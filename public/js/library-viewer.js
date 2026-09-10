// EduShare 2.0 Teacher Library: repost picker, lesson slide viewer, filters.
(function () {
    document.querySelectorAll('.repost-picker').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.getElementById('repostItemId').value = btn.getAttribute('data-item-id') || '';
            document.getElementById('repostItemTitle').textContent = btn.getAttribute('data-item-title') || '';
        });
    });
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    document.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('.lesson-viewer') : null;
        if (!btn) return;
        var title = btn.getAttribute('data-lesson-title') || 'Lesson Slides';
        document.getElementById('lessonViewTitle').textContent = title;
        var box = document.getElementById('lessonViewSlides');
        box.innerHTML = '';
        try {
            var lesson = JSON.parse(decodeURIComponent(btn.getAttribute('data-lesson') || '%7B%7D'));
            var slides = Array.isArray(lesson.slides) ? lesson.slides : [];
            if (!slides.length) { box.innerHTML = '<p class="text-muted">No slides stored for this lesson.</p>'; return; }
            var asLines = function (v) {
                if (Array.isArray(v)) return v.map(function (x) { return String(x || ''); });
                if (typeof v === 'string' && v) return [v];
                return [];
            };
            // Dual-read: new shape wins when present, so merged content never double-counts.
            var linesOf = function (s) {
                var fromNew = asLines(s.bullets).concat(asLines(s.student_task));
                if (fromNew.length) return fromNew;
                return asLines(s.content);
            };
            var tipOf = function (s) {
                if (typeof s.teacher_tip === 'string' && s.teacher_tip) return s.teacher_tip;
                return s.notes || '';
            };
            slides.forEach(function (s, i) {
                var id = String(s.id || s.type || 'Concept');
                var div = document.createElement('div');
                div.className = 'glass-card p-3';
                var lis = linesOf(s).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
                var tip = tipOf(s);
                var note = tip ? '<div class="mt-2 small text-muted fst-italic"><i class="bi bi-lightbulb me-1"></i>' + esc(tip) + '</div>' : '';
                div.innerHTML = '<div class="d-flex justify-content-between mb-2"><span class="badge-emerald">Slide ' + (i + 1) + '</span><span class="badge-amber text-capitalize">' + esc(id) + '</span></div>'
                    + '<h6 class="fw-bold">' + esc(s.title) + '</h6>'
                    + '<ul class="small text-secondary ps-3 mb-0">' + lis + '</ul>' + note;
                box.appendChild(div);
            });
        } catch (err) {
            box.innerHTML = '<p class="text-danger">Could not parse stored slides.</p>';
        }
    });
    var q = document.getElementById('librarySearch');
    var subj = document.getElementById('librarySubject');
    var count = document.getElementById('libraryCount');
    function apply() {
        var t = (q ? q.value : '').trim().toLowerCase();
        var s = subj ? subj.value : '';
        var visible = 0;
        document.querySelectorAll('.library-card').forEach(function (card) {
            var hitT = !t || (card.getAttribute('data-search') || '').indexOf(t) !== -1;
            var hitS = !s || card.getAttribute('data-subject') === s;
            var show = hitT && hitS;
            card.style.display = show ? '' : 'none';
            if (show) visible++;
        });
        if (count) count.textContent = visible;
    }
    if (q) q.addEventListener('input', apply);
    if (subj) subj.addEventListener('change', apply);
})();
