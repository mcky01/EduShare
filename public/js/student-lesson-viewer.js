// EduShare Student viewer: projection bullets only (speaker notes stay teacher-only).
(function () {
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function asLines(v) {
        if (Array.isArray(v)) return v.map(function (x) { return String(x || ''); });
        if (typeof v === 'string' && v) return [v];
        return [];
    }
    function linesOf(s) {
        var fromNew = asLines(s.slide_text).concat(asLines(s.student_task));
        if (fromNew.length) return fromNew.map(function (x) { return String(x).replace(/\s*\[[PS]\d+\]/g, '').trim(); });
        var legacy = asLines(s.bullets).concat(asLines(s.student_task));
        if (legacy.length) return legacy;
        return asLines(s.content);
    }
    document.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('.lesson-viewer') : null;
        if (!btn) return;
        var title = btn.getAttribute('data-lesson-title') || 'Lesson Slides';
        var titleEl = document.getElementById('studentLessonTitle');
        if (titleEl) titleEl.textContent = title;
        var box = document.getElementById('studentLessonSlides');
        if (!box) return;
        box.innerHTML = '';
        try {
            var lesson = JSON.parse(decodeURIComponent(btn.getAttribute('data-lesson') || '%7B%7D'));
            var slides = Array.isArray(lesson.slides) ? lesson.slides : [];
            if (!slides.length) { box.innerHTML = '<p class="text-muted">No slides posted for this lesson yet.</p>'; return; }
            slides.forEach(function (s, i) {
                var id = String(s.id || s.type || 'Slide');
                var div = document.createElement('div');
                div.className = 'glass-card p-3';
                var lis = linesOf(s).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
                div.innerHTML = '<div class="d-flex justify-content-between mb-2"><span class="badge-emerald">Slide ' + (i + 1) + '</span><span class="badge-amber text-capitalize">' + esc(id) + '</span></div>'
                    + '<h6 class="fw-bold">' + esc(s.title) + '</h6>'
                    + '<ul class="small text-secondary ps-3 mb-0">' + lis + '</ul>';
                box.appendChild(div);
            });
            var modalEl = document.getElementById('studentLessonModal');
            if (modalEl && window.bootstrap && window.bootstrap.Modal) {
                window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
            }
        } catch (err) {
            box.innerHTML = '<p class="text-danger" role="alert">Could not open these slides. The file may be outdated — ask your teacher to re-post it.</p>';
        }
        // Move focus into the slides region so keyboard/screen-reader users land on content.
        if (box.firstElementChild && box.firstElementChild.setAttribute) {
            box.setAttribute('tabindex', '-1');
            try { box.focus({ preventScroll: true }); } catch { /* noop */ }
        }
    });
})();
