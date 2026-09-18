// EduShare Distraction-Free Quiz Runner

document.addEventListener('DOMContentLoaded', () => {
    const quizRunner = document.getElementById('quizRunnerContainer');
    if (!quizRunner) return;

    const quizId = quizRunner.dataset.quizId;
    const classId = quizRunner.dataset.classId;
    const timeLimitMinutes = parseInt(quizRunner.dataset.timeLimit, 10) || 15;
    const questionCards = document.querySelectorAll('.question-card');
    const totalQuestions = questionCards.length;

    let currentQuestionIndex = 0;
    let secondsRemaining = timeLimitMinutes * 60;
    const storageKey = `edushare-quiz:${quizId}:${classId}:answers`;
    const answers = {};
    const flagged = {};
    // Restore any in-progress answers saved in this browser (survives reload/accidental nav).
    try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
        Object.assign(answers, saved);
    } catch { /* private mode — start blank */ }
    const persistAnswers = () => {
        try { sessionStorage.setItem(storageKey, JSON.stringify(answers)); } catch { /* noop */ }
    };
    
    // Navigation Buttons (declare first)
    const prevBtn = document.getElementById('prevQuestionBtn');
    const nextBtn = document.getElementById('nextQuestionBtn');
    const flagBtn = document.getElementById('flagQuestionBtn');
    const submitQuizBtn = document.getElementById('submitQuizBtn');

    // Initialize UI
    showQuestion(0);
    renderNavigator();
    startTimer();

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentQuestionIndex > 0) showQuestion(currentQuestionIndex - 1);
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (currentQuestionIndex < totalQuestions - 1) showQuestion(currentQuestionIndex + 1);
        });
    }

    if (flagBtn) {
        flagBtn.addEventListener('click', () => {
            const currentQId = questionCards[currentQuestionIndex].dataset.questionId;
            flagged[currentQId] = !flagged[currentQId];
            updateNavState(currentQuestionIndex);
            flagBtn.classList.toggle('btn-liquid-amber', flagged[currentQId]);
            flagBtn.setAttribute('aria-pressed', flagged[currentQId] ? 'true' : 'false');
        });
    }

    // Keyboard navigation: ArrowLeft/ArrowRight move between questions (unless typing in a text input).
    document.addEventListener('keydown', (e) => {
        const ae = document.activeElement;
        const tag = (ae && ae.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (ae && ae.matches && ae.matches('input[type=radio], select, [contenteditable], .btn-nav-question')) return;
        if (e.key === 'ArrowRight' && currentQuestionIndex < totalQuestions - 1) showQuestion(currentQuestionIndex + 1);
        else if (e.key === 'ArrowLeft' && currentQuestionIndex > 0) showQuestion(currentQuestionIndex - 1);
    });

    if (submitQuizBtn) {
        submitQuizBtn.addEventListener('click', () => {
            const unanswered = totalQuestions - Object.keys(answers).length;
            let confirmMsg = 'Are you ready to submit your quiz?';
            if (unanswered > 0) {
                confirmMsg = `You still have ${unanswered} unanswered question(s). Are you sure you want to submit now?`;
            }
            if (confirm(confirmMsg)) {
                submitQuiz();
            }
        });
    }

    // 3. Listen to input changes (radio and text inputs)
    document.querySelectorAll('.quiz-option-input').forEach(input => {
        // Pre-check any option restored from sessionStorage.
        const qId0 = input.dataset.questionId;
        if (answers[qId0] !== undefined && String(answers[qId0]) === String(input.value)) input.checked = true;
        input.addEventListener('change', (e) => {
            const qId = e.target.dataset.questionId;
            answers[qId] = e.target.value;
            persistAnswers();
            updateNavState(currentQuestionIndex);
        });
    });

    document.querySelectorAll('.quiz-ident-input').forEach(input => {
        // Restore typed answers saved in this browser.
        const qId0 = input.dataset.questionId;
        if (typeof answers[qId0] === 'string') input.value = answers[qId0];
        input.addEventListener('input', (e) => {
            const qId = e.target.dataset.questionId;
            if (e.target.value.trim().length > 0) {
                answers[qId] = e.target.value.trim();
            } else {
                delete answers[qId];
            }
            persistAnswers();
            updateNavState(currentQuestionIndex);
        });
    });
    // Paint navigator states for restored answers on load.
    questionCards.forEach((card, idx) => updateNavState(idx));

    function showQuestion(index) {
        questionCards.forEach((card, idx) => {
            card.style.display = idx === index ? 'block' : 'none';
        });

        currentQuestionIndex = index;
        document.getElementById('currentQuestionDisplay').textContent = index + 1;

        if (prevBtn) prevBtn.disabled = index === 0;
        if (nextBtn) nextBtn.style.display = index === totalQuestions - 1 ? 'none' : 'inline-flex';
        if (submitQuizBtn) submitQuizBtn.style.display = index === totalQuestions - 1 ? 'inline-flex' : 'none';

        const currentQId = questionCards[currentQuestionIndex].dataset.questionId;
        if (flagBtn) {
            flagBtn.classList.toggle('btn-liquid-amber', !!flagged[currentQId]);
            flagBtn.setAttribute('aria-pressed', flagged[currentQId] ? 'true' : 'false');
        }

        updateNavActive(index);
    }

    function renderNavigator() {
        const navGrid = document.getElementById('questionNavigatorGrid');
        if (!navGrid) return;
        navGrid.innerHTML = '';

        questionCards.forEach((card, idx) => {
            const qNumBtn = document.createElement('button');
            qNumBtn.type = 'button';
            qNumBtn.className = 'btn btn-sm btn-nav-question rounded-circle fw-bold';
            qNumBtn.style.width = '38px';
            qNumBtn.style.height = '38px';
            qNumBtn.style.margin = '4px';
            qNumBtn.style.position = 'relative';     // ← needed for absolute glyph
            qNumBtn.style.padding = '0';
            qNumBtn.id = `nav-q-${idx}`;
            updatePaletteBtn(qNumBtn, idx, false, false);

            qNumBtn.addEventListener('click', () => showQuestion(idx));
            navGrid.appendChild(qNumBtn);
        });
        updateNavActive(0);
    }

    function updatePaletteBtn(btn, idx, isAnswered, isFlagged, isCurrent) {
        var current = (isCurrent === undefined) ? idx === currentQuestionIndex : isCurrent;
        var state = isFlagged ? 'flagged' : (isAnswered ? 'answered' : 'unanswered');

        // Reset content and clear old glyph
        btn.innerHTML = '';
        var numSpan = document.createElement('span');
        numSpan.textContent = String(idx + 1);
        numSpan.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;';
        btn.appendChild(numSpan);

        // Corner glyph badge
        if (isAnswered || isFlagged) {
            var cue = document.createElement('span');
            cue.setAttribute('aria-hidden', 'true');
            cue.textContent = isFlagged ? '⚑' : '✓';
            cue.style.cssText = [
                'position:absolute',
                'top:-4px',
                'right:-4px',
                'width:16px',
                'height:16px',
                'border-radius:50%',
                'background:' + (isFlagged ? '#f59e0b' : '#0d522c'),
                'color:#ffffff',
                'font-size:10px',
                'line-height:16px',
                'text-align:center',
                'font-weight:700',
                'box-shadow:0 0 0 2px #ffffff'   // white ring so it pops over the circle
            ].join(';');
            btn.appendChild(cue);
        }

        btn.setAttribute('aria-label', 'Question ' + (idx + 1) + ' — ' + state + (current ? ', current' : ''));
        if (current) btn.setAttribute('aria-current', 'true');
        else btn.removeAttribute('aria-current');
    }

    function updateNavActive(index) {
        document.querySelectorAll('.btn-nav-question').forEach((btn, idx) => {
            btn.classList.toggle('border-primary', idx === index);
            btn.style.boxShadow = idx === index ? '0 0 0 3px rgba(16, 185, 129, 0.4)' : 'none';
            var card = questionCards[idx];
            var qId = card ? card.dataset.questionId : null;
            updatePaletteBtn(btn, idx, qId != null && answers[qId] !== undefined, qId != null && !!flagged[qId], idx === index);
        });
    }

    function updateNavState(index) {
        const card = questionCards[index];
        const qId = card.dataset.questionId;
        const navBtn = document.getElementById(`nav-q-${index}`);
        if (!navBtn) return;

        const isAnswered = answers[qId] !== undefined;
        const isFlagged = !!flagged[qId];

        if (isFlagged) {
            navBtn.style.background = '#f59e0b';
            navBtn.style.color = '#ffffff';
        } else if (isAnswered) {
            navBtn.style.background = '#0d522c';
            navBtn.style.color = '#ffffff';
        } else {
            navBtn.style.background = 'rgba(255,255,255,0.7)';
            navBtn.style.color = '#0f291e';
        }
        updatePaletteBtn(navBtn, index, isAnswered, isFlagged);
    }

    function startTimer() {
        const timerDisplay = document.getElementById('quizTimerDisplay');
        const paint = () => {
            const mins = Math.floor(secondsRemaining / 60);
            const secs = secondsRemaining % 60;
            if (timerDisplay) {
                timerDisplay.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                if (secondsRemaining < 120) {
                    timerDisplay.classList.add('text-danger', 'fw-bolder');
                }
            }
        };
        paint();
        let timerInterval = null;
        window.__quizStopTimer = () => { if (timerInterval) clearInterval(timerInterval); };
        // One-shot screen-reader announcements at thresholds only (no per-second chatter).
        const announce = (msg) => {
            const node = document.getElementById('quizTimerAnnounce');
            if (node) node.textContent = msg;
        };
        let warned5 = secondsRemaining <= 300;
        let warned1 = secondsRemaining <= 60;
        timerInterval = setInterval(() => {
            secondsRemaining--;
            if (secondsRemaining <= 0) {
                clearInterval(timerInterval);
                autoSubmitOnExpiry();
                return;
            }
            if (secondsRemaining === 300 && !warned5) {
                warned5 = true;
                announce('5 minutes remaining.');
            }
            if (secondsRemaining === 60 && !warned1) {
                warned1 = true;
                announce('Warning: 1 minute remaining.');
            }
            paint();
        }, 1000);
    }
    // Graceful auto-submit: inline banner (no blocking alert), then submit once.
    async function autoSubmitOnExpiry() {
        const timerDisplay = document.getElementById('quizTimerDisplay');
        if (timerDisplay) {
            timerDisplay.textContent = '00:00';
        }
        const announcer = document.getElementById('quizTimerAnnounce');
        if (announcer) announcer.textContent = 'Time expired. Submitting your answers.';
        let banner = document.getElementById('quizExpiryBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'quizExpiryBanner';
            banner.className = 'alert alert-warning text-center mt-3';
            banner.setAttribute('role', 'alert');
            banner.innerHTML = '<i class="bi bi-clock-history me-1"></i>Time expired — submitting your answers now…';
            quizRunner.prepend(banner);
        }
        await submitQuiz(true);
    }

    async function submitQuiz(isAuto = false) {
        if (submitQuiz.submitting) return;
        submitQuiz.submitting = true;
        const submitBtn = document.getElementById('submitQuizBtn');
        const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.setAttribute('aria-busy', 'true');
            submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span> Submitting...';
        }

        try {
            const csrfToken = document.querySelector('meta[name=csrf-token]')?.content || window.CSRF_TOKEN || '';
            const res = await fetch(`/student/quizzes/${quizId}/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrfToken },
                body: JSON.stringify({
                    class_id: classId,
                    answers
                })
            });

            if (res.status === 401 || res.redirected) {
                window.location.href = '/auth/login';
                return;
            }
            const data = await res.json().catch(() => ({}));
            if (data.redirectUrl) {
                if (window.__quizStopTimer) window.__quizStopTimer();
                try { sessionStorage.removeItem(storageKey); } catch { /* noop */ }
                window.location.href = data.redirectUrl;
            } else {
                alert(data.error || 'Failed to submit quiz.');
                submitQuiz.submitting = false;
                if (submitBtn) { submitBtn.disabled = false; submitBtn.removeAttribute('aria-busy'); submitBtn.innerHTML = originalBtnHtml; }
            }
        } catch (err) {
            console.error('Quiz submit error:', err);
            // Auto-submit path: keep answers saved and show retry inside the expiry banner.
            if (isAuto) {
                const banner = document.getElementById('quizExpiryBanner');
                if (banner) banner.innerHTML = '<i class="bi bi-wifi-off me-1"></i>Auto-submit failed (connection error). Your answers are saved in this browser — <button type="button" class="btn btn-sm btn-liquid-primary ms-2" id="quizRetrySubmit">Retry submit</button>';
                const retry = document.getElementById('quizRetrySubmit');
                if (retry) retry.addEventListener('click', () => submitQuiz(true));
            } else {
                alert('An error occurred during submission. Please try again.');
            }
            submitQuiz.submitting = false;
            if (submitBtn) { submitBtn.disabled = false; submitBtn.removeAttribute('aria-busy'); submitBtn.innerHTML = originalBtnHtml; }
        }
    }
});