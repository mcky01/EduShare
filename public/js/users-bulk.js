// Admin users: bulk-select checkbox bookkeeping (CSP-safe external file).
(function () {
    function init() {
        var all = document.getElementById('bulkCheckAll');
        var boxes = Array.prototype.slice.call(document.querySelectorAll('.bulk-check'));
        var count = document.getElementById('bulkSelectedCount');
        var form = document.getElementById('bulkSelectedForm');
        function refresh() {
            var n = boxes.filter(function (b) { return b.checked; }).length;
            if (count) count.textContent = n + ' selected';
        }
        if (all) all.addEventListener('change', function () {
            boxes.forEach(function (b) { b.checked = all.checked; });
            refresh();
        });
        boxes.forEach(function (b) { b.addEventListener('change', refresh); });
        if (form) form.addEventListener('submit', function (e) {
            boxes.filter(function (b) { return b.checked; }).forEach(function (b) {
                var h = document.createElement('input');
                h.type = 'hidden'; h.name = 'ids'; h.value = b.value;
                form.appendChild(h);
            });
            if (boxes.filter(function (b) { return b.checked; }).length === 0) {
                e.preventDefault();
                alert('Select at least one pending account.');
            }
        });
        refresh();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
