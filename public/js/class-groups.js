// EduShare — Admin classes grouped view (CSP-safe, vanilla, no deps).
// Collapsible grade groups with persisted state (localStorage), so an
// admin's expanded/collapsed layout survives navigation + reload.
(function () {
    'use strict';

    var STORE_KEY = 'edushare-admin-class-groups';

    function loadState() {
        try {
            var raw = localStorage.getItem(STORE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function saveState(state) {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(state));
        } catch (e) { /* private mode: layout just resets */ }
    }

    function applyToGroup(group, collapsed, state) {
        var body = group.querySelector('.class-grade-body');
        var btn = group.querySelector('[data-grade-toggle]');
        var chev = group.querySelector('.class-grade-chevron');
        if (!body || !btn) return;
        body.hidden = collapsed;
        btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        if (chev) {
            chev.classList.toggle('bi-chevron-down', !collapsed);
            chev.classList.toggle('bi-chevron-right', collapsed);
        }
        var grade = group.getAttribute('data-grade-group');
        if (grade) {
            state[grade] = collapsed ? '0' : '1';
            saveState(state);
        }
    }

    function init() {
        var groups = Array.prototype.slice.call(document.querySelectorAll('.class-grade-group'));
        if (!groups.length) return;
        var state = loadState();
        groups.forEach(function (group) {
            var grade = group.getAttribute('data-grade-group');
            // Default: all expanded. Restore only explicit collapses.
            applyToGroup(group, state[grade] === '0', state);
            var btn = group.querySelector('[data-grade-toggle]');
            if (btn) {
                btn.addEventListener('click', function () {
                    var body = group.querySelector('.class-grade-body');
                    applyToGroup(group, !(body && body.hidden), loadState());
                });
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
