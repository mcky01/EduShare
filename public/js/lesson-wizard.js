// EduShare 2.0 AI Lesson Generator Wizard

document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('btnGenerateLesson');
    const lessonForm = document.getElementById('lessonSetupForm');
    const step1 = document.getElementById('lessonStep1');
    const step2 = document.getElementById('lessonStep2');
    const slidesContainer = document.getElementById('slidesPreviewContainer');
    const btnSaveToLibrary = document.getElementById('btnSaveLessonToLibrary');

    let currentLessonData = null;
    let currentNeedsReview = false;
    let currentValidation = [];
    let currentLessonId = null;
    let currentGrounded = false;
    const csrfToken = () => document.querySelector('meta[name=csrf-token]')?.content || window.CSRF_TOKEN || '';

    const syncCompetencyEl = document.getElementById('lessonCompetency');
    const syncTermSel = document.getElementById('lessonTerm');
    const lessonCompCount = document.getElementById('lessonCompCount');
    if (syncCompetencyEl && syncTermSel) {
        const filterCompByTerm = () => {
            const t = syncTermSel.value;
            let visible = 0;
            Array.from(syncCompetencyEl.options || []).forEach((o) => {
                const code = o.dataset?.code || '';
                const ot = o.dataset?.term || '';
                const show = !code || !t || ot === t;
                o.hidden = !show;
                if (show && code) visible++;
            });
            if (lessonCompCount) lessonCompCount.textContent = t ? `(${visible} in ${t})` : '';
            const cur = syncCompetencyEl.selectedOptions?.[0];
            if (cur && cur.hidden) {
                const first = Array.from(syncCompetencyEl.options || []).find((o) => !o.hidden && (o.dataset?.code || ''));
                if (first) syncCompetencyEl.value = first.value;
            }
        };
        syncTermSel.addEventListener('change', filterCompByTerm);
        filterCompByTerm();
    }

    function collectPrefs() {
        const checked = (sel) => Array.from(document.querySelectorAll(sel + ':checked')).map((c) => c.value);
        const other = (cbId, txtId) => {
            const on = document.getElementById(cbId)?.checked;
            const v = document.getElementById(txtId)?.value.trim();
            return on && v ? [v] : [];
        };
        const val = (id) => document.getElementById(id)?.value.trim() || '';
        return {
            approach: [...checked('.approach-cb'), ...other('approachOtherCb', 'approachOther')],
            integration: [...checked('.integration-cb'), ...other('integrationOtherCb', 'integrationOther')],
            resources: [...checked('.resources-cb'), ...other('resourcesOtherCb', 'resourcesOther')],
            language: val('lessonLanguage'),
            assessment: [...checked('.assessment-cb'), ...other('assessmentOtherCb', 'assessmentOther')],
            class_profile: [...checked('.profile-cb'), ...other('profileOtherCb', 'profileOther')].join('; '),
            inclusion: [...checked('.inclusion-cb'), ...other('inclusionOtherCb', 'inclusionOther')].join('; '),
            duration: val('lessonDuration'),
            content_standard: val('lessonContentStd'),
            performance_standard: val('lessonPerfStd'),
            bow_week: val('lessonBowWeek')
        };
    }

    if (generateBtn) {
        generateBtn.addEventListener('click', async () => {
            const topic = document.getElementById('lessonTopic').value.trim();
            const grade_level = document.getElementById('lessonGrade').value;
            const subject = document.getElementById('lessonSubject').value;
            const competencyEl = document.getElementById('lessonCompetency');
            const competency = competencyEl.value;
            const competency_code = competencyEl.selectedOptions?.[0]?.dataset?.code || '';
            const autoTerm = competencyEl.selectedOptions?.[0]?.dataset?.term || '';
            const termSel = document.getElementById('lessonTerm');
            const term = (termSel && termSel.value) || autoTerm || '';
            const instructions = document.getElementById('lessonInstructions').value.trim();

            if (!topic) {
                alert('Please provide a lesson topic.');
                return;
            }

            generateBtn.disabled = true;
            generateBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Generating Lesson Slides with AI...';

            try {
                const res = await fetch('/api/ai/lesson/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrfToken() },
                    body: JSON.stringify({
                        topic,
                        grade_level,
                        subject,
                        competency,
                        competency_code,
                        term,
                        instructions,
                        ...collectPrefs()
                    })
                });

                const data = await res.json();
                if (data.success && data.lesson) {
                    currentLessonData = data.lesson;
                    currentNeedsReview = !!data.needsReview;
                    currentValidation = Array.isArray(data.validation) ? data.validation : [];
                    currentLessonId = data.lessonId || null;
                    currentGrounded = !!data.grounded;
                    renderSlides(data.lesson);
                    updateGroundBadge(data);
                    updateReviewBox();
                    step1.style.display = 'none';
                    step2.style.display = 'block';
                } else {
                    alert('Lesson generation failed. Please try again.');
                }
            } catch (err) {
                console.error('Lesson generate error:', err);
                alert('Error generating lesson.');
            } finally {
                generateBtn.disabled = false;
                generateBtn.innerHTML = '<i class="bi bi-stars me-2"></i> Generate Lesson Plan & Slides';
            }
        });
    }

    function updateGroundBadge(data) {
        const badge = document.getElementById('lessonGroundBadge');
        if (!badge) return;
        const n = Array.isArray(data.sources) ? data.sources.length : 0;
        const issues = Array.isArray(data.validation) ? data.validation : [];
        if (data.grounded && n > 0 && !data.needsReview) {
            badge.textContent = `Grounded: ${n} source${n === 1 ? '' : 's'} (${data.retrieval_reason || 'reranked'})`;
            badge.className = 'small fw-semibold text-success';
        } else {
            const why = issues.length ? ` — check: ${issues.slice(0, 3).join(', ')}` : '';
            badge.textContent = `Teacher review required${why}${data.saveWarning ? ': draft not saved' : ''}`;
            badge.className = 'small fw-semibold text-danger';
        }
        if (data.saveWarning) alert(data.saveWarning);
    }

    function asLines(v) {
        if (Array.isArray(v)) return v.map((x) => String(x || ''));
        if (typeof v === 'string' && v) return [v];
        return [];
    }

    // Dual-read: new shape wins when present, so merged content never double-counts.
    function slideLines(s) {
        const fromNew = [...asLines(s.bullets), ...asLines(s.student_task)];
        if (fromNew.length) return fromNew;
        return asLines(s.content);
    }

    function slideNote(s) {
        if (typeof s.teacher_tip === 'string' && s.teacher_tip) return s.teacher_tip;
        return s.notes || '';
    }

    function renderSlides(lesson) {
        if (!slidesContainer) return;
        if (!lesson || !Array.isArray(lesson.slides) || lesson.slides.length === 0) { alert('Lesson generation returned empty. Try again.'); return; }
        slidesContainer.innerHTML = '';

        const meta = lesson.meta || {};
        const topicEl = document.getElementById('displayLessonTopic');
        const compEl = document.getElementById('displayLessonComp');
        if (topicEl) topicEl.textContent = meta.topic || lesson.topic || '';
        if (compEl) compEl.textContent = `${meta.subject || lesson.subject || ''} • ${meta.grade_level || lesson.gradeLevel || ''} • ${meta.competency || lesson.competency || ''}`;

        lesson.slides.forEach((slide, idx) => {
            const slideCol = document.createElement('div');
            slideCol.className = 'col-md-6 mb-4';
            const id = String(slide.id || slide.type || '').toLowerCase() || 'Concept';
            const lines = slideLines(slide).map((x) => `<li>${formatSlideContent(x)}</li>`).join('');
            const tip = slideNote(slide);
            const notes = tip ? `<div class="mt-2 small text-muted fst-italic"><i class="bi bi-lightbulb me-1"></i>${escapeHtml(tip)}</div>` : '';

            slideCol.innerHTML = `
                <div class="glass-card p-4 h-100 position-relative">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <span class="badge-emerald">Slide ${idx + 1}</span>
                        <span class="badge-amber text-capitalize">${escapeHtml(id)}</span>
                    </div>
                    <h5 class="fw-bold mb-3 text-dark">${escapeHtml(slide.title)}</h5>
                    <ul class="small text-secondary ps-3 mb-0" style="line-height: 1.6;">${lines}</ul>
                    ${notes}
                </div>
            `;
            slidesContainer.appendChild(slideCol);
        });
    }

    function formatSlideContent(content) {
        if (!content) return '';
        let text = escapeHtml(content);
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
        text = text.replace(/^### (.*$)/gim, '<h6 class="fw-bold text-success mt-2 mb-1">$1</h6>');
        return text;
    }

    function updateReviewBox() {
        var box = document.getElementById('lessonReviewBox');
        if (!box) return;
        if (!currentNeedsReview) { box.style.display = 'none'; box.innerHTML = ''; return; }
        var list = currentValidation.slice(0, 5).map(function (v) { return '<li>' + escapeHtml(v) + '</li>'; }).join('');
        box.style.display = 'block';
        box.innerHTML = '<div class="alert alert-warning py-2 px-3 mb-0 small">'
            + '<strong>Teacher review required before saving.</strong>'
            + (list ? '<ul class="mb-1 mt-1">' + list + '</ul>' : '')
            + '<label class="d-flex align-items-center gap-2 mt-1 mb-0">'
            + '<input type="checkbox" id="lessonReviewConfirm" class="form-check-input mt-0"> I reviewed and approve this lesson'
            + '</label></div>';
    }

    if (btnSaveToLibrary) {
        btnSaveToLibrary.addEventListener('click', async () => {
            if (!currentLessonData) return;

            const selectedClassCheckboxes = document.querySelectorAll('.post-class-checkbox:checked');
            const class_ids = Array.from(selectedClassCheckboxes).map(cb => cb.value);
            const confirmed = document.getElementById('lessonReviewConfirm')?.checked === true;
            if (currentNeedsReview && !confirmed) {
                alert('Please review the flagged issues and tick approval before saving.');
                return;
            }

            btnSaveToLibrary.disabled = true;
            btnSaveToLibrary.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Saving...';

            try {
                const res = await fetch('/api/ai/lesson/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrfToken() },
                    body: JSON.stringify({
                        title: currentLessonData.topic,
                        lesson_json: currentLessonData,
                        class_ids,
                        confirmed,
                        lessonId: currentLessonId,
                        grounded: currentGrounded
                    })
                });

                const data = await res.json();
                if (data.success) {
                    const reach = Number.isInteger(data.posted) && data.posted > 0
                        ? ` Posted to ${data.posted} class${data.posted === 1 ? '' : 'es'}.`
                        : '';
                    alert(`Lesson successfully saved to your Material Library!${reach}`);
                    window.location.href = '/teacher/library';
                } else if (res.status === 422) {
                    currentNeedsReview = true;
                    currentValidation = Array.isArray(data.validation) ? data.validation : [];
                    updateReviewBox();
                    alert((data.error || 'Review required.') + (currentValidation.length ? ' Check: ' + currentValidation.slice(0, 3).join(', ') : ''));
                    btnSaveToLibrary.disabled = false;
                } else {
                    alert('Failed to save lesson.');
                    btnSaveToLibrary.disabled = false;
                }
            } catch (err) {
                console.error('Save error:', err);
                alert('An error occurred while saving.');
                btnSaveToLibrary.disabled = false;
            }
        });
    }
});
