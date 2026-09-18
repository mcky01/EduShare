// EduShare Teacher Library: repost picker + lesson slide viewer.
// List filtering is handled globally by /js/local-filter.js (scope: library).
(function () {
    if (document.documentElement.hasAttribute('data-library-wired')) return;
    document.documentElement.setAttribute('data-library-wired', '1');
    // Modal POST forms (upload / repost): disable submit to prevent double-posts.
    document.querySelectorAll('#uploadMaterialModal form, #repostSharedModal form').forEach(function (form) {
        if (form.dataset.libraryWired) return;
        form.dataset.libraryWired = '1';
        form.addEventListener('submit', function () {
            var btn = form.querySelector('button[type="submit"]');
            if (!btn || btn.disabled) return;
            btn.disabled = true;
            btn.setAttribute('aria-busy', 'true');
            btn.insertAdjacentHTML('afterbegin', '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>');
        });
    });
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
            // Projection-first: slide_text wins, legacy bullets/content as fallback.
            // Citations never shown on projection; script/visual shown teacher-only.
            var linesOf = function (s) {
                var fromNew = asLines(s.slide_text).concat(asLines(s.student_task));
                if (fromNew.length) return fromNew.map(function (x) { return String(x).replace(/\s*\[[PS]\d+\]/g, '').trim(); });
                var legacy = asLines(s.bullets).concat(asLines(s.student_task));
                if (legacy.length) return legacy;
                return asLines(s.content);
            };
            var scriptOf = function (s) {
                if (typeof s.teacher_script === 'string' && s.teacher_script) return s.teacher_script;
                return '';
            };
            var visualOf = function (s) {
                if (typeof s.visual_prompt === 'string' && s.visual_prompt) return s.visual_prompt;
                return '';
            };
            var tipOf = function (s) {
                if (typeof s.teacher_tip === 'string' && s.teacher_tip) return s.teacher_tip;
                return s.notes || '';
            };
            var sayOf = function (s) {
                if (typeof s.speaker_notes === 'string' && s.speaker_notes) return s.speaker_notes;
                return '';
            };
            slides.forEach(function (s, i) {
                var id = String(s.id || s.type || 'Concept');
                var div = document.createElement('div');
                div.className = 'glass-card p-3';
                var lis = linesOf(s).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
                var tip = tipOf(s);
                var say = sayOf(s);
                var script = scriptOf(s);
                var visual = visualOf(s);
                var sayHtml = say ? '<div class="mt-2 small text-primary"><i class="bi bi-mic me-1"></i><strong>Say / Do:</strong> ' + esc(say) + '</div>' : '';
                var scriptHtml = script ? '<div class="mt-2 small text-secondary"><i class="bi bi-journal-text me-1"></i><strong>Script:</strong> ' + esc(script) + '</div>' : '';
                var visualHtml = '<div class="mt-2 small text-muted"><i class="bi bi-image me-1"></i><em>Show: ' + esc(visual || 'simple visual related to the slide title') + '</em></div>';
                var note = tip ? '<div class="mt-2 small text-muted fst-italic"><i class="bi bi-lightbulb me-1"></i>' + esc(tip) + '</div>' : '';
                div.innerHTML = '<div class="d-flex justify-content-between mb-2"><span class="badge-emerald">Slide ' + (i + 1) + '</span><span class="badge-amber text-capitalize">' + esc(id) + '</span></div>'
                    + '<h6 class="fw-bold">' + esc(s.title) + '</h6>'
                    + '<ul class="small text-secondary ps-3 mb-0">' + lis + '</ul>' + visualHtml + scriptHtml + sayHtml + note;
                box.appendChild(div);
            });
        } catch (err) {
            box.innerHTML = '<p class="text-danger">Could not parse stored slides.</p>';
        }
    });
})();
