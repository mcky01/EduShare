// Teacher AI Quiz Maker (extracted from quiz-maker.ejs inline script)
let generatedQuizQuestions = [];
let quizNeedsReview = false;
let quizValidation = [];
let quizGrounded = false;
const csrfToken = () => document.querySelector('meta[name=csrf-token]')?.content || window.CSRF_TOKEN || '';

if (typeof escapeHtml === 'undefined') {
    window.escapeHtml = (str) => {
        if (str == null) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };
}

function notifyQuiz(msg, type) {
    if (window.showToast) {
        window.showToast(msg, type || 'info');
        return;
    }
    let status = document.getElementById('quizStatus');
    if (!status) {
        status = document.createElement('div');
        status.id = 'quizStatus';
        status.className = 'small fw-semibold mb-2';
        const container = document.getElementById('quizQuestionsContainer');
        if (container && container.parentNode) container.parentNode.insertBefore(status, container);
        else return;
    }
    status.textContent = msg;
    status.classList.toggle('text-danger', type === 'error');
    status.classList.toggle('text-success', type === 'success');
}

function showSaveActions() {
    const el = document.getElementById('saveQuizActions');
    if (!el) return;
    el.classList.remove('d-none');
    el.style.display = 'flex';
}

(function syncQuizCompetencyTerm() {
    const compEl = document.getElementById('quizCompetency');
    const termSel = document.getElementById('quizTerm');
    const countEl = document.getElementById('quizCompCount');
    if (!compEl || !termSel) return;
    const filterCompByTerm = () => {
        const t = termSel.value;
        let visible = 0;
        Array.from(compEl.options || []).forEach((o) => {
            const code = o.dataset?.code || '';
            const ot = o.dataset?.term || '';
            const show = !code || !t || ot === t;
            o.hidden = !show;
            if (show && code) visible++;
        });
        if (countEl) countEl.textContent = t ? `(${visible} in ${t})` : '';
        const cur = compEl.selectedOptions?.[0];
        if (cur && cur.hidden) {
            const first = Array.from(compEl.options || []).find((o) => !o.hidden && (o.dataset?.code || ''));
            if (first) compEl.value = first.value;
        }
    };
    termSel.addEventListener('change', filterCompByTerm);
    filterCompByTerm();
})();

function updateQuizGroundBadge(data) {
    const badge = document.getElementById('quizGroundBadge');
    if (!badge) return;
    const n = Array.isArray(data.sources) ? data.sources.length : 0;
    const issues = Array.isArray(data.validation) ? data.validation : [];
    if (data.grounded && n > 0 && !data.needsReview) {
        badge.textContent = `Grounded: ${n} source${n === 1 ? '' : 's'} (${data.retrieval_reason || 'reranked'})`;
        badge.className = 'small fw-semibold text-success';
    } else {
        const why = issues.length ? ` — check: ${issues.slice(0, 3).join(', ')}` : '';
        badge.textContent = `Teacher review required${why}`;
        badge.className = 'small fw-semibold text-danger';
    }
}

document.getElementById('btnGenerateQuiz').addEventListener('click', async () => {
    const topic = document.getElementById('quizTopic').value.trim();
    const grade_level = document.getElementById('quizGrade').value;
    const subject = document.getElementById('quizSubject').value;
    const mc_count = document.getElementById('quizMcCount').value;
    const tf_count = document.getElementById('quizTfCount').value;
    const id_count = document.getElementById('quizIdCount').value;
    const compEl = document.getElementById('quizCompetency');
    const competency = compEl ? compEl.value : 'General Standard';
    const competency_code = compEl?.selectedOptions?.[0]?.dataset?.code || '';
    const autoTerm = compEl?.selectedOptions?.[0]?.dataset?.term || '';
    const termSel = document.getElementById('quizTerm');
    const term = (termSel && termSel.value) || autoTerm || '';

    const btn = document.getElementById('btnGenerateQuiz');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Generating Questions...';

    try {
        const res = await fetch('/api/ai/quiz/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrfToken() },
            body: JSON.stringify({ topic, grade_level, subject, mc_count, tf_count, id_count, competency, competency_code, term })
        });

        const data = await res.json();
        if (data.success && data.questions) {
            generatedQuizQuestions = data.questions;
            quizNeedsReview = !!data.needsReview;
            quizValidation = Array.isArray(data.validation) ? data.validation : [];
            quizGrounded = !!data.grounded;
            renderQuizQuestions(data.questions);
            updateQuizGroundBadge(data);
            updateQuizReviewBox();
            showSaveActions();
        } else {
            notifyQuiz('Failed to generate quiz.', 'error');
        }
    } catch (err) {
        console.error('Quiz gen error:', err);
        notifyQuiz('Error generating quiz.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-stars me-2"></i> Generate Questions with AI';
    }
});

function renderQuizQuestions(questions) {
    const container = document.getElementById('quizQuestionsContainer');
    container.innerHTML = '';
    document.getElementById('questionCountBadge').textContent = `${questions.length} Questions`;

    questions.forEach((q, idx) => {
        const qCard = document.createElement('div');
        qCard.className = 'glass-card p-3 mb-3';

        let optionsHtml = '';
        if (q.options && q.options.length > 0) {
            optionsHtml = '<div class="mt-2 ps-2">';
            q.options.forEach(opt => {
                optionsHtml += `
                    <div class="small p-1 d-flex align-items-center gap-2 ${opt.is_correct ? 'fw-bold text-success' : 'text-secondary'}">
                        <i class="bi ${opt.is_correct ? 'bi-check-circle-fill text-success' : 'bi-circle text-muted'}"></i>
                        <span>${escapeHtml(opt.option_text)}</span>
                    </div>
                `;
            });
            optionsHtml += '</div>';
        }

        qCard.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="badge-emerald">Question ${idx + 1}</span>
                <span class="badge-amber text-capitalize">${escapeHtml(String(q.question_type || '').replace('_', ' '))}</span>
            </div>
            <div class="fw-bold text-dark mb-1">${escapeHtml(q.question_text)}</div>
            ${optionsHtml}
            ${q.explanation ? `<div class="mt-2 small text-muted fst-italic"><i class="bi bi-info-circle me-1"></i>Explanation: ${escapeHtml(q.explanation)}</div>` : ''}
        `;
        container.appendChild(qCard);
    });
}

function updateQuizReviewBox() {
    var box = document.getElementById('quizReviewBox');
    if (!box) return;
    if (!quizNeedsReview) { box.style.display = 'none'; box.innerHTML = ''; return; }
    var list = quizValidation.slice(0, 5).map(function (v) { return '<li>' + escapeHtml(v) + '</li>'; }).join('');
    box.style.display = 'block';
    box.innerHTML = '<div class="alert alert-warning py-2 px-3 mb-0 small">'
        + '<strong>Teacher review required before publishing.</strong>'
        + (list ? '<ul class="mb-1 mt-1">' + list + '</ul>' : '')
        + '<label class="d-flex align-items-center gap-2 mt-1 mb-0">'
        + '<input type="checkbox" id="quizReviewConfirm" class="form-check-input mt-0"> I reviewed and approve this quiz'
        + '</label></div>';
}

document.getElementById('btnSaveQuiz').addEventListener('click', async () => {
    if (generatedQuizQuestions.length === 0) return;

    const title = document.getElementById('quizTitle').value.trim();
    const subject = document.getElementById('quizSubject').value;
    const grade_level = document.getElementById('quizGrade').value;
    const time_limit = document.getElementById('quizTimeLimit').value;
    const passing_score = document.getElementById('quizPassingScore').value;

    const selectedClassCheckboxes = document.querySelectorAll('.quiz-cls-cb:checked');
    const class_ids = Array.from(selectedClassCheckboxes).map(cb => cb.value);
    const confirmed = document.getElementById('quizReviewConfirm')?.checked === true;
    if (quizNeedsReview && !confirmed) {
        notifyQuiz('Please review the flagged issues and tick approval before publishing.', 'error');
        return;
    }

    const btn = document.getElementById('btnSaveQuiz');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Publishing...';

    try {
        const res = await fetch('/api/ai/quiz/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrfToken() },
            body: JSON.stringify({
                title,
                subject,
                grade_level,
                time_limit,
                passing_score,
                questions: generatedQuizQuestions,
                class_ids,
                confirmed,
                grounded: quizGrounded
            })
        });

        const data = await res.json();
        if (data.success) {
            notifyQuiz('Quiz successfully published and assigned to your classes!', 'success');
            window.location.href = '/teacher/classes';
        } else if (res.status === 422) {
            quizNeedsReview = true;
            quizValidation = Array.isArray(data.validation) ? data.validation : [];
            updateQuizReviewBox();
            notifyQuiz((data.error || 'Review required.') + (quizValidation.length ? ' Check: ' + quizValidation.slice(0, 3).join(', ') : ''), 'error');
            btn.disabled = false;
        } else {
            notifyQuiz(data.error || 'Failed to publish quiz.', 'error');
            btn.disabled = false;
        }
    } catch (err) {
        console.error('Quiz save error:', err);
        notifyQuiz('Error saving quiz.', 'error');
        btn.disabled = false;
    }
});
