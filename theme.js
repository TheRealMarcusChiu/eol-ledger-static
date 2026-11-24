// Appearance (Settings gear): applied before first paint so pages never flash the wrong mode. Kept in this browser only.
(function () {
  var KEY = 'eol-ledger.appearance.v1';
  var MODES = ['dark', 'light', 'system'];
  var THEMES = ['candle', 'ember', 'sage', 'lapis', 'plum', 'truist'];
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  var prefs = { mode: 'dark', theme: 'candle' };

  function load() {
    var saved = null;
    try { saved = JSON.parse(window.localStorage.getItem(KEY)); } catch (e) { /* defaults */ }
    if (saved && typeof saved === 'object') {
      if (MODES.indexOf(saved.mode) >= 0) prefs.mode = saved.mode;
      if (THEMES.indexOf(saved.theme) >= 0) prefs.theme = saved.theme;
    }
  }

  function apply() {
    var mode = prefs.mode === 'system' ? (media && media.matches ? 'light' : 'dark') : prefs.mode;
    root.setAttribute('data-mode', mode);
    root.setAttribute('data-theme', prefs.theme);
  }

  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* not persisted */ }
  }

  load();
  apply();
  // Tables stream in long before deferred app.js pages them: app.css shows only a first page until each table is ready.
  root.setAttribute('data-tables-pending', '');
  if (window.addEventListener) window.addEventListener('load', function () { root.removeAttribute('data-tables-pending'); });
  if (media && media.addEventListener) media.addEventListener('change', function () { if (prefs.mode === 'system') apply(); });

  window.EolAppearance = {
    modes: MODES.slice(),
    themes: THEMES.slice(),
    get: function () { return { mode: prefs.mode, theme: prefs.theme }; },
    set: function (next) {
      if (next && MODES.indexOf(next.mode) >= 0) prefs.mode = next.mode;
      if (next && THEMES.indexOf(next.theme) >= 0) prefs.theme = next.theme;
      apply();
      save();
    }
  };
})();
