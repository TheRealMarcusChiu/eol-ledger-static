// Model, matching, static API and shipping checks (run: npm test). Browser behaviour: test/browser_check.py.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../model.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f));
const catalogue = JSON.parse(read('data/catalogue-upstream.json'));
const inventory = JSON.parse(read('data/demo-dependency-inventory.json'));
const prov = JSON.parse(read('data/catalogue-provenance.json'));
const TODAY = '2026-11-24';
const model = M.build(catalogue, inventory, TODAY);
const plain = (o) => JSON.parse(JSON.stringify(o));

/** app.js's pure helpers, loaded like the source project's own app tests do. */
const app = (() => {
  const ctx = vm.createContext({ window: {}, document: { addEventListener() {}, getElementById() { return null; } }, URL });
  vm.runInContext(read('app.js').toString(), ctx);
  return ctx;
})();
const api = (view, size) => M.dashboardApi('https://x.test/eol-ledger-static/api/dashboard?view=' + encodeURIComponent(JSON.stringify(Object.assign({ v: 1 }, view))), model.dashboard, app);

test('the frozen snapshot is the recorded, unmodified upstream response', () => {
  const bytes = read('data/catalogue-upstream.json');
  assert.strictEqual(crypto.createHash('sha256').update(bytes).digest('hex'), prov.sha256);
  assert.strictEqual(bytes.length, prov.bytes);
  assert.strictEqual(catalogue.generated_at, prov.upstreamGeneratedAt);
  assert.strictEqual(catalogue.schema_version, prov.upstreamSchemaVersion);
  assert.strictEqual(catalogue.total, prov.products);
});

test('every product and every release cycle of the catalogue is loaded, and the dashboard lists them all, used or not', () => {
  const expected = new Map();
  catalogue.result.forEach((p) => expected.set(p.name, new Set(p.releases.map((r) => r.name))));
  const cycles = [...expected.values()].reduce((n, s) => n + s.size, 0);
  assert.strictEqual(cycles, prov.releaseCycles);
  assert.deepStrictEqual(model.catalogue.failures, []);
  assert.strictEqual(model.catalogue.products.size, prov.products);
  assert.strictEqual(model.dashboard.rows.length, cycles);
  const unused = model.dashboard.rows.filter((r) => r.repos === 0);
  assert.strictEqual(unused.length, cycles - 20);
  unused.forEach((r) => {
    assert.strictEqual(r.version, 'Not installed');
    assert.strictEqual(r.branches, 0);
    assert.strictEqual(r.dependency, model.catalogue.products.get(r.product).label);
  });
  // EoL date ascending, unknown last, then product and cycle
  const dates = model.dashboard.rows.map((r) => r.eol);
  const firstBlank = dates.indexOf('');
  assert.ok(dates.slice(firstBlank).every((d) => d === ''));
  assert.deepStrictEqual(dates.slice(0, firstBlank), dates.slice(0, firstBlank).slice().sort());
});

test('lifecycle dates and labels are taken from the snapshot, never invented', () => {
  const raw = new Map(catalogue.result.map((p) => [p.name, p]));
  model.dashboard.rows.forEach((r) => {
    const release = raw.get(r.product).releases.filter((x) => x.name === r.cycle).pop();
    assert.strictEqual(r.eol, release.eolFrom || '');
  });
});

const dep = (name, version) => {
  for (const b of model.branches) for (const d of b.deps) if (d.name === name && d.version === version) return d;
  throw new Error('no ' + name + ' ' + version);
};

test('demo packages map to the right product and cycle', () => {
  const cases = [
    ['org.springframework:spring-core', '7.0.11', 'spring-framework', '7.0'],
    ['org.springframework:spring-core', '5.3.39', 'spring-framework', '5.3'],
    ['django', '5.2.19', 'django', '5.2'],
    ['django', '3.2.25', 'django', '3.2'],
    ['org.hibernate:hibernate-core', '5.6.15.Final', 'hibernate-orm', '5.6'], // vendor suffix
    ['org.apache.logging.log4j:log4j-core', '2.12.4', 'log4j', '2.12'], // longest cycle, not "2"
    ['next', '14.2.28', 'nextjs', '14'],
    ['@angular/core', '19.2.14', 'angular', '19'],
  ];
  for (const [name, version, product, cycle] of cases) {
    const d = dep(name, version);
    assert.strictEqual(d.match.product, product, name);
    assert.strictEqual(d.cycle.name, cycle, name + ' ' + version);
    assert.match(d.match.evidence, new RegExp('is an endoflife.date identifier of ' + product + '; version .* falls in cycle ' + cycle.replace('.', '\\.') + '$'));
  }
  const spring = model.dashboard.rows.find((r) => r.product === 'spring-framework' && r.cycle === '5.3');
  assert.strictEqual(spring.repos, 2);
  assert.strictEqual(spring.branches, 2);
  assert.strictEqual(spring.eol, '2024-08-31');
  assert.strictEqual(spring.status, 'Ended 2 years ago');
});

test('unmatched packages stay unknown with honest evidence and are counted', () => {
  const rxjs = model.branches.flatMap((b) => b.deps).find((d) => d.name === 'rxjs');
  assert.strictEqual(rxjs.match.product, null);
  assert.strictEqual(rxjs.cycle, null);
  assert.strictEqual(rxjs.match.evidence, 'No catalogue identifier or mapping for pkg:npm/rxjs');
  assert.deepStrictEqual(rxjs.eol, { css: 'unknown', text: 'Not mapped to an upstream product' });
  const all = model.branches.flatMap((b) => b.deps);
  assert.strictEqual(model.dashboard.unmatched, all.filter((d) => !d.cycle).length);
  assert.ok(model.dashboard.unmatched > 0);
});

test('demo code repos keep their synthetic labels and are never shown as hosted links', () => {
  assert.strictEqual(model.branches.length, 22);
  assert.strictEqual(new Set(model.branches.map(M.repoKey)).size, 11);
  model.branches.forEach((b) => {
    assert.match(b.repoUrl, /^https:\/\/example\.invalid\//);
    assert.strictEqual(M.liveLink(b.repoUrl), null);
    assert.ok(b.inline.demo);
    assert.match(b.facts.appId, /^DEMO-\d+$/);
    assert.ok(b.deps.some((d) => d.cycle), b.repoName + ' ' + b.branch + ' has a lifecycle-tracked package');
  });
  assert.strictEqual(M.liveLink('https://endoflife.date/python'), 'https://endoflife.date/python');
  assert.strictEqual(M.safeLink('javascript:alert(1)'), null);
  assert.strictEqual(M.safeLink('https://user:pw@x.test/'), null);
});

test('matcher rules: purl normalization, cycles and refusals', () => {
  const cat = M.parseCatalogue({ total: 5, result: [
    { name: 'python', releases: [{ name: '3.1' }, { name: '3.10' }, { name: 'bookworm' }], identifiers: [{ type: 'purl', id: 'pkg:pypi/my_lib' }] },
    { name: 'react', releases: [{ name: '18' }, { name: '17' }], identifiers: [{ type: 'purl', id: 'pkg:npm/react' }] },
    { name: 'acme', releases: [{ name: '1' }], identifiers: [{ type: 'purl', id: 'pkg:maven/Org.Acme/x' }, { type: 'purl', id: 'pkg:npm/shared' }] },
    { name: 'other', releases: [{ name: '1' }], identifiers: [{ type: 'purl', id: 'pkg:npm/shared' }] },
    { name: 'core', releases: [{ name: '2' }] },
  ] });
  const m = (n, v, p) => plain(M.match(cat, n, v, p));
  assert.strictEqual(m('x', '3.10.5', 'pkg:pypi/My_Lib@3.10.5').cycle, '3.10');
  assert.strictEqual(m('x', '3.1.4', 'pkg:pypi/my-lib@3.1.4').cycle, '3.1');
  assert.strictEqual(m('react', '18.2.0', 'pkg:npm/React@18.2.0').cycle, '18');
  assert.strictEqual(m('react', 'v17.0.2', null).cycle, '17');
  const rc = m('react', '18.0.0-rc1', 'pkg:npm/react@18.0.0-rc1');
  assert.strictEqual(rc.cycle, null);
  assert.match(rc.evidence, /is not a plain release version/);
  assert.strictEqual(m('x', '1.0', 'pkg:maven/Org.Acme/x@1.0').product, 'acme');
  assert.strictEqual(m('x', '1.0', 'pkg:maven/org.acme/x@1.0').product, null); // Maven stays case-sensitive
  assert.match(m('x', '1', 'pkg:npm/shared@1').evidence, /listed by several products acme, other/);
  assert.match(m('x', '1', 'nonsense').evidence, /^malformed purl nonsense; not matched by package name either$/);
  assert.strictEqual(m('core', '2.0', null).product, 'core'); // no purl: exact name
  assert.strictEqual(m('core', '2.0', 'pkg:npm/core@2.0').product, null); // a purl is never matched by name
  const conflict = m('react', '18.1.0', 'pkg:npm/react@18.2.0');
  assert.strictEqual(conflict.product, 'react');
  assert.strictEqual(conflict.cycle, null);
  assert.match(conflict.evidence, /conflicts with purl version 18\.2\.0/);
  assert.match(m('react', null, 'pkg:npm/react@17.0.1').evidence, /version 17\.0\.1 taken from the purl.*falls in cycle 17$/);
  assert.strictEqual(M.normalizePurl('pkg:npm/%40angular/core@1?x=1#y'), 'pkg:npm/@angular/core');
  assert.strictEqual(M.normalizePurl('pkg:npm/a%2Fb'), 'pkg:npm/a%2fb'); // stays one segment; npm then lower-cases, as in Java
  assert.strictEqual(M.normalizePurl('pkg:maven/a%2Fb/X'), 'pkg:maven/a%2Fb/X');
  assert.strictEqual(M.normalizePurl('pkg:npm/bad%zz'), null);
  assert.throws(() => M.parseCatalogue({ total: 3, result: [] }), /total does not match/);
  assert.match(M.parseCatalogue({ result: [{ name: 'BAD', releases: [] }, { name: 'ok', releases: [{ name: '1', eolFrom: '2020-02-30' }] }] }).failures.join(), /BAD.*ok \(invalid date\)/);
});

test('EoL status follows the source wording', () => {
  const e = (c) => M.eolOf(c, TODAY);
  assert.deepStrictEqual(e({ eolFrom: '2026-11-23' }), { css: 'ended', text: 'Ended 1 day ago' });
  assert.deepStrictEqual(e({ eolFrom: '2026-11-24' }), { css: 'ended', text: 'Ends today' });
  assert.deepStrictEqual(e({ eolFrom: '2027-03-01' }), { css: 'soon', text: 'Ends in 3 months' });
  assert.deepStrictEqual(e({ eolFrom: '2030-01-01' }), { css: 'ok', text: 'Ends in 3 years' });
  assert.deepStrictEqual(e({ eolFrom: null, isEol: true }), { css: 'ended', text: 'Ended (date not published)' });
  assert.deepStrictEqual(e({ eolFrom: null, isEol: false }), { css: 'unknown', text: 'No EoL date announced' });
  assert.deepStrictEqual(e(null), { css: 'unknown', text: 'Unknown: no matched release cycle' });
});

test('static dashboard API: filters apply to the whole table before paging, page sizes 1..1000, empty results', () => {
  const total = model.dashboard.rows.length;
  let p = api({});
  assert.deepStrictEqual([p.total, p.matching, p.page, p.pages, p.size, p.rows.length], [total, total, 1, Math.ceil(total / 20), 20, 20]);
  assert.ok(app.validPage(plain(p)), 'answer has the shape app.js validates');
  assert.strictEqual(api({ size: 1 }).rows.length, 1);
  assert.strictEqual(api({ size: 1000 }).rows.length, 1000);
  assert.strictEqual(api({ size: 1001 }).size, 20);
  assert.strictEqual(api({ size: 7.5 }).size, 20);
  p = api({ page: 99999 });
  assert.strictEqual(p.page, p.pages);

  const used = api({ filters: { repos: { mode: 'range', startText: '1' } }, size: 7 });
  assert.strictEqual(used.matching, 20);
  assert.strictEqual(used.pages, 3);
  assert.strictEqual(api({ filters: { repos: { mode: 'range', startText: '1' } }, size: 7, page: 3 }).rows.length, 6);
  const pages = [1, 2, 3].flatMap((n) => api({ filters: { repos: { mode: 'range', startText: '1' } }, size: 7, page: n }).rows.map((r) => r.product + ' ' + r.cycle));
  assert.strictEqual(new Set(pages).size, 20);

  const django = api({ filters: { dependency: { mode: 'text', op: 'contains', text: 'django' } }, size: 3 });
  const expected = model.dashboard.values.filter((v) => v.dependency.toLowerCase().includes('django')).length;
  assert.strictEqual(django.matching, expected);
  assert.ok(expected > 3, 'more matches than one page');
  assert.ok(django.rows.every((r) => /django/i.test(r.dependency)));

  const none = api({ filters: { dependency: { mode: 'text', op: 'contains', text: 'zzzz-no-such' } } });
  assert.deepStrictEqual([none.matching, none.page, none.pages, none.rows.length, none.total], [0, 1, 1, 0, total]);
  assert.strictEqual(api({ filters: { status: { mode: 'values', selected: [] } } }).matching, 0);
  assert.strictEqual(api({ filters: { repos: { mode: 'values', excluded: ['0'] } } }).matching, 20);

  const sorted = api({ sort: { key: 'repos', dir: 'desc' } }).rows;
  assert.strictEqual(sorted[0].repos, 2);
  const fuzzy = api({ filters: { dependency: { mode: 'text', op: 'fuzzy', text: 'pyhton' } } });
  assert.ok(fuzzy.rows.some((r) => r.product === 'python'));
});

test('static dashboard API: column values cover the whole table', () => {
  const values = (k) => M.dashboardApi('https://x.test/api/dashboard/values?column=' + k, model.dashboard, app);
  const eol = values('eol');
  assert.ok(app.validValues(plain(eol)));
  assert.deepStrictEqual(plain(eol[eol.length - 1]), { value: '', label: 'Not published' });
  assert.deepStrictEqual(values('repos').map((v) => v.value), ['0', '1', '2']);
  assert.throws(() => values('nope'), /HTTP 400/);
});

test('no markup injection, no backend calls, no root-absolute URLs', () => {
  const code = read('static.js') + read('model.js');
  assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
  const appJs = read('app.js').toString();
  assert.doesNotMatch(appJs, /method:\s*'POST'|fetch\('\/|'\/catalog\//);
  assert.strictEqual(appJs.match(/\bfetch\(/g).length, 1, 'only the dashboard JSON call, which static.js answers');
  for (const f of fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))) {
    assert.doesNotMatch(read(f).toString(), /(href|src|action)="\/(?!\/)/, f);
    assert.doesNotMatch(read(f).toString(), /<form/, f);
  }
});

test('only allowlisted files ship', () => {
  const ALLOW = ['.gitignore', '.nojekyll', 'README.md', 'package.json', 'index.html', 'repos.html', 'branch.html', 'dependency.html', 'product.html', 'imports.html',
    'app.css', 'app.js', 'theme.js', 'model.js', 'static.js', 'favicon.svg', 'favicon.ico', 'apple-touch-icon.png',
    'fonts/README.md', 'fonts/newsreader-latin-standard-normal.woff2', 'fonts/newsreader-latin-standard-italic.woff2', 'fonts/jetbrains-mono-latin-wght-normal.woff2',
    'data/catalogue-upstream.json', 'data/catalogue-provenance.json', 'data/demo-dependency-inventory.json',
    'LICENSES/Newsreader-OFL.txt', 'LICENSES/JetBrainsMono-OFL.txt', 'LICENSES/endoflife.date-MIT.txt',
    'test/model.test.js', 'test/browser_check.py'].sort();
  const found = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, e.name);
      if (rel === '.git' || rel === 'node_modules' || e.name === '__pycache__') continue;
      if (e.isDirectory()) walk(rel); else found.push(rel);
    }
  })('');
  assert.deepStrictEqual(found.sort(), ALLOW);
});
