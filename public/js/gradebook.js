// EduShare 2.0 Interactive Gradebook Sheet

document.addEventListener('DOMContentLoaded', () => {
    const scoreInputs = document.querySelectorAll('.grade-score-cell');

    scoreInputs.forEach(input => {
        input.addEventListener('change', async (e) => {
            const el = e.target;
            const columnId = el.dataset.columnId;
            const studentId = el.dataset.studentId;
            const maxScore = parseFloat(el.dataset.maxScore) || 100;
            let score = parseFloat(el.value);

            if (isNaN(score) || score < 0) {
                score = 0;
                el.value = 0;
            } else if (score > maxScore) {
                alert(`Score cannot exceed maximum score of ${maxScore}`);
                el.value = maxScore;
                score = maxScore;
            }

            el.style.backgroundColor = '#fef3c7'; // Amber saving indicator

            try {
                const res = await fetch('/api/gradebook/entry', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        column_id: columnId,
                        student_id: studentId,
                        score
                    })
                });

                if (res.ok) {
                    el.style.backgroundColor = '#d1fae5'; // Emerald success indicator
                    setTimeout(() => el.style.backgroundColor = '', 1000);
                } else {
                    el.style.backgroundColor = '#fee2e2'; // Red error indicator
                }
            } catch (err) {
                console.error('Score save error:', err);
                el.style.backgroundColor = '#fee2e2';
            }
        });
    });
});
