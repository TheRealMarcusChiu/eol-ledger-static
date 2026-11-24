// Backend-free port of EoL Ledger's read model: Matcher, CatalogService.parse, the JSON import's flattening (InventoryJson),
// Ledger (branches, deps, EoL status, dashboard rows) and DashboardQuery (rows, filter values, the /api/dashboard page).
// Runs in the browser (window.EolModel) and in Node tests (require).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EolModel = factory();
})(this, function () {
  'use strict';

  // ---- Matcher -------------------------------------------------------------------------------------

  var NUMERIC = /^\d+(\.\d+)*$/;
  // Pre-releases (-rc1, -SNAPSHOT, .M1), build metadata and other suffixes are deliberately not matched.
  var PLAIN_RELEASE = /^v?(\d+(?:\.\d+)*)(?:\.(?:final|release|ga))?$/i;
  var TYPE = /^[a-z][a-z0-9.+-]*$/;
  /** purl types whose namespace and name are case-insensitive per the purl specification. */
  var CASE_INSENSITIVE = ['npm', 'pypi', 'github', 'bitbucket', 'deb', 'nuget', 'composer', 'hex', 'apk'];

  // shortcut: invalid UTF-8 after percent-decoding is rejected here, where Java's URLDecoder substitutes U+FFFD; no such purl in the demo data.
  function decode(raw) {
    try { return decodeURIComponent(raw); } catch (e) { return null; }
  }

  /** Package identity pkg:type/namespace/name (Matcher.normalizePurl); null for anything that is not a well-formed purl. */
  function normalizePurl(purl) {
    if (purl == null) return null;
    var p = String(purl).trim();
    if (p.slice(0, 4).toLowerCase() !== 'pkg:') return null;
    p = p.slice(4).replace(/^\/+/, '').replace(/[?#].*$/, '');
    var slash = p.indexOf('/');
    if (slash <= 0) return null;
    var type = p.slice(0, slash).toLowerCase();
    if (!TYPE.test(type)) return null;
    var rest = p.slice(slash + 1).replace(/\/+$/, '');
    var at = rest.indexOf('@', rest.lastIndexOf('/') + 1);
    if (at >= 0) rest = rest.slice(0, at);
    if (!rest) return null;
    var segments = [];
    var raws = rest.split('/');
    for (var i = 0; i < raws.length; i++) {
      if (!raws[i]) return null;
      var s = decode(raws[i]);
      if (s === null) return null;
      s = s.replace(/%/g, '%25').replace(/\//g, '%2F');
      if (CASE_INSENSITIVE.indexOf(type) >= 0) s = s.toLowerCase();
      if (type === 'pypi') s = s.replace(/_/g, '-');
      segments.push(s);
    }
    return 'pkg:' + type + '/' + segments.join('/');
  }

  /** Percent-decoded version after '@' in the purl's final segment, or null when absent or undecodable. */
  function purlVersion(purl) {
    if (purl == null) return null;
    var p = String(purl).trim().replace(/[?#].*$/, '');
    var at = p.indexOf('@', p.lastIndexOf('/') + 1);
    if (at < 0) return null;
    var v = decode(p.slice(at + 1));
    return v === null || !v.trim() ? null : v;
  }

  function isPlainRelease(version) {
    return version != null && PLAIN_RELEASE.test(String(version).trim());
  }

  function stripZeros(s) { return s.replace(/^0+(?=\d)/, ''); }

  /** Longest numeric cycle whose dot components are a prefix of a plain release version's components. */
  function matchCycle(version, cycles) {
    if (version == null) return null;
    var m = PLAIN_RELEASE.exec(String(version).trim());
    if (!m) return null;
    var v = m[1].split('.').map(stripZeros);
    var best = null, bestLen = 0;
    cycles.forEach(function (c) {
      if (!NUMERIC.test(c)) return;
      var parts = c.split('.').map(stripZeros);
      if (parts.length > v.length || parts.length <= bestLen) return;
      if (parts.every(function (x, i) { return x === v[i]; })) { best = c; bestLen = parts.length; }
    });
    return best;
  }

  /**
   * Matcher.match without explicit mappings (eol.mappings is blank by default and this demo configures none):
   * exact normalized purl listed by exactly one product, else (only without a purl) a name equal to a product name.
   */
  function match(cat, name, version, purl) {
    var norm = normalizePurl(purl);
    if (purl != null && norm == null) return { product: null, cycle: null, evidence: 'malformed purl ' + purl + '; not matched by package name either' };
    var listed = norm == null ? [] : cat.byPurl.get(norm) || [];
    var product, evidence;
    if (listed.length === 1) {
      product = listed[0];
      evidence = 'purl ' + norm + ' is an endoflife.date identifier of ' + product;
    } else if (listed.length > 1) {
      return { product: null, cycle: null, evidence: 'purl ' + norm + ' is listed by several products ' + listed.join(', ') + '; add an explicit mapping to choose one' };
    } else if (norm == null && name != null && cat.cycles.has(name.toLowerCase())) {
      product = name.toLowerCase();
      evidence = 'package has no purl; its name equals product ' + product;
    } else {
      return { product: null, cycle: null, evidence: norm == null
        ? 'No catalogue identifier or mapping for package name ' + name + ' (no purl)'
        : 'No catalogue identifier or mapping for ' + norm };
    }
    var fromPurl = purlVersion(purl);
    if (version != null && fromPurl != null && version !== fromPurl) {
      return { product: product, cycle: null, evidence: evidence + '; SBOM version ' + version + ' conflicts with purl version ' + fromPurl + ', so no cycle is guessed' };
    }
    if (version == null && fromPurl != null) {
      version = fromPurl;
      evidence += '; version ' + version + ' taken from the purl (the SBOM record states none)';
    }
    var cycles = cat.cycles.get(product);
    var cycle = matchCycle(version, cycles ? Array.from(cycles.keys()) : []);
    if (cycle == null && !isPlainRelease(version)) {
      evidence += '; version ' + version + ' is not a plain release version (digits and dots, optional leading v or .Final/.RELEASE/.GA), so no cycle is guessed';
    } else if (cycle == null) {
      evidence += '; no release cycle of ' + product + ' matches version ' + version;
    } else {
      evidence += '; version ' + version + ' falls in cycle ' + cycle;
    }
    return { product: product, cycle: cycle, evidence: evidence };
  }

  // ---- CatalogService.parse over a raw /products/full response ---------------------------------------

  var PRODUCT_NAME = /^[a-z0-9][a-z0-9._-]*$/;

  function text(n) { return typeof n === 'string' && n.trim() ? n : null; }

  function date(n) {
    if (n === null || n === undefined) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(n));
    var d = m && new Date(Date.UTC(+m[1], m[2] - 1, +m[3]));
    if (!d || d.getUTCMonth() !== m[2] - 1 || d.getUTCDate() !== +m[3]) throw new Error('invalid date');
    return m[0];
  }

  /**
   * The whole catalogue as CatalogService would store it: the envelope is validated first (a truncated catalogue is
   * refused), then each product parses on its own; a malformed product is listed in failures and skipped.
   */
  function parseCatalogue(body) {
    var result = body && body.result;
    if (!Array.isArray(result)) throw new Error('catalogue response result is not an array');
    if (body.total !== undefined && body.total !== result.length) throw new Error('catalogue response total does not match its ' + result.length + ' product(s)');
    if (!result.length) throw new Error('catalogue response has no products');
    var products = new Map(), cycles = new Map(), byPurl = new Map(), failures = [];
    result.forEach(function (n) {
      var name = n && typeof n.name === 'string' ? n.name : '';
      try {
        if (!PRODUCT_NAME.test(name)) throw new Error('missing or invalid product name');
        if (!Array.isArray(n.releases)) throw new Error('missing releases');
        var label = typeof n.label === 'string' ? n.label : name;
        var link = text(n.links && n.links.html);
        var purls = [];
        (Array.isArray(n.identifiers) ? n.identifiers : []).forEach(function (id) {
          var norm = id && id.type === 'purl' ? normalizePurl(typeof id.id === 'string' ? id.id : '') : null;
          if (norm && purls.indexOf(norm) < 0) purls.push(norm);
        });
        var mine = new Map(); // a repeated cycle name: last one wins
        n.releases.forEach(function (r) {
          var cycle = r && typeof r.name === 'string' ? r.name : '';
          if (!cycle.trim()) throw new Error('release without name');
          var latest = r.latest || {};
          mine.set(cycle, { product: name, productLabel: label, productLink: link, name: cycle, label: text(r.label),
            releaseDate: date(r.releaseDate), isEol: typeof r.isEol === 'boolean' ? r.isEol : null, eolFrom: date(r.eolFrom),
            latest: text(latest.name), latestDate: date(latest.date) });
        });
        // a product listed twice is replaced, like the per-product transaction
        byPurl.forEach(function (list, purl) { var i = list.indexOf(name); if (i >= 0) list.splice(i, 1); if (!list.length) byPurl.delete(purl); });
        products.set(name, { name: name, label: label, link: link });
        cycles.set(name, mine);
        purls.forEach(function (purl) {
          if (!byPurl.has(purl)) byPurl.set(purl, []);
          byPurl.get(purl).push(name);
          byPurl.get(purl).sort();
        });
      } catch (e) {
        failures.push((name || '?') + ' (' + e.message + ')');
      }
    });
    return { products: products, cycles: cycles, byPurl: byPurl, failures: failures };
  }

  // ---- Ledger --------------------------------------------------------------------------------------

  var INLINE = 'inline:json-upload';

  /** Ledger.NATURAL: digit runs compared as numbers, so cycle 10 sorts after 9. */
  function naturalCompare(a, b) {
    var i = 0, j = 0;
    function digit(c) { return c >= '0' && c <= '9'; }
    while (i < a.length && j < b.length) {
      var x = a.charAt(i), y = b.charAt(j);
      if (digit(x) && digit(y)) {
        var si = i, sj = j;
        while (i < a.length && digit(a.charAt(i))) i++;
        while (j < b.length && digit(b.charAt(j))) j++;
        var na = stripZeros(a.slice(si, i)), nb = stripZeros(b.slice(sj, j));
        var c = na.length !== nb.length ? na.length - nb.length : cmp(na, nb);
        if (c) return c;
      } else {
        if (x !== y) return x < y ? -1 : 1;
        i++;
        j++;
      }
    }
    return (a.length - i) - (b.length - j);
  }

  /** Java String.compareTo order (UTF-16 code units). */
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  /** Only well-formed http(s) URLs with a host and no credentials become links (Ledger.safeLink). */
  function safeLink(url) {
    if (url == null) return null;
    try {
      var u = new URL(String(url).trim());
      return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname && !u.username && !u.password ? url : null;
    } catch (e) { return null; }
  }

  /** safeLink, minus reserved .invalid placeholder hosts: the demo's synthetic repos must never look like hosted ones. */
  function liveLink(url) {
    var link = safeLink(url);
    return link && !/\.invalid$/i.test(new URL(String(url).trim()).hostname) ? link : null;
  }

  function days(from, to) {
    return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5);
  }

  function span(n) {
    if (n < 60) return n + (n === 1 ? ' day' : ' days');
    if (n < 730) return Math.floor(n / 30) + ' months';
    return Math.floor(n / 365) + ' years';
  }

  /** Ledger.Eol.of: css is one of ended, soon, ok, unknown. */
  function eolOf(c, today) {
    if (!c) return { css: 'unknown', text: 'Unknown: no matched release cycle' };
    if (c.eolFrom) {
      var d = days(today, c.eolFrom);
      if (d < 0) return { css: 'ended', text: 'Ended ' + span(-d) + ' ago' };
      if (d === 0) return { css: 'ended', text: 'Ends today' };
      return { css: d <= 180 ? 'soon' : 'ok', text: 'Ends in ' + span(d) };
    }
    if (c.isEol === true) return { css: 'ended', text: 'Ended (date not published)' };
    if (c.isEol === false) return { css: 'unknown', text: 'No EoL date announced' };
    return { css: 'unknown', text: 'Unknown' };
  }

  function ecosystem(purl) {
    if (purl == null || purl.lastIndexOf('pkg:', 0) !== 0 || purl.indexOf('/') < 0) return null;
    return purl.slice(4, purl.indexOf('/')).toLowerCase();
  }

  function displayVersion(d) {
    var fromPurl = purlVersion(d.purl);
    if (d.version == null) return fromPurl == null ? 'not stated' : fromPurl + ' (from purl)';
    return fromPurl == null || fromPurl === d.version ? d.version : d.version + ' (purl: ' + fromPurl + ')';
  }

  /** Keys sorted at every level, as the import stores each entry. */
  function canonical(n) {
    if (Array.isArray(n)) return n.map(canonical);
    if (n && typeof n === 'object') {
      var o = {};
      Object.keys(n).sort().forEach(function (k) { o[k] = canonical(n[k]); });
      return o;
    }
    return n;
  }

  function str(v) { return typeof v === 'string' ? v : null; }
  function asText(v) { return v === null || v === undefined ? '' : String(v); }

  function contextKey(purl, name, version) {
    var n = normalizePurl(purl);
    return (n != null ? n : String(name).trim()) + '\n' + (version == null ? '' : String(version).trim());
  }

  /** Ledger.parseInline: what one JSON-uploaded entry declared (never fetched) plus each package's graph contexts. */
  function inline(e) {
    var projects = (e.projects || []).map(function (p) {
      var tools = [asText(p.ecosystem), asText(p.packageManager)].filter(function (s, i, a) { return s && a.indexOf(s) === i; }).join(' via ');
      var status = asText(p.resolution && p.resolution.status);
      return asText(p.path) + (tools ? ': ' + tools : '') + (status ? ' (' + status + ')' : '');
    });
    var contexts = {};
    (e.dependencies || []).forEach(function (d) {
      var parts = ['scope', 'dependencyType'].filter(function (f) { return d[f] != null; }).map(function (f) { return String(d[f]); });
      var c = parts.join(', ');
      if (d.depth > 1) c += ' (depth ' + d.depth + ')';
      if (d.optional === true) c += ', optional';
      if (d.projectPath != null) c = d.projectPath + (c ? ': ' + c : '');
      if (!c) return;
      var k = contextKey(str(d.purl), asText(d.name), asText(d.version));
      (contexts[k] = contexts[k] || []).indexOf(c) < 0 && contexts[k].push(c);
    });
    Object.keys(contexts).forEach(function (k) { contexts[k] = contexts[k].sort(cmp).join('; '); });
    var sbom = e.sbom || {};
    var host = '';
    try { host = new URL(e.url).hostname; } catch (x) { /* no URL */ }
    return { appId: str(e.appId), declaredSbomUrl: str(sbom.url), generatedAt: str(sbom.generatedAt),
      demo: e.demo === true || /\.invalid$/.test(host), localRepository: str(e.localRepository), projects: projects,
      context: function (dep) { return contexts[contextKey(dep.purl, dep.name, dep.version)] || ''; } };
  }

  function depOrder(a, b) {
    return cmp(a.name, b.name) || nullsFirst(a.version, b.version) || nullsFirst(a.purl, b.purl);
  }
  function nullsFirst(a, b) { return a == null ? (b == null ? 0 : -1) : b == null ? 1 : cmp(a, b); }

  /**
   * The bundled demo inventory as one import would store it: one branch per entry (ids in file order), one snapshot each,
   * and one dependency row per package identity (normalized purl, else name) plus version.
   * shortcut: InventoryJson's validation is not ported; only the source project's own validated demo fixture is ever loaded.
   */
  function importInventory(entries) {
    var depId = 0;
    return entries.map(function (raw, i) {
      var e = canonical(raw);
      e.projects && e.projects.sort(function (a, b) { return cmp(JSON.stringify(a), JSON.stringify(b)); });
      var all = (e.dependencies || []).map(function (d) { return { name: String(d.name).trim(), version: String(d.version).trim(), purl: str(d.purl) }; });
      all.sort(depOrder);
      var unique = new Map();
      all.forEach(function (d) {
        var k = (d.purl != null ? normalizePurl(d.purl) : d.name) + '\n' + d.version;
        if (!unique.has(k)) unique.set(k, d);
      });
      var flat = Array.from(unique.values()).sort(depOrder).map(function (d) { return { id: ++depId, name: d.name, version: d.version, purl: d.purl }; });
      var sbom = e.sbom || {};
      return { id: i + 1, repoName: e.name == null ? null : String(e.name).trim(), repoUrl: str(e.url), provider: str(e.provider) || 'other',
        branch: str(e.branch), sbomUrl: INLINE, observedAt: str(sbom.generatedAt), depCount: flat.length, rows: flat, inline: inline(e),
        facts: { appId: text(e.appId), version: text(e.version), format: text(sbom.format) || 'Inventory JSON' } };
    });
  }

  function lower(s) { return s == null ? '' : s.toLowerCase(); }

  /** The whole read model: catalogue, branches with matched dependencies, and the dashboard rows. */
  function build(catalogueBody, inventory, today) {
    var cat = parseCatalogue(catalogueBody);
    var branches = importInventory(inventory).sort(function (a, b) {
      return cmp(lower(a.repoName), lower(b.repoName)) || nullsFirst(a.repoUrl, b.repoUrl) || nullsFirst(a.branch, b.branch) || a.id - b.id;
    });
    branches.forEach(function (b) {
      b.deps = b.rows.slice().sort(function (x, y) { return cmp(lower(x.name), lower(y.name)) || cmp(x.version, y.version) || x.id - y.id; })
        .map(function (r) {
          var m = match(cat, r.name, r.version, r.purl);
          var c = m.cycle == null ? null : cat.cycles.get(m.product).get(m.cycle);
          return { id: r.id, name: r.name, version: r.version, purl: r.purl, ecosystem: ecosystem(r.purl), match: m, cycle: c,
            eol: m.product == null ? { css: 'unknown', text: 'Not mapped to an upstream product' } : eolOf(c, today), displayVersion: displayVersion(r) };
        });
    });
    var byId = new Map(branches.map(function (b) { return [b.id, b]; }));
    var model = { today: today, catalogue: cat, branches: branches, branch: function (id) { return byId.get(id) || null; } };
    model.dashboard = dashboard(model);
    return model;
  }

  /** Every branch's latest-snapshot dependency, in branch then dependency order. */
  function latestDeps(model) {
    var out = [];
    model.branches.forEach(function (b) { b.deps.forEach(function (d) { out.push({ branch: b, dep: d }); }); });
    return out;
  }

  function repoKey(b) { return b.repoUrl != null ? b.repoUrl : '#' + b.id; }
  function nameText(b) { return b.repoName == null ? '—' : b.repoName; }
  function branchText(b) { return b.branch == null ? '—' : b.branch; }

  function productHref(p, c) { return 'product.html?product=' + encodeURIComponent(p) + (c == null ? '' : '&version=' + encodeURIComponent(c)); }
  function branchHref(id) { return 'branch.html?id=' + id; }
  function depHref(b, d) { return 'dependency.html?branch=' + b + '&dep=' + d; }

  function cell(s) { return s == null ? '' : String(s).replace(/\s+/g, ' ').trim(); }
  function sortedDistinct(list) {
    return list.filter(function (s, i, a) { return s != null && String(s).trim() && a.indexOf(s) === i; }).sort(cmp);
  }

  var DASH_KEYS = ['purl', 'ecosystem', 'dependency', 'version', 'eol', 'status', 'repos', 'branches', 'context', 'cycle', 'evidence', 'source', 'sbom'];
  function dashType(k) { return k === 'version' ? 'version' : k === 'eol' ? 'date' : k === 'repos' || k === 'branches' ? 'number' : 'text'; }

  /**
   * Ledger.dashboard(showUnused = true) as DashboardQuery stores it: one row per catalogue release cycle, used or not,
   * EoL date ascending (unknown last), then product and cycle. rows are the API's Row objects, values each column's filter value.
   */
  function dashboard(model) {
    var inv = new Map(), unmatched = 0;
    latestDeps(model).forEach(function (a) {
      var c = a.dep.cycle;
      if (!c) { unmatched++; return; }
      var k = c.product + ' ' + c.name;
      if (!inv.has(k)) inv.set(k, []);
      var inl = a.branch.inline;
      inv.get(k).push({ branch: a.branch, dep: a.dep, context: inl.context(a.dep), sbom: inl.declaredSbomUrl != null ? inl.declaredSbomUrl : a.branch.sbomUrl });
    });
    var cycles = [];
    model.catalogue.cycles.forEach(function (m) { m.forEach(function (c) { cycles.push(c); }); });
    cycles.sort(function (a, b) { return nullsLast(a.eolFrom, b.eolFrom) || cmp(a.product, b.product) || cmp(a.name, b.name); });
    var rows = [], values = [];
    cycles.forEach(function (c) {
      var ev = inv.get(c.product + ' ' + c.name) || [];
      function vals(f) { return sortedDistinct(ev.map(f)).join('; '); }
      var repos = sortedDistinct(ev.map(function (e) { return repoKey(e.branch); })).length;
      var branches = sortedDistinct(ev.map(function (e) { return String(e.branch.id); })).length;
      var eol = eolOf(c, model.today);
      var source = sortedDistinct(ev.map(function (e) { return e.branch.repoUrl; })).map(function (u) { return { text: u === INLINE ? 'Inline upload' : u, link: liveLink(u) }; });
      var sbom = sortedDistinct(ev.map(function (e) { return e.sbom; })).map(function (u) { return { text: u === INLINE ? 'Inline upload' : u, link: liveLink(u) }; });
      var evidence = ev.map(function (e) { return { href: depHref(e.branch.id, e.dep.id), text: nameText(e.branch) + ' / ' + branchText(e.branch) + ': Details' }; });
      var ecosystems = vals(function (e) { return e.dep.ecosystem; });
      var row = { product: c.product, cycle: c.name, href: productHref(c.product, c.name),
        purl: cell(vals(function (e) { return e.dep.ecosystem == null ? e.dep.purl : e.dep.ecosystem + ' / ' + e.dep.purl; })),
        ecosystem: cell(ecosystems || 'Unknown'),
        dependency: ev.length ? vals(function (e) { return e.dep.name; }) : c.productLabel,
        version: ev.length ? vals(function (e) { return e.dep.displayVersion; }) : 'Not installed',
        eol: c.eolFrom || '', status: eol.text, statusCss: eol.css, repos: repos, branches: branches,
        context: cell(vals(function (e) { return e.context; })),
        cycleLabel: cell(c.productLabel + ' ' + (c.label != null ? c.label : c.name)),
        matching: vals(function (e) { return e.dep.match.evidence; }), evidence: evidence, sources: source, sboms: sbom };
      rows.push(row);
      values.push({ purl: row.purl, ecosystem: row.ecosystem, dependency: row.dependency, version: row.version, eol: row.eol, status: row.status,
        repos: String(repos), branches: String(branches), context: row.context, cycle: row.cycleLabel,
        // the cells' visible text as the browser collapses it: the matching text, then each link / URL
        evidence: cell([row.matching].concat(evidence.map(function (l) { return l.text; })).join(' ')),
        source: cell(source.map(function (u) { return u.text; }).join(' ')), sbom: cell(sbom.map(function (u) { return u.text; }).join(' ')) });
    });
    var domains = {};
    DASH_KEYS.forEach(function (k) { domains[k] = sortedDistinct(values.map(function (v) { return v[k]; })).concat(values.some(function (v) { return v[k] === ''; }) ? [''] : []); });
    return { rows: rows, values: values, domains: domains, unmatched: unmatched };
  }
  function nullsLast(a, b) { return a == null ? (b == null ? 0 : 1) : b == null ? -1 : cmp(a, b); }

  /**
   * GET api/dashboard?view= and api/dashboard/values?column= answered from the static rows with app.js's own view, filter,
   * sort and paging helpers (app: an object holding them), so every filter applies to the whole table before pagination.
   */
  function dashboardApi(url, dash, app) {
    var u = new URL(url);
    var types = {};
    DASH_KEYS.forEach(function (k) { types[k] = dashType(k); });
    if (/\/api\/dashboard\/values$/.test(u.pathname)) {
      var k = u.searchParams.get('column');
      if (DASH_KEYS.indexOf(k) < 0) throw new Error('HTTP 400');
      var col = dash.values.map(function (v) { return v[k]; }), seen = {}, out = [];
      app.sortOrder(col, types[k], 'asc').forEach(function (i) {
        if (seen['=' + col[i]]) return;
        seen['=' + col[i]] = true;
        out.push({ value: col[i], label: col[i] === '' && k === 'eol' ? 'Not published' : col[i] });
      });
      return out;
    }
    if (!/\/api\/dashboard$/.test(u.pathname)) throw new Error('HTTP 404');
    var view = app.decodeView(u.searchParams.get('view'), DASH_KEYS, types, { key: 'eol', dir: 'asc' }, dash.domains);
    var shown = app.visibleRows(dash.values, view.filters, types);
    var order = view.sort ? app.sortOrder(dash.values.map(function (v) { return v[view.sort.key]; }), types[view.sort.key], view.sort.dir)
      : dash.values.map(function (v, i) { return i; });
    var matching = order.filter(function (i) { return shown[i]; });
    var p = app.pageRange(matching.length, view.page, view.size);
    return { total: dash.rows.length, matching: matching.length, page: p.page, pages: p.pages, size: view.size,
      rows: matching.slice(p.start, p.end).map(function (i) { return dash.rows[i]; }) };
  }

  // ---- product, cycle and affected branches ----------------------------------------------------------

  function productCycles(model, product) {
    var m = model.catalogue.cycles.get(product);
    return (m ? Array.from(m.values()) : []).sort(function (a, b) {
      // release date newest first (unknown last), then cycle name descending
      return -nullsFirst(a.releaseDate, b.releaseDate) || -naturalCompare(a.name, b.name);
    });
  }

  function affected(model, product, cycle) {
    return latestDeps(model).filter(function (a) {
      var c = a.dep.cycle;
      return c && c.product === product && (cycle == null || c.name === cycle);
    });
  }

  function repoCountsByCycle(model, product) {
    var sets = {};
    affected(model, product, null).forEach(function (a) {
      (sets[a.dep.cycle.name] = sets[a.dep.cycle.name] || new Set()).add(repoKey(a.branch));
    });
    var out = {};
    Object.keys(sets).forEach(function (k) { out[k] = sets[k].size; });
    return out;
  }

  /** Branch page order: EoL date (unknown last), then name naturally, then id. */
  function dependencyRows(b) {
    return b.deps.slice().sort(function (x, y) {
      return nullsLast(x.cycle && x.cycle.eolFrom, y.cycle && y.cycle.eolFrom) || naturalCompare(x.name, y.name) || x.id - y.id;
    });
  }

  /** "2026-11-20 10:00:00 UTC" (the source's yyyy-MM-dd HH:mm:ss z, in UTC). */
  function time(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? iso : d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  }

  /** This browser's local calendar day, YYYY-MM-DD. */
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  return { normalizePurl: normalizePurl, purlVersion: purlVersion, isPlainRelease: isPlainRelease, matchCycle: matchCycle, match: match,
    parseCatalogue: parseCatalogue, importInventory: importInventory, build: build, eolOf: eolOf, safeLink: safeLink, liveLink: liveLink,
    naturalCompare: naturalCompare, dashboardApi: dashboardApi, productCycles: productCycles, affected: affected,
    repoCountsByCycle: repoCountsByCycle, dependencyRows: dependencyRows, latestDeps: latestDeps, time: time, today: today,
    nameText: nameText, branchText: branchText, repoKey: repoKey, productHref: productHref, branchHref: branchHref, depHref: depHref,
    INLINE: INLINE, DASH_KEYS: DASH_KEYS };
});
