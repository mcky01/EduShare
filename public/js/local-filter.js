// EduShare shared local list filter.
// Usage: render partials/local-filter with { scope, ... }, and mark each
// filterable element with [data-filter-scope="<scope>"] carrying:
//   data-search        (lowercase haystack, required)
//   data-filter-group  (optional group value matched against the select)
// The count hook [data-filter-count="<scope>"] (or #<countId>) shows visible rows.
// Works in both card and table views: count reflects the ACTIVE view when the
// page also uses /js/view-toggle.js (listens for edushare:view-change).
(function () {
    function scopeEls(scope) {
        return Array.prototype.slice.call(
            document.querySelectorAll('[data-filter-scope="' + scope + '"]')
        );
    }
    function searchInput(scope) {
        return document.querySelector('[data-filter-search="' + scope + '"]');
    }
    function groupSelect(scope) {
        return document.querySelector('[data-filter-group-select="' + scope + '"]');
    }
    function countEls(scope) {
        return Array.prototype.slice.call(
            document.querySelectorAll('[data-filter-count="' + scope + '"]')
        );
    }
    function viewScopeFor(scope) {
        // Convention: filter scopes that mirror a view-toggle scope share its name.
        return document.querySelector('[data-view-toggle="' + scope + '"]') ? scope : null;
    }
    function activeView(scope) {
        var vs = viewScopeFor(scope);
        if (vs && window.EduViewToggle) return window.EduViewToggle.getView(vs);
        return null;
    }
    // Rows rendered inside a [data-view-table] wrapper belong to the table view;
    // everything else counts as the card view.
    function rowView(row) {
        return row.closest('[data-view-table]') ? 'table' : 'card';
    }
    function apply(scope) {
        var q = searchInput(scope);
        var g = groupSelect(scope);
        var t = (q && q.value ? q.value : '').trim().toLowerCase();
        var gv = g ? g.value : '';
        var view = activeView(scope);
        var visibleActive = 0;
        var visibleTotal = 0;
        scopeEls(scope).forEach(function (el) {
            var hitT = !t || (el.getAttribute('data-search') || '').indexOf(t) !== -1;
            var hitG = !gv || (el.getAttribute('data-filter-group') || '') === gv;
            var show = hitT && hitG;
            el.style.display = show ? '' : 'none';
            if (show) {
                visibleTotal++;
                if (!view || rowView(el) === view) visibleActive++;
            }
        });
        var n = view ? visibleActive : visibleTotal;
        var total = scopeEls(scope).length;
        countEls(scope).forEach(function (c) {
            c.textContent = n;
            c.setAttribute('aria-label', n + ' of ' + total + ' shown');
        });
        syncEmpty(scope, visibleTotal === 0 && total > 0);
    }
    // "No matches" live row: one per scope, inserted after the filter bar
    // and announced via role="status" when a scope filters to zero.
    function syncEmpty(scope, show) {
        var bar = document.querySelector('[data-filter-bar="' + scope + '"]');
        if (!bar) return;
        var el = document.querySelector('[data-filter-empty="' + scope + '"]');
        if (!el) {
            el = document.createElement('div');
            el.setAttribute('data-filter-empty', scope);
            el.setAttribute('role', 'status');
            el.className = 'small text-muted px-1 pb-2';
            el.textContent = 'No matches \u2014 try a different search or filter.';
            bar.insertAdjacentElement('afterend', el);
        }
        el.hidden = !show;
    }
    function applyAll(scope) {
        if (scope) { apply(scope); return; }
        document.querySelectorAll('[data-filter-bar]').forEach(function (bar) {
            apply(bar.getAttribute('data-filter-bar'));
        });
    }

    document.addEventListener('input', function (e) {
        var s = e.target && e.target.closest ? e.target.closest('[data-filter-search]') : null;
        if (s) apply(s.getAttribute('data-filter-search'));
    });
    document.addEventListener('change', function (e) {
        var s = e.target && e.target.closest ? e.target.closest('[data-filter-group-select]') : null;
        if (s) apply(s.getAttribute('data-filter-group-select'));
    });
    document.addEventListener('edushare:view-change', function (e) {
        if (e.detail && e.detail.scope) apply(e.detail.scope);
    });
    document.addEventListener('DOMContentLoaded', function () { applyAll(); });

    window.EduLocalFilter = { apply: apply, applyAll: applyAll };
})();
