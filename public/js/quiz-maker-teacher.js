// Teacher AI Quiz Maker (extracted from quiz-maker.ejs inline script)
let generatedQuizQuestions = [];
let quizNeedsReview = false;
let quizValidation = [];
let quizGrounded = false;
const csrfToken = () => document.querySelector('meta[name=csrf-token]')?.content || window.CSRF_TOKEN || '';

// ============================================================
// Draft persistence (sessionStorage) — survives refresh + back/forward
// ============================================================
const DRAFT_KEY = 'edushare_quiz_draft_v1';

function saveQuizDraft() {
    try {
        if (!generatedQuizQuestions || generatedQuizQuestions.length === 0) {
            // If there's nothing to save, clear the draft to avoid restoring stale data
            sessionStorage.removeItem(DRAFT_KEY);
            return;
        }
        const draft = {
            savedAt: Date.now(),
            questions: generatedQuizQuestions,
            needsReview: quizNeedsReview,
            validation: quizValidation,
            grounded: quizGrounded,
            // Save form fields too
            form: {
                title: document.getElementById('quizTitle')?.value || '',
                subject: document.getElementById('quizSubject')?.value || '',
                gradeLevel: document.getElementById('quizGrade')?.value || '',
                topic: document.getElementById('quizTopic')?.value || '',
                planText: document.getElementById('quizPlanText')?.value || '',
                planFormat: document.getElementById('quizPlanFormat')?.value || '',
                focusSession: document.getElementById('quizFocusSession')?.value || '',
                mcCount: document.getElementById('quizMcCount')?.value || '3',
                tfCount: document.getElementById('quizTfCount')?.value || '2',
                idCount: document.getElementById('quizIdCount')?.value || '1',
                timeLimit: document.getElementById('quizTimeLimit')?.value || '15',
                passingScore: document.getElementById('quizPassingScore')?.value || '60',
                targetClasses: Array.from(document.querySelectorAll('.quiz-cls-cb:checked')).map((cb) => cb.value)
            }
        };
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (err) {
        console.warn('Failed to save quiz draft:', err);
    }
}

function loadQuizDraft() {
    try {
        const raw = sessionStorage.getItem(DRAFT_KEY);
        if (!raw) return null;
        const draft = JSON.parse(raw);
        // Expire drafts older than 6 hours (safety net — avoid stale data)
        if (!draft.savedAt || Date.now() - draft.savedAt > 6 * 60 * 60 * 1000) {
            sessionStorage.removeItem(DRAFT_KEY);
            return null;
        }
        return draft;
    } catch {
        return null;
    }
}

function clearQuizDraft() {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
}

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

// ---- AI generation loading UI ----
let __quizLoadTimer = null;

function showQuizLoadingState() {
    const container = document.getElementById('quizQuestionsContainer');
    if (!container) return;
    const startedAt = Date.now();
    container.innerHTML = `
        <div class="quiz-loading-wrap">
            <div class="quiz-loading-spinner"></div>
            <div class="quiz-loading-title">AI is writing your quiz…</div>
            <div class="quiz-loading-sub">Reading your plan, drafting questions, building the answer key.</div>
            <div class="quiz-loading-sub">Local models typically take 30–90 seconds.</div>
            <div class="quiz-loading-timer" id="quizLoadingTimer">00:00</div>
            <div class="mt-4">
                <div class="quiz-skeleton-card">
                    <div class="quiz-skeleton-line w-40"></div>
                    <div class="quiz-skeleton-line w-90"></div>
                    <div class="quiz-skeleton-line w-60 short"></div>
                    <div class="quiz-skeleton-line w-90 short"></div>
                </div>
                <div class="quiz-skeleton-card">
                    <div class="quiz-skeleton-line w-40"></div>
                    <div class="quiz-skeleton-line w-90"></div>
                    <div class="quiz-skeleton-line w-60 short"></div>
                    <div class="quiz-skeleton-line w-90 short"></div>
                </div>
                <div class="quiz-skeleton-card">
                    <div class="quiz-skeleton-line w-40"></div>
                    <div class="quiz-skeleton-line w-90"></div>
                    <div class="quiz-skeleton-line w-60 short"></div>
                </div>
            </div>
        </div>
    `;

    // Tick the timer every second
    if (__quizLoadTimer) clearInterval(__quizLoadTimer);
    const timerEl = () => document.getElementById('quizLoadingTimer');
    __quizLoadTimer = setInterval(() => {
        const el = timerEl();
        if (!el) return;
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const s = String(elapsed % 60).padStart(2, '0');
        el.textContent = `${m}:${s}`;
    }, 500);

    // Also update the question count badge to reflect the loading state
    const badge = document.getElementById('questionCountBadge');
    if (badge) badge.textContent = 'Generating…';

    // Hide any stale review box
    const reviewBox = document.getElementById('quizReviewBox');
    if (reviewBox) { reviewBox.style.display = 'none'; reviewBox.innerHTML = ''; }

    // Hide save actions until new questions arrive
    const saveActions = document.getElementById('saveQuizActions');
    if (saveActions) { saveActions.classList.add('d-none'); saveActions.style.display = 'none'; }
}

function clearQuizLoadingState() {
    if (__quizLoadTimer) { clearInterval(__quizLoadTimer); __quizLoadTimer = null; }
}

function showQuizLoadingError(message) {
    clearQuizLoadingState();
    const container = document.getElementById('quizQuestionsContainer');
    if (!container) return;
    container.innerHTML = `
        <div class="text-center p-5">
            <i class="bi bi-exclamation-triangle fs-1 text-warning d-block mb-2"></i>
            <h6 class="fw-bold mb-1">Quiz generation failed</h6>
            <p class="small text-muted mb-3">${escapeHtml(message || 'The AI service is unavailable right now. Please try again.')}</p>
            <button type="button" class="btn btn-liquid-primary btn-sm" onclick="document.getElementById('btnGenerateQuiz').click()">
                <i class="bi bi-arrow-repeat me-1"></i> Try Again
            </button>
        </div>
    `;
    const badge = document.getElementById('questionCountBadge');
    if (badge) badge.textContent = '0 Questions';
}

function showSaveActions() {
    const el = document.getElementById('saveQuizActions');
    if (!el) return;
    el.classList.remove('d-none');
    el.style.display = 'flex';
}

(function quizPlanPreview() {
    const planEl = document.getElementById('quizPlanText');
    const fileEl = document.getElementById('quizPlanFile');
    const wrap = document.getElementById('quizPlanCoverageWrap');
    const box = document.getElementById('quizPlanCoverage');
    if (!planEl || !box) return;

    // Local HTML escaper (in case the shared one isn't defined yet)
    const esc = (s) => {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    // Render the coverage badge (existing behaviour).
    const render = () => {
        const t = (planEl.value || '').toLowerCase();
        const hasFile = fileEl && fileEl.files && fileEl.files.length > 0;
        if (!t.trim() && !hasFile) {
            if (wrap) wrap.style.display = 'none';
            return;
        }
        if (wrap) wrap.style.display = '';
        const cov = {
            assessment: /assessments?\b|formative assessment|conflict map|exit|quiz|rubric/.test(t),
            experiences: /learning experiences?|procedure|activity|discussion/.test(t),
            intentions: /intentions?|objectives?|competency/.test(t)
        };
        const tick = (ok) => ok ? '✓' : '○';
        box.textContent = `Plan: ${tick(cov.assessment)} Assessment · ${tick(cov.experiences)} Experiences · ${tick(cov.intentions)} Intentions${hasFile ? ' · File attached' : ''}${!cov.assessment ? ' — quiz items need the Assessment section' : ' — ready'}`;
        box.className = cov.assessment ? 'small fw-semibold text-success' : 'small fw-semibold text-warning';
    };

    // NEW: Auto-parse the file and populate the textarea with extracted text.
    async function autoParsePlanFile(file) {
        if (!file) return;
        if (wrap) wrap.style.display = '';
        box.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Parsing lesson plan...';
        box.className = 'small fw-semibold text-muted';

        try {
            const fd = new FormData();
            fd.append('plan_file', file);
            const res = await fetch('/api/ai/lesson/parse', {
                method: 'POST',
                headers: { 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrfToken() },
                body: fd
            });

            // The endpoint returns JSON. Guard against login redirects or 404s.
            const raw = await res.text();
            let data;
            try { data = JSON.parse(raw); }
            catch {
                if (res.status === 404) throw new Error('Parse endpoint not found (404). Restart the app server and try again.');
                if (/login|sign in/i.test(raw.slice(0, 500))) throw new Error('Session expired. Reload the page and sign in again.');
                throw new Error(`Parse failed (HTTP ${res.status}).`);
            }
            if (!res.ok) throw new Error(data.error || 'Parse failed.');

            // Populate the textarea with the extracted plan text.
            if (data.planText && planEl) {
                planEl.value = data.planText;
                // Fire input so the coverage preview recalculates from the real text.
                planEl.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // Success badge.
            const sectionCount = Array.isArray(data.sections) ? data.sections.length : 0;
            const tableCount = data.tableCount || 0;
            box.innerHTML = `<span class="text-success">✓ Parsed ${esc(file.name)} — ${tableCount} table(s), ${sectionCount} sections (${esc(data.source || 'file')}). Review the text above, then generate.</span>`;
            box.className = 'small fw-semibold text-success';

        } catch (err) {
            box.innerHTML = `<span class="text-danger">${esc(err.message || 'Could not read this file.')}</span>`;
            box.className = 'small fw-semibold text-danger';
        }
    }

    // Wire up listeners.
    planEl.addEventListener('input', render);
    if (fileEl) fileEl.addEventListener('change', () => {
        const f = fileEl.files?.[0];
        if (f) {
            autoParsePlanFile(f);
        } else {
            render();
        }
    });

    // Initial paint.
    render();
})();

function updateQuizGroundBadge(data) {
    const badge = document.getElementById('quizGroundBadge');
    if (!badge) return;
    const n = Array.isArray(data.sources) ? data.sources.length : 0;
    const issues = Array.isArray(data.validation) ? data.validation : [];
    const sessTxt = data.focus_session ? ` · Session ${data.focus_session}` : '';
    const deckTxt = data.deck_aligned ? ' · Deck-aligned' : '';
    if (data.grounded && !data.needsReview) {
        badge.textContent = `Plan-grounded: ${n} section${n === 1 ? '' : 's'}${sessTxt}${deckTxt}`;
        badge.className = 'small fw-semibold text-success';
    } else {
        const why = issues.length ? ` — check: ${issues.slice(0, 3).join(', ')}` : '';
        badge.textContent = `Teacher review required${why}`;
        badge.className = 'small fw-semibold text-danger';
    }
}

const genBtn = document.getElementById('btnGenerateQuiz');
if (genBtn) genBtn.addEventListener('click', async () => {
    const topic = document.getElementById('quizTopic').value.trim();
    const grade_level = document.getElementById('quizGrade').value;
    const subject = document.getElementById('quizSubject').value;
    const mc_count = document.getElementById('quizMcCount').value;
    const tf_count = document.getElementById('quizTfCount').value;
    const id_count = document.getElementById('quizIdCount').value;
    const plan_text = document.getElementById('quizPlanText')?.value.trim() || '';
    const plan_format = document.getElementById('quizPlanFormat')?.value || 'ilaw';
    const focus_session = document.getElementById('quizFocusSession')?.value || '';
    const plan_file = document.getElementById('quizPlanFile')?.files?.[0] || null;
    const deck_file = document.getElementById('quizDeckFile')?.files?.[0] || null;
    let lesson_json = null;
    // Auto-fill from a just-generated deck stored by the lesson wizard.
    try {
        const lastDeck = sessionStorage.getItem('edushare_last_deck');
        if (lastDeck) lesson_json = JSON.parse(lastDeck);
    } catch { lesson_json = null; }
    if (!topic) {
        notifyQuiz('Please provide a topic.', 'error');
        return;
    }
    if ((Number(mc_count) || 0) + (Number(tf_count) || 0) + (Number(id_count) || 0) < 1) {
        notifyQuiz('Set at least one question (multiple choice, true/false, or identification).', 'error');
        return;
    }

    const btn = genBtn;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Generating Questions...';
    showQuizLoadingState();

    try {
        if (deck_file) {
            try {
                const txt = await deck_file.text();
                const parsed = JSON.parse(txt);
                if (parsed && Array.isArray(parsed.slides)) lesson_json = parsed;
                else if (parsed && parsed.lesson && Array.isArray(parsed.lesson.slides)) lesson_json = parsed.lesson;
            } catch { /* keep auto-filled deck */ }
        }
        let res;
        if (plan_file) {
            const fd = new FormData();
            fd.append('topic', topic);
            fd.append('grade_level', grade_level);
            fd.append('subject', subject);
            fd.append('mc_count', mc_count);
            fd.append('tf_count', tf_count);
            fd.append('id_count', id_count);
            fd.append('plan_text', plan_text);
            fd.append('plan_file', plan_file);
            fd.append('plan_format', plan_format);
            fd.append('focus_session', focus_session);
            if (lesson_json) fd.append('lesson_json', JSON.stringify(lesson_json));
            res = await fetch('/api/ai/quiz/generate', {
                method: 'POST',
                headers: { 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrfToken() },
                body: fd
            });
        } else {
            res = await fetch('/api/ai/quiz/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrfToken() },
                body: JSON.stringify({ topic, grade_level, subject, mc_count, tf_count, id_count, plan_text, plan_format, focus_session, lesson_json })
            });
        }

        const data = await res.json();
        if (data.success && data.questions) {
            clearQuizLoadingState();
            generatedQuizQuestions = data.questions;
            quizNeedsReview = !!data.needsReview;
            quizValidation = Array.isArray(data.validation) ? data.validation : [];
            quizGrounded = !!data.grounded;
            renderQuizQuestions(data.questions);
            updateQuizGroundBadge(data);
            updateQuizReviewBox();
            showSaveActions();
            saveQuizDraft();
        } else {
            showQuizLoadingError(data.error || 'Failed to generate quiz.');
            notifyQuiz('Failed to generate quiz.', 'error');
        }
    } catch (err) {
        console.error('Quiz gen error:', err);
        showQuizLoadingError(err.message || 'Error generating quiz.');
        notifyQuiz('Error generating quiz.', 'error');
    } finally {
        genBtn.disabled = false;
        genBtn.innerHTML = '<i class="bi bi-stars me-2"></i> Generate Questions with AI';
    }
});

function renderQuizQuestions(questions) {
    const container = document.getElementById('quizQuestionsContainer');
    container.innerHTML = '';
    document.getElementById('questionCountBadge').textContent = `${questions.length} Questions`;

    if (!questions.length) {
        container.innerHTML = `
            <div class="text-center text-muted p-5">
                <i class="bi bi-card-checklist fs-1 text-warning d-block mb-2"></i>
                <h6>No Questions Generated Yet</h6>
                <p class="small">Configure your parameters and click "Generate Questions with AI".</p>
            </div>`;
        return;
    }

    questions.forEach((q, idx) => {
        const card = document.createElement('div');
        card.className = 'glass-card p-3 mb-3';
        card.dataset.qIndex = idx;

        // Question type badge — read-only
        const typeLabel = String(q.question_type || '').replace('_', ' ');
        const typeBadgeClass = q.question_type === 'multiple_choice' ? 'badge-amber'
            : q.question_type === 'true_false' ? 'badge-emerald'
            : 'badge-gray';

        // Options editor depends on type
        let optionsHtml = '';
        if (q.question_type === 'multiple_choice') {
            const opts = Array.isArray(q.options) ? q.options : [];
            optionsHtml = `
                <div class="mt-2" data-field="mc-options">
                    <label class="form-label small fw-bold mb-1">Answer Options <span class="text-muted fw-normal">(select the correct one)</span></label>
                    <div class="d-flex flex-column gap-2">
                        ${opts.map((opt, oi) => `
                            <div class="d-flex align-items-center gap-2">
                                <input type="radio" class="form-check-input mt-0" name="correct-${idx}" ${opt.is_correct ? 'checked' : ''} data-opt-index="${oi}">
                                <input type="text" class="glass-input py-1 flex-grow-1" value="${escapeHtml(opt.option_text || '')}" data-opt-text="${oi}" placeholder="Option text">
                                <button type="button" class="btn btn-sm btn-glass text-danger" data-opt-del="${oi}" title="Remove option">&times;</button>
                            </div>`).join('')}
                    </div>
                    <button type="button" class="btn btn-sm btn-glass mt-2" data-opt-add>+ Add option</button>
                </div>`;
        } else if (q.question_type === 'true_false') {
            // Ensure normalized options exist for TF (True always at index 0, False at 1)
            if (!Array.isArray(q.options) || q.options.length !== 2) {
                q.options = [
                    { option_text: 'True',  is_correct: (q.answer === true || q.correct_answer === true || q.correct === true) ? 1 : 0 },
                    { option_text: 'False', is_correct: (q.answer === false || q.correct_answer === false || q.correct === false) ? 1 : 0 }
                ];
                // If nothing was correct, default True.
                if (!q.options[0].is_correct && !q.options[1].is_correct) q.options[0].is_correct = 1;
            }
            optionsHtml = `
                <div class="mt-2" data-field="tf-options">
                    <label class="form-label small fw-bold mb-1">Correct Answer</label>
                    <div class="d-flex gap-3">
                        <label class="small d-flex align-items-center gap-2">
                            <input type="radio" class="form-check-input mt-0" name="tf-correct-${idx}" value="0" ${q.options[0].is_correct ? 'checked' : ''}>
                            <strong>True</strong>
                        </label>
                        <label class="small d-flex align-items-center gap-2">
                            <input type="radio" class="form-check-input mt-0" name="tf-correct-${idx}" value="1" ${q.options[1].is_correct ? 'checked' : ''}>
                            <strong>False</strong>
                        </label>
                    </div>
                </div>`;
        } else if (q.question_type === 'identification') {
            const aliases = (Array.isArray(q.accept) && q.accept.length)
                ? q.accept
                : [q.answer || q.correct_answer || q.correct || ''].filter((x) => String(x).trim());
            const value = aliases.join(', ');
            const warnHtml = value
                ? ''
                : `<div class="alert alert-warning py-1 px-2 mt-2 mb-0 small" data-ident-warn>
                    <i class="bi bi-exclamation-triangle me-1"></i>
                    <strong>No expected answer set.</strong> Students will always be marked wrong until you enter one.
                </div>`;
            optionsHtml = `
                <div class="mt-2" data-field="ident-answer">
                    <label class="form-label small fw-bold mb-1">
                        Correct Answer
                        <span class="text-muted fw-normal">(case and whitespace are ignored; separate accepted answers with commas)</span>
                    </label>
                    <input type="text" class="glass-input py-1" value="${escapeHtml(value)}" data-ident-answer placeholder="Expected answer">
                    ${warnHtml}
                </div>`;
        }

        // Points field (tiny, next to explanation)
        const points = Number(q.points) || 1;

        card.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-2">
                <div class="d-flex align-items-center gap-2">
                    <span class="badge-emerald">Question ${idx + 1}</span>
                    <span class="${typeBadgeClass} text-capitalize">${escapeHtml(typeLabel)}</span>
                </div>
                <div class="d-flex align-items-center gap-2">
                    <label class="small text-muted mb-0">Pts:</label>
                    <input type="number" class="glass-input py-0 px-2 text-center" style="width:60px;height:30px;" min="1" max="100" value="${points}" data-q-points>
                    <button type="button" class="btn btn-sm btn-glass text-danger" data-q-del title="Delete this question">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>

            <div class="mb-2">
                <label class="form-label small fw-bold mb-1">Question Text</label>
                <textarea class="glass-input" rows="2" data-q-text placeholder="Type the question...">${escapeHtml(q.question_text || '')}</textarea>
            </div>

            ${optionsHtml}

            <div class="mt-2">
                <label class="form-label small fw-bold mb-1">Explanation <span class="text-muted fw-normal">(shown in results, not during quiz)</span></label>
                <textarea class="glass-input" rows="2" data-q-expl placeholder="Explain why the correct answer is correct...">${escapeHtml(q.explanation || '')}</textarea>
            </div>
        `;

        container.appendChild(card);
        bindQuestionCard(card, idx);
    });
    saveQuizDraft();
}

function bindQuestionCard(card, idx) {
    const q = generatedQuizQuestions[idx];
    if (!q) return;

    // ----- Question text -----
    card.querySelector('[data-q-text]')?.addEventListener('input', (e) => {
        q.question_text = e.target.value;
        saveQuizDraft();
    });

    // ----- Explanation -----
    card.querySelector('[data-q-expl]')?.addEventListener('input', (e) => {
        q.explanation = e.target.value;
        saveQuizDraft();
    });

    // ----- Points -----
    card.querySelector('[data-q-points]')?.addEventListener('input', (e) => {
        const v = parseInt(e.target.value, 10);
        q.points = Number.isFinite(v) && v > 0 ? v : 1;
        saveQuizDraft();
    });

    // ----- Multiple Choice handling -----
    if (q.question_type === 'multiple_choice') {
        // Text updates
        card.querySelectorAll('[data-opt-text]').forEach((inp) => {
            inp.addEventListener('input', (e) => {
                const oi = parseInt(inp.dataset.optText, 10);
                if (q.options[oi]) q.options[oi].option_text = e.target.value;
            });
            saveQuizDraft();
        });
        // Radio = correct answer
        card.querySelectorAll(`input[name="correct-${idx}"]`).forEach((radio) => {
            radio.addEventListener('change', (e) => {
                const oi = parseInt(radio.dataset.optIndex, 10);
                q.options.forEach((o, i) => { o.is_correct = (i === oi) ? 1 : 0; });
            });
        });
        // Remove option
        card.querySelectorAll('[data-opt-del]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const oi = parseInt(btn.dataset.optDel, 10);
                q.options.splice(oi, 1);
                // Ensure at least one is marked correct
                if (!q.options.some((o) => o.is_correct) && q.options[0]) q.options[0].is_correct = 1;
                renderQuizQuestions(generatedQuizQuestions);
            });
            saveQuizDraft();
        });
        // Add option
        card.querySelector('[data-opt-add]')?.addEventListener('click', () => {
            q.options.push({ option_text: '', is_correct: 0 });
            renderQuizQuestions(generatedQuizQuestions);
            saveQuizDraft();
        });
    }

    // ----- True / False -----
    if (q.question_type === 'true_false') {
        card.querySelectorAll(`input[name="tf-correct-${idx}"]`).forEach((radio) => {
            radio.addEventListener('change', () => {
                const selected = parseInt(radio.value, 10); // 0 = True, 1 = False
                q.options = [
                    { option_text: 'True',  is_correct: selected === 0 ? 1 : 0 },
                    { option_text: 'False', is_correct: selected === 1 ? 1 : 0 }
                ];
                // Keep answer field in sync for backend compatibility
                q.answer = selected === 0;
                saveQuizDraft();
            });
        });
    }

    // ----- Identification -----
    if (q.question_type === 'identification') {
        const input = card.querySelector('[data-ident-answer]');
        if (input) {
            input.addEventListener('input', (e) => {
                const aliases = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                q.accept = aliases.length ? aliases : [];
                q.answer = aliases[0] || e.target.value.trim();
                const warn = card.querySelector('[data-ident-warn]');
                if (warn) warn.style.display = aliases.length ? 'none' : '';
                saveQuizDraft();
            });
        }
    }

    // ----- Delete question -----
    card.querySelector('[data-q-del]')?.addEventListener('click', () => {
        if (!confirm(`Delete Question ${idx + 1}?`)) return;
        generatedQuizQuestions.splice(idx, 1);
        renderQuizQuestions(generatedQuizQuestions);
        saveQuizDraft();
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
            clearQuizDraft();
            notifyQuiz('Quiz successfully published and assigned to your classes!', 'success');
            const firstCls = document.querySelector('.quiz-cls-cb:checked');
            window.location.href = firstCls ? `/teacher/classes/${firstCls.value}?tab=quizzes` : '/teacher/quiz-maker';
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

// ============================================================
// Restore saved draft on page load
// ============================================================
(function restoreQuizDraft() {
    const draft = loadQuizDraft();
    if (!draft || !Array.isArray(draft.questions) || draft.questions.length === 0) return;

    // 1. Restore form fields
    const f = draft.form || {};
    const setVal = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
    setVal('quizTitle', f.title);
    setVal('quizSubject', f.subject);
    setVal('quizGrade', f.gradeLevel);
    setVal('quizTopic', f.topic);
    setVal('quizPlanText', f.planText);
    setVal('quizPlanFormat', f.planFormat);
    setVal('quizFocusSession', f.focusSession);
    setVal('quizMcCount', f.mcCount);
    setVal('quizTfCount', f.tfCount);
    setVal('quizIdCount', f.idCount);
    setVal('quizTimeLimit', f.timeLimit);
    setVal('quizPassingScore', f.passingScore);
    // Restore class checkboxes
    if (Array.isArray(f.targetClasses)) {
        document.querySelectorAll('.quiz-cls-cb').forEach((cb) => {
            cb.checked = f.targetClasses.includes(cb.value);
        });
    }

    // 2. Restore question state
    generatedQuizQuestions = draft.questions;
    quizNeedsReview = !!draft.needsReview;
    quizValidation = Array.isArray(draft.validation) ? draft.validation : [];
    quizGrounded = !!draft.grounded;

    // 3. Render
    renderQuizQuestions(generatedQuizQuestions);
    updateQuizReviewBox();
    showSaveActions();

    // 4. Notify the teacher
    if (window.showToast) {
        window.showToast('Restored your in-progress quiz draft.', 'info');
    } else {
        console.log('Restored draft with', generatedQuizQuestions.length, 'questions.');
    }
})();