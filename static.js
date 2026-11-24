// Renders each page of the static demo from the bundled data (model.js), shaped like the source's Thymeleaf templates, then
// loads app.js to enhance its tables. Data only ever becomes text nodes or attribute values, never markup.
(function () {
  'use strict';
  var M = window.EolModel;
  var root = document.documentElement;
  var main = document.getElementById('main');
  var q = new URL(window.location.href).searchParams;

  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v; else el.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(function (k) { add(el, k); });
    else el.append(kid);
  }
  /** Appends to main; nested arrays (like dependencyTable's) are flattened, never stringified. */
  function show() { add(main, Array.prototype.slice.call(arguments)); }
  function title(t) { document.title = t + ' · EoL Ledger'; }
  function fact(dt, dd) { return [h('dt', null, dt), dd]; }
  function eolSpan(e) { return h('span', { class: 'eol eol-' + e.css }, e.text); }
  function muted(t) { return h('span', { class: 'muted' }, t); }
  /** A repo or SBOM URL: an external link only when it is a real http(s) host, else plain text. */
  function urlText(url, blank) {
    var link = M.liveLink(url);
    return link ? h('a', { href: link, rel: 'noopener noreferrer' }, url) : h('span', null, url == null ? blank : url);
  }

  function notFound() {
    title('Page not found');
    show(h('h1', null, 'Page not found'),
      h('p', { class: 'lede' }, 'The code repo, product or page does not exist. It may have been typed incorrectly.'),
      h('p', null, h('a', { href: './' }, 'Back to EoL Dependencies')));
  }

  function demoNotice(prov) {
    return h('div', { class: 'notice', role: 'status' }, 'Static read-only demo: EoL dates come from a frozen endoflife.date snapshot generated ',
      M.time(prov.upstreamGeneratedAt), '; the code repos are fictional DEMO inventories (example.invalid placeholders, not remotely hosted). ',
      h('a', { href: 'imports.html' }, 'About this data'), '.');
  }

  // ---- the shared dependency table (fragments.html dependencyTable) ----

  var COLS = [['ecosystem', 'Ecosystem'], ['dependency', 'Dependency Name'], ['version', 'Version', 'version'], ['eol', 'EOL Date', 'date'],
    ['status', 'Status'], ['repos', '# Code Repos Using It', 'number'], ['branches', '# Code Repo Branches Using It', 'number'],
    ['purl', 'Ecosystem / Package URL'], ['context', 'Project context'], ['cycle', 'Upstream cycle'], ['evidence', 'Matching evidence'],
    ['source', 'Source control'], ['sbom', 'SBOM']];

  function dependencyTable(dash, tbody, attrs) {
    return [
      h('details', { id: 'table-settings', class: 'help', hidden: true }, h('summary', null, 'Table settings'), h('div', { class: 'col-settings' }),
        h('button', { type: 'button', 'data-columns-reset': true }, 'Reset columns')),
      h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': dash ? 'EoL Dependencies' : 'Dependencies' },
        h('table', Object.assign({ id: dash ? 'dependencies-table' : 'latest-dependencies-table', 'data-dependency-table': dash ? 'dashboard' : 'branch',
          'data-legacy': 'false' }, attrs),
          h('colgroup', null, COLS.map(function (c) { return h('col', { 'data-column': c[0] }); })),
          h('thead', null, h('tr', null, COLS.map(function (c) {
            return h('th', { scope: 'col', 'data-type': c[2], class: c[2] === 'number' ? 'num' : null, 'data-column': c[0] }, c[1]);
          }))),
          tbody))];
  }

  /** fragments.html inventoryRows: one snapshot's packages. */
  function inventoryRows(b, deps) {
    var rows = deps.map(function (d) {
      var detail = M.depHref(b.id, d.id), c = d.cycle;
      var href = c ? M.productHref(c.product, c.name) : detail;
      return h('tr', { 'data-href': href },
        h('td', { 'data-column': 'ecosystem' }, d.ecosystem || 'Unknown'),
        h('td', { 'data-column': 'dependency' }, h('a', { href: href }, d.name)),
        h('td', { 'data-column': 'version' }, d.displayVersion),
        h('td', { 'data-column': 'eol', class: 'date', 'data-value': c && c.eolFrom || '' }, c ? c.eolFrom || 'Not published' : ''),
        h('td', { 'data-column': 'status' }, eolSpan(d.eol)),
        h('td', { 'data-column': 'repos', class: 'num', 'data-value': '1' }, '1'),
        h('td', { 'data-column': 'branches', class: 'num', 'data-value': '1' }, '1'),
        h('td', { 'data-column': 'purl' }, h('span', null, d.ecosystem || 'n/a'), h('br'), d.purl ? h('code', { class: 'small muted' }, d.purl) : null),
        h('td', { 'data-column': 'context', class: 'small' }, b.inline.context(d)),
        h('td', { 'data-column': 'cycle' }, c ? h('span', null, c.productLabel + ' ' + c.name)
          : d.match.product ? h('span', { class: 'muted' }, d.match.product + ', cycle unknown') : h('span', { class: 'muted' }, 'No upstream mapping')),
        h('td', { 'data-column': 'evidence', class: 'small' }, h('span', null, d.match.evidence), c ? [' ', h('a', { href: detail }, 'Details')] : null),
        h('td', { 'data-column': 'source', class: 'col-source' }, urlText(b.repoUrl, '—')),
        h('td', { 'data-column': 'sbom', class: 'col-sbom' }, h('span', null, 'Inline upload')));
    });
    if (!deps.length) rows.push(h('tr', null, h('td', { colspan: '13', class: 'empty' }, 'No packages in this snapshot.')));
    return h('tbody', null, rows);
  }

  /** fragments.html inlineFacts: what the bundled JSON entry declared about itself; nothing here was fetched. */
  function inlineFacts(inl) {
    return h('dl', { class: 'facts' },
      fact('Inventory source', h('dd', null, 'Inline JSON ', muted('(bundled demo inventory, read-only)'))),
      fact('App ID', h('dd', null, inl.appId || 'Not stated')),
      fact('Projects / modules', h('dd', null, inl.projects.length ? null : muted('None declared'),
        h('ul', { class: 'plain' }, inl.projects.map(function (p) { return h('li', null, p); })))),
      fact('Declared SBOM', h('dd', null, inl.declaredSbomUrl == null ? muted('None (inline inventory only)')
        : [urlText(inl.declaredSbomUrl, ''), ' ', muted('(declared, never fetched)')])),
      fact('Generated', h('dd', null, inl.generatedAt || 'Not stated')),
      inl.demo || inl.localRepository != null ? fact('Demo', h('dd', null,
        inl.demo ? h('span', null, 'Fictional synthetic demo code repo: its URL is a placeholder and is not remotely hosted. ') : null,
        inl.localRepository != null ? h('span', null, 'Source: ', h('code', null, inl.localRepository), ' ',
          muted('(git bundle in the source project\'s demo evidence; not part of this static site)')) : null)) : null);
  }

  // ---- pages ----

  var pages = {
    dashboard: function (model, prov) {
      title('EoL Dependencies');
      var dash = model.dashboard;
      // app.js asks for api/dashboard pages and value lists; they are answered here, from the static rows, never sent.
      window.EolStaticApi = function (url) { return Promise.resolve().then(function () { return M.dashboardApi(url, dash, window); }); };
      show(
        h('div', { class: 'page-head title-row' }, h('h1', null, 'EoL Dependencies'), h('span', { class: 'hint' }, 'Catalogue snapshot ', M.time(prov.upstreamGeneratedAt))),
        demoNotice(prov),
        dependencyTable(true, h('tbody', null, h('tr', { 'data-empty': true, hidden: true }, h('td', { colspan: '13', class: 'empty' }, 'No dependency versions match.'))),
          { 'data-start': '', 'data-end': '', 'data-sort': 'asc', 'data-server': 'api/dashboard', 'data-total': dash.rows.length,
            'data-matching': dash.rows.length, 'data-sync-running': 'false' }),
        dash.unmatched ? h('p', { class: 'hint' }, String(dash.unmatched), ' installed packages have no release cycle; see each ',
          h('a', { href: 'repos.html' }, 'code repo branch'), ' for why.') : null);
    },

    repos: function (model) {
      title('Code repos');
      var head = [['App ID', 0], ['Repository name', 8], ['Code repo', 1], ['Branch', 2], ['Version', 6, 'version'], ['Provider', 3],
        ['SBOM Format', 7], ['Packages', 4, 'number'], ['Latest snapshot', 5, 'datetime']];
      show(h('div', { class: 'page-head' }, h('h1', null, 'Code repos')), h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Code repo branches' },
        h('table', { id: 'code-repos-table' },
          h('thead', null, h('tr', null, head.map(function (c) {
            return h('th', { scope: 'col', 'data-preference-index': c[1], 'data-type': c[2], class: c[2] === 'number' ? 'num' : null }, c[0]);
          }))),
          h('tbody', null, model.branches.map(function (b) {
            var seen = M.time(b.observedAt);
            return h('tr', { 'data-href': M.branchHref(b.id) },
              h('td', { 'data-column': 'appid' }, b.facts.appId || '—'),
              h('td', { 'data-column': 'name' }, M.nameText(b)),
              h('td', { 'data-column': 'repo', class: 'col-source' }, urlText(b.repoUrl, '—')),
              h('td', { 'data-column': 'branch' }, h('span', null, M.branchText(b))),
              h('td', { 'data-column': 'version' }, b.facts.version || '—'),
              h('td', { 'data-column': 'provider' }, b.provider || '—'),
              h('td', { 'data-column': 'format' }, b.facts.format || '—'),
              h('td', { 'data-column': 'packages', class: 'num' }, String(b.depCount)),
              h('td', { 'data-column': 'snapshot', class: 'date small', 'data-value': seen }, seen || 'Not stated'));
          }), model.branches.length ? null : h('tr', null, h('td', { colspan: '9', class: 'empty' }, 'No code repos.'))))));
    },

    branch: function (model) {
      var b = /^\d+$/.test(q.get('id') || '') ? model.branch(Number(q.get('id'))) : null;
      if (!b) return notFound();
      title(M.nameText(b) + ' @ ' + M.branchText(b));
      show(
        h('div', { class: 'page-head' }, h('p', { class: 'crumbs' }, h('a', { href: 'repos.html' }, 'Code repos'), ' / ', h('span', null, M.nameText(b))),
          h('div', { class: 'title-row' }, h('h1', null, h('span', null, M.nameText(b)), ' ', muted('@'), ' ', h('span', null, M.branchText(b))))),
        h('section', { class: 'panel' },
          h('dl', { class: 'facts' },
            fact('Code repo', h('dd', null, urlText(b.repoUrl, '—'), ' ', muted('(' + (b.provider || '—') + ')'))),
            fact('Branch', h('dd', null, h('code', null, M.branchText(b)))),
            fact('SBOM', h('dd', null, 'Inline upload ', muted('(nothing fetched)'))),
            fact('Latest snapshot', h('dd', null, M.time(b.observedAt) || 'Not stated', ' ', muted('(the inventory\'s generatedAt; the static demo has no import time)')))),
          inlineFacts(b.inline)),
        h('h2', null, 'Latest dependencies'),
        dependencyTable(false, inventoryRows(b, M.dependencyRows(b)), {}));
    },

    dependency: function (model) {
      var b = /^\d+$/.test(q.get('branch') || '') ? model.branch(Number(q.get('branch'))) : null;
      var id = Number(q.get('dep'));
      var d = b && /^\d+$/.test(q.get('dep') || '') ? b.deps.find(function (x) { return x.id === id; }) : null;
      if (!d) return notFound();
      title(d.name);
      var norm = M.normalizePurl(d.purl), c = d.cycle;
      show(
        h('div', { class: 'page-head' }, h('p', { class: 'crumbs' }, h('a', { href: 'repos.html' }, 'Code repos'), ' / ',
          h('a', { href: M.branchHref(b.id) }, M.nameText(b) + ' @ ' + M.branchText(b)), ' / ', h('span', null, d.name)), h('h1', null, d.name)),
        h('section', { class: 'panel' }, h('dl', { class: 'facts' },
          fact('Installed version', h('dd', null, h('code', null, d.displayVersion))),
          fact('purl', h('dd', null, h('code', null, d.purl || 'none in SBOM'))),
          fact('Normalized identity', h('dd', null, h('code', null, norm || 'n/a (matched by package name only)'))),
          fact('Ecosystem', h('dd', null, d.ecosystem || 'Unknown')),
          fact('Upstream product', h('dd', null, d.match.product ? h('a', { href: M.productHref(d.match.product) }, d.match.product)
            : h('span', null, 'Not mapped to an endoflife.date product'))),
          fact('Release cycle', h('dd', null, c ? h('a', { href: M.productHref(c.product, c.name) }, c.name) : h('span', null, 'Unknown'))),
          fact('EoL status', h('dd', null, eolSpan(d.eol))),
          fact('Matching evidence', h('dd', null, d.match.evidence)))),
        c ? null : h('details', { class: 'help' }, h('summary', null, 'How to map this package'),
          h('p', null, 'EoL Ledger only matches a package when its purl is listed as an identifier by exactly one endoflife.date product, ',
            'or when you configure an explicit mapping. It never guesses from generic names or ecosystems.'),
          h('p', null, 'In the full EoL Ledger app you would add a mapping such as ', h('code', null, 'eol.mappings=' + (norm || d.name.toLowerCase()) + '=<product>'),
            ' (environment variable ', h('code', null, 'EOL_MAPPINGS'), ') and restart. This static demo configures no mappings.')));
    },

    product: function (model, prov) {
      var p = model.catalogue.products.get(q.get('product') || '');
      if (!p) return notFound();
      var today = model.today;
      if (q.has('version')) return cycle(model, prov, p, q.get('version'));
      title(p.label + ' releases');
      var counts = M.repoCountsByCycle(model, p.name);
      show(
        h('div', { class: 'page-head' }, h('p', { class: 'crumbs' }, h('a', { href: './' }, 'EoL Dependencies'), ' / ', h('span', null, p.label)),
          h('h1', null, p.label),
          h('p', { class: 'lede' }, M.safeLink(p.link) ? h('a', { href: p.link }, p.link) : h('span', null, 'endoflife.date product ' + p.name),
            ', snapshot generated ', h('span', null, M.time(prov.upstreamGeneratedAt)))),
        h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Release cycles' },
          h('table', { id: 'release-cycles-table', 'data-preference-key': 'release cycles' },
            h('thead', null, h('tr', null, [['Cycle', 'version'], ['Latest patch', 'version'], ['Released', 'date'], ['EoL date', 'date'], ['Status'],
              ['# Code Repos Using It', 'number']].map(function (c) { return h('th', { scope: 'col', 'data-type': c[1], class: c[1] === 'number' ? 'num' : null }, c[0]); }))),
            h('tbody', null, M.productCycles(model, p.name).map(function (c) {
              var href = M.productHref(p.name, c.name);
              return h('tr', { 'data-href': href },
                h('td', null, h('a', { href: href }, c.label || c.name)),
                h('td', { 'data-value': c.latest || '' }, c.latest || 'Unknown'),
                h('td', { class: 'date', 'data-value': c.releaseDate || '' }, c.releaseDate || 'Unknown'),
                h('td', { class: 'date', 'data-value': c.eolFrom || '' }, c.eolFrom || 'Not published'),
                h('td', null, eolSpan(M.eolOf(c, today))),
                h('td', { class: 'num' }, String(counts[c.name] || 0)));
            })))));
    },

    imports: function (model, prov) {
      title('Imports & sync');
      var cycles = 0;
      model.catalogue.cycles.forEach(function (m) { cycles += m.size; });
      var repos = new Set(model.branches.map(M.repoKey)).size;
      var packages = model.branches.reduce(function (n, b) { return n + b.depCount; }, 0);
      show(
        h('div', { class: 'page-head title-row' }, h('h1', null, 'Imports')),
        h('div', { class: 'notice', role: 'status' }, 'This static demo is read-only and has no server: importing files, catalogue sync and clearing data ',
          'are not available here. Every page is computed in your browser from the two bundled files below.'),
        h('section', { class: 'panel', 'aria-labelledby': 'sync-h' }, h('h2', { id: 'sync-h' }, 'endoflife.date Catalogue'),
          h('dl', { class: 'facts' },
            fact('Source', h('dd', null, h('code', null, prov.sourceUrl), ', one whole-catalogue response saved unmodified (frozen snapshot)')),
            fact('Upstream generated', h('dd', null, M.time(prov.upstreamGeneratedAt), ' ', muted('(generated_at, schema ' + prov.upstreamSchemaVersion + ')'))),
            fact('File saved', h('dd', null, M.time(prov.fileSavedAtUtc), ' ', muted('(' + prov.fileSavedAtNote + ')'))),
            fact('Contents', h('dd', null, model.catalogue.products.size + ' products, ' + cycles + ' release cycles',
              model.catalogue.failures.length ? '; skipped: ' + model.catalogue.failures.join(', ') : '; every product parsed')),
            fact('SHA-256', h('dd', null, h('code', null, prov.sha256), ' ', muted('(' + prov.bytes + ' bytes)'))),
            fact('Download', h('dd', null, h('a', { class: 'button-quiet', href: prov.file, download: true }, 'Download the raw snapshot')))),
          h('details', { class: 'help' }, h('summary', null, 'Help'),
            h('p', null, 'EoL dates come only from this snapshot; no lifecycle date is invented. Statuses such as "Ends in 2 months" are computed against ',
              'your browser\'s date today, so they change over time while the snapshot stays the same.'))),
        h('section', { class: 'panel', 'aria-labelledby': 'upload-h' }, h('h2', { id: 'upload-h' }, 'Bulk import: demo inventory'),
          h('p', null, 'The source project\'s resolver-derived demo dependency-inventory JSON, shown as if imported once: ' + repos + ' fictional DEMO code repos, '
            + model.branches.length + ' branches, ' + packages + ' distinct packages. Their ', h('code', null, 'example.invalid'),
            ' URLs are placeholders, not remotely hosted, and are never shown as links. Snapshot times are each entry\'s declared ', h('code', null, 'sbom.generatedAt'), '.'),
          h('p', { class: 'small muted' }, prov.demoInventorySource),
          h('p', null, h('a', { class: 'button-quiet', href: prov.demoInventory, download: true }, 'Download demo JSON'))),
        h('section', { class: 'panel', 'aria-labelledby': 'about-h' }, h('h2', { id: 'about-h' }, 'Attribution and licences'),
          h('ul', { class: 'plain' },
            h('li', null, 'EoL Ledger (the source app this demo is built from; its pages, styles and table script are reused). No licence file was found in its source; this demo adds none.'),
            h('li', null, 'Lifecycle data: ', h('a', { href: 'https://endoflife.date' }, 'endoflife.date'), ' (', h('a', { href: 'LICENSES/endoflife.date-MIT.txt' }, 'MIT licence'), ').'),
            h('li', null, 'Fonts: Newsreader and JetBrains Mono, SIL Open Font License 1.1 (', h('a', { href: 'fonts/README.md' }, 'font notes'), ', ',
              h('a', { href: 'LICENSES/Newsreader-OFL.txt' }, 'Newsreader OFL'), ', ', h('a', { href: 'LICENSES/JetBrainsMono-OFL.txt' }, 'JetBrains Mono OFL'), ').'))));
    }
  };

  function cycle(model, prov, p, name) {
    var c = model.catalogue.cycles.get(p.name).get(name);
    if (!c) return notFound();
    title(p.label + ' ' + c.name);
    var affected = M.affected(model, p.name, c.name);
    var installed = affected.map(function (a) { return a.dep.displayVersion; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
    var repoCount = new Set(affected.map(function (a) { return M.repoKey(a.branch); })).size;
    show(
      h('div', { class: 'page-head' }, h('p', { class: 'crumbs' }, h('a', { href: './' }, 'EoL Dependencies'), ' / ',
        h('a', { href: M.productHref(p.name) }, p.label), ' / ', h('span', null, c.name)),
        h('div', { class: 'title-row' }, h('h1', null, p.label + ' ' + (c.label || c.name)), h('a', { class: 'button', href: M.productHref(p.name) }, 'Show all versions'))),
      h('section', { class: 'panel', 'aria-labelledby': 'facts-h' }, h('h2', { id: 'facts-h', class: 'sr-only' }, 'Release cycle facts'),
        h('dl', { class: 'facts' },
          fact('EoL date', h('dd', null, h('span', null, c.eolFrom || 'Not published upstream'), ' ', h('span', null, eolSpan(M.eolOf(c, model.today))))),
          fact('Released', h('dd', null, c.releaseDate || 'Unknown')),
          fact('Latest upstream patch', h('dd', null, c.latest ? c.latest + (c.latestDate ? ' (' + c.latestDate + ')' : '') : 'Unknown')),
          fact('Installed versions', h('dd', null, installed.length ? installed.map(function (v, i) { return [h('code', null, v), i < installed.length - 1 ? ', ' : null]; })
            : muted('Not installed in any latest snapshot'))),
          fact('Code repos', h('dd', null, repoCount + ' code repos, ' + affected.length + ' branch dependencies')),
          fact('Upstream source', h('dd', null, M.safeLink(p.link) ? h('a', { href: p.link }, p.link) : h('span', null, 'endoflife.date'), ' ',
            muted('(endoflife.date API snapshot, generated ' + M.time(prov.upstreamGeneratedAt) + ')')))),
        h('details', { class: 'help' }, h('summary', null, 'Help'),
          h('p', null, 'The cycle is the upstream release line; the installed version is the exact patch each branch\'s inventory reports.'))),
      h('h2', null, 'Code Repos Containing Dependency'),
      h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Affected code repo branches' },
        h('table', { id: 'affected-branches-table', 'data-preference-key': 'affected code repo branches' },
          h('thead', null, h('tr', null, [['Code repo'], ['Branch'], ['Package'], ['Installed version', 'version'], ['Snapshot observed', 'datetime'], ['Ecosystem']]
            .map(function (x) { return h('th', { scope: 'col', 'data-type': x[1] }, x[0]); }))),
          h('tbody', null, affected.map(function (a) {
            var href = M.branchHref(a.branch.id);
            return h('tr', { 'data-href': href },
              h('td', { class: 'col-source' }, a.branch.repoUrl == null ? '—' : a.branch.repoUrl),
              h('td', null, h('a', { href: href }, M.branchText(a.branch))),
              h('td', null, a.dep.name),
              h('td', null, h('code', null, a.dep.displayVersion)),
              h('td', { class: 'date small' }, M.time(a.branch.observedAt)),
              h('td', null, a.dep.ecosystem || 'Unknown'));
          }), affected.length ? null : h('tr', null, h('td', { colspan: '6', class: 'empty' }, 'No branch uses this cycle in its latest snapshot.'))))));
  }

  function json(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ': HTTP ' + r.status); return r.json(); });
  }

  // Keep app.css's first-page gate on until app.js has paged the tables we are about to draw.
  root.setAttribute('data-tables-pending', '');
  Promise.all([json('data/catalogue-upstream.json'), json('data/demo-dependency-inventory.json'), json('data/catalogue-provenance.json')])
    .then(function (data) {
      var model = M.build(data[0], data[1], M.today());
      pages[document.body.getAttribute('data-page')](model, data[2]);
      var s = document.createElement('script');
      s.src = 'app.js';
      s.onload = function () { root.removeAttribute('data-tables-pending'); root.setAttribute('data-app-ready', ''); };
      document.head.appendChild(s);
    })
    .catch(function (e) {
      show(h('div', { class: 'notice notice-error', role: 'alert' }, 'The demo data could not be loaded (' + e.message + '). Reload to try again.'));
    });
})();
