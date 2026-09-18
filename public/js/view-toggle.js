// EduShare reusable card/table view toggle.
// Usage: render partials/view-toggle with { scope, label }, plus two containers:
//   [data-view-cards="<scope>"]  (card grid, visible by default)
//   [data-view-table="<scope>"]  (table wrapper, starts with .d-none)
// Preference persists per scope in localStorage. Page filters keep working by
// filtering both card and row elements, then re-applying on 'edushare:view-change'.
(function () {
    var KEY_PREFIX = 'edushare-view:';

    function read(scope) {
        try { return localStorage.getItem(KEY_PREFIX + scope); } catch (e) { return null; }
    }
    function save(scope, view) {
        try { localStorage.setItem(KEY_PREFIX + scope, view); } catch (e) { /* private mode */ }
    }
    function cardsEl(scope) {
        return document.querySelector('[data-view-cards="' + scope + '"]');
    }
    function tableEl(scope) {
        return document.querySelector('[data-view-table="' + scope + '"]');
    }
    function buttons(scope) {
        return Array.prototype.slice.call(
            document.querySelectorAll('[data-view-toggle="' + scope + '"] [data-view-btn]')
        );
    }
    function getView(scope) {
        var t = tableEl(scope);
        return (t && !t.classList.contains('d-none')) ? 'table' : 'card';
    }
    function setView(scope, view, persist) {
        var showTable = view === 'table';
        var c = cardsEl(scope);
        var t = tableEl(scope);
        if (!c && !t) return;
        if (c) c.classList.toggle('d-none', showTable);
        if (t) t.classList.toggle('d-none', !showTable);
        buttons(scope).forEach(function (btn) {
            var active = btn.getAttribute('data-view-btn') === view;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        if (persist !== false) save(scope, view);
        document.dispatchEvent(new CustomEvent('edushare:view-change', { detail: { scope: scope, view: view } }));
    }

    // Delegated clicks: one listener covers every toggle on the page.
    document.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-view-btn]') : null;
        if (!btn) return;
        var group = btn.closest('[data-view-toggle]');
        if (!group) return;
        setView(
            group.getAttribute('data-view-toggle'),
            btn.getAttribute('data-view-btn') === 'table' ? 'table' : 'card'
        );
    });

    // Restore saved preference per scope on load.
    document.querySelectorAll('[data-view-toggle]').forEach(function (group) {
        var scope = group.getAttribute('data-view-toggle');
        if (read(scope) === 'table') setView(scope, 'table', false);
        else setView(scope, 'card', false);
    });

    window.EduViewToggle = { getView: getView, setView: setView };
})();
