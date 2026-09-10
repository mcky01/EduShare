// EduShare 2.0 Interactive Gradebook Sheet
// Debounced autosave + clamp + arrow-key nav + save indicator.

document.addEventListener('DOMContentLoaded', () => {
    var classSelect = document.getElementById('gradebookClassSelect');
    if (classSelect) {
        classSelect.addEventListener('change', () => {
            var id = classSelect.value;
            window.location.href = '/teacher/gradebook?classId=' + encodeURIComponent(id);
        });
    }

    var badge = document.getElementById('gradeSaveBadge');
    function setIndicator(state, text) {
        if (!badge) return;
        badge.textContent = text || state;
        badge.className = state === 'error' ? 'badge bg-danger'
            : state === 'dirty' ? 'badge-amber'
            : state === 'saving' ? 'badge-amber'
            : 'badge-emerald';
    }

    function clampCell(el) {
        var max = parseFloat(el.dataset.maxScore);
        if (!isFinite(max) || max <= 0) max = 100;
        var v = parseFloat(el.value);
        if (el.value === '' || isNaN(v)) return 0;
        if (v < 0) { el.value = 0; return 0; }
        if (v > max) { el.value = max; return max; }
        return v;
    }

    async function saveCell(el) {
        var score = clampCell(el);
        el.classList.remove('dirty');
        el.classList.add('saving');
        setIndicator('saving', 'Saving...');
        try {
            var csrfToken = (document.querySelector('meta[name=csrf-token]') || {}).content || window.CSRF_TOKEN || '';
            var res = await fetch('/api/gradebook/entry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken, 'X-Requested-With': 'XMLHttpRequest' },
                body: JSON.stringify({
                    column_id: el.dataset.columnId,
                    student_id: el.dataset.studentId,
                    score: score
                })
            });
            el.classList.remove('saving');
            if (res.ok) {
                el.classList.add('saved');
                el.title = '';
                setIndicator('saved', 'Saved');
                setTimeout(() => el.classList.remove('saved'), 1200);
            } else {
                el.classList.add('error');
                el.title = res.status === 403 ? 'Save failed. Access denied.' : 'Save failed.';
                setIndicator('error', 'Save failed');
            }
        } catch (err) {
            el.classList.remove('saving');
            el.classList.add('error');
            setIndicator('error', 'Save failed');
        }
    }

    var timers = new WeakMap();
    var cells = Array.prototype.slice.call(document.querySelectorAll('.grade-score-cell'));

    cells.forEach((input) => {
        input.addEventListener('input', () => {
            input.classList.remove('saved', 'error');
            input.classList.add('dirty');
            setIndicator('dirty', 'Unsaved changes');
            if (timers.has(input)) clearTimeout(timers.get(input));
            timers.set(input, setTimeout(() => saveCell(input), 600));
        });
        input.addEventListener('change', () => {
            if (timers.has(input)) clearTimeout(timers.get(input));
            saveCell(input);
        });
        input.addEventListener('keydown', (e) => {
            var idx = cells.indexOf(input);
            var row = input.closest('tr');
            var rowCells = row ? Array.prototype.slice.call(row.querySelectorAll('.grade-score-cell')) : [];
            var colIdx = rowCells.indexOf(input);
            var target = null;
            if (e.key === 'ArrowRight') target = rowCells[colIdx + 1] || null;
            else if (e.key === 'ArrowLeft') target = rowCells[colIdx - 1] || null;
            else if (e.key === 'ArrowDown' || e.key === 'Enter') {
                var nextRow = row ? row.nextElementSibling : null;
                if (nextRow) {
                    var nc = nextRow.querySelectorAll('.grade-score-cell');
                    target = nc[colIdx] || nc[0] || null;
                }
            } else if (e.key === 'ArrowUp') {
                var prevRow = row ? row.previousElementSibling : null;
                if (prevRow) {
                    var pc = prevRow.querySelectorAll('.grade-score-cell');
                    target = pc[colIdx] || pc[0] || null;
                }
            } else return;
            if (target) {
                e.preventDefault();
                if (timers.has(input)) { clearTimeout(timers.get(input)); saveCell(input); }
                target.focus();
                if (typeof target.select === 'function') target.select();
            } else if (idx === -1) {
                void idx;
            }
        });
    });
});
