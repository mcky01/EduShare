const { query, withTransaction } = require('../config/database');
const { setFlash } = require('../middleware/branding');
const gradebookService = require('../services/gradebookService');
const exportService = require('../services/exportService');
const aiService = require('../services/aiService');

function generateClassCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

async function dashboard(req, res) {
    try {
        const teacherUserId = req.session.user.id;

        const classes = await query(
            'SELECT * FROM classes WHERE teacher_id = ? AND is_active = 1 ORDER BY class_name ASC',
            [teacherUserId]
        );

        const classIds = classes.map(c => c.id);

        let totalStudents = 0;
        let pendingSubmissions = 0;
        let quizzesCount = 0;

        if (classIds.length > 0) {
            const placeholders = classIds.map(() => '?').join(',');

            const [studentRes] = await query(
                `SELECT COUNT(DISTINCT student_id) AS count FROM enrollments WHERE class_id IN (${placeholders}) AND status = 'active'`,
                classIds
            );
            totalStudents = studentRes.count;

            const [subRes] = await query(
                `SELECT COUNT(*) AS count FROM activity_submissions WHERE class_id IN (${placeholders}) AND status = 'submitted'`,
                classIds
            );
            pendingSubmissions = subRes.count;

            const [qRes] = await query(
                'SELECT COUNT(*) AS count FROM quizzes WHERE teacher_id = ?',
                [teacherUserId]
            );
            quizzesCount = qRes.count;
        }

        const recentSubmissions = classIds.length > 0 ? await query(
            `SELECT asub.*, ca.title AS activity_title, c.class_name, u.first_name, u.last_name
             FROM activity_submissions asub
             JOIN class_activities ca ON asub.activity_id = ca.id
             JOIN classes c ON asub.class_id = c.id
             JOIN students s ON asub.student_id = s.id
             JOIN users u ON s.user_id = u.id
             WHERE asub.class_id IN (${classIds.map(() => '?').join(',')}) AND asub.status = 'submitted'
             ORDER BY asub.submitted_at DESC LIMIT 5`,
            classIds
        ) : [];

        res.render('teacher/dashboard', {
            title: 'Teacher Dashboard | EduShare 2.0',
            stats: {
                classes: classes.length,
                students: totalStudents,
                toGrade: pendingSubmissions,
                quizzes: quizzesCount
            },
            classes,
            recentSubmissions
        });
    } catch (err) {
        console.error('Teacher dashboard error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function classes(req, res) {
    try {
        const teacherUserId = req.session.user.id;
        const classList = await query(
            `SELECT c.*, COUNT(e.id) AS student_count
             FROM classes c
             LEFT JOIN enrollments e ON c.id = e.class_id AND e.status = 'active'
             WHERE c.teacher_id = ?
             GROUP BY c.id
             ORDER BY c.created_at DESC`,
            [teacherUserId]
        );

        res.render('teacher/classes', {
            title: 'My Classes | EduShare 2.0',
            classes: classList
        });
    } catch (err) {
        console.error('Teacher classes error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function createClass(req, res) {
    try {
        const teacherUserId = req.session.user.id;
        const { class_name, subject, grade_level, section, room, schedule } = req.body;

        if (!class_name || !subject || !grade_level || !section) {
            setFlash(req, 'error', 'Class name, subject, grade level, and section are required.');
            return res.redirect('/teacher/classes');
        }

        let classCode;
        let isUnique = false;
        while (!isUnique) {
            classCode = generateClassCode();
            const existing = await query('SELECT id FROM classes WHERE class_code = ?', [classCode]);
            if (existing.length === 0) isUnique = true;
        }

        await withTransaction(async (conn) => {
            const [cRes] = await conn.query(
                `INSERT INTO classes (teacher_id, class_name, subject, grade_level, section, class_code, room, schedule)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [teacherUserId, class_name.trim(), subject.trim(), grade_level, section.trim(), classCode, room || null, schedule || null]
            );
            const classId = cRes.insertId;

            // Seed default MATATAG categories
            await conn.query(
                `INSERT INTO gradebook_categories (class_id, category_name, category_code, weight_percentage, sort_order)
                 VALUES 
                    (?, 'Written Works', 'written_works', 20.00, 1),
                    (?, 'Performance Tasks', 'performance_tasks', 50.00, 2),
                    (?, 'Quarterly Exam', 'quarterly_exam', 30.00, 3)`,
                [classId, classId, classId]
            );
        });

        setFlash(req, 'success', `Class "${class_name}" created with code: ${classCode}`);
        res.redirect('/teacher/classes');
    } catch (err) {
        console.error('Create class error:', err);
        setFlash(req, 'error', 'Failed to create class.');
        res.redirect('/teacher/classes');
    }
}

async function classDetail(req, res) {
    try {
        const classId = parseInt(req.params.id, 10);
        const teacherUserId = req.session.user.id;

        const classRows = await query(
            'SELECT * FROM classes WHERE id = ? AND teacher_id = ?',
            [classId, teacherUserId]
        );
        if (classRows.length === 0) {
            setFlash(req, 'error', 'Class not found.');
            return res.redirect('/teacher/classes');
        }
        const cls = classRows[0];

        // 1. Materials
        const materials = await query(
            `SELECT cm.id AS post_id, cm.posted_at, li.*
             FROM class_materials cm
             JOIN library_items li ON cm.library_item_id = li.id
             WHERE cm.class_id = ?
             ORDER BY cm.posted_at DESC`,
            [classId]
        );

        // 2. Activities
        const activities = await query(
            `SELECT ca.*, ap.posted_at,
                    (SELECT COUNT(*) FROM activity_submissions WHERE activity_id = ca.id AND class_id = ?) AS submission_count,
                    (SELECT COUNT(*) FROM enrollments WHERE class_id = ? AND status = 'active') AS total_students
             FROM class_activities ca
             JOIN activity_posts ap ON ca.id = ap.activity_id
             WHERE ap.class_id = ?
             ORDER BY ca.created_at DESC`,
            [classId, classId, classId]
        );

        // 3. Quizzes
        const quizzes = await query(
            `SELECT q.*, sq.is_published, sq.start_time, sq.end_time,
                    (SELECT COUNT(*) FROM quiz_attempts WHERE quiz_id = q.id AND class_id = ?) AS attempt_count
             FROM quizzes q
             JOIN section_quizzes sq ON q.id = sq.quiz_id
             WHERE sq.class_id = ?
             ORDER BY q.created_at DESC`,
            [classId, classId]
        );

        // 4. Announcements
        const announcements = await query(
            `SELECT a.*,
                    (SELECT COUNT(*) FROM announcement_reads WHERE announcement_id = a.id) AS read_count
             FROM announcements a
             WHERE a.class_id = ?
             ORDER BY a.is_pinned DESC, a.created_at DESC`,
            [classId]
        );

        // 5. Students Roster
        const students = await query(
            `SELECT s.id AS student_profile_id, s.student_id AS lrn, s.gender, s.grade_level, s.section,
                    u.first_name, u.last_name, u.email, u.avatar_url, e.enrollment_date, e.id AS enrollment_id
             FROM enrollments e
             JOIN students s ON e.student_id = s.id
             JOIN users u ON s.user_id = u.id
             WHERE e.class_id = ? AND e.status = 'active'
             ORDER BY s.gender DESC, u.last_name ASC, u.first_name ASC`,
            [classId]
        );

        // Available library items for posting
        const availableLibrary = await query(
            `SELECT * FROM library_items 
             WHERE teacher_id = ? AND id NOT IN (SELECT library_item_id FROM class_materials WHERE class_id = ?)
             ORDER BY created_at DESC`,
            [teacherUserId, classId]
        );

        res.render('teacher/class-detail', {
            title: `${cls.class_name} | EduShare 2.0`,
            cls,
            materials,
            activities,
            quizzes,
            announcements,
            students,
            availableLibrary,
            activeTab: req.query.tab || 'materials'
        });
    } catch (err) {
        console.error('Class detail error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function postAnnouncement(req, res) {
    try {
        const classId = parseInt(req.params.id, 10);
        const teacherUserId = req.session.user.id;
        const { title, message, category, is_pinned } = req.body;

        if (!title || !message) {
            setFlash(req, 'error', 'Title and message are required.');
            return res.redirect(`/teacher/classes/${classId}?tab=announcements`);
        }

        await query(
            `INSERT INTO announcements (class_id, teacher_id, title, message, category, is_pinned)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [classId, teacherUserId, title.trim(), message.trim(), category || 'general', is_pinned === '1' ? 1 : 0]
        );

        setFlash(req, 'success', 'Announcement posted successfully!');
        res.redirect(`/teacher/classes/${classId}?tab=announcements`);
    } catch (err) {
        console.error('Post announcement error:', err);
        setFlash(req, 'error', 'Failed to post announcement.');
        res.redirect(`/teacher/classes/${req.params.id}?tab=announcements`);
    }
}

async function createActivity(req, res) {
    try {
        const teacherUserId = req.session.user.id;
        const { title, instructions, points, due_date, class_ids } = req.body;

        if (!title || !points) {
            setFlash(req, 'error', 'Activity title and points are required.');
            return res.redirect('back');
        }

        let filePath = null;
        let fileType = null;
        let fileSize = null;

        if (req.file) {
            filePath = `/uploads/materials/${req.file.filename}`;
            fileType = req.file.mimetype;
            fileSize = (req.file.size / (1024 * 1024)).toFixed(2) + ' MB';
        }

        const targetClassIds = Array.isArray(class_ids) ? class_ids : [class_ids].filter(Boolean);
        if (targetClassIds.length === 0) {
            setFlash(req, 'error', 'Please select at least one class section.');
            return res.redirect('back');
        }

        await withTransaction(async (conn) => {
            const [actRes] = await conn.query(
                `INSERT INTO class_activities (teacher_id, title, instructions, points, due_date, file_path, file_type, file_size)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [teacherUserId, title.trim(), instructions?.trim() || null, parseInt(points, 10) || 100, due_date || null, filePath, fileType, fileSize]
            );
            const actId = actRes.insertId;

            for (const cId of targetClassIds) {
                await conn.query(
                    `INSERT IGNORE INTO activity_posts (activity_id, class_id) VALUES (?, ?)`,
                    [actId, cId]
                );

                // Auto create Gradebook Column under Performance Tasks
                const [catRows] = await conn.query(
                    'SELECT id FROM gradebook_categories WHERE class_id = ? AND category_code = "performance_tasks" LIMIT 1',
                    [cId]
                );
                if (catRows.length > 0) {
                    await conn.query(
                        `INSERT INTO gradebook_columns (class_id, category_id, column_name, max_score, source_type, activity_id)
                         VALUES (?, ?, ?, ?, 'activity', ?)`,
                        [cId, catRows[0].id, title.trim(), parseInt(points, 10) || 100, actId]
                    );
                }
            }
        });

        setFlash(req, 'success', `Activity "${title}" assigned to selected class(es)!`);
        res.redirect('back');
    } catch (err) {
        console.error('Create activity error:', err);
        setFlash(req, 'error', 'Failed to create activity: ' + err.message);
        res.redirect('back');
    }
}

async function viewActivityGrading(req, res) {
    try {
        const activityId = parseInt(req.params.activityId, 10);
        const classId = parseInt(req.params.classId, 10);

        const [activity] = await query('SELECT * FROM class_activities WHERE id = ?', [activityId]);
        const [cls] = await query('SELECT * FROM classes WHERE id = ?', [classId]);

        if (!activity || !cls) {
            setFlash(req, 'error', 'Activity or class not found.');
            return res.redirect('/teacher/classes');
        }

        // Get all enrolled students with their submission if any
        const submissions = await query(
            `SELECT s.id AS student_profile_id, s.student_id AS lrn, s.gender, u.first_name, u.last_name,
                    sub.id AS submission_id, sub.file_path, sub.note, sub.score, sub.feedback, sub.status, sub.submitted_at, sub.graded_at
             FROM enrollments e
             JOIN students s ON e.student_id = s.id
             JOIN users u ON s.user_id = u.id
             LEFT JOIN activity_submissions sub ON sub.activity_id = ? AND sub.student_id = s.id AND sub.class_id = ?
             WHERE e.class_id = ? AND e.status = 'active'
             ORDER BY s.gender DESC, u.last_name ASC`,
            [activityId, classId, classId]
        );

        res.render('teacher/activity-grading', {
            title: `Grading: ${activity.title} | EduShare 2.0`,
            activity,
            cls,
            submissions
        });
    } catch (err) {
        console.error('Activity grading error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function gradeSubmission(req, res) {
    try {
        const { submission_id, activity_id, class_id, student_id, score, feedback } = req.body;

        const numScore = parseFloat(score);

        await withTransaction(async (conn) => {
            if (submission_id) {
                await conn.query(
                    `UPDATE activity_submissions
                     SET score = ?, feedback = ?, status = 'graded', graded_at = NOW()
                     WHERE id = ?`,
                    [numScore, feedback || null, submission_id]
                );
            } else {
                await conn.query(
                    `INSERT INTO activity_submissions (activity_id, class_id, student_id, score, feedback, status, graded_at)
                     VALUES (?, ?, ?, ?, ?, 'graded', NOW())`,
                    [activity_id, class_id, student_id, numScore, feedback || null]
                );
            }

            // Sync to Gradebook Column
            const [cols] = await conn.query(
                'SELECT id FROM gradebook_columns WHERE class_id = ? AND activity_id = ? LIMIT 1',
                [class_id, activity_id]
            );
            if (cols.length > 0) {
                await conn.query(
                    `INSERT INTO gradebook_entries (column_id, student_id, score, manual_override)
                     VALUES (?, ?, ?, 1)
                     ON DUPLICATE KEY UPDATE score = VALUES(score), manual_override = 1`,
                    [cols[0].id, student_id, numScore]
                );
            }
        });

        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.json({ success: true, score: numScore });
        }

        setFlash(req, 'success', 'Submission graded successfully!');
        res.redirect('back');
    } catch (err) {
        console.error('Grade submission error:', err);
        if (req.xhr) return res.status(500).json({ error: err.message });
        setFlash(req, 'error', 'Failed to grade submission.');
        res.redirect('back');
    }
}

async function library(req, res) {
    try {
        const teacherUserId = req.session.user.id;
        const items = await query(
            'SELECT * FROM library_items WHERE teacher_id = ? AND in_library = 1 ORDER BY created_at DESC',
            [teacherUserId]
        );

        const teacherClasses = await query(
            'SELECT id, class_name, subject, grade_level, section FROM classes WHERE teacher_id = ? AND is_active = 1',
            [teacherUserId]
        );

        res.render('teacher/library', {
            title: 'My Material Library | EduShare 2.0',
            items,
            classes: teacherClasses
        });
    } catch (err) {
        console.error('Library error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function uploadLibraryItem(req, res) {
    try {
        const teacherUserId = req.session.user.id;
        const { title, description, subject, grade_level, post_to_classes } = req.body;

        if (!title || !req.file) {
            setFlash(req, 'error', 'Title and a file upload are required.');
            return res.redirect('/teacher/library');
        }

        const filePath = `/uploads/materials/${req.file.filename}`;
        const fileType = req.file.mimetype;
        const fileSize = (req.file.size / (1024 * 1024)).toFixed(2) + ' MB';

        const itemRes = await query(
            `INSERT INTO library_items (teacher_id, title, description, file_path, file_type, file_size, subject, grade_level, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'upload')`,
            [teacherUserId, title.trim(), description?.trim() || null, filePath, fileType, fileSize, subject || 'General', grade_level || 'Grade 7']
        );
        const itemId = itemRes.insertId;

        // Repost to selected classes if specified
        if (post_to_classes) {
            const classIds = Array.isArray(post_to_classes) ? post_to_classes : [post_to_classes];
            for (const cId of classIds) {
                await query(
                    `INSERT IGNORE INTO class_materials (library_item_id, class_id) VALUES (?, ?)`,
                    [itemId, cId]
                );
            }
        }

        setFlash(req, 'success', `"${title}" successfully saved to library!`);
        res.redirect('/teacher/library');
    } catch (err) {
        console.error('Upload library item error:', err);
        setFlash(req, 'error', 'Failed to upload item.');
        res.redirect('/teacher/library');
    }
}

async function repostLibraryItem(req, res) {
    try {
        const { item_id, class_ids } = req.body;
        if (!item_id || !class_ids) {
            setFlash(req, 'error', 'Item and at least one target class are required.');
            return res.redirect('/teacher/library');
        }

        const targetIds = Array.isArray(class_ids) ? class_ids : [class_ids];
        for (const cId of targetIds) {
            await query(
                `INSERT IGNORE INTO class_materials (library_item_id, class_id) VALUES (?, ?)`,
                [item_id, cId]
            );
        }

        setFlash(req, 'success', 'Material successfully posted to class section(s)!');
        res.redirect('back');
    } catch (err) {
        console.error('Repost item error:', err);
        setFlash(req, 'error', 'Failed to repost material.');
        res.redirect('back');
    }
}

async function gradebook(req, res) {
    try {
        const teacherUserId = req.session.user.id;
        const classes = await query(
            'SELECT id, class_name, subject, grade_level, section FROM classes WHERE teacher_id = ? AND is_active = 1',
            [teacherUserId]
        );

        if (classes.length === 0) {
            return res.render('teacher/gradebook', {
                title: 'Gradebook | EduShare 2.0',
                classes: [],
                selectedClass: null,
                gradebookData: null
            });
        }

        const selectedClassId = parseInt(req.query.classId, 10) || classes[0].id;
        const selectedClass = classes.find(c => c.id === selectedClassId) || classes[0];

        const gradebookData = await gradebookService.getClassGradebook(selectedClass.id);

        res.render('teacher/gradebook', {
            title: `E-Class Record: ${selectedClass.class_name} | EduShare 2.0`,
            classes,
            selectedClass,
            gradebookData
        });
    } catch (err) {
        console.error('Gradebook error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function exportGradebook(req, res) {
    try {
        const classId = parseInt(req.params.classId, 10);
        const [cls] = await query('SELECT * FROM classes WHERE id = ?', [classId]);
        if (!cls) return res.status(404).send('Class not found');

        const gradebookData = await gradebookService.getClassGradebook(classId);
        const csvContent = exportService.generateGradebookCSV(gradebookData, cls.class_name);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="Gradebook-${cls.class_code}.csv"`);
        res.send(csvContent);
    } catch (err) {
        console.error('Export gradebook error:', err);
        res.status(500).send('Error exporting gradebook');
    }
}

async function advisory(req, res) {
    try {
        const teacherUserId = req.session.user.id;
        const teacherRows = await query(
            'SELECT * FROM teachers WHERE user_id = ?',
            [teacherUserId]
        );

        const teacher = teacherRows[0] || {};
        if (!teacher.is_adviser) {
            setFlash(req, 'info', 'You are currently not designated as an advisory class adviser.');
        }

        // Find students in advisory grade and section
        const students = await query(
            `SELECT s.id AS student_profile_id, s.student_id AS lrn, s.gender, s.grade_level, s.section,
                    u.id AS user_id, u.first_name, u.last_name, u.email, u.last_login
             FROM students s
             JOIN users u ON s.user_id = u.id
             WHERE s.grade_level = ? AND s.section = ?
             ORDER BY s.gender DESC, u.last_name ASC`,
            [teacher.advisory_grade || 'Grade 7', teacher.advisory_section || 'Rizal']
        );

        const maleCount = students.filter(s => s.gender === 'Male').length;
        const femaleCount = students.filter(s => s.gender === 'Female').length;

        res.render('teacher/advisory', {
            title: `Advisory Section: ${teacher.advisory_grade} - ${teacher.advisory_section} | EduShare 2.0`,
            teacher,
            students,
            stats: {
                total: students.length,
                male: maleCount,
                female: femaleCount
            }
        });
    } catch (err) {
        console.error('Advisory error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function lessonGenerator(req, res) {
    try {
        const teacherUserId = req.session.user.id;
        const teacherClasses = await query(
            'SELECT id, class_name, subject, grade_level, section FROM classes WHERE teacher_id = ? AND is_active = 1',
            [teacherUserId]
        );
        const comps = await query('SELECT * FROM competencies ORDER BY code ASC');

        res.render('teacher/lesson-generator', {
            title: 'AI Lesson Plan Generator | EduShare 2.0',
            classes: teacherClasses,
            competencies: comps
        });
    } catch (err) {
        console.error('Lesson generator view error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function quizMaker(req, res) {
    try {
        const teacherUserId = req.session.user.id;
        const teacherClasses = await query(
            'SELECT id, class_name, subject, grade_level, section FROM classes WHERE teacher_id = ? AND is_active = 1',
            [teacherUserId]
        );
        const myQuizzes = await query(
            `SELECT q.*, 
                    (SELECT COUNT(*) FROM section_quizzes WHERE quiz_id = q.id) AS sections_assigned,
                    (SELECT COUNT(*) FROM quiz_attempts WHERE quiz_id = q.id) AS total_attempts
             FROM quizzes q
             WHERE q.teacher_id = ?
             ORDER BY q.created_at DESC`,
            [teacherUserId]
        );

        res.render('teacher/quiz-maker', {
            title: 'AI Quiz Maker | EduShare 2.0',
            classes: teacherClasses,
            quizzes: myQuizzes
        });
    } catch (err) {
        console.error('Quiz maker view error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

module.exports = {
    dashboard,
    classes,
    createClass,
    classDetail,
    postAnnouncement,
    createActivity,
    viewActivityGrading,
    gradeSubmission,
    library,
    uploadLibraryItem,
    repostLibraryItem,
    gradebook,
    exportGradebook,
    advisory,
    lessonGenerator,
    quizMaker
};
