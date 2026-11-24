// A plain mouse click on a body cell's value text (.cell-run) is for selecting it, so it does not navigate; touch/pen taps,
// keyboard Enter and modified clicks (Ctrl/Meta/Shift/Alt: new tab, window, download) keep the link's native behaviour.
var pointerType = 'mouse';
document.addEventListener('pointerdown', function (e) { pointerType = e.pointerType; }, true);

// Whole-row navigation for tables; every row also carries a real link for keyboard and assistive tech.
document.addEventListener('click', function (e) {
  // A drag that selected text and ended beside the value clicks the cell link around it: that is a selection too.
  var selected = window.getSelection && String(window.getSelection());
  if (e.detail > 0 && pointerType === 'mouse' && !(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
      && e.target.closest && !e.target.closest('a:not(.cell-link)')
      && (e.target.closest('tbody .cell-run') || (selected && e.target.closest('tbody a.cell-link')))) {
    if (e.target.closest('a.cell-link')) e.preventDefault();
    return;
  }
  var row = e.target.closest('tr[data-href]');
  if (!row || e.target.closest('a, button, input, select, label, summary, [data-column-resize]')) return;
  if (window.getSelection && String(window.getSelection())) return;
  if (e.ctrlKey || e.metaKey || e.button === 1) { window.open(row.dataset.href, '_blank', 'noopener'); return; }
  window.location.assign(row.dataset.href);
});

// Rows made focusable (dashboard with its link column hidden) open on Enter.
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' || !e.target.matches || !e.target.matches('tr[data-href][tabindex]')) return;
  if (e.ctrlKey || e.metaKey) { window.open(e.target.dataset.href, '_blank', 'noopener'); return; }
  window.location.assign(e.target.dataset.href);
});

// Dependency table column visibility and widths, kept independently in this browser only.
var TABLE_KEY = 'eol-ledger.dependencies-table.v1';
var MIN_WIDTH = 80;
var MAX_WIDTH = 1000;
var TABLE_COLUMNS = { ecosystem: 140, dependency: 220, version: 120, eol: 130, status: 210, repos: 120, branches: 120, purl: 280, context: 240, cycle: 200, evidence: 280, source: 260, sbom: 260 };
var BRANCH_TABLE_KEY = 'eol-ledger.branch-dependencies-table.v1';

function clampWidth(n, fallback) {
  return typeof n === 'number' && isFinite(n) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(n))) : fallback;
}

function ownObject(o, key) {
  var v = o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, key) ? o[key] : null;
  return v && typeof v === 'object' ? v : null;
}

/** Stored JSON text to fresh {key: {visible, width}} for the known columns; anything malformed falls back to the default. */
function tablePrefs(text) {
  var saved = null;
  try { saved = JSON.parse(text); } catch (e) { /* default */ }
  var cols = ownObject(saved, 'columns');
  var prefs = {};
  var shown = 0;
  Object.keys(TABLE_COLUMNS).forEach(function (key) {
    var c = ownObject(cols, key);
    var visible = c && Object.prototype.hasOwnProperty.call(c, 'visible') && typeof c.visible === 'boolean' ? c.visible : true;
    var width = c && Object.prototype.hasOwnProperty.call(c, 'width') ? c.width : null;
    prefs[key] = { visible: visible, width: clampWidth(width, TABLE_COLUMNS[key]) };
    if (visible) shown++;
  });
  if (!shown) Object.keys(prefs).forEach(function (key) { prefs[key].visible = true; });
  return prefs;
}

/** localStorage call on our own key; blocked or failing storage just means no persistence. */
function tableStorage(method, value, key) {
  try { return window.localStorage[method](key || TABLE_KEY, value); } catch (e) { return null; }
}

/** A header's stable preference identity: its data-preference-index (kept when columns are inserted before it), else its position. */
function prefIndex(cell, i) {
  var p = cell.getAttribute('data-preference-index');
  return p !== null && /^\d+$/.test(p) ? Number(p) : i;
}

/** Narrowest width that keeps a header on one line: its name and sort arrow plus the cell's padding, whose right side holds the filter button and resize handle. */
function headerFloor(cell) {
  var first = cell.querySelector('.th-sort');
  if (cell.hidden || !first || !document.createRange) return MIN_WIDTH;
  var range = document.createRange();
  range.setStartBefore(first);
  range.setEndAfter(first);
  var cs = window.getComputedStyle(cell);
  var w = range.getBoundingClientRect().width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 2;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.ceil(w)));
}

/** A column-resize handle for a header cell: drag it, or focus it and use Left/Right (Shift for x5); double-click resets. */
function resizeHandle(label, key, get, set, done, reset) {
  var h = document.createElement('span');
  h.className = 'col-resize';
  h.tabIndex = 0;
  h.title = 'Drag to resize; double-click to reset';
  h.setAttribute('role', 'separator');
  h.setAttribute('aria-orientation', 'vertical');
  h.setAttribute('aria-label', 'Resize ' + label + ' column');
  h.setAttribute('aria-valuemin', MIN_WIDTH);
  h.setAttribute('aria-valuemax', MAX_WIDTH);
  h.setAttribute('data-column-resize', key);
  h.addEventListener('keydown', function (e) {
    var step = e.key === 'ArrowLeft' ? -10 : e.key === 'ArrowRight' ? 10 : 0;
    if (!step) return;
    e.preventDefault();
    set(get() + (e.shiftKey ? step * 5 : step));
    done();
  });
  h.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    var startX = e.clientX, startW = get();
    function move(ev) { set(startW + ev.clientX - startX); }
    function up() {
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', up);
      h.removeEventListener('pointercancel', up);
      done();
    }
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
    h.addEventListener('pointercancel', up);
  });
  if (reset) h.addEventListener('dblclick', function (e) { e.preventDefault(); reset(); });
  return h;
}

/** A header's own non-blank text node (its title before any controls are added), if it has one. */
function headerTitle(cell) {
  return Array.prototype.find.call(cell.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); });
}

function initColumns(table, settings) {
  var keys = Object.keys(TABLE_COLUMNS);
  var storageKey = table.dataset.dependencyTable === 'dashboard' ? TABLE_KEY : BRANCH_TABLE_KEY;
  var prefs = tablePrefs(tableStorage('getItem', null, storageKey));
  var list = settings.querySelector('.col-settings');

  var col = {}, th = {}, toggle = {}, handle = {}, drawn = {};

  function headerMin(key) { return headerFloor(th[key]); }

  function apply() {
    var shown = keys.filter(function (k) { return prefs[k].visible; });
    var total = 0;
    keys.forEach(function (key) {
      table.querySelectorAll('[data-column="' + key + '"]').forEach(function (el) { el.hidden = !prefs[key].visible; });
    });
    keys.forEach(function (key) {
      var p = prefs[key];
      // The stored width is the user's choice; the header's own one-line width is the floor it is drawn at.
      var w = p.visible ? Math.max(p.width, headerMin(key)) : p.width;
      drawn[key] = w;
      col[key].style.width = th[key].style.width = w + 'px';
      toggle[key].checked = p.visible;
      toggle[key].disabled = p.visible && shown.length === 1; // at least one column stays visible
      handle[key].setAttribute('aria-valuenow', w);
      if (p.visible) total += w;
    });
    table.style.width = total + 'px';
    table.querySelectorAll('td.empty').forEach(function (empty) { empty.colSpan = shown.length; });
    // The focusable row link lives in the first (dependency) column; without it the row itself takes focus and Enter.
    table.querySelectorAll('tbody tr[data-href]').forEach(function (row) {
      if (prefs.dependency.visible) row.removeAttribute('tabindex'); else row.tabIndex = 0;
    });
  }

  function save() { tableStorage('setItem', JSON.stringify({ columns: prefs }), storageKey); }

  function resize(key, w) {
    prefs[key].width = clampWidth(w, prefs[key].width);
    apply();
  }

  keys.forEach(function (key) {
    col[key] = table.querySelector('col[data-column="' + key + '"]');
    th[key] = table.querySelector('th[data-column="' + key + '"]');
    var label = th[key].textContent.trim();

    var h = handle[key] = resizeHandle(label, key,
      function () { return drawn[key]; },
      function (w) { resize(key, w); }, save,
      function () { resize(key, TABLE_COLUMNS[key]); save(); });
    th[key].appendChild(h);

    var row = document.createElement('div');
    row.className = 'col-setting';
    var show = document.createElement('label');
    var box = toggle[key] = document.createElement('input');
    box.type = 'checkbox';
    box.setAttribute('data-column-toggle', key);
    box.addEventListener('change', function () { prefs[key].visible = box.checked; apply(); save(); });
    show.append(box, ' ' + label);
    row.append(show);
    list.appendChild(row);
  });

  settings.querySelector('[data-columns-reset]').addEventListener('click', function () {
    resetColumnOrder(table);
    tableStorage('removeItem', null, storageKey);
    prefs = tablePrefs(null);
    apply();
  });

  table.classList.add('cols-sized');
  apply();
  settings.hidden = false;
  return { refit: apply };
}

/** Keep known saved identities once each, then append newly introduced columns in their original order. */
function columnOrder(text, keys) {
  var saved;
  try { saved = JSON.parse(text); } catch (e) { /* original order */ }
  var order = [];
  (Array.isArray(saved) ? saved : []).concat(keys).forEach(function (key) {
    if (keys.indexOf(key) >= 0 && order.indexOf(key) < 0) order.push(key);
  });
  return order;
}

var HEADER_CONTROLS = 'a, input, select, textarea, label, summary, [role="dialog"], [data-column-resize], button:not(.th-sort)';

function headerControl(target) {
  var cell = target.closest('th');
  var control = target.closest(HEADER_CONTROLS);
  return cell && control && cell.contains(control) ? control : null;
}

function headerSort(cell, sort) {
  cell.addEventListener('click', function (e) { if (!headerControl(e.target)) sort(); });
}

function resetColumnOrder(table) {
  if (table.columnLayout) table.columnLayout.reset();
}

/** Capture original nodes before any movement; lazy popup sizing also uses these original identities. */
function initColumnOrder(table) {
  var head = table.tHead && table.tHead.rows[0];
  if (!head || !head.cells.length) return;
  var cells = Array.prototype.slice.call(head.cells);
  var keys = cells.map(function (cell, i) { return cell.getAttribute('data-column') || (cell.getAttribute('data-label') || cellText(cell)) + ':' + prefIndex(cell, i); });
  var groups = [cells];
  Array.prototype.forEach.call(table.rows, function (row) {
    if (row !== head && row.cells.length === cells.length && !row.querySelector('td.empty')) {
      var nodes = Array.prototype.slice.call(row.cells);
      nodes.forEach(function (cell, i) { cell.originalColumnIndex = i; });
      groups.push(nodes);
    }
  });
  var shifted = groups.slice(); // th/td only: col elements don't render transforms
  table.querySelectorAll('colgroup').forEach(function (group) {
    if (group.children.length === cells.length) groups.push(Array.prototype.slice.call(group.children));
  });
  var storageKey = 'eol-ledger.table-order.v1.' + encodeURIComponent(table.dataset.dependencyTable || prefsId(table));
  var order = columnOrder(tableStorage('getItem', null, storageKey), keys);
  function apply() {
    groups.forEach(function (nodes) {
      order.forEach(function (key) { var node = nodes[keys.indexOf(key)]; node.parentNode.appendChild(node); });
    });
    // A server table's rows arrive after setup, so they are not in groups: order their cells by data-column instead.
    if (table.dataset.server) Array.prototype.forEach.call(table.tBodies[0].rows, function (tr) {
      order.forEach(function (key) {
        var c = Array.prototype.find.call(tr.cells, function (td) { return td.getAttribute('data-column') === key; });
        if (c) tr.appendChild(c);
      });
    });
    order.forEach(function (key, i) {
      var cell = cells[keys.indexOf(key)], button = cell.querySelector('.th-sort');
      if (button) button.setAttribute('aria-label', (cell.getAttribute('data-label') || cellText(cell)) + ', column ' + (i + 1) + ' of ' + cells.length + '. Alt+Left or Alt+Right to move');
    });
  }
  function move(cell, target) {
    var from = order.indexOf(keys[cells.indexOf(cell)]), to = order.indexOf(keys[cells.indexOf(target)]);
    if (from === to || from < 0 || to < 0) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    apply();
    tableStorage('setItem', JSON.stringify(order), storageKey);
  }
  table.columnLayout = { cells: cells, reset: function () { order = keys.slice(); apply(); tableStorage('removeItem', null, storageKey); } };
  var drag = null, suppressClick = false;
  function inside(r, e) { return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom; }
  /**
   * Landing slot (index in order) under the pointer, from the untransformed snapshot; -1 off the header, under an overlay,
   * inside any original control, or over a control that was not there at activation. A known control the preview carried
   * over a valid point does not count, else the preview would undo itself and flicker.
   */
  function landing(e) {
    var hit = document.elementFromPoint(e.clientX, e.clientY);
    if (!hit || cells.indexOf(hit.closest('th')) < 0) return -1;
    if (drag.controls.some(function (c) { return inside(c, e); })) return -1;
    var control = headerControl(hit);
    if (control && !drag.controls.some(function (c) { return c.node === control; })) return -1;
    for (var i = 0; i < drag.rects.length; i++) {
      if (drag.rects[i].width && inside(drag.rects[i], e)) return i;
    }
    return -1;
  }
  /** Shift every column to where the drop at slot `to` would put it: cumulative visible widths, new order minus current. */
  function preview(to) {
    var next = order.slice(), from = order.indexOf(keys[cells.indexOf(drag.cell)]);
    if (to >= 0) next.splice(to, 0, next.splice(from, 1)[0]);
    function lefts(list) {
      var x = 0, out = {};
      list.forEach(function (key) { out[key] = x; x += drag.rects[order.indexOf(key)].width; });
      return out;
    }
    var was = lefts(order), now = lefts(next);
    shifted.forEach(function (nodes) {
      keys.forEach(function (key, i) { nodes[i].style.transform = now[key] === was[key] ? '' : 'translateX(' + (now[key] - was[key]) + 'px)'; });
    });
  }
  function clear() {
    table.classList.remove('column-previewing'); // first, so the reset below snaps instead of animating
    shifted.forEach(function (nodes) { nodes.forEach(function (node) { node.style.transform = ''; }); });
    cells.forEach(function (cell) { cell.classList.remove('column-dragging'); });
    var old = drag;
    drag = null;
    if (old && old.cell.hasPointerCapture(old.id)) old.cell.releasePointerCapture(old.id);
  }
  head.addEventListener('click', function (e) {
    if (suppressClick && e.detail !== 0) { suppressClick = false; e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  head.addEventListener('pointerdown', function (e) {
    suppressClick = false;
    if (e.button !== 0 || e.isPrimary === false || headerControl(e.target)) return;
    var cell = e.target.closest('th');
    if (cells.indexOf(cell) < 0) return;
    suppressClick = false;
    drag = { cell: cell, id: e.pointerId, x: e.clientX, y: e.clientY, active: false, target: null };
    cell.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = Math.abs(e.clientX - drag.x), dy = Math.abs(e.clientY - drag.y);
    if (!drag.active && dy > 6 && dy > dx) { suppressClick = true; clear(); return; }
    if (!drag.active && dx < 6) return;
    if (!drag.active) {
      // geometry before any transform, in saved order: transformed headers never decide the slot
      drag.rects = order.map(function (key) {
        var cell = cells[keys.indexOf(key)], r = cell.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: cell.hidden ? 0 : r.width };
      });
      drag.controls = [];
      cells.forEach(function (cell) {
        if (cell.hidden) return;
        Array.prototype.forEach.call(cell.querySelectorAll(HEADER_CONTROLS), function (control) {
          var r = control.getBoundingClientRect();
          if (r.right > r.left && r.bottom > r.top) drag.controls.push({ node: control, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
        });
      });
      drag.active = true;
      drag.cell.classList.add('column-dragging');
      table.classList.add('column-previewing');
    }
    suppressClick = true;
    e.preventDefault();
    preview(landing(e));
  });
  head.addEventListener('pointerup', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var to = drag.active ? landing(e) : -1;
    if (to >= 0) move(drag.cell, cells[keys.indexOf(order[to])]);
    clear();
  });
  head.addEventListener('pointercancel', clear);
  head.addEventListener('lostpointercapture', clear);
  window.addEventListener('scroll', clear, true);
  window.addEventListener('blur', clear);
  var pop = table.closest('[popover]');
  if (pop) pop.addEventListener('toggle', clear);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drag) { suppressClick = true; clear(); }
  });
  head.addEventListener('keydown', function (e) {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || !e.target.matches('.th-sort')) return;
    e.preventDefault();
    var cell = e.target.closest('th');
    var visible = order.map(function (key) { return cells[keys.indexOf(key)]; }).filter(function (c) { return !c.hidden; });
    var target = visible[visible.indexOf(cell) + (e.key === 'ArrowLeft' ? -1 : 1)];
    if (target) { move(cell, target); e.target.focus({ preventScroll: true }); }
  });
  cells.forEach(function (cell) {
    cell.classList.add('column-reorder');
    var button = cell.querySelector('.th-sort');
    if (!button) {
      button = document.createElement('button'); button.type = 'button'; button.className = 'th-sort';
      var title = headerTitle(cell);
      button.textContent = title ? title.textContent.trim() : cellText(cell);
      if (title) title.replaceWith(button); else cell.prepend(button);
    }
    button.title = (cell.hasAttribute('data-sortable') ? 'Click to sort; ' : '') + 'Drag to move column; Alt+Left or Alt+Right to move';
    button.setAttribute('aria-keyshortcuts', 'Alt+ArrowLeft Alt+ArrowRight');
  });
  apply();
}

// ---- Header sort and filters for EVERY table: mirrored in the URL (see Shareable views), never stored. Pure helpers first (tested in Node). ----
// A column's key is its th[data-column] (else its position), its type th[data-type]: text | version | number | date | datetime.
// A cell's value is its td[data-value] when present (e.g. a blank EoL date shown as "Not published"), else its visible text.

var COLUMN_TYPES = { dependency: 'text', version: 'version', context: 'text', purl: 'text', cycle: 'text', eol: 'date', status: 'text', repos: 'number', branches: 'number', evidence: 'text', source: 'text', sbom: 'text' };
var TEXT_OPS = { 'contains': 'Contains', 'not-contains': 'Does not contain', 'exact': 'Is exactly', 'not-exact': 'Is not exactly',
  'starts-with': 'Starts with', 'ends-with': 'Ends with', 'fuzzy': 'Fuzzy match', 'is-blank': 'Is blank', 'not-blank': 'Is not blank' };
var natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Typed comparison of two non-blank cell values: ISO dates, real numbers, else natural text (3.9 before 3.10).
 * datetime ("2026-11-20 10:00:00 UTC") sorts on the whole stamp but compares by day against a YYYY-MM-DD bound.
 */
function compareTyped(type, a, b) {
  if (type === 'number') return Number(a) - Number(b);
  if (type === 'datetime' && (a.length === 10 || b.length === 10)) { a = a.slice(0, 10); b = b.slice(0, 10); }
  if (type === 'date' || type === 'datetime') return a < b ? -1 : a > b ? 1 : 0;
  return natural.compare(a, b);
}

/** Row indexes in display order: blanks last in both directions, ties keep the original order. */
function sortOrder(values, type, dir) {
  var sign = dir === 'desc' ? -1 : 1;
  return values.map(function (v, i) { return i; }).sort(function (i, j) {
    var a = values[i], b = values[j];
    if (!a !== !b) return a ? -1 : 1;
    return (a && b && sign * compareTyped(type, a, b)) || i - j;
  });
}

/** One range bound typed by the user: {value} (null when blank) or {error}. */
function parseBound(type, text) {
  var t = String(text == null ? '' : text).trim();
  if (!t) return { value: null };
  if (type === 'number') return /^-?\d+(\.\d+)?$/.test(t) ? { value: t } : { error: 'Enter a number.' };
  if (type === 'date' || type === 'datetime') {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    var d = m && new Date(Date.UTC(+m[1], m[2] - 1, +m[3]));
    return d && d.getUTCMonth() === m[2] - 1 && d.getUTCDate() === +m[3] ? { value: t } : { error: 'Enter a real date as YYYY-MM-DD.' };
  }
  return { value: t };
}

/** Both bounds checked together: {start, end} or {error}; a reversed range is an error, never silently applied. */
function checkRange(type, startText, endText) {
  var s = parseBound(type, startText), e = parseBound(type, endText);
  if (s.error || e.error) return { error: (s.error ? 'From: ' + s.error : '') + (s.error && e.error ? ' ' : '') + (e.error ? 'To: ' + e.error : '') };
  if (s.value !== null && e.value !== null && compareTyped(type, s.value, e.value) > 0) return { error: 'From must be on or before To.' };
  return { start: s.value, end: e.value };
}

/** Optimal string alignment distance: edits plus adjacent transpositions (pyhton -> python is 1). */
function editDistance(a, b) {
  var d = [];
  for (var i = 0; i <= a.length; i++) {
    d[i] = [i];
    for (var j = 1; j <= b.length; j++) {
      d[i][j] = i === 0 ? j : Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Every query word must appear in the value, or be within a small typo distance of a value word (or of its start). */
function fuzzyMatches(value, query) {
  var v = value.toLowerCase();
  var words = v.split(/[^\p{L}\p{N}.]+/u).filter(Boolean);
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(function (q) {
    if (v.indexOf(q) >= 0) return true;
    var allowed = q.length <= 3 ? 0 : q.length <= 6 ? 1 : 2;
    return words.some(function (w) { return editDistance(q, w) <= allowed || editDistance(q, w.slice(0, q.length)) <= allowed; });
  });
}

/** Literal, case-insensitive text operators (never a regex). A blank query leaves the value-taking operators inactive. */
function textMatches(op, value, query) {
  var v = String(value).toLowerCase(), q = String(query == null ? '' : query).trim().toLowerCase();
  if (op === 'is-blank') return !v.trim();
  if (op === 'not-blank') return !!v.trim();
  if (!q) return true;
  switch (op) {
    case 'not-contains': return v.indexOf(q) < 0;
    case 'exact': return v === q;
    case 'not-exact': return v !== q;
    case 'starts-with': return v.lastIndexOf(q, 0) === 0;
    case 'ends-with': return v.length >= q.length && v.indexOf(q, v.length - q.length) >= 0;
    case 'fuzzy': return fuzzyMatches(v, q);
    default: return v.indexOf(q) >= 0;
  }
}

/** A column's fresh filter: values mode with every value selected, i.e. inactive. */
function emptyFilter() {
  return { mode: 'values', selected: null, search: '', searchOp: 'contains', op: 'contains', text: '', start: null, end: null, startText: '', endText: '', error: '' };
}

/** The applied constraint of the selected mode only, as value -> boolean; null when it constrains nothing. */
function filterPredicate(f, type) {
  if (f.mode === 'values') {
    if (!f.selected) return null;
    var set = {};
    f.selected.forEach(function (v) { set['=' + v] = true; });
    return function (v) { return set['=' + v] === true; };
  }
  if (f.mode === 'text') {
    if (f.op !== 'is-blank' && f.op !== 'not-blank' && !String(f.text).trim()) return null;
    return function (v) { return textMatches(f.op, v, f.text); };
  }
  if (f.start === null && f.end === null) return null;
  return function (v) {
    return !!v && (f.start === null || compareTyped(type, v, f.start) >= 0) && (f.end === null || compareTyped(type, v, f.end) <= 0);
  };
}

/** Rows (arrays of {key: value}) that pass every active column filter: AND across columns. types: {key: type}, the dashboard's by default. */
function visibleRows(rows, filters, types) {
  var t = types || COLUMN_TYPES;
  var preds = Object.keys(filters).map(function (k) { return [k, filterPredicate(filters[k], t[k] || 'text')]; })
    .filter(function (p) { return p[1]; });
  return rows.map(function (r) { return preds.every(function (p) { return p[1](r[p[0]]); }); });
}

/**
 * Clears one column's filter (other filters and the sort kept) or, without a key, every filter plus the table's default sort.
 * keys and defaultSort describe the table; they default to the dashboard's columns and EoL date ascending. A null defaultSort
 * means "source order".
 */
function clearedState(state, key, keys, defaultSort) {
  var all = keys || Object.keys(COLUMN_TYPES);
  var initial = defaultSort === undefined ? { key: 'eol', dir: 'asc' } : defaultSort;
  var next = { filters: Object.assign({}, state && state.filters), sort: key ? state.sort : initial };
  (key ? [key] : all).forEach(function (k) { next.filters[k] = emptyFilter(); });
  return next;
}

/** Next sort after a header click: a new column starts ascending; the same column flips. */
function nextSort(sort, key) {
  return { key: key, dir: sort && sort.key === key && sort.dir === 'asc' ? 'desc' : 'asc' };
}

/**
 * Header menu box for a trigger at top..bottom in a viewport vh tall: below it, or above when below is short and above
 * has more room; always inside the viewport, with the menu scrolling itself when taller than the room.
 */
function menuBox(top, bottom, height, vh) {
  var below = vh - bottom - 12, above = top - 12;
  var up = height > below && above > below;
  var room = Math.min(vh - 16, Math.max(up ? above : below, Math.min(height, 120)));
  var h = Math.min(height, room);
  var y = up ? top - 4 - h : bottom + 4;
  return { top: Math.max(8, Math.min(y, vh - 8 - h)), maxHeight: room };
}

/** Values selection after a checkbox change; selecting every distinct value means "no constraint" again. */
function toggleValue(selected, all, value, on) {
  var next = (selected || all).filter(function (v) { return v !== value; });
  if (on) next.push(value);
  return next.length === all.length ? null : next;
}

/** A cell's filter/sort value: its data-value when the server set one, else its visible text with whitespace collapsed. */
function cellText(td) {
  return td ? td.textContent.replace(/\s+/g, ' ').trim() : '';
}
function cellValue(td) {
  return td && td.hasAttribute('data-value') ? td.getAttribute('data-value') : cellText(td);
}

var DEFAULT_PAGE_SIZE = 20, MAX_PAGE_SIZE = 1000;

/** Rows per page: a whole number 1..1000 (DashboardQuery checks the same on the server). */
function validPageSize(n) {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_PAGE_SIZE;
}

/** Typed rows-per-page text to a size, or null: digits only, so "7.5", "1e2" and blanks never apply or truncate. */
function parsePageSize(text) {
  var t = String(text == null ? '' : text).trim();
  if (!/^[0-9]+$/.test(t)) return null;
  var n = Number(t);
  return validPageSize(n) ? n : null;
}

/** Rows start..end of n matching rows on a page: a valid size (else 20), page clamped to 1..pages; 0 rows is one empty page. */
function pageRange(n, page, size) {
  if (!validPageSize(size)) size = DEFAULT_PAGE_SIZE;
  var pages = Math.max(1, Math.ceil(n / size));
  var p = Math.min(pages, Math.max(1, Math.floor(page) || 1));
  return { page: p, pages: pages, start: (p - 1) * size, end: Math.min(n, p * size) };
}

// ---- Shareable views: a table's sort, filters and page live in ?view.<table id>={"v":1,...}; widths/visibility/order never do ----

var VIEW_DERIVED = { start: true, end: true, error: true }; // recomputed from startText/endText by checkRange

/**
 * One table's view as versioned JSON holding only what differs from the defaults; null when it is all defaults.
 * domains: {key: the table's distinct values}; a values selection is written as the shorter of selected and excluded.
 * shortcut: an arbitrary selection near half of a huge domain stays long either way; a server 400 is possible there.
 */
function encodeView(view, keys, defaultSort, domains) {
  var out = { v: 1 }, filters = {}, blank = emptyFilter();
  keys.forEach(function (k) {
    var f = view.filters[k], diff = {};
    Object.keys(blank).forEach(function (n) {
      if (!VIEW_DERIVED[n] && JSON.stringify(f[n]) !== JSON.stringify(blank[n])) diff[n] = f[n];
    });
    var domain = domains && domains[k];
    if (f.selected && domain) {
      var picked = {};
      f.selected.forEach(function (v) { picked['=' + v] = true; });
      var excluded = domain.filter(function (v) { return !picked['=' + v]; });
      if (JSON.stringify(excluded).length < JSON.stringify(f.selected).length) { delete diff.selected; diff.excluded = excluded; }
    }
    if (f.excluded && !f.selected) diff.excluded = f.excluded; // server tables: not yet resolved against the column's values
    // An invalid draft keeps the last valid bounds applied: carry them so the URL matches the same rows.
    if (f.error && (f.start !== null || f.end !== null)) { diff.start = f.start; diff.end = f.end; }
    if (Object.keys(diff).length) filters[k] = diff;
  });
  if (Object.keys(filters).length) out.filters = filters;
  if (JSON.stringify(view.sort) !== JSON.stringify(defaultSort)) out.sort = view.sort;
  if (view.page > 1) out.page = view.page;
  if (view.size !== DEFAULT_PAGE_SIZE) out.size = view.size;
  return Object.keys(out).length > 1 ? JSON.stringify(out) : null;
}

/** An excluded list over a column's values as a selection: null when nothing known is excluded. */
function resolveExcluded(excluded, domain) {
  var out = {};
  excluded.forEach(function (x) { out['=' + x] = true; });
  var kept = domain.filter(function (x) { return !out['=' + x]; });
  return kept.length === domain.length ? null : kept;
}

/** Untrusted URL text to a full view: anything missing, malformed, unknown or of another version falls back to its default. */
function decodeView(text, keys, types, defaultSort, domains) {
  var v = null;
  try { v = JSON.parse(text); } catch (e) { /* defaults */ }
  var view = clearedState(null, null, keys, defaultSort);
  view.page = 1;
  view.size = DEFAULT_PAGE_SIZE;
  function has(o, n) { return !!o && typeof o === 'object' && !Array.isArray(o) && Object.prototype.hasOwnProperty.call(o, n); }
  function strings(a) { return Array.isArray(a) && a.every(function (x) { return typeof x === 'string'; }); }
  function bound(x) { return x === null || typeof x === 'string'; }
  if (!has(v, 'v') || v.v !== 1) return view;
  keys.forEach(function (k) {
    if (!has(v.filters, k)) return;
    var s = v.filters[k], f = view.filters[k], domain = domains && domains[k];
    if (has(s, 'mode') && ['values', 'text', 'range'].indexOf(s.mode) >= 0) f.mode = s.mode;
    if (has(s, 'selected') && (s.selected === null || strings(s.selected))) f.selected = s.selected && s.selected.slice();
    else if (has(s, 'excluded') && strings(s.excluded) && domain) f.selected = resolveExcluded(s.excluded, domain);
    else if (has(s, 'excluded') && strings(s.excluded) && s.excluded.length) f.excluded = s.excluded.slice(); // a server table applies it as NOT IN
    if (has(s, 'searchOp') && ['contains', 'exact', 'fuzzy'].indexOf(s.searchOp) >= 0) f.searchOp = s.searchOp;
    if (has(s, 'op') && has(TEXT_OPS, s.op)) f.op = s.op;
    ['search', 'text', 'startText', 'endText'].forEach(function (n) { if (has(s, n) && typeof s[n] === 'string') f[n] = s[n]; });
    var type = types[k] || 'text', c = checkRange(type, f.startText, f.endText);
    if (!c.error) { f.start = c.start; f.end = c.end; return; }
    f.error = c.error;
    // An invalid draft carries the bounds it kept applied; they must pass the same validators.
    var applied = has(s, 'start') && has(s, 'end') && bound(s.start) && bound(s.end) ? checkRange(type, s.start, s.end) : { error: true };
    if (!applied.error) { f.start = applied.start; f.end = applied.end; }
  });
  if (has(v, 'sort') && v.sort === null) view.sort = null;
  else if (has(v.sort, 'key') && keys.indexOf(v.sort.key) >= 0 && (v.sort.dir === 'asc' || v.sort.dir === 'desc')) view.sort = { key: v.sort.key, dir: v.sort.dir };
  if (Number.isInteger(v.page) && v.page > 1) view.page = v.page;
  if (validPageSize(v.size)) view.size = v.size;
  return view;
}

/** href with one query param set, or removed for null; every other param and the fragment kept. */
function withParam(href, name, value) {
  var u = new URL(href);
  if (value === null) u.searchParams.delete(name); else u.searchParams.set(name, value);
  return u.href;
}

/**
 * Per-tab cache of server-table JSON (dashboard pages and column value lists) in sessionStorage, keyed by the full
 * absolute request URL (endpoint plus view or column), so moving between pages of one tab repeats no API call. HTML is
 * still requested as usual. A reload (normal or hard) drops every owned key once per document before any read, and so
 * does an explicit local import, clear or sync; nothing else (no timer, no remote change) refreshes a cached answer.
 * Only validated successful answers are stored; blocked, full or corrupt storage is just a miss.
 */
var JSON_CACHE = 'eol-ledger.json-cache.v1.';
var pendingJson = {};
function clearJsonCache() {
  try {
    var s = window.sessionStorage;
    for (var i = s.length - 1; i >= 0; i--) {
      var k = s.key(i);
      if (k && k.indexOf(JSON_CACHE) === 0) s.removeItem(k);
    }
  } catch (e) { /* blocked storage holds no cache either */ }
}
// Once per document, before any read: a normal or hard reload (both "reload") starts the tab's cache afresh.
try {
  var navEntry = window.performance.getEntriesByType('navigation')[0];
  if (navEntry && navEntry.type === 'reload') clearJsonCache();
} catch (e) { /* no Navigation Timing: keep the cache */ }
// The one exception to "only a reload": a local POST (import, SBOM import, sync, clear) is about to change the data.
document.addEventListener('submit', function (e) {
  if (e.target && /^post$/i.test(e.target.getAttribute('method') || '')) clearJsonCache();
}, true);
function isObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function objects(a) { return Array.isArray(a) && a.every(isObject); }
function counts(o, keys) { return keys.every(function (k) { return Number.isInteger(o[k]) && o[k] >= 0; }); }
function strings(o, keys) { return keys.every(function (k) { return typeof o[k] === 'string'; }); }
var ROW_STRINGS = ['product', 'cycle', 'href', 'purl', 'ecosystem', 'dependency', 'version', 'eol', 'status', 'statusCss', 'context', 'cycleLabel', 'matching'];
/** A DashboardQuery.Url: always text; link is null when the value is not a safe http(s) URL. */
function validUrls(a) { return objects(a) && a.every(function (u) { return typeof u.text === 'string' && (u.link === null || typeof u.link === 'string'); }); }
/** The /api/dashboard page (DashboardQuery.Page and Row) as fillRows and serverRow read it. */
function validPage(p) {
  return isObject(p) && counts(p, ['page', 'pages', 'total', 'matching']) && objects(p.rows) && p.rows.every(function (r) {
    return strings(r, ROW_STRINGS) && counts(r, ['repos', 'branches']) && objects(r.evidence)
      && r.evidence.every(function (l) { return strings(l, ['href', 'text']); }) && validUrls(r.sources) && validUrls(r.sboms);
  });
}
/** The /api/dashboard/values list (DashboardQuery.Value) a filter menu's fill reads. */
function validValues(v) { return objects(v) && v.every(function (e) { return strings(e, ['value', 'label']); }); }

/** The JSON at url from this tab's cache, else one shared network request whose valid answer is then cached. */
function cachedJson(url, valid) {
  var key = JSON_CACHE + url;
  try {
    var hit = JSON.parse(window.sessionStorage.getItem(key));
    if (hit !== null && valid(hit)) return Promise.resolve(hit);
    if (hit !== null) window.sessionStorage.removeItem(key);
  } catch (e) {
    try { window.sessionStorage.removeItem(key); } catch (ignored) { /* blocked */ }
  }
  if (!pendingJson[url]) {
    // Static demo: static.js answers from the bundled data (window.EolStaticApi), so no API request is ever sent.
    var p = pendingJson[url] = (window.EolStaticApi ? window.EolStaticApi(url) : fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }))
      .then(function (data) {
        if (!valid(data)) throw new Error('unexpected answer');
        try { window.sessionStorage.setItem(key, JSON.stringify(data)); } catch (e) { /* full or blocked: just not cached */ }
        return data;
      });
    var done = function () { delete pendingJson[url]; };
    p.then(done, done);
  }
  return pendingJson[url];
}

/**
 * The Code repos table is server-rendered, so its tab snapshot is its first visit's tbody as plain data (cell text,
 * a/span links and the few attributes repos.html sets), under the same owned prefix: the same reload and local-POST
 * rules clear it. Restored before any enhancement; anything else in the rows, or a bad stored value, means fresh rows.
 */
var ROW_ATTRS = ['data-href'], CELL_ATTRS = ['data-column', 'class', 'data-value', 'colspan'];
function safeHref(h) {
  if (typeof h !== 'string' || /[\s\\\u0000-\u001f]/.test(h)) return false;
  if (/^\/(?!\/)/.test(h)) return true;
  try {
    var u = new URL(h);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password;
  } catch (e) { return false; }
}
function onlyKeys(o, names) { return Object.keys(o).every(function (k) { return names.indexOf(k) >= 0; }); }
function validAttrs(a, names) { return isObject(a) && onlyKeys(a, names) && Object.keys(a).every(function (k) { return typeof a[k] === 'string'; }); }
function validPart(p) {
  return typeof p === 'string' || (isObject(p) && onlyKeys(p, ['tag', 'text', 'href']) && typeof p.text === 'string'
    && ((p.tag === 'span' && p.href === undefined) || (p.tag === 'a' && safeHref(p.href))));
}
/** Every row has one cell per header column and a safe data-href, or is the single empty-table cell. */
function validRows(rows, width) {
  return Array.isArray(rows) && rows.every(function (r) {
    if (!isObject(r) || !onlyKeys(r, ['attrs', 'cells']) || !validAttrs(r.attrs, ROW_ATTRS) || !Array.isArray(r.cells)) return false;
    var empty = r.cells.length === 1 && isObject(r.cells[0]) && isObject(r.cells[0].attrs) && r.cells[0].attrs['class'] === 'empty';
    if (!empty && (r.cells.length !== width || !safeHref(r.attrs['data-href']))) return false;
    return r.cells.every(function (c) {
      return isObject(c) && onlyKeys(c, ['attrs', 'parts']) && validAttrs(c.attrs, CELL_ATTRS)
        && (c.attrs.colspan === undefined || /^\d{1,2}$/.test(c.attrs.colspan)) && Array.isArray(c.parts) && c.parts.every(validPart);
    });
  });
}
function readAttrs(node, names) {
  var out = {};
  names.forEach(function (n) {
    var v = n === 'class' ? node.className : node.getAttribute(n);
    if (v) out[n] = v;
  });
  return out;
}
/** The tbody as data; null when a cell holds anything but text, a/span links or the no-script fallback. */
function readRows(tbody) {
  var rows = [];
  for (var i = 0; i < tbody.rows.length; i++) {
    var tr = tbody.rows[i], cells = [];
    for (var j = 0; j < tr.cells.length; j++) {
      var td = tr.cells[j], parts = [];
      for (var k = 0; k < td.childNodes.length; k++) {
        var n = td.childNodes[k], tag = n.nodeType === 1 ? n.tagName.toLowerCase() : null;
        if (n.nodeType === 3) parts.push(n.textContent);
        else if (tag === 'a' || tag === 'span') parts.push(tag === 'a' ? { tag: tag, text: n.textContent, href: n.getAttribute('href') } : { tag: tag, text: n.textContent });
        else if (tag !== 'noscript' && n.nodeType !== 8) return null; // scripts run here, so the no-script link is never shown
      }
      cells.push({ attrs: readAttrs(td, CELL_ATTRS), parts: parts });
    }
    rows.push({ attrs: readAttrs(tr, ROW_ATTRS), cells: cells });
  }
  return rows;
}
function writeRows(tbody, rows) {
  Array.prototype.slice.call(tbody.rows).forEach(function (tr) { tr.remove(); });
  rows.forEach(function (r) {
    var tr = document.createElement('tr');
    Object.keys(r.attrs).forEach(function (k) { tr.setAttribute(k, r.attrs[k]); });
    r.cells.forEach(function (c) {
      var td = document.createElement('td');
      Object.keys(c.attrs).forEach(function (k) { if (k === 'class') td.className = c.attrs[k]; else td.setAttribute(k, c.attrs[k]); });
      c.parts.forEach(function (p) {
        if (typeof p === 'string') return td.append(p); // text nodes: never parsed as markup
        var e = document.createElement(p.tag);
        e.textContent = p.text;
        if (p.href) e.setAttribute('href', p.href);
        if (p.href && p.href.charAt(0) !== '/') e.setAttribute('rel', 'noopener noreferrer');
        td.appendChild(e);
      });
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}
/** Restores this tab's snapshot of the table's rows, or takes it on the first visit. */
function tabSnapshot(table) {
  var tbody = table.tBodies[0], head = table.tHead && table.tHead.rows[0];
  if (!tbody || !head) return;
  var key = JSON_CACHE + 'rows.' + new URL(window.location.href).pathname + '#' + table.id;
  try {
    var saved = JSON.parse(window.sessionStorage.getItem(key));
    if (saved !== null && validRows(saved, head.cells.length)) return writeRows(tbody, saved);
  } catch (e) { /* corrupt or blocked: fresh rows */ }
  var rows = readRows(tbody);
  try {
    if (rows) window.sessionStorage.setItem(key, JSON.stringify(rows)); else window.sessionStorage.removeItem(key);
  } catch (e) { /* full or blocked: just not kept */ }
}

/**
 * One dashboard row from /api/dashboard, shaped like the server-rendered one (same cells, data-value and links), with its
 * cells in the header's current order and visibility. order: data-column keys left to right; th: key -> header cell;
 * keys: the template's column order (each cell's original index).
 */
function serverRow(r, order, th, keys) {
  var tr = document.createElement('tr'), cells = {};
  tr.setAttribute('data-row', r.product + ' ' + r.cycle);
  tr.setAttribute('data-repos', String(r.repos));
  tr.setAttribute('data-branches', String(r.branches));
  tr.setAttribute('data-href', r.href);
  function td(key, value, cls, text) {
    var c = document.createElement('td');
    c.setAttribute('data-column', key);
    if (cls) c.className = cls;
    if (value !== null) c.setAttribute('data-value', value);
    if (text !== null) c.textContent = text;
    cells[key] = c;
    return c;
  }
  function el(tag, text, href) {
    var e = document.createElement(tag);
    if (href) e.setAttribute('href', href);
    e.textContent = text;
    return e;
  }
  td('purl', null, null, r.purl);
  td('ecosystem', null, null, r.ecosystem);
  td('dependency', r.dependency, null, null).appendChild(el('a', r.dependency, r.href));
  td('version', r.version, null, r.version || 'Not installed');
  td('eol', r.eol, 'date', r.eol || 'Not published');
  var status = el('span', r.status);
  status.className = 'eol eol-' + r.statusCss;
  td('status', r.status, null, null).appendChild(status);
  td('repos', String(r.repos), 'num', String(r.repos));
  td('branches', String(r.branches), 'num', String(r.branches));
  td('context', null, null, r.context);
  td('cycle', null, null, r.cycleLabel);
  var evidence = td('evidence', null, 'small', null);
  evidence.appendChild(el('span', r.matching));
  r.evidence.forEach(function (l) { evidence.append(' ', el('a', l.text, l.href)); });
  [['source', 'col-source', r.sources], ['sbom', 'col-sbom', r.sboms]].forEach(function (s) {
    var c = td(s[0], null, s[1], null);
    s[2].forEach(function (u) {
      var e = el(u.link ? 'a' : 'span', u.text, u.link); // link is already restricted to http(s) by the server
      if (u.link) e.setAttribute('rel', 'noopener noreferrer');
      c.append(e, document.createElement('br'), ' ');
    });
  });
  order.forEach(function (key) {
    var c = cells[key];
    c.hidden = th[key].hidden;
    c.originalColumnIndex = keys.indexOf(key);
    tr.appendChild(c);
  });
  if (th.dependency && th.dependency.hidden) tr.tabIndex = 0;
  return tr;
}

var tableSeq = 0;

/**
 * Gives one table the shared header controls: click a column name to sort (asc, then desc), open its funnel for
 * Values / Text / Range filters. opts: {noun, defaultSort, legacy} (dashboard only sets them).
 */
function initTable(table, opts) {
  opts = opts || {};
  var head = table.tHead && table.tHead.rows[0];
  var tbody = table.tBodies[0];
  if (!head || !tbody) return table.setAttribute('data-table-ready', ''); // not paged: nothing to gate
  var trs = Array.prototype.filter.call(tbody.rows, function (tr) { return !tr.hasAttribute('data-empty') && !tr.querySelector('td.empty'); });
  var uid = 't' + (++tableSeq);
  var noun = opts.noun || 'rows';
  var defaultSort = opts.defaultSort || null;
  // A server table (the dashboard) holds only the current page: filters, sort, counts and pages come from its JSON API.
  var server = table.getAttribute('data-server');
  var total = Number(table.getAttribute('data-total')) || 0, seq = 0;

  // Pages below the table: render() lists every match in display order; draw() shows only the current page of it.
  var matching = trs.map(function (tr, i) { return i; }), page = 1, size = DEFAULT_PAGE_SIZE;
  // Browser-local rows per page by table role (like column prefs); only used when the URL has no view param.
  var sizeKey = 'eol-ledger.page-size.v1.' + encodeURIComponent(prefsId(table));
  function savedSize() { return parsePageSize(tableStorage('getItem', null, sizeKey)) || DEFAULT_PAGE_SIZE; }
  var pager = document.createElement('nav');
  pager.className = 'pager';
  pager.setAttribute('aria-label', 'Pages of ' + noun);
  var sizeInput = document.createElement('input');
  sizeInput.setAttribute('data-page-size', '');
  sizeInput.setAttribute('type', 'number');
  sizeInput.setAttribute('min', '1');
  sizeInput.setAttribute('max', String(MAX_PAGE_SIZE));
  sizeInput.setAttribute('step', '1');
  sizeInput.inputMode = 'numeric';
  sizeInput.value = String(size);
  var sizeError = document.createElement('p');
  sizeError.className = 'filter-error';
  sizeError.id = 'page-size-error-' + uid;
  sizeError.setAttribute('data-page-size-error', '');
  sizeError.setAttribute('aria-live', 'polite');
  sizeInput.setAttribute('aria-describedby', sizeError.id);
  sizeInput.setAttribute('aria-invalid', 'false');
  var sizeLabel = document.createElement('label');
  sizeLabel.append('Rows per page ', sizeInput);
  var prev = document.createElement('button'), next = document.createElement('button');
  prev.type = next.type = 'button';
  prev.className = next.className = 'button-quiet';
  prev.setAttribute('data-page-prev', '');
  next.setAttribute('data-page-next', '');
  prev.textContent = 'Previous';
  next.textContent = 'Next';
  var where = document.createElement('p');
  where.setAttribute('data-page-status', '');
  where.setAttribute('aria-live', 'polite');
  pager.append(sizeLabel, sizeError, prev, where, next);
  (table.closest('.table-wrap') || table).after(pager);

  function draw() {
    if (server) return fetchPage();
    var p = pageRange(matching.length, page, size);
    page = p.page;
    trs.forEach(function (tr) { tr.hidden = true; }); // hidden rows are display: none, so never tabbable
    matching.slice(p.start, p.end).forEach(function (i) { trs[i].hidden = false; });
    where.textContent = 'Page ' + p.page + ' of ' + p.pages;
    prev.disabled = p.page <= 1;
    next.disabled = p.page >= p.pages;
    writeView();
  }

  // The address bar mirrors this table's view under its real id; tables without one keep page-local state.
  var param = table.id ? 'view.' + table.id : null, viewReady = false;
  function writeView() {
    if (!viewReady) return;
    var text = encodeView({ filters: filters, sort: sort, page: page, size: size }, keys, defaultSort, distinct);
    // Defaults on a legacy start/end/sort link still need a param, or a reload would bring the legacy bounds back.
    if (!text && legacyView) text = '{"v":1}';
    var href = withParam(window.location.href, param, text);
    if (href !== window.location.href) window.history.replaceState(window.history.state, '', href);
  }

  function turn(by, button, other) {
    page += by;
    draw();
    if (button.disabled) other.focus(); // a disabled button drops focus to the page
  }
  prev.addEventListener('click', function () { turn(-1, prev, next); });
  next.addEventListener('click', function () { turn(1, next, prev); });
  // Applied on commit (change, blur, Enter), never per keystroke; an invalid value keeps the last size and says why.
  function commitSize() {
    var n = parsePageSize(sizeInput.value);
    sizeInput.setAttribute('aria-invalid', String(n === null));
    sizeError.textContent = n === null ? 'Enter a whole number from 1 to ' + MAX_PAGE_SIZE + '; still showing ' + size + ' per page.' : '';
    if (n === null || n === size) return; // the same committed value (change then blur/Enter) draws once
    size = n;
    tableStorage('setItem', String(n), sizeKey);
    page = 1;
    draw();
  }
  sizeInput.addEventListener('change', commitSize);
  sizeInput.addEventListener('blur', commitSize);
  sizeInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commitSize(); } });
  if (!server) draw();
  if (!trs.length && !server) {
    // nothing to sort or filter; the page's own empty message stays, but the size control still shows the restored size
    var emptyText = param ? new URL(window.location.href).searchParams.get(param) : null;
    size = emptyText !== null ? decodeView(emptyText, [], {}, null).size : savedSize();
    sizeInput.value = String(size);
    return table.setAttribute('data-table-ready', '');
  }

  /** Fetches the current page for the current view; a newer request makes older answers stale. */
  function fetchPage() {
    var mine = ++seq;
    var text = encodeView({ filters: filters, sort: sort, page: page, size: size }, keys, defaultSort, distinct) || '{"v":1}';
    table.setAttribute('aria-busy', 'true');
    return cachedJson(withParam(new URL(server, window.location.href).href, 'view', text), validPage)
      .then(function (p) {
        if (mine !== seq) return;
        page = p.page;
        total = p.total;
        fillRows(p.rows);
        where.textContent = 'Page ' + p.page + ' of ' + p.pages;
        prev.disabled = p.page <= 1;
        next.disabled = p.page >= p.pages;
        emptyRow.hidden = p.matching > 0;
        headerState(p.matching);
        table.removeAttribute('aria-busy');
        writeView();
      })
      .catch(function (e) {
        if (mine !== seq) return;
        table.removeAttribute('aria-busy');
        count.textContent = 'Could not load ' + noun + ' (' + e.message + '). Change a filter or reload to retry.';
      });
  }

  function fillRows(rows) {
    trs.forEach(function (tr) { tr.remove(); });
    var order = Array.prototype.map.call(head.cells, function (c) { return c.getAttribute('data-column'); });
    trs = rows.map(function (r) {
      var tr = serverRow(r, order, th, keys);
      tbody.insertBefore(tr, emptyRow);
      return tr;
    });
    clipCells(table);
    linkRows(table);
  }

  var cols = Array.prototype.map.call(head.cells, function (cell, i) {
    return { th: cell, index: i, key: cell.getAttribute('data-column') || 'c' + prefIndex(cell, i), type: cell.getAttribute('data-type') || 'text' };
  });
  var keys = cols.map(function (c) { return c.key; });
  var types = {}, th = {}, colIndex = {};
  cols.forEach(function (c) { types[c.key] = c.type; th[c.key] = c.th; colIndex[c.key] = c.index; });

  var emptyRow = tbody.querySelector('tr[data-empty]');
  if (!emptyRow) {
    emptyRow = document.createElement('tr');
    emptyRow.setAttribute('data-empty', '');
    emptyRow.hidden = true;
    var td = document.createElement('td');
    td.className = 'empty';
    td.colSpan = cols.length;
    td.textContent = 'No ' + noun + ' match these filters.';
    emptyRow.appendChild(td);
    tbody.appendChild(emptyRow);
  }

  var data = trs.map(function (tr) {
    var r = {};
    keys.forEach(function (k) { r[k] = cellValue(tr.cells[colIndex[k]]); });
    return r;
  });
  var labels = {}, menus = {}, sortButtons = {}, openButtons = {}, distinct = {};
  var filters = {}, sort;
  var openKey = null;

  var bar = document.createElement('div');
  bar.className = 'filter-bar';
  var count = document.createElement('p');
  count.setAttribute('data-filter-count', '');
  count.setAttribute('role', 'status');
  var clearAll = document.createElement('button');
  clearAll.type = 'button';
  clearAll.className = 'button-quiet';
  clearAll.setAttribute('data-filters-clear-all', '');
  clearAll.textContent = 'Clear all filters';
  bar.append(count, clearAll);
  table.filterBar = bar; // placeSettings docks the table's settings gear after Clear all
  (table.closest('.table-wrap') || table).before(bar);

  function reset(k) {
    var s = clearedState({ filters: filters, sort: sort }, k, keys, defaultSort);
    filters = s.filters;
    sort = s.sort;
  }

  function render() {
    // Every filter or sort change starts again on page 1 of the whole table's matches.
    page = 1;
    if (server) {
      draw(); // the answer updates the count
      headerState(null);
      return;
    }
    var shown = visibleRows(data, filters, types);
    var order = sort ? sortOrder(data.map(function (r) { return r[sort.key]; }), types[sort.key], sort.dir) : data.map(function (r, i) { return i; });
    order.forEach(function (i) { tbody.insertBefore(trs[i], emptyRow); });
    matching = order.filter(function (i) { return shown[i]; });
    draw();
    emptyRow.hidden = matching.length > 0;
    headerState(matching.length);
  }

  /** Header sort/filter indicators and the count line; n is the number of matches, null while a server page loads. */
  function headerState(n) {
    var active = keys.filter(function (k) { return filterPredicate(filters[k], types[k]) || (filters[k].mode === 'values' && filters[k].excluded); });
    keys.forEach(function (k) {
      var on = active.indexOf(k) >= 0;
      th[k].setAttribute('data-filter-active', String(on));
      openButtons[k].setAttribute('aria-label', 'Filter ' + labels[k] + (on ? ' (filter active)' : ''));
      if (sort && sort.key === k) th[k].setAttribute('aria-sort', sort.dir === 'asc' ? 'ascending' : 'descending');
      else th[k].removeAttribute('aria-sort');
      sortButtons[k].lastChild.textContent = sort && sort.key === k ? (sort.dir === 'asc' ? '↑' : '↓') : '↕';
    });
    if (n !== null) {
      count.textContent = active.length
        ? n + ' matching ' + noun + ' of ' + (server ? total : trs.length)
        : n + ' of ' + (server ? total : trs.length) + ' ' + noun;
    }
    var sortMoved = defaultSort ? !(sort && sort.key === defaultSort.key && sort.dir === defaultSort.dir) : !!sort;
    clearAll.hidden = !active.length && !sortMoved;
    clearAll.textContent = active.length ? 'Clear all filters' : 'Reset sort';
    place(); // a range error line can change the open menu's height
  }

  // Writes one column's state into its menu controls (after a clear, or on first build).
  function sync(k) {
    var f = filters[k], m = menus[k];
    m.mode.value = f.mode;
    m.search.value = f.search;
    m.searchOp.value = f.searchOp;
    m.op.value = f.op;
    m.text.value = f.text;
    m.text.disabled = f.op === 'is-blank' || f.op === 'not-blank';
    m.start.value = f.startText;
    m.end.value = f.endText;
    m.error.textContent = f.mode === 'range' ? f.error : '';
    [m.start, m.end].forEach(function (el) { el.setAttribute('aria-invalid', String(!!f.error)); });
    m.boxes.forEach(function (box) {
      box.checked = !f.selected || f.selected.indexOf(box.value) >= 0;
      // The search only hides list entries; checked values outside it stay selected.
      box.parentNode.hidden = !textMatches(f.searchOp, box.parentNode.textContent.trim(), f.search);
    });
    m.sections.forEach(function (s) { s.hidden = s.getAttribute('data-mode') !== f.mode; });
    place(); // a mode or search change alters the open menu's height
  }

  function control(tag, attr, k, label) {
    var el = document.createElement(tag);
    el.setAttribute(attr, k);
    if (label) el.setAttribute('aria-label', label);
    return el;
  }

  function options(select, map) {
    Object.keys(map).forEach(function (v) { select.add(new Option(map[v], v)); });
  }

  function field(text, el) {
    var l = document.createElement('label');
    l.append(text + ' ', el);
    return l;
  }

  function button(attr, k, text) {
    var b = control('button', attr, k);
    b.type = 'button';
    b.className = 'button-quiet';
    b.textContent = text;
    return b;
  }

  function funnel() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 12 12');
    svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M1 2h10L7.2 6.6V10L4.8 11V6.6z');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.2');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return svg;
  }

  function place() {
    if (!openKey) return;
    var m = menus[openKey].root, r = openButtons[openKey].getBoundingClientRect();
    var scrolled = m.scrollTop;
    m.style.maxHeight = 'none'; // measure the content's own height for the current mode
    var box = menuBox(r.top, r.bottom, m.offsetHeight, window.innerHeight);
    m.style.top = box.top + 'px';
    m.style.maxHeight = box.maxHeight + 'px';
    m.scrollTop = scrolled;
    m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
  }

  function close(focus) {
    if (!openKey) return;
    var k = openKey;
    openKey = null;
    menus[k].root.hidden = true;
    openButtons[k].setAttribute('aria-expanded', 'false');
    // No scroll: an outside click closes the menu on pointerdown, and scrolling back to the header would move its target.
    if (focus) openButtons[k].focus({ preventScroll: true });
  }

  function open(k) {
    close(false);
    openKey = k;
    menus[k].root.hidden = false;
    openButtons[k].setAttribute('aria-expanded', 'true');
    if (server && !distinct[k] && !menus[k].loading) loadValues(k);
    place();
    menus[k].mode.focus();
  }

  // A server table's value list is the whole column (not just this page), fetched when its menu first opens.
  function loadValues(k) {
    menus[k].loading = true;
    var u = new URL(server, window.location.href);
    u.pathname += '/values';
    u.searchParams.set('column', k);
    cachedJson(u.href, validValues)
      .then(function (entries) {
        menus[k].fill(entries);
        var f = filters[k];
        if (f.excluded) { f.selected = resolveExcluded(f.excluded, distinct[k]); delete f.excluded; }
        sync(k);
      })
      .catch(function (e) { menus[k].loading = false; menus[k].error.textContent = 'Could not load values (' + e.message + ').'; });
  }

  function build(k) {
    var f = function () { return filters[k]; };
    var type = types[k];
    var root = control('div', 'data-column-filter', k);
    root.className = 'filter-menu';
    root.id = 'filter-menu-' + uid + '-' + k;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Filter ' + labels[k]);
    root.hidden = true;

    var mode = control('select', 'data-filter-mode', k);
    options(mode, { values: 'Values', text: 'Text', range: 'Range' });
    mode.addEventListener('change', function () { f().mode = mode.value; sync(k); render(); });

    var vals = document.createElement('div');
    vals.setAttribute('data-mode', 'values');
    var searchOp = control('select', 'data-filter-search-op', k, 'Match values by');
    options(searchOp, { contains: 'Contains', exact: 'Is exactly', fuzzy: 'Fuzzy match' });
    var search = control('input', 'data-filter-search', k, 'Search ' + labels[k] + ' values');
    search.type = 'search';
    search.placeholder = 'Search values';
    // Searching only narrows the list; rows change when a checkbox does.
    function narrow() { f().search = search.value; f().searchOp = searchOp.value; sync(k); writeView(); }
    search.addEventListener('input', narrow);
    searchOp.addEventListener('change', narrow);
    var all = button('data-filter-select-all', k, 'Select all');
    var none = button('data-filter-select-none', k, 'Select none');
    all.setAttribute('aria-label', 'Select all values');
    none.setAttribute('aria-label', 'Select no values');
    all.addEventListener('click', function () { f().selected = null; delete f().excluded; sync(k); render(); });
    none.addEventListener('click', function () { f().selected = []; delete f().excluded; sync(k); render(); });
    var list = document.createElement('div');
    list.className = 'filter-values';
    var boxes = [];
    // entries: {value, label} in ascending display order; label is the cell text, e.g. "Not published" for a blank EoL date.
    function fill(entries) {
      entries.forEach(function (e) {
        var v = e.value;
        var box = control('input', 'data-filter-value', k);
        box.type = 'checkbox';
        box.value = v;
        box.addEventListener('change', function () { f().selected = toggleValue(f().selected, distinct[k], v, box.checked); render(); });
        var l = document.createElement('label');
        l.append(box, ' ' + (e.label || '(blank)'));
        list.appendChild(l);
        boxes.push(box);
      });
      distinct[k] = boxes.map(function (b) { return b.value; });
    }
    if (!server) {
      var seen = {}, entries = [];
      sortOrder(data.map(function (r) { return r[k]; }), type, 'asc').forEach(function (i) {
        var v = data[i][k];
        if (seen['=' + v]) return;
        seen['=' + v] = true;
        entries.push({ value: v, label: cellText(trs[i].cells[colIndex[k]]) });
      });
      fill(entries);
    }
    var picks = document.createElement('div');
    picks.className = 'actions';
    picks.append(all, none);
    vals.append(field('Search', searchOp), search, picks, list);

    var txt = document.createElement('div');
    txt.setAttribute('data-mode', 'text');
    var op = control('select', 'data-filter-operator', k);
    options(op, TEXT_OPS);
    var text = control('input', 'data-filter-text', k, labels[k] + ' text');
    text.type = 'text';
    text.placeholder = 'Text';
    function textChanged() { f().op = op.value; f().text = text.value; text.disabled = op.value === 'is-blank' || op.value === 'not-blank'; render(); }
    op.addEventListener('change', textChanged);
    text.addEventListener('input', textChanged);
    txt.append(field('Operator', op), text);

    var rng = document.createElement('div');
    rng.setAttribute('data-mode', 'range');
    var hint = type === 'date' || type === 'datetime' ? 'YYYY-MM-DD' : type === 'number' ? 'Number' : 'Text';
    var start = control('input', 'data-filter-start', k);
    var end = control('input', 'data-filter-end', k);
    var error = document.createElement('p');
    error.className = 'filter-error';
    error.setAttribute('role', 'alert');
    error.id = 'filter-error-' + uid + '-' + k;
    [start, end].forEach(function (el) {
      el.type = 'text';
      el.placeholder = hint;
      if (type === 'number') el.inputMode = 'decimal';
      el.setAttribute('aria-describedby', error.id);
      el.addEventListener('input', function () {
        var c = checkRange(type, start.value, end.value);
        f().startText = start.value;
        f().endText = end.value;
        f().error = c.error || '';
        // An invalid draft keeps the last valid bounds applied.
        if (!c.error) { f().start = c.start; f().end = c.end; }
        error.textContent = f().error;
        [start, end].forEach(function (x) { x.setAttribute('aria-invalid', String(!!c.error)); });
        render();
      });
    });
    var note = document.createElement('p');
    note.className = 'filter-hint';
    note.textContent = 'Both inclusive; blank is open.';
    rng.append(field('From', start), field('To', end), note);

    var clear = button('data-filter-clear', k, 'Clear filter');
    clear.addEventListener('click', function () { reset(k); sync(k); render(); mode.focus(); });

    root.append(field('Filter by', mode), vals, txt, rng, error, clear);
    // Tabbing out of the menu closes it; clicks on its own blank areas do not.
    root.addEventListener('focusout', function (e) {
      if (openKey === k && e.relatedTarget && !root.contains(e.relatedTarget) && e.relatedTarget !== openButtons[k]) close(false);
    });
    menus[k] = { root: root, mode: mode, search: search, searchOp: searchOp, op: op, text: text, start: start, end: end, error: error,
      boxes: boxes, sections: [vals, txt, rng], fill: fill };
    return root;
  }

  keys.forEach(function (k) {
    var cell = th[k];
    var title = headerTitle(cell);
    labels[k] = title ? title.textContent.trim() : cellText(cell);
    cell.setAttribute('data-sortable', '');
    cell.setAttribute('data-label', labels[k]);
    var s = sortButtons[k] = control('button', 'data-column-sort', k);
    s.type = 'button';
    s.className = 'th-sort';
    s.title = 'Sort by ' + labels[k];
    var ind = document.createElement('span');
    ind.className = 'sort-ind';
    ind.setAttribute('aria-hidden', 'true');
    s.append(labels[k], ind);
    headerSort(cell, function () { sort = nextSort(sort, k); render(); });
    var o = openButtons[k] = control('button', 'data-filter-open', k);
    o.type = 'button';
    o.className = 'th-filter';
    o.appendChild(funnel());
    o.setAttribute('aria-haspopup', 'dialog');
    o.setAttribute('aria-expanded', 'false');
    o.setAttribute('aria-controls', 'filter-menu-' + uid + '-' + k);
    o.addEventListener('click', function () { if (openKey === k) close(true); else open(k); });
    if (title) title.replaceWith(s, o); else cell.prepend(s, o);
    // In the header for natural tab order; position: fixed keeps it clear of the table's scroll clipping.
    cell.appendChild(build(k));
  });

  document.addEventListener('pointerdown', function (e) {
    if (openKey && !menus[openKey].root.contains(e.target) && !openButtons[openKey].contains(e.target)) {
      var inMenu = menus[openKey].root.contains(document.activeElement);
      close(inMenu);
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openKey) { e.preventDefault(); close(true); }
  });
  window.addEventListener('resize', place);
  window.addEventListener('scroll', function (e) {
    if (openKey && !menus[openKey].root.contains(e.target)) place(); // the menu's own scrolling does not move it
  }, true);

  clearAll.addEventListener('click', function () {
    // A legacy start/end/sort or ?unused=false dashboard link: reload the default view (column prefs are stored, so they stay),
    // dropping only the legacy params and this table's view; other params and the fragment stay.
    if (opts.legacy && table.getAttribute('data-legacy') === 'true') {
      window.location.assign(['start', 'end', 'sort', 'unused', param].filter(Boolean).reduce(function (href, n) { return withParam(href, n, null); }, window.location.href));
      return;
    }
    close(false);
    reset();
    keys.forEach(sync);
    render();
  });

  var legacyView = !!(opts.legacy && param && (table.getAttribute('data-start') || table.getAttribute('data-end') || table.getAttribute('data-sort') === 'desc'));

  // Explicit URL state wins; without it, the defaults (or a legacy link's bounds). Page and size go last: render() starts on page 1.
  function applyView() {
    var text = param ? new URL(window.location.href).searchParams.get(param) : null;
    var v = decodeView(text, keys, types, defaultSort, distinct);
    viewReady = false;
    if (text !== null) {
      filters = v.filters;
      sort = v.sort;
    } else {
      reset();
      if (opts.legacy) {
        // Legacy ?start=&end=&sort= links (validated by the server) become the initial header state.
        var legacy = checkRange('date', table.getAttribute('data-start'), table.getAttribute('data-end'));
        if (!legacy.error && (legacy.start || legacy.end) && filters.eol) {
          filters.eol = Object.assign(emptyFilter(), { mode: 'range', start: legacy.start, end: legacy.end, startText: legacy.start || '', endText: legacy.end || '' });
        }
        if (table.getAttribute('data-sort') === 'desc' && sort) sort = { key: sort.key, dir: 'desc' };
      }
    }
    keys.forEach(sync);
    render();
    size = text !== null ? v.size : savedSize(); // an explicit URL param always wins, even without a valid size
    sizeInput.value = String(size);
    sizeInput.setAttribute('aria-invalid', 'false');
    sizeError.textContent = '';
    page = v.page;
    viewReady = !!param;
    draw();
  }

  if (param) window.addEventListener('popstate', function () { close(false); applyView(); });
  applyView();
  // A running sync never refreshes this page in place: the tab cache keeps its snapshot until a reload (README).
  table.setAttribute('data-table-ready', ''); // lifts the app.css first-page gate now the restored view is drawn
}

/** Browser-local preference identity: an explicit data-preference-key (a former noun kept when a table gained an id), else its id, else its noun. */
function prefsId(t) {
  return t.getAttribute('data-preference-key') || t.id || tableNoun(t);
}

/** "3 of 4 code repo branches": the table's data-noun, else its region label in lower case, else "rows". */
function tableNoun(t) {
  var region = t.closest && t.closest('[aria-label]');
  return t.getAttribute('data-noun') || (region ? region.getAttribute('aria-label').toLowerCase() : 'rows');
}

// ---- Column visibility on every other table (semantic keys, browser-local, independent of widths) ----

function visibilityPrefs(text, keys) {
  var saved = null;
  try { saved = JSON.parse(text); } catch (e) { /* all visible */ }
  var out = Object.create(null);
  keys.forEach(function (key) {
    out[key] = !(saved && typeof saved === 'object' && !Array.isArray(saved)
      && Object.prototype.hasOwnProperty.call(saved, key) && saved[key] === false);
  });
  if (!keys.some(function (key) { return out[key]; })) keys.forEach(function (key) { out[key] = true; });
  return out;
}

function visibilityKey(table) {
  // Table roles (not record URLs or DOM order) also share preferences across branch/product detail pages.
  return 'eol-ledger.table-columns.v1.' + encodeURIComponent(prefsId(table));
}

function visibilityStorage(table, method, value) {
  try { return window.localStorage[method](visibilityKey(table), value); } catch (e) { return null; }
}

function rowFocus(table) {
  table.querySelectorAll('tbody tr[data-href]').forEach(function (row) {
    var reachable = Array.prototype.some.call(row.cells, function (cell) {
      return !cell.hidden && cell.querySelector('a[href]:not([tabindex="-1"]), button:not([disabled]), input:not([disabled]), select:not([disabled])');
    });
    if (reachable) row.removeAttribute('tabindex'); else row.tabIndex = 0;
  });
}

function initVisibility(table, refit) {
  var cells = table.columnLayout ? table.columnLayout.cells : Array.prototype.slice.call(table.tHead.rows[0].cells);
  var keys = cells.map(function (cell) { return cell.getAttribute('data-label') || cellText(cell); });
  var prefs = visibilityPrefs(visibilityStorage(table, 'getItem'), keys);
  var settings = document.createElement('details');
  settings.className = 'help table-settings';
  settings.setAttribute('aria-label', 'Table settings: ' + tableNoun(table));
  var summary = document.createElement('summary');
  summary.textContent = 'Table settings';
  var list = document.createElement('div');
  list.className = 'col-settings';
  var boxes = [];
  var rows = Array.prototype.slice.call(table.tBodies[0].rows);

  function apply() {
    var shown = keys.filter(function (key) { return prefs[key]; }).length;
    cells.forEach(function (cell, i) {
      cell.hidden = !prefs[keys[i]];
      boxes[i].checked = !cell.hidden;
      boxes[i].disabled = !cell.hidden && shown === 1;
    });
    rows.forEach(function (row) {
      if (row.querySelector('td.empty')) { row.cells[0].colSpan = shown; return; }
      Array.prototype.forEach.call(row.cells, function (cell, i) { cell.hidden = !prefs[keys[cell.originalColumnIndex == null ? i : cell.originalColumnIndex]]; });
    });
    rowFocus(table);
    refit();
  }

  keys.forEach(function (key, i) {
    var row = document.createElement('div');
    row.className = 'col-setting';
    var label = document.createElement('label');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.setAttribute('data-column-toggle', key);
    box.addEventListener('change', function () {
      prefs[key] = box.checked;
      if (!keys.some(function (k) { return prefs[k]; })) prefs[key] = true;
      apply();
      visibilityStorage(table, 'setItem', JSON.stringify(prefs));
    });
    boxes[i] = box;
    label.append(box, ' ' + key);
    row.appendChild(label);
    list.appendChild(row);
  });
  var reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'button-quiet';
  reset.textContent = 'Reset columns';
  reset.setAttribute('data-columns-reset', '');
  reset.addEventListener('click', function () {
    resetColumnOrder(table);
    visibilityStorage(table, 'removeItem');
    prefs = visibilityPrefs(null, keys);
    apply();
  });
  settings.append(summary, list, reset);
  placeSettings(table, settings);
  apply();
}

/**
 * Docks a table's settings disclosure (server-rendered or built above) at the end of its filter toolbar, right after
 * Clear all, as an icon-only gear named "Table settings"; its other children move into one panel the CSS drops down.
 * A table without a toolbar (no rows) keeps it above the table.
 */
function placeSettings(table, settings) {
  var summary = settings.querySelector('summary'), panel = document.createElement('div');
  panel.className = 'settings-panel';
  Array.prototype.slice.call(settings.childNodes).forEach(function (n) { if (n !== summary) panel.appendChild(n); });
  settings.appendChild(panel);
  summary.textContent = '';
  summary.setAttribute('aria-label', 'Table settings');
  summary.setAttribute('title', 'Table settings');
  var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('aria-hidden', 'true');
  [[4.3, 2, '1.7 1.68'], [2.2, 1.1, '']].forEach(function (c) { // a toothed ring and a hub: a gear
    var circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', '6');
    circle.setAttribute('cy', '6');
    circle.setAttribute('r', String(c[0]));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', String(c[1]));
    if (c[2]) circle.setAttribute('stroke-dasharray', c[2]);
    svg.appendChild(circle);
  });
  summary.appendChild(svg);
  if (table.filterBar) table.filterBar.appendChild(settings);
  else (table.closest('.table-wrap') || table).before(settings);
}

// ---- Resizable columns on every other table (widths remembered per table in this browser) ----

var WIDTHS_KEY = 'eol-ledger.table-widths.v1';

/** Stored widths for one table: {columnIndex: px} with only finite numbers kept; anything malformed is empty. */
function storedWidths(text, id) {
  var all = null;
  try { all = JSON.parse(text); } catch (e) { /* none */ }
  var mine = ownObject(all, id) || {};
  var out = {};
  Object.keys(mine).forEach(function (k) {
    if (/^\d+$/.test(k) && typeof mine[k] === 'number' && isFinite(mine[k])) out[k] = clampWidth(mine[k], MIN_WIDTH);
  });
  return out;
}

function initResize(table) {
  var head = table.tHead && table.tHead.rows[0];
  if (!head || !head.cells.length || !table.offsetWidth) return null;
  var id = prefsId(table);
  var cells = table.columnLayout ? table.columnLayout.cells : Array.prototype.slice.call(head.cells);
  var natural = cells.map(function (c) { return Math.round(c.getBoundingClientRect().width); });
  var saved = storedWidths(tableStorage('getItem', null, WIDTHS_KEY), id);
  var ids = cells.map(prefIndex); // stored widths are keyed by preference index, not current position
  var widths = natural.map(function (n, i) { return saved[ids[i]] || n; });
  var drawn = [];

  function apply() {
    var total = 0;
    cells.forEach(function (c, i) {
      var w = Math.max(widths[i], headerFloor(c));
      drawn[i] = w;
      c.style.width = w + 'px';
      handles[i].setAttribute('aria-valuenow', w);
      if (!c.hidden) total += w;
    });
    table.style.width = total + 'px';
  }

  function save() {
    var all = null;
    try { all = JSON.parse(tableStorage('getItem', null, WIDTHS_KEY)); } catch (e) { /* start fresh */ }
    if (!all || typeof all !== 'object' || Array.isArray(all)) all = {};
    var mine = {};
    Object.keys(saved).forEach(function (k) { mine[k] = saved[k]; });
    all[id] = mine;
    tableStorage('setItem', JSON.stringify(all), WIDTHS_KEY);
  }

  var handles = cells.map(function (c, i) {
    var label = c.getAttribute('data-label') || cellText(c);
    var h = resizeHandle(label, String(ids[i]),
      function () { return drawn[i]; },
      function (w) { widths[i] = saved[ids[i]] = clampWidth(w, widths[i]); apply(); },
      save,
      function () { widths[i] = natural[i]; delete saved[ids[i]]; apply(); save(); });
    c.appendChild(h);
    return h;
  });

  table.classList.add('cols-sized');
  apply();
  initVisibility(table, apply);
  return apply;
}

// ---- One-line cells with a hover marquee ----

/** Wraps every body cell's content in .cell-clip > .cell-run so it stays on one line; a <br> becomes a " · " separator. */
function clipCells(table) {
  Array.prototype.forEach.call(table.tBodies, function (tbody) {
    Array.prototype.forEach.call(tbody.rows, function (tr) {
      Array.prototype.forEach.call(tr.cells, function (td) {
        if (td.classList.contains('empty') || td.querySelector('.cell-clip')) return;
        td.querySelectorAll('br').forEach(function (br) {
          var sep = document.createElement('span');
          sep.className = 'cell-sep';
          sep.setAttribute('aria-hidden', 'true');
          sep.textContent = ' · ';
          br.replaceWith(sep);
        });
        var clip = document.createElement('span');
        clip.className = 'cell-clip';
        var run = document.createElement('span');
        run.className = 'cell-run';
        while (td.firstChild) run.appendChild(td.firstChild);
        clip.appendChild(run);
        td.appendChild(clip);
      });
    });
  });
}

/** How far (px) a cell's one-line content overflows its box; 0 when it fits. */
function overflowOf(clip) {
  return Math.max(0, Math.ceil(clip.scrollWidth - clip.clientWidth));
}

/** Marquee duration: about 45px a second, never shorter than 2s, so long values do not race past. */
function marqueeSeconds(distance) {
  return Math.max(2, Math.round(distance / 45 * 10) / 10);
}

function initMarquee() {
  var current = null, pressed = false;
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Text never moves under a selection: a press pauses the running marquee where it is (removing it would swap the value's
  // layout box and Chromium would start no selection), it stays paused while it holds the selection, and no other starts meanwhile.
  document.addEventListener('mousedown', function () { pressed = true; if (current) current.classList.add('is-held'); }, true);
  document.addEventListener('mouseup', function () { pressed = false; if (current && !selecting(current)) current.classList.remove('is-held'); }, true);
  function selecting(clip) {
    var s = window.getSelection && window.getSelection();
    return pressed || !!(s && !s.isCollapsed && s.containsNode(clip, true));
  }

  function stop() {
    if (!current) return;
    current.classList.remove('is-marquee', 'is-held');
    current = null;
  }

  function start(clip) {
    if (clip === current) return;
    stop();
    var over = overflowOf(clip);
    if (!over) return;
    var td = clip.parentNode;
    // The full value is always available as a tooltip, which is all a reduced-motion user gets.
    if (!td.title) td.title = cellText(td).replace(/ · /g, ' ');
    if (still || selecting(clip)) return;
    clip.style.setProperty('--marquee-dist', -over + 'px');
    clip.style.setProperty('--marquee-time', marqueeSeconds(over) + 's');
    clip.classList.add('is-marquee');
    current = clip;
  }

  function clipFor(target) {
    var td = target && target.closest && target.closest('main tbody td');
    return td ? td.querySelector('.cell-clip') : null;
  }

  document.addEventListener('mouseover', function (e) {
    if (pressed) return; // mid-drag: leave the pressed value as it is
    var clip = clipFor(e.target);
    if (clip) start(clip); else stop();
  });
  document.addEventListener('mouseleave', stop);
  document.addEventListener('focusin', function (e) {
    if (pressed) return;
    var clip = clipFor(e.target);
    if (clip) start(clip); else stop();
  });
}

// ---- Right-click a cell's value: a small popup with one button that copies the value as plain text ----

/** Top-left for a w x h popup at point x,y, kept 8px inside a vw x vh viewport. */
function popupAt(x, y, w, h, vw, vh) {
  return { left: Math.max(8, Math.min(x, vw - w - 8)), top: Math.max(8, Math.min(y, vh - h - 8)) };
}

/**
 * Copies plain text from a click: execCommand('copy') on a temporary textarea first, because this app is served over plain
 * HTTP on the LAN where navigator.clipboard does not exist; the Clipboard API only when that fails. Resolves true only when a
 * copy really happened.
 */
function copyText(text, host) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.className = 'copy-buffer';
  host.appendChild(ta);
  ta.focus({ preventScroll: true });
  ta.select();
  var ok = false;
  try { ok = document.execCommand('copy') === true; } catch (e) { /* not copied */ }
  ta.remove();
  var clip = window.navigator && window.navigator.clipboard;
  if (ok || !clip || !clip.writeText) return Promise.resolve(ok);
  return clip.writeText(text).then(function () { return true; }, function () { return false; });
}

/** A cell value's text as shown: list items and " · " separators kept apart, <noscript> fallbacks left out, whitespace collapsed. */
function valueText(run) {
  var c = run.cloneNode(true);
  c.querySelectorAll('noscript').forEach(function (n) { n.remove(); });
  c.querySelectorAll('li').forEach(function (li) { li.append(' '); });
  return c.textContent.replace(/\s+/g, ' ').trim();
}

function initCopy() {
  var menu = document.createElement('div');
  menu.className = 'copy-menu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Cell value');
  menu.tabIndex = -1;
  menu.hidden = true;
  var copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'button-quiet';
  copy.setAttribute('data-copy-value', '');
  copy.textContent = 'Copy text value';
  var note = document.createElement('p');
  note.setAttribute('data-copy-status', '');
  note.setAttribute('role', 'status');
  menu.append(copy, note);
  var value = '', back = null;

  function close(focus) {
    if (menu.hidden) return;
    menu.hidden = true;
    if (focus && back && back.focus) back.focus({ preventScroll: true });
  }

  document.addEventListener('contextmenu', function (e) {
    var td = e.target.closest && e.target.closest('main tbody td');
    var run = td && td.querySelector('.cell-run');
    // The mouse must be on the value itself; the menu key / Shift+F10 on a focused cell link uses that cell's value.
    var keyed = e.button !== 2 && e.target === document.activeElement && e.target.matches('a.cell-link');
    if (!run || !(run.contains(e.target) || keyed)) { close(false); return; }
    e.preventDefault();
    if (menu.hidden) back = document.activeElement;
    value = valueText(run);
    copy.disabled = !value;
    note.textContent = value ? '' : 'This cell has no text to copy.';
    // Inside an open popover (top layer) the menu must live in it to show above it and not light-dismiss it.
    (td.closest('[popover]') || document.body).appendChild(menu);
    menu.hidden = false;
    var r = run.getBoundingClientRect();
    var at = popupAt(keyed ? r.left : e.clientX, keyed ? r.bottom + 4 : e.clientY, menu.offsetWidth, menu.offsetHeight,
      window.innerWidth, window.innerHeight);
    menu.style.left = at.left + 'px';
    menu.style.top = at.top + 'px';
    (value ? copy : menu).focus({ preventScroll: true });
  });

  copy.addEventListener('click', function () {
    copyText(value, menu).then(function (ok) {
      note.textContent = ok ? 'Copied.' : 'Copy failed: this browser blocked the clipboard. Select the text and press Ctrl+C.';
    });
    copy.focus({ preventScroll: true }); // the temporary textarea took focus
  });

  document.addEventListener('pointerdown', function (e) { if (!menu.contains(e.target)) close(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { e.preventDefault(); close(true); } });
  menu.addEventListener('focusout', function (e) { if (e.relatedTarget && !menu.contains(e.relatedTarget)) close(false); });
  window.addEventListener('resize', function () { close(false); });
  window.addEventListener('scroll', function (e) { if (!menu.contains(e.target)) close(false); }, true);
}

// ---- Whole-row links: every cell of a linked row is a real <a>, so the browser shows the row's URL on hover ----

/** True when an element's href resolves to the same URL as the row's data-href. */
function sameTarget(a, href) {
  try { return new URL(a.getAttribute('href'), document.baseURI).href === new URL(href, document.baseURI).href; } catch (e) { return false; }
}

/**
 * For each tr[data-href]: links in its cells that go where the row goes become plain text, then every cell without
 * its own interactive content is wrapped in <a class="cell-link" href="row">. Only the first cell's link is in the tab
 * order and the accessibility tree; the rest are mouse targets for the same URL. Cells with another link (a repo URL,
 * a Details page) keep that link and are left alone.
 */
function linkRows(table) {
  table.querySelectorAll('tbody tr[data-href]').forEach(function (tr) {
    var href = tr.getAttribute('data-href');
    var first = true;
    Array.prototype.forEach.call(tr.cells, function (td) {
      if (td.classList.contains('empty')) return;
      td.querySelectorAll('a[href]').forEach(function (a) {
        if (!sameTarget(a, href)) return;
        var span = document.createElement('span');
        while (a.firstChild) span.appendChild(a.firstChild);
        a.replaceWith(span);
      });
      if (td.querySelector('a, button, input, select, textarea, details, noscript')) { first = false; return; }
      var link = document.createElement('a');
      link.className = 'cell-link';
      link.href = href;
      link.draggable = false; // dragging over the value selects its text instead of dragging the link
      if (!first) {
        link.tabIndex = -1;
        link.setAttribute('aria-hidden', 'true');
      }
      first = false;
      while (td.firstChild) link.appendChild(td.firstChild);
      td.appendChild(link);
      td.classList.add('has-cell-link');
    });
  });
}

// ---- Settings gear (top bar): appearance mode and accent theme, applied and stored by theme.js ----

var THEME_NAMES = { candle: 'Candle', ember: 'Ember', sage: 'Sage', lapis: 'Lapis', plum: 'Plum', truist: 'Truist' };
var MODE_NAMES = { dark: 'Dark', light: 'Light', system: 'System' };

function initSettings(topbar, appearance) {
  var ns = 'http://www.w3.org/2000/svg';
  var wrap = document.createElement('div');
  wrap.className = 'settings';

  var toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'settings-toggle';
  toggle.setAttribute('aria-label', 'Settings');
  toggle.title = 'Settings';
  toggle.setAttribute('aria-haspopup', 'dialog');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'settings-panel');
  var svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  [['path', { d: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z' }],
   ['path', { d: 'M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z' }]]
    .forEach(function (d) {
      var el = document.createElementNS(ns, d[0]);
      Object.keys(d[1]).forEach(function (k) { el.setAttribute(k, d[1][k]); });
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', 'currentColor');
      el.setAttribute('stroke-width', '1.4');
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(el);
    });
  toggle.appendChild(svg);

  var panel = document.createElement('div');
  panel.id = 'settings-panel';
  panel.className = 'settings-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Settings');
  panel.hidden = true;

  var title = document.createElement('p');
  title.className = 'settings-title';
  title.textContent = 'Appearance';

  function group(label, names, kind) {
    var fs = document.createElement('fieldset');
    fs.className = 'settings-group settings-' + kind;
    var legend = document.createElement('legend');
    legend.textContent = label;
    fs.appendChild(legend);
    var buttons = {};
    Object.keys(names).forEach(function (key) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'settings-option';
      b.setAttribute('data-' + kind, key);
      if (kind === 'theme') {
        var sw = document.createElement('span');
        sw.className = 'swatch';
        sw.setAttribute('data-swatch', key);
        sw.setAttribute('aria-hidden', 'true');
        b.appendChild(sw);
      }
      b.append(names[key]);
      b.addEventListener('click', function () {
        var next = {};
        next[kind] = key;
        appearance.set(next);
        sync();
      });
      buttons[key] = b;
      fs.appendChild(b);
    });
    return { el: fs, buttons: buttons };
  }

  var modes = group('Mode', MODE_NAMES, 'mode');
  var themes = group('Accent', THEME_NAMES, 'theme');
  var note = document.createElement('p');
  note.className = 'settings-note';
  note.textContent = 'Saved in this browser. Status colours (ended, ends soon, supported) never change.';
  panel.append(title, modes.el, themes.el, note);
  // The server-rendered Imports link (shown in the top bar without scripts) moves into this panel: same href and aria-current.
  var imports = topbar.querySelector('[data-settings-imports]');
  if (imports) panel.append(imports);

  function sync() {
    var cur = appearance.get();
    Object.keys(modes.buttons).forEach(function (k) { modes.buttons[k].setAttribute('aria-pressed', String(cur.mode === k)); });
    Object.keys(themes.buttons).forEach(function (k) { themes.buttons[k].setAttribute('aria-pressed', String(cur.theme === k)); });
  }

  // the panel scrolls itself instead of running past the bottom of a short screen
  function fit() { panel.style.maxHeight = Math.max(0, window.innerHeight - panel.getBoundingClientRect().top - 16) + 'px'; }

  function open() {
    sync();
    panel.hidden = false;
    fit();
    toggle.setAttribute('aria-expanded', 'true');
    var pressed = panel.querySelector('[aria-pressed="true"]');
    (pressed || panel.querySelector('button')).focus();
  }

  function close(focus) {
    if (panel.hidden) return;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (focus) toggle.focus();
  }

  toggle.addEventListener('click', function () { if (panel.hidden) open(); else close(true); });
  document.addEventListener('pointerdown', function (e) { if (!wrap.contains(e.target)) close(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { e.preventDefault(); close(true); } });
  wrap.addEventListener('focusout', function (e) { if (e.relatedTarget && !wrap.contains(e.relatedTarget)) close(false); });
  window.addEventListener('resize', function () { if (!panel.hidden) fit(); });

  wrap.append(toggle, panel);
  topbar.appendChild(wrap);
}

// Wire-up: the dashboard keeps its column settings; every table on every page gets the same header sort and filters.
if (document.querySelectorAll) {
  // Before any enhancement reads or moves its cells: the tab's frozen Code repos rows.
  var codeRepos = document.getElementById('code-repos-table');
  if (codeRepos) tabSnapshot(codeRepos);
  var topbar = document.querySelector('.topbar');
  if (topbar && window.EolAppearance) initSettings(topbar, window.EolAppearance);
  var dependencyColumns = [];
  document.querySelectorAll('table[data-dependency-table]').forEach(function (t) {
    t.tableSettings = t.closest('.table-wrap').previousElementSibling;
    dependencyColumns.push(initColumns(t, t.tableSettings));
  });
  document.querySelectorAll('main table').forEach(function (t) {
    initTable(t, t.hasAttribute('data-dependency-table')
      ? { noun: 'dependencies', defaultSort: { key: 'eol', dir: 'asc' }, legacy: t.dataset.dependencyTable === 'dashboard' }
      : { noun: tableNoun(t) });
    if (t.tableSettings) placeSettings(t, t.tableSettings);
  });
  dependencyColumns.forEach(function (columns) {
    // Header sort/filter buttons now exist: widen any column whose header would wrap; again once the web fonts have loaded.
    columns.refit();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(columns.refit);
  });
  // After the header controls: their value lists and filters read the cells' original text.
  document.querySelectorAll('main table').forEach(clipCells);
  document.querySelectorAll('main table').forEach(linkRows);
  document.querySelectorAll('main table').forEach(initColumnOrder);
  initMarquee();
  initCopy();
  // Every other table: measure its natural column widths (now one-line), then make them draggable.
  var refits = [];
  document.querySelectorAll('main table').forEach(function (t) {
    if (t.hasAttribute('data-dependency-table')) return;
    var pop = t.closest('[popover]');
    if (pop && !t.offsetWidth) {
      // A table in a closed popover has no size yet: measure it the first time the popover opens.
      pop.addEventListener('toggle', function first(e) {
        if (e.newState !== 'open') return;
        pop.removeEventListener('toggle', first);
        initResize(t);
      });
      return;
    }
    var refit = initResize(t);
    if (refit) refits.push(refit);
  });
  if (refits.length && document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { refits.forEach(function (f) { f(); }); });
  }
}
