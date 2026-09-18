// Teacher activity grading: status filter, score clamp, bulk-save (CSP-safe external file).
(function () {
    if (document.documentElement.hasAttribute('data-grading-wired')) return;
    document.documentElement.setAttribute('data-grading-wired', '1');
    function init() {
        var filter = document.getElementById('gradeStatusFilter');
        var rows = Array.prototype.slice.call(document.querySelectorAll('[data-grade-row]'));
        if (filter) {
            filter.addEventListener('change', function () {
                var v = filter.value;
                rows.forEach(function (r) {
                    r.style.display = (v === 'all' || r.getAttribute('data-status') === v) ? '' : 'none';
                });
            });
        }
        // Clamp score inputs to max.
        document.querySelectorAll('[data-grade-score]').forEach(function (inp) {
            inp.addEventListener('change', function () {
                var max = parseFloat(inp.getAttribute('data-max')) || 100;
                var v = parseFloat(inp.value);
                if (inp.value === '' || isNaN(v)) return;
                if (v < 0) inp.value = 0;
                else if (v > max) inp.value = max;
            });
        });
        // Single-save: spinner + disable on each row form to prevent double-submits.
        document.querySelectorAll('form[id^="grade-form-"]').forEach(function (form) {
            if (form.dataset.gradeWired) return;
            form.dataset.gradeWired = '1';
            form.addEventListener('submit', function () {
                var btn = form.querySelector('[data-grade-save]');
                if (!btn || btn.disabled) return;
                btn.disabled = true;
                btn.setAttribute('aria-busy', 'true');
                btn.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>';
            });
        });
        // Bulk-save: POST each row with a score via XHR, keep single-row forms intact.
        var bulkBtn = document.querySelector('[data-bulk-save]');
        var bulkStatus = document.getElementById('bulkSaveStatus');
        if (bulkBtn) {
            bulkBtn.addEventListener('click', async function () {
                var endpoint = bulkBtn.getAttribute('data-grade-endpoint') || '/teacher/activities/grade';
                var activityId = bulkBtn.getAttribute('data-activity-id');
                var classId = bulkBtn.getAttribute('data-class-id');
                var csrfEl = document.querySelector('meta[name="csrf-token"]');
                var token = (csrfEl && csrfEl.content) || window.CSRF_TOKEN || '';
                var pending = rows.filter(function (r) {
                    var scoreEl = r.querySelector('[data-grade-score]');
                    return scoreEl && String(scoreEl.value).trim() !== '';
                });
                if (pending.length === 0) {
                    if (bulkStatus) bulkStatus.textContent = 'No scores to save.';
                    return;
                }
                bulkBtn.disabled = true;
                bulkBtn.setAttribute('aria-busy', 'true');
                var origBulk = bulkBtn.innerHTML;
                bulkBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span> Saving...';
                var saved = 0, failed = 0;
                for (var i = 0; i < pending.length; i++) {
                    var row = pending[i];
                    var scoreVal = row.querySelector('[data-grade-score]').value;
                    var fbEl = row.querySelector('[data-grade-feedback]');
                    if (bulkStatus) bulkStatus.textContent = 'Saving ' + (i + 1) + ' / ' + pending.length + '...';
                    try {
                        var res = await fetch(endpoint, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                                'Accept': 'application/json',
                                'X-Requested-With': 'XMLHttpRequest',
                                'x-csrf-token': token
                            },
                            body: new URLSearchParams({
                                submission_id: row.getAttribute('data-submission-id') || '',
                                activity_id: activityId,
                                class_id: classId,
                                student_id: row.getAttribute('data-student-id') || '',
                                score: scoreVal,
                                feedback: fbEl ? fbEl.value : ''
                            })
                        });
                        if (res.ok) { saved++; row.setAttribute('data-status', 'graded'); }
                        else { failed++; }
                    } catch (e) { failed++; }
                }
                bulkBtn.disabled = false;
                bulkBtn.removeAttribute('aria-busy');
                bulkBtn.innerHTML = origBulk;
                if (bulkStatus) bulkStatus.textContent = 'Saved ' + saved + ' of ' + pending.length + (failed ? ' (' + failed + ' failed)' : '') + '.';
                var gradedNow = rows.filter(function (r) {
                    var s = r.querySelector('[data-grade-score]');
                    return s && String(s.value).trim() !== '';
                }).length;
                var gradedCount = document.getElementById('gradedCount');
                var gradedBar = document.getElementById('gradedBar');
                if (gradedCount) gradedCount.textContent = gradedNow;
                if (gradedBar) {
                    var pct = rows.length ? Math.round(gradedNow / rows.length * 100) : 0;
                    gradedBar.style.width = pct + '%';
                    gradedBar.setAttribute('aria-valuenow', gradedNow);
                    gradedBar.setAttribute('aria-valuemax', rows.length);
                }
            });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

// ============================================================
// Per-row grading via fetch (keeps the teacher on this page)
// ============================================================
(function perRowGradeForm() {
    const forms = document.querySelectorAll('form[id^="grade-form-"]');
    if (!forms.length) return;

    const csrfMeta = document.querySelector('meta[name=csrf-token]')?.content
        || document.querySelector('input[name="_csrf"]')?.value
        || window.CSRF_TOKEN
        || '';

    forms.forEach((form) => {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const btn = form.querySelector('button[type=submit]');
            const origHtml = btn ? btn.innerHTML : '';
            const row = form.closest('tr');
            const scoreInput = row?.querySelector('[data-grade-score]');
            const feedbackInput = row?.querySelector('[data-grade-feedback]');

            // Client-side validation
            const maxScore = parseFloat(scoreInput?.dataset.max || '0');
            let score = scoreInput ? parseFloat(scoreInput.value) : NaN;
            if (!Number.isFinite(score)) {
                alert('Please enter a numeric score.');
                scoreInput?.focus();
                return;
            }
            if (score < 0) score = 0;
            if (maxScore > 0 && score > maxScore) score = maxScore;
            if (scoreInput) scoreInput.value = score;

            // Loading state
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
            }

            const payload = {
                submission_id: form.querySelector('[name=submission_id]')?.value || null,
                activity_id: form.querySelector('[name=activity_id]')?.value,
                class_id: form.querySelector('[name=class_id]')?.value,
                student_id: form.querySelector('[name=student_id]')?.value,
                score: score,
                feedback: feedbackInput?.value || ''
            };

            try {
                const res = await fetch(form.action, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Accept': 'application/json',
                        'x-csrf-token': csrfMeta
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json().catch(() => ({}));

                if (res.ok && data.success) {
                    // Update the row visually
                    if (row) row.dataset.status = 'graded';
                    const statusCell = row?.querySelector('td:nth-child(2)');
                    if (statusCell) {
                        statusCell.innerHTML = '<span class="badge-emerald"><i class="bi bi-check2-circle me-1"></i>Graded</span>';
                    }

                    // Update the score display in case it was clamped
                    if (scoreInput && data.score != null) scoreInput.value = data.score;

                    // Flash a checkmark on the button
                    if (btn) {
                        btn.innerHTML = '<i class="bi bi-check2-circle"></i>';
                        setTimeout(() => {
                            btn.innerHTML = origHtml;
                            btn.disabled = false;
                        }, 1200);
                    }

                    // Recompute the progress bar
                    if (typeof window.refreshGradingProgress === 'function') {
                        window.refreshGradingProgress();
                    } else {
                        // Fallback: manually recompute if your grading.js has an inline version
                        updateProgressInline();
                    }
                } else {
                    alert(data.error || 'Failed to save grade. Please try again.');
                    if (btn) { btn.innerHTML = origHtml; btn.disabled = false; }
                }
            } catch (err) {
                console.error('Grade save error:', err);
                alert('A network error occurred. Please try again.');
                if (btn) { btn.innerHTML = origHtml; btn.disabled = false; }
            }
        });
    });

    // Fallback progress recompute (safe to call multiple times)
    function updateProgressInline() {
        const rows = document.querySelectorAll('[data-grade-row]');
        const total = rows.length;
        let graded = 0;
        rows.forEach((r) => { if (r.dataset.status === 'graded') graded++; });
        const counter = document.getElementById('gradedCount');
        const bar = document.getElementById('gradedBar');
        if (counter) counter.textContent = graded;
        if (bar) {
            bar.style.width = total ? Math.round((graded / total) * 100) + '%' : '0%';
            bar.setAttribute('aria-valuenow', graded);
        }
    }
})();