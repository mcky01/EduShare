const { query, withTransaction } = require('../config/database');
const { setFlash } = require('../middleware/branding');
const gradebookService = require('../services/gradebookService');

async function dashboard(req, res) {
    try {
        const studentProfileId = req.session.user.student_profile_id;

        // 1. Enrolled classes
        const classes = await query(
            `SELECT c.*, u.first_name AS teacher_first, u.last_name AS teacher_last, u.avatar_url AS teacher_avatar
             FROM enrollments e
             JOIN classes c ON e.class_id = c.id
             JOIN users u ON c.teacher_id = u.id
             WHERE e.student_id = ? AND e.status = 'active'
             ORDER BY c.class_name ASC`,
            [studentProfileId]
        );

        const classIds = classes.map(c => c.id);

        let pendingQuizzes = [];
        let upcomingActivities = [];
        let announcements = [];

        if (classIds.length > 0) {
            const placeholders = classIds.map(() => '?').join(',');

            // Quizzes not yet taken
            pendingQuizzes = await query(
                `SELECT q.*, c.class_name, sq.end_time
                 FROM section_quizzes sq
                 JOIN quizzes q ON sq.quiz_id = q.id
                 JOIN classes c ON sq.class_id = c.id
                 WHERE sq.class_id IN (${placeholders}) AND sq.is_published = 1
                   AND q.id NOT IN (
                       SELECT quiz_id FROM quiz_attempts WHERE student_id = ? AND status IN ('submitted', 'graded')
                   )
                 ORDER BY sq.created_at DESC LIMIT 4`,
                [...classIds, studentProfileId]
            );

            // Activities
            upcomingActivities = await query(
                `SELECT ca.*, c.class_name, ap.class_id, sub.status AS submission_status, sub.score
                 FROM activity_posts ap
                 JOIN class_activities ca ON ap.activity_id = ca.id
                 JOIN classes c ON ap.class_id = c.id
                 LEFT JOIN activity_submissions sub ON sub.activity_id = ca.id AND sub.class_id = ap.class_id AND sub.student_id = ?
                 WHERE ap.class_id IN (${placeholders})
                 ORDER BY ca.due_date ASC LIMIT 5`,
                [studentProfileId, ...classIds]
            );

            // Announcements
            announcements = await query(
                `SELECT a.*, c.class_name, u.first_name AS teacher_first, u.last_name AS teacher_last
                 FROM announcements a
                 JOIN classes c ON a.class_id = c.id
                 JOIN users u ON a.teacher_id = u.id
                 WHERE a.class_id IN (${placeholders})
                 ORDER BY a.is_pinned DESC, a.created_at DESC LIMIT 5`,
                classIds
            );
        }

        res.render('student/dashboard', {
            title: 'Student Dashboard | EduShare 2.0',
            classes,
            pendingQuizzes,
            upcomingActivities,
            announcements
        });
    } catch (err) {
        console.error('Student dashboard error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function classes(req, res) {
    try {
        const studentProfileId = req.session.user.student_profile_id;
        const enrolledClasses = await query(
            `SELECT c.*, u.first_name AS teacher_first, u.last_name AS teacher_last,
                    (SELECT COUNT(*) FROM class_materials WHERE class_id = c.id) AS material_count,
                    (SELECT COUNT(*) FROM section_quizzes WHERE class_id = c.id AND is_published = 1) AS quiz_count
             FROM enrollments e
             JOIN classes c ON e.class_id = c.id
             JOIN users u ON c.teacher_id = u.id
             WHERE e.student_id = ? AND e.status = 'active'
             ORDER BY c.class_name ASC`,
            [studentProfileId]
        );

        res.render('student/classes', {
            title: 'My Classes | EduShare 2.0',
            classes: enrolledClasses
        });
    } catch (err) {
        console.error('Student classes error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function joinClass(req, res) {
    try {
        const studentProfileId = req.session.user.student_profile_id;
        const { class_code } = req.body;

        if (!class_code) {
            setFlash(req, 'error', 'Please enter a 6-character class code.');
            return res.redirect('/student/classes');
        }

        const cleanCode = class_code.trim().toUpperCase();
        const rows = await query('SELECT * FROM classes WHERE class_code = ? AND is_active = 1', [cleanCode]);
        if (rows.length === 0) {
            setFlash(req, 'error', 'No active class found matching this code.');
            return res.redirect('/student/classes');
        }

        const targetClass = rows[0];

        // Check already enrolled
        const existing = await query(
            'SELECT id FROM enrollments WHERE student_id = ? AND class_id = ? AND status = "active"',
            [studentProfileId, targetClass.id]
        );

        if (existing.length > 0) {
            setFlash(req, 'info', `You are already enrolled in ${targetClass.class_name}.`);
            return res.redirect('/student/classes');
        }

        await query(
            `INSERT INTO enrollments (student_id, class_id, status)
             VALUES (?, ?, 'active')
             ON DUPLICATE KEY UPDATE status = 'active'`,
            [studentProfileId, targetClass.id]
        );

        setFlash(req, 'success', `Successfully joined ${targetClass.class_name}!`);
        res.redirect(`/student/classes/${targetClass.id}`);
    } catch (err) {
        console.error('Join class error:', err);
        setFlash(req, 'error', 'Failed to join class.');
        res.redirect('/student/classes');
    }
}

async function classView(req, res) {
    try {
        const classId = parseInt(req.params.id, 10);
        const studentProfileId = req.session.user.student_profile_id;

        // Verify enrollment
        const enrollCheck = await query(
            'SELECT id FROM enrollments WHERE class_id = ? AND student_id = ? AND status = "active"',
            [classId, studentProfileId]
        );
        if (enrollCheck.length === 0) {
            setFlash(req, 'error', 'You are not enrolled in this class.');
            return res.redirect('/student/classes');
        }

        const [cls] = await query(
            `SELECT c.*, u.first_name AS teacher_first, u.last_name AS teacher_last, u.email AS teacher_email
             FROM classes c
             JOIN users u ON c.teacher_id = u.id
             WHERE c.id = ?`,
            [classId]
        );

        // Materials
        const materials = await query(
            `SELECT cm.posted_at, li.*
             FROM class_materials cm
             JOIN library_items li ON cm.library_item_id = li.id
             WHERE cm.class_id = ?
             ORDER BY cm.posted_at DESC`,
            [classId]
        );

        // Activities
        const activities = await query(
            `SELECT ca.*, ap.posted_at, sub.id AS submission_id, sub.status AS submission_status, sub.score, sub.feedback
             FROM class_activities ca
             JOIN activity_posts ap ON ca.id = ap.activity_id
             LEFT JOIN activity_submissions sub ON sub.activity_id = ca.id AND sub.class_id = ap.class_id AND sub.student_id = ?
             WHERE ap.class_id = ?
             ORDER BY ca.due_date ASC`,
            [studentProfileId, classId]
        );

        // Quizzes
        const quizzes = await query(
            `SELECT q.*, sq.start_time, sq.end_time,
                    qa.id AS attempt_id, qa.score, qa.percentage, qa.passed, qa.status AS attempt_status
             FROM quizzes q
             JOIN section_quizzes sq ON q.id = sq.quiz_id
             LEFT JOIN quiz_attempts qa ON qa.quiz_id = q.id AND qa.student_id = ? AND qa.class_id = ?
             WHERE sq.class_id = ? AND sq.is_published = 1
             ORDER BY q.created_at DESC`,
            [studentProfileId, classId, classId]
        );

        // Announcements
        const announcements = await query(
            `SELECT a.*, ar.is_acknowledged
             FROM announcements a
             LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.student_id = ?
             WHERE a.class_id = ?
             ORDER BY a.is_pinned DESC, a.created_at DESC`,
            [studentProfileId, classId]
        );

        res.render('student/class-view', {
            title: `${cls.class_name} | EduShare 2.0`,
            cls,
            materials,
            activities,
            quizzes,
            announcements,
            activeTab: req.query.tab || 'materials'
        });
    } catch (err) {
        console.error('Student class view error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function viewActivitySubmit(req, res) {
    try {
        const activityId = parseInt(req.params.activityId, 10);
        const classId = parseInt(req.params.classId, 10);
        const studentProfileId = req.session.user.student_profile_id;

        const [activity] = await query('SELECT * FROM class_activities WHERE id = ?', [activityId]);
        const [cls] = await query('SELECT * FROM classes WHERE id = ?', [classId]);

        if (!activity || !cls) {
            setFlash(req, 'error', 'Activity not found.');
            return res.redirect('/student/classes');
        }

        const [submission] = await query(
            'SELECT * FROM activity_submissions WHERE activity_id = ? AND class_id = ? AND student_id = ?',
            [activityId, classId, studentProfileId]
        );

        res.render('student/activity-submit', {
            title: `Submit: ${activity.title} | EduShare 2.0`,
            activity,
            cls,
            submission: submission || null
        });
    } catch (err) {
        console.error('Activity submit view error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function submitActivity(req, res) {
    try {
        const activityId = parseInt(req.params.activityId, 10);
        const classId = parseInt(req.params.classId, 10);
        const studentProfileId = req.session.user.student_profile_id;
        const { note } = req.body;

        let filePath = null;
        let fileType = null;

        if (req.file) {
            filePath = `/uploads/submissions/${req.file.filename}`;
            fileType = req.file.mimetype;
        }

        const [existing] = await query(
            'SELECT id, file_path FROM activity_submissions WHERE activity_id = ? AND class_id = ? AND student_id = ?',
            [activityId, classId, studentProfileId]
        );

        if (existing) {
            await query(
                `UPDATE activity_submissions
                 SET file_path = COALESCE(?, file_path), file_type = COALESCE(?, file_type), note = ?, submitted_at = NOW()
                 WHERE id = ?`,
                [filePath, fileType, note?.trim() || null, existing.id]
            );
        } else {
            await query(
                `INSERT INTO activity_submissions (activity_id, class_id, student_id, file_path, file_type, note, status)
                 VALUES (?, ?, ?, ?, ?, ?, 'submitted')`,
                [activityId, classId, studentProfileId, filePath, fileType, note?.trim() || null]
            );
        }

        setFlash(req, 'success', 'Your activity submission has been saved!');
        res.redirect(`/student/classes/${classId}?tab=activities`);
    } catch (err) {
        console.error('Submit activity error:', err);
        setFlash(req, 'error', 'Failed to submit activity.');
        res.redirect('back');
    }
}

async function takeQuiz(req, res) {
    try {
        const quizId = parseInt(req.params.quizId, 10);
        const studentProfileId = req.session.user.student_profile_id;

        // Check if student already submitted
        const [existingAttempt] = await query(
            'SELECT id FROM quiz_attempts WHERE quiz_id = ? AND student_id = ? AND status IN ("submitted", "graded")',
            [quizId, studentProfileId]
        );

        if (existingAttempt) {
            return res.redirect(`/student/quizzes/${existingAttempt.id}/result`);
        }

        const [quiz] = await query('SELECT * FROM quizzes WHERE id = ?', [quizId]);
        if (!quiz) {
            setFlash(req, 'error', 'Quiz not found.');
            return res.redirect('/student/dashboard');
        }

        // Find class for this quiz
        const [sq] = await query(
            `SELECT sq.class_id, c.class_name
             FROM section_quizzes sq
             JOIN classes c ON sq.class_id = c.id
             JOIN enrollments e ON e.class_id = c.id
             WHERE sq.quiz_id = ? AND e.student_id = ? AND e.status = 'active'
             LIMIT 1`,
            [quizId, studentProfileId]
        );

        if (!sq) {
            setFlash(req, 'error', 'This quiz is not assigned to your class.');
            return res.redirect('/student/dashboard');
        }

        const questions = await query(
            'SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY order_index ASC',
            [quizId]
        );

        for (const q of questions) {
            if (q.question_type !== 'identification') {
                q.options = await query(
                    'SELECT id, option_text, order_index FROM quiz_options WHERE question_id = ? ORDER BY order_index ASC',
                    [q.id]
                );
            }
        }

        res.render('student/take-quiz', {
            title: `Quiz: ${quiz.title} | EduShare 2.0`,
            quiz,
            classInfo: sq,
            questions,
            layout: false // Standalone distraction-free runner
        });
    } catch (err) {
        console.error('Take quiz error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function submitQuiz(req, res) {
    try {
        const quizId = parseInt(req.params.quizId, 10);
        const studentProfileId = req.session.user.student_profile_id;
        const { class_id, answers } = req.body;

        const [quiz] = await query('SELECT * FROM quizzes WHERE id = ?', [quizId]);
        if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

        const questions = await query('SELECT * FROM quiz_questions WHERE quiz_id = ?', [quizId]);

        let totalScore = 0;
        let maxScore = 0;

        const detailedAnswers = [];

        for (const q of questions) {
            const questionPoints = Number(q.points) || 1;
            maxScore += questionPoints;

            const studentAns = answers ? answers[q.id] : null;
            let isCorrect = 0;
            let awarded = 0;
            let selectedOptId = null;
            let ansText = null;

            if (q.question_type === 'multiple_choice' || q.question_type === 'true_false') {
                selectedOptId = studentAns ? parseInt(studentAns, 10) : null;
                if (selectedOptId) {
                    const [opt] = await query(
                        'SELECT is_correct FROM quiz_options WHERE id = ? AND question_id = ?',
                        [selectedOptId, q.id]
                    );
                    if (opt && opt.is_correct === 1) {
                        isCorrect = 1;
                        awarded = questionPoints;
                    }
                }
            } else if (q.question_type === 'identification') {
                ansText = (studentAns || '').trim();
                const correctOptions = await query(
                    'SELECT option_text FROM quiz_options WHERE question_id = ?',
                    [q.id]
                );
                const match = correctOptions.some(opt =>
                    opt.option_text.trim().toLowerCase() === ansText.toLowerCase()
                );
                if (match) {
                    isCorrect = 1;
                    awarded = questionPoints;
                }
            }

            totalScore += awarded;
            detailedAnswers.push({
                question_id: q.id,
                selected_option_id: selectedOptId,
                answer_text: ansText,
                is_correct: isCorrect,
                points_awarded: awarded
            });
        }

        const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
        const passed = percentage >= (quiz.passing_score || 60);

        let attemptId;
        await withTransaction(async (conn) => {
            const [attRes] = await conn.query(
                `INSERT INTO quiz_attempts (student_id, quiz_id, class_id, score, max_score, percentage, passed, status, completed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', NOW())
                 ON DUPLICATE KEY UPDATE score = VALUES(score), percentage = VALUES(percentage), passed = VALUES(passed), status = 'submitted', completed_at = NOW()`,
                [studentProfileId, quizId, class_id, totalScore, maxScore, percentage, passed ? 1 : 0]
            );
            attemptId = attRes.insertId;

            // If updated on duplicate key, get existing attempt id
            if (!attemptId) {
                const [existing] = await conn.query(
                    'SELECT id FROM quiz_attempts WHERE student_id = ? AND quiz_id = ?',
                    [studentProfileId, quizId]
                );
                attemptId = existing[0].id;
            }

            // Save individual answers
            for (const da of detailedAnswers) {
                await conn.query(
                    `INSERT INTO quiz_attempt_answers (attempt_id, question_id, selected_option_id, answer_text, is_correct, points_awarded)
                     VALUES (?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE selected_option_id = VALUES(selected_option_id), answer_text = VALUES(answer_text), is_correct = VALUES(is_correct), points_awarded = VALUES(points_awarded)`,
                    [attemptId, da.question_id, da.selected_option_id, da.answer_text, da.is_correct, da.points_awarded]
                );
            }
        });

        // Automatically sync quiz score to Gradebook
        await gradebookService.syncQuizScore(quizId, class_id, studentProfileId, totalScore, maxScore);

        return res.json({
            success: true,
            redirectUrl: `/student/quizzes/${attemptId}/result`
        });
    } catch (err) {
        console.error('Submit quiz error:', err);
        return res.status(500).json({ error: 'Quiz submission failed: ' + err.message });
    }
}

async function quizResult(req, res) {
    try {
        const attemptId = parseInt(req.params.attemptId, 10);
        const studentProfileId = req.session.user.student_profile_id;

        const [attempt] = await query(
            `SELECT qa.*, q.title AS quiz_title, q.description AS quiz_desc, q.passing_score, c.class_name
             FROM quiz_attempts qa
             JOIN quizzes q ON qa.quiz_id = q.id
             JOIN classes c ON qa.class_id = c.id
             WHERE qa.id = ? AND qa.student_id = ?`,
            [attemptId, studentProfileId]
        );

        if (!attempt) {
            setFlash(req, 'error', 'Quiz result not found.');
            return res.redirect('/student/dashboard');
        }

        const answers = await query(
            `SELECT qaa.*, qq.question_text, qq.question_type, qq.explanation, qq.points AS max_points
             FROM quiz_attempt_answers qaa
             JOIN quiz_questions qq ON qaa.question_id = qq.id
             WHERE qaa.attempt_id = ?
             ORDER BY qq.order_index ASC`,
            [attemptId]
        );

        for (const a of answers) {
            a.options = await query(
                'SELECT * FROM quiz_options WHERE question_id = ? ORDER BY order_index ASC',
                [a.question_id]
            );
        }

        res.render('student/quiz-result', {
            title: `Quiz Result: ${attempt.quiz_title} | EduShare 2.0`,
            attempt,
            answers
        });
    } catch (err) {
        console.error('Quiz result error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function chatbot(req, res) {
    res.render('student/chatbot', {
        title: 'AI Study Tutor | EduShare 2.0',
        gradeLevel: req.session.user.grade_level || 'Grade 7'
    });
}

module.exports = {
    dashboard,
    classes,
    joinClass,
    classView,
    viewActivitySubmit,
    submitActivity,
    takeQuiz,
    submitQuiz,
    quizResult,
    chatbot
};
