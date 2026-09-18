// Admin gradebook: client-side student filter (CSP-safe external file; read-only view).
(function () {
    function init() {
        var input = document.getElementById('gradebookFilter');
        var table = document.getElementById('gradebookTable');
        var count = document.getElementById('gradebookCount');
        if (!input || !table) return;
        var rows = Array.prototype.slice.call(table.querySelectorAll('tbody tr'));
        function refresh() {
            var q = input.value.trim().toLowerCase();
            var shown = 0;
            rows.forEach(function (r) {
                var name = (r.cells[0] ? r.cells[0].textContent : '') + ' ' + (r.cells[1] ? r.cells[1].textContent : '');
                var hit = !q || name.toLowerCase().indexOf(q) !== -1;
                r.style.display = hit ? '' : 'none';
                if (hit) shown++;
            });
            if (count) count.textContent = shown + ' of ' + rows.length + ' students';
        }
        input.addEventListener('input', refresh);
        refresh();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
