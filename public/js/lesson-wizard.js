// EduShare 2.0 AI Lesson Generator Wizard

document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('btnGenerateLesson');
    const lessonForm = document.getElementById('lessonSetupForm');
    const step1 = document.getElementById('lessonStep1');
    const step2 = document.getElementById('lessonStep2');
    const slidesContainer = document.getElementById('slidesPreviewContainer');
    const btnSaveToLibrary = document.getElementById('btnSaveLessonToLibrary');

    let currentLessonData = null;

    if (generateBtn) {
        generateBtn.addEventListener('click', async () => {
            const topic = document.getElementById('lessonTopic').value.trim();
            const grade_level = document.getElementById('lessonGrade').value;
            const subject = document.getElementById('lessonSubject').value;
            const competency = document.getElementById('lessonCompetency').value;
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
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        topic,
                        grade_level,
                        subject,
                        competency,
                        instructions
                    })
                });

                const data = await res.json();
                if (data.success && data.lesson) {
                    currentLessonData = data.lesson;
                    renderSlides(data.lesson);
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

    function renderSlides(lesson) {
        if (!slidesContainer) return;
        slidesContainer.innerHTML = '';

        document.getElementById('displayLessonTopic').textContent = lesson.topic;
        document.getElementById('displayLessonComp').textContent = `${lesson.subject} • ${lesson.gradeLevel} • ${lesson.competency}`;

        lesson.slides.forEach((slide, idx) => {
            const slideCol = document.createElement('div');
            slideCol.className = 'col-md-6 mb-4';

            slideCol.innerHTML = `
                <div class="glass-card p-4 h-100 position-relative">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <span class="badge-emerald">Slide ${slide.slideNumber || idx + 1}</span>
                        <span class="badge-amber text-capitalize">${slide.type || 'Concept'}</span>
                    </div>
                    <h5 class="fw-bold mb-3 text-dark">${escapeHtml(slide.title)}</h5>
                    <div class="small text-secondary" style="white-space: pre-wrap; line-height: 1.6;">${formatSlideContent(slide.content)}</div>
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

    if (btnSaveToLibrary) {
        btnSaveToLibrary.addEventListener('click', async () => {
            if (!currentLessonData) return;

            const selectedClassCheckboxes = document.querySelectorAll('.post-class-checkbox:checked');
            const class_ids = Array.from(selectedClassCheckboxes).map(cb => cb.value);

            btnSaveToLibrary.disabled = true;
            btnSaveToLibrary.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Saving...';

            try {
                const res = await fetch('/api/ai/lesson/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: currentLessonData.topic,
                        lesson_json: currentLessonData,
                        class_ids
                    })
                });

                const data = await res.json();
                if (data.success) {
                    alert('Lesson successfully saved to your Material Library!');
                    window.location.href = '/teacher/library';
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
