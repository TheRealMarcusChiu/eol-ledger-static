"""Real-browser acceptance for the static demo (run: npm run check:browser [screenshot dir]).

Serves this folder under /eol-ledger-static/ (as GitHub Pages will) and drives Chromium at desktop and mobile sizes.
Every check runs; failures are listed and the exit status is 1 if any failed.
"""
import functools
import http.server
import math
import os
import re
import sys
import tempfile
import threading

from playwright.sync_api import expect, sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
CYCLES = 9476


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    tmp = tempfile.mkdtemp()
    os.symlink(ROOT, os.path.join(tmp, 'eol-ledger-static'))
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=tmp))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, 'http://127.0.0.1:%d/eol-ledger-static/' % httpd.server_port


def ready(page):
    page.wait_for_selector('html[data-app-ready]')
    if page.locator('main table').count():
        page.wait_for_selector('main table[data-table-ready]')
    if page.locator('#dependencies-table').count():
        page.wait_for_function("document.querySelector('#dependencies-table').getAttribute('aria-busy') === null"
                               " && !!document.querySelector('[data-filter-count]').textContent")


def go(page, url):
    page.goto(url)
    ready(page)


def run(name, viewport, base, browser):
    results = []
    extra = {'is_mobile': True, 'has_touch': True, 'device_scale_factor': 2} if name == 'mobile' else {}
    ctx = browser.new_context(viewport=viewport, **extra)
    page = ctx.new_page()
    requests, errors = [], []
    page.on('request', lambda r: requests.append((r.method, r.url)))
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    count = page.locator('[data-filter-count]').first
    status = page.locator('[data-page-status]').first
    size = page.locator('[data-page-size]').first
    dash_rows = page.locator('#dependencies-table tbody tr:not([data-empty])')

    def check(label, fn):
        try:
            fn()
            results.append((label, None))
        except Exception as e:  # noqa: BLE001 - every failure is reported, none hidden
            results.append((label, str(e).splitlines()[0][:300]))

    def shot(n):
        if SHOTS:
            page.screenshot(path=os.path.join(SHOTS, '%s-%s.png' % (name, n)), full_page=False)

    def dashboard_default():
        go(page, base)
        assert '[object ' not in page.locator('main').inner_text(), 'a DOM node was rendered as text'
        expect(count).to_have_text('%d of %d dependencies' % (CYCLES, CYCLES))
        expect(dash_rows).to_have_count(20)
        expect(status).to_have_text('Page 1 of %d' % math.ceil(CYCLES / 20))
        expect(page.locator('#dependencies-table th[data-column="eol"]')).to_have_attribute('aria-sort', 'ascending')
        shot('dashboard')

    def dashboard_page_size():
        size.fill('50')
        size.press('Enter')
        expect(dash_rows).to_have_count(50)
        expect(status).to_have_text('Page 1 of %d' % math.ceil(CYCLES / 50))
        assert '%22size%22%3A50' in page.url or '"size":50' in page.url, page.url
        page.reload()
        ready(page)
        expect(dash_rows).to_have_count(50)
        expect(size).to_have_value('50')
        size.fill('0')
        size.press('Enter')
        expect(page.locator('[data-page-size-error]').first).to_contain_text('whole number from 1 to 1000')
        expect(dash_rows).to_have_count(50)
        size.fill('1000')
        size.press('Enter')
        expect(dash_rows).to_have_count(1000)
        size.fill('50')
        size.press('Enter')
        expect(dash_rows).to_have_count(50)
        first = dash_rows.first.get_attribute('data-row')
        page.locator('[data-page-next]').first.click()
        expect(status).to_have_text('Page 2 of %d' % math.ceil(CYCLES / 50))
        assert dash_rows.first.get_attribute('data-row') != first

    def dashboard_filters():
        page.locator('[data-filter-open="dependency"]').click()
        page.locator('[data-filter-mode="dependency"]').select_option('text')
        page.locator('[data-filter-text="dependency"]').fill('django')
        expect(count).to_have_text(re.compile(r'^\d+ matching dependencies of %d$' % CYCLES))
        n = int(count.text_content().split()[0])
        assert n >= 2, n
        expect(status).to_have_text('Page 1 of %d' % math.ceil(n / 50))  # filtered before paging, from page 1
        expect(dash_rows).to_have_count(min(n, 50))
        page.locator('[data-filter-text="dependency"]').fill('zzzz-no-such')
        expect(count).to_have_text('0 matching dependencies of %d' % CYCLES)
        expect(page.locator('#dependencies-table tr[data-empty]')).to_be_visible()
        expect(page.locator('#dependencies-table tr[data-empty]')).to_have_text('No dependency versions match.')
        expect(status).to_have_text('Page 1 of 1')
        shot('dashboard-empty')
        page.keyboard.press('Escape')
        page.locator('[data-filters-clear-all]').first.click()
        expect(count).to_have_text('%d of %d dependencies' % (CYCLES, CYCLES))
        page.locator('[data-filter-open="repos"]').click()
        page.locator('[data-filter-mode="repos"]').select_option('range')
        page.locator('[data-filter-start="repos"]').fill('1')
        expect(count).to_have_text('20 matching dependencies of %d' % CYCLES)
        page.keyboard.press('Escape')
        page.locator('[data-filter-open="status"]').click()
        page.locator('[data-filter-mode="status"]').select_option('values')
        expect(page.locator('[data-filter-value="status"]').first).to_be_attached()
        page.keyboard.press('Escape')

    def drilldown_and_back():
        filtered = page.url
        page.locator('#dependencies-table tbody tr[data-href]').first.locator('a').first.click()
        ready(page)
        assert 'product.html?product=' in page.url and '&version=' in page.url, page.url
        expect(page.locator('h1')).to_be_visible()
        expect(page.locator('#affected-branches-table tbody tr[data-href]').first).to_be_attached()
        shot('cycle')
        page.go_back()
        ready(page)
        assert page.url == filtered, page.url
        expect(count).to_have_text('20 matching dependencies of %d' % CYCLES)

    def repos_and_branch():
        go(page, base + 'repos.html')
        expect(count).to_have_text('22 of 22 code repo branches')
        expect(status).to_have_text('Page 1 of 2')
        assert page.locator('a[href*="example.invalid"]').count() == 0, 'synthetic URL shown as a link'
        expect(page.locator('#code-repos-table tbody')).to_contain_text('https://example.invalid/')
        size.fill('5')
        size.press('Enter')
        expect(status).to_have_text('Page 1 of 5')
        shot('repos')
        go(page, base)
        expect(dash_rows).to_have_count(50)  # the dashboard keeps its own size
        go(page, base + 'repos.html')
        expect(status).to_have_text('Page 1 of 5')
        # app.js: a plain mouse click on a value's text selects it; Enter on the row link navigates
        page.locator('#code-repos-table tbody tr[data-href]').first.locator('a.cell-link').first.press('Enter')
        ready(page)
        assert re.search(r'branch\.html\?id=\d+$', page.url), page.url
        expect(page.locator('main')).to_contain_text('Fictional synthetic demo code repo')
        expect(page.locator('#latest-dependencies-table tbody tr[data-href]').first).to_be_attached()
        assert page.locator('a[href*="example.invalid"]').count() == 0
        shot('branch')
        branch = page.url
        page.locator('#latest-dependencies-table td[data-column="evidence"] a', has_text='Details').first.click()
        ready(page)
        assert 'dependency.html?branch=' in page.url, page.url
        expect(page.locator('dl.facts')).to_contain_text('falls in cycle')
        page.go_back()
        ready(page)
        assert page.url == branch

    def product_pages():
        go(page, base + 'product.html?product=django')
        expect(page.locator('h1')).to_have_text('Django')
        expect(page.locator('#release-cycles-table tbody tr[data-href]').first).to_be_attached()
        go(page, base + 'product.html?product=django&version=3.2')
        expect(page.locator('#affected-branches-table tbody tr[data-href]')).to_have_count(2)
        expect(page.locator('dl.facts')).to_contain_text('3.2.25')
        expect(page.locator('dl.facts')).to_contain_text('2024-04-01')

    def not_found_and_imports():
        for u in ['branch.html?id=999', 'branch.html?id=<img>', 'dependency.html?branch=1&dep=99999', 'product.html?product=nope', 'product.html?product=django&version=0.0']:
            page.goto(base + u)
            expect(page.locator('h1')).to_have_text('Page not found')
        go(page, base + 'imports.html')
        expect(page.locator('main')).to_contain_text('489 products, %d release cycles; every product parsed' % CYCLES)
        expect(page.locator('main')).to_contain_text('703b5dbb4f45462f11641e0f1230e3e3fd6618f5332b5428038af961adadd11c')
        assert page.locator('form').count() == 0
        shot('imports')

    def layout():
        go(page, base)
        over = page.evaluate('document.documentElement.scrollWidth - window.innerWidth')
        assert over <= 1, 'page scrolls sideways by %dpx' % over

    for label, fn in [('dashboard default view', dashboard_default), ('dashboard typed page size + reload', dashboard_page_size),
                      ('dashboard global filters + empty state', dashboard_filters), ('drill-down + back restores view', drilldown_and_back),
                      ('code repos + branch + package drill-down', repos_and_branch), ('product + cycle pages', product_pages),
                      ('not-found routes + imports page', not_found_and_imports), ('no sideways page scroll', layout)]:
        check(label, fn)

    def network():
        bad = [(m, u) for m, u in requests if m != 'GET' or not u.startswith(base) or '/api/' in u]
        assert not bad, bad[:5]
    check('only same-origin GETs of static files', network)
    check('no page errors', lambda: (_ for _ in ()).throw(AssertionError(errors[:5])) if errors else None)
    ctx.close()
    return results


def main():
    httpd, base = serve()
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
    failed = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name, viewport in [('desktop', {'width': 1366, 'height': 900}), ('mobile', {'width': 390, 'height': 844})]:
            for label, err in run(name, viewport, base, browser):
                print('%-4s %-8s %s%s' % ('ok' if err is None else 'FAIL', name, label, '' if err is None else ': ' + err))
                failed += err is not None
        browser.close()
    httpd.shutdown()
    print('%d failed' % failed)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
