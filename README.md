# EoL Ledger — static demo

A backend-free, read-only demo of [EoL Ledger](#source-and-attribution): which end-of-life (EoL) release cycles a set of
code repositories depends on. It runs entirely in the browser from three bundled files; there is no server, database,
API or Java runtime, and nothing outside this site is requested at runtime.

* **EoL Dependencies** (`index.html`): every release cycle of the frozen endoflife.date catalogue (all 9,476, used or
  not), with the source app's header sort, Values / Text / Range filters, column settings, and a typed rows-per-page size
  (1–1000, default 20, kept per table). Filters and sort apply to the whole table before paging.
* **Code repos** (`repos.html`): the source project's demo inventory: 11 fictional DEMO repos × 2 branches, with App ID,
  version, provider, SBOM format, package count and snapshot time.
* Drill-downs: branch (`branch.html?id=`), package with matching evidence (`dependency.html?branch=&dep=`), product
  (`product.html?product=`) and release cycle (`product.html?product=&version=`).
* **Imports** (`imports.html`): snapshot provenance, downloads, attribution. Uploads, catalogue sync and clearing data
  need the real app's server and are not offered here.

All URLs are relative, so the site works from any sub-path such as `/eol-ledger-static/`.

## Data

| File | What |
|---|---|
| `data/catalogue-upstream.json` | `GET https://endoflife.date/api/v1/products/full`, saved unmodified. `generated_at` 2026-11-24T07:54:44+00:00, schema 1.2.1, 489 products, 9,476 release cycles, SHA-256 `703b5dbb4f45462f11641e0f1230e3e3fd6618f5332b5428038af961adadd11c` |
| `data/catalogue-provenance.json` | The facts above plus the file's saved time (UTC) |
| `data/demo-dependency-inventory.json` | The source project's `src/main/resources/samples/demo-dependency-inventory.json` (commit `167e7a9a143b2ee6652161593b4bb2b00017a6e2`), unmodified |

The demo repositories are fictional: their `example.invalid` URLs are placeholders, not remotely hosted, and are shown as
plain text, never as links. Their rows come from native resolver runs in the source project's demo evidence (git bundles,
lock files and trees live there, not here). Snapshot times are each entry's declared `sbom.generatedAt`, since nothing
was imported at a real time. EoL statuses ("Ends in 2 months") are computed against the browser's date today.

## How it works

* `model.js` ports the source's read model to JavaScript: `Matcher` (purl normalization, cycle matching, refusals),
  `CatalogService.parse`, the JSON import's per-branch flattening, `Ledger` (EoL status, dashboard rows, product and
  cycle drill-downs) and `DashboardQuery` (each column's filter value). The source's explicit `eol.mappings` are not
  ported: they are blank by default and this demo configures none.
* `static.js` renders each page with the same markup as the source's Thymeleaf templates (text nodes only), then loads
  `app.js`.
* `app.js`, `app.css`, `theme.js`, fonts and icons are the source's own files. `app.js` has two changes: its
  dashboard data request is answered by `window.EolStaticApi` (the static rows, filtered with `app.js`'s own helpers),
  and the catalogue-sync poller (POST/GET to the server) is removed.

## Local preview

Run from the repository root, then open http://localhost:8080/:

```bash
python3 -m http.server 8080
```

Opening the files directly (`file://`) is not supported: the pages load their data with `fetch` of JSON files.

## Test

```bash
npm test                     # node --test: model, matching, static API, safety and shipping allowlist
npm run check:browser        # Python Playwright + Chromium: desktop and mobile, served under /eol-ledger-static/
```

`check:browser` needs the Python `playwright` package and its Chromium browser installed.

## Source and attribution

* EoL Ledger: [github.com/TheRealMarcusChiu/eol-ledger](https://github.com/TheRealMarcusChiu/eol-ledger), the source
  app (Java/Spring) this demo is built from, at commit `167e7a9a143b2ee6652161593b4bb2b00017a6e2`; its pages, styles
  and table script are reused.
  No licence file was found in its source, and this demo adds none.
* Lifecycle data: [endoflife.date](https://endoflife.date), MIT licence (`LICENSES/endoflife.date-MIT.txt`).
* Fonts: Newsreader and JetBrains Mono, SIL Open Font License 1.1 (`fonts/README.md`, `LICENSES/*-OFL.txt`).
