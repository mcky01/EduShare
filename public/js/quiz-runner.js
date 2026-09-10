// EduShare 2.0 Distraction-Free Quiz Runner

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
    const answers = {};
    const flagged = {};

    // 1. Initialize UI
    showQuestion(0);
    renderNavigator();
    startTimer();

    // 2. Navigation Buttons
    const prevBtn = document.getElementById('prevQuestionBtn');
    const nextBtn = document.getElementById('nextQuestionBtn');
    const flagBtn = document.getElementById('flagQuestionBtn');
    const submitQuizBtn = document.getElementById('submitQuizBtn');

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
        });
    }

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
        input.addEventListener('change', (e) => {
            const qId = e.target.dataset.questionId;
            answers[qId] = e.target.value;
            updateNavState(currentQuestionIndex);
        });
    });

    document.querySelectorAll('.quiz-ident-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const qId = e.target.dataset.questionId;
            if (e.target.value.trim().length > 0) {
                answers[qId] = e.target.value.trim();
            } else {
                delete answers[qId];
            }
            updateNavState(currentQuestionIndex);
        });
    });

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
        if (flagBtn) flagBtn.classList.toggle('btn-liquid-amber', !!flagged[currentQId]);

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
            qNumBtn.textContent = idx + 1;
            qNumBtn.id = `nav-q-${idx}`;

            qNumBtn.addEventListener('click', () => showQuestion(idx));
            navGrid.appendChild(qNumBtn);
        });
        updateNavActive(0);
    }

    function updateNavActive(index) {
        document.querySelectorAll('.btn-nav-question').forEach((btn, idx) => {
            btn.classList.toggle('border-primary', idx === index);
            btn.style.boxShadow = idx === index ? '0 0 0 3px rgba(16, 185, 129, 0.4)' : 'none';
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
    }

    function startTimer() {
        const timerDisplay = document.getElementById('quizTimerDisplay');
        const timerInterval = setInterval(() => {
            secondsRemaining--;
            if (secondsRemaining <= 0) {
                clearInterval(timerInterval);
                alert('Time has expired! Submitting your quiz now...');
                submitQuiz();
                return;
            }

            const mins = Math.floor(secondsRemaining / 60);
            const secs = secondsRemaining % 60;
            if (timerDisplay) {
                timerDisplay.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                if (secondsRemaining < 120) {
                    timerDisplay.classList.add('text-danger', 'fw-bolder');
                }
            }
        }, 1000);
    }

    async function submitQuiz() {
        const submitBtn = document.getElementById('submitQuizBtn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Submitting...';
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

            const data = await res.json();
            if (data.redirectUrl) {
                window.location.href = data.redirectUrl;
            } else {
                alert(data.error || 'Failed to submit quiz.');
                if (submitBtn) submitBtn.disabled = false;
            }
        } catch (err) {
            console.error('Quiz submit error:', err);
            alert('An error occurred during submission. Please try again.');
            if (submitBtn) submitBtn.disabled = false;
        }
    }
});
