const { query, withTransaction } = require('../config/database');
const { setFlash } = require('../middleware/branding');
const notifications = require('../services/notificationService');
const gradebookService = require('../services/gradebookService');
const sectionService = require('../services/sectionService');
const exportService = require('../services/exportService');
const aiService = require('../services/aiService');

async function requireOwnClass(teacherUserId, classId) {
  const id = parseInt(classId, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  const rows = await query('SELECT * FROM classes WHERE id = ? AND teacher_id = ?', [id, teacherUserId]);
  return rows[0] || null;
}

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
            title: 'Teacher Dashboard | EduShare',
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
            title: 'My Classes | EduShare',
            classes: classList,
            teacherProfile: await query(
                'SELECT grade_level, section FROM teachers WHERE user_id = ? LIMIT 1',
                [teacherUserId]
            ).then(r => (r.length > 0 ? r[0] : null)).catch(() => null)
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
        const cn = (class_name || '').trim();
        const sj = (subject || '').trim();
        const gl = (grade_level || '').trim();
        const rawSc = (section || '').trim().replace(/\s+/g, ' ').slice(0, 50);

        if (!cn || !sj || !gl || !rawSc) {
            setFlash(req, 'error', 'Class name, subject, grade level, and section are required.');
            return res.redirect('/teacher/classes');
        }
        // Grade whitelist (7-12 everywhere) + canonical section spelling so
        // the new class immediately joins the suggestion vocabulary instead
        // of seeding a fresh "Rizal vs rizal" split.
        if (!sectionService.GRADES_7_12.includes(gl)) {
            setFlash(req, 'error', 'Select a valid grade level (Grade 7 to Grade 12).');
            return res.redirect('/teacher/classes');
        }
        const sc = await sectionService.canonicalizeSection(gl, rawSc);
        sectionService.clearSectionCache();

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
                [teacherUserId, cn, sj, gl, sc, classCode, room || null, schedule || null]
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

            // Seed one editable manual column per category so the gradebook is
            // usable before any quiz/activity exists to auto-link one. Runs
            // inside the same transaction so a failure never leaves a class
            // with categories but no columns.
            const [seedCats] = await conn.query(
                'SELECT id, category_code FROM gradebook_categories WHERE class_id = ?',
                [classId]
            );
            const catIdByCode = {};
            for (const c of seedCats) catIdByCode[c.category_code] = c.id;
            for (const [code, columnName] of [
                ['written_works', 'Written Works 1'],
                ['performance_tasks', 'Performance Task 1'],
                ['quarterly_exam', 'Quarterly Exam']
            ]) {
                const categoryId = catIdByCode[code];
                if (!categoryId) continue;
                await conn.query(
                    `INSERT INTO gradebook_columns (class_id, category_id, column_name, max_score, source_type, sort_order)
                     VALUES (?, ?, ?, 100, 'manual', 1)`,
                    [classId, categoryId, columnName]
                );
            }
        });

        setFlash(req, 'success', `Class "${cn}" created with code: ${classCode}`);
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

        // 2. Activities (submission_count counts real student work, not teacher grade rows)
        const activities = await query(
            `SELECT ca.*, ap.posted_at,
                    (SELECT COUNT(*) FROM activity_submissions WHERE activity_id = ca.id AND class_id = ? AND status = 'submitted') AS submission_count,
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
            title: `${cls.class_name} | EduShare`,
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
        const cls = await requireOwnClass(teacherUserId, classId);
        if (!cls) {
            setFlash(req, 'error', 'Access forbidden.');
            return res.redirect('/teacher/classes');
        }
        const { title, message, category, is_pinned } = req.body;

        if (!title || !message) {
            setFlash(req, 'error', 'Title and message are required.');
            return res.redirect(`/teacher/classes/${cls.id}?tab=announcements`);
        }

        const annRes = await query(
            `INSERT INTO announcements (class_id, teacher_id, title, message, category, is_pinned)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [cls.id, teacherUserId, title.trim(), message.trim(), category || 'general', is_pinned === '1' ? 1 : 0]
        );

        // Notify enrolled students (best-effort; never blocks the redirect).
        notifications.notifyClass({
            classId: cls.id,
            type: 'announcement',
            title: `New bulletin in ${cls.class_name}: ${title.trim()}`,
            message: message.trim(),
            linkFor: () => `/student/classes/${cls.id}`,
            refType: 'announcement',
            refId: annRes.insertId
        });

        setFlash(req, 'success', 'Announcement posted successfully!');
        res.redirect(`/teacher/classes/${cls.id}?tab=announcements`);
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
            filePath = `/files/materials/${req.file.filename}`;
            fileType = req.file.mimetype;
            fileSize = (req.file.size / (1024 * 1024)).toFixed(2) + ' MB';
        }

        const targetClassIds = Array.isArray(class_ids) ? class_ids : [class_ids].filter(Boolean);
        if (targetClassIds.length === 0) {
            setFlash(req, 'error', 'Please select at least one class section.');
            return res.redirect('back');
        }

        const ownedRows = await query(
            `SELECT id FROM classes WHERE teacher_id = ? AND id IN (${targetClassIds.map(() => '?').join(',')})`,
            [teacherUserId, ...targetClassIds.map((v) => parseInt(v, 10))]
        );
        if (ownedRows.length !== targetClassIds.length) {
            setFlash(req, 'error', 'Access forbidden.');
            return res.redirect('back');
        }

        let createdActivityId = null;
        const createdActivityTitle = title.trim();
        const createdActivityPoints = parseInt(points, 10) || 100;
        const createdDueDate = due_date || null;
        await withTransaction(async (conn) => {
            const [actRes] = await conn.query(
                `INSERT INTO class_activities (teacher_id, title, instructions, points, due_date, file_path, file_type, file_size)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [teacherUserId, createdActivityTitle, instructions?.trim() || null, createdActivityPoints, createdDueDate, filePath, fileType, fileSize]
            );
            const actId = actRes.insertId;
            createdActivityId = actId;

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

        // Notify each target class (best-effort; deduped per student+activity+class).
        if (createdActivityId) {
            const dueLabel = createdDueDate ? ` Due: ${new Date(createdDueDate).toLocaleDateString()}.` : '';
            for (const cId of targetClassIds) {
                const cidInt = parseInt(cId, 10);
                notifications.notifyClass({
                    classId: cidInt,
                    type: 'activity',
                    title: `New activity: ${createdActivityTitle}`,
                    message: `${createdActivityPoints} points.${dueLabel}`,
                    linkFor: () => `/student/activities/${createdActivityId}/classes/${cidInt}/submit`,
                    refType: 'activity',
                    refId: `${createdActivityId}`
                });
            }
        }

        setFlash(req, 'success', `Activity "${title}" assigned to selected class(es)!`);
        res.redirect('back');
    } catch (err) {
        console.error('Create activity error:', err);
        setFlash(req, 'error', 'Failed to create activity.');
        res.redirect('back');
    }
}

async function viewActivityGrading(req, res) {
    try {
        const teacherId = req.session.user.id;
        const activityId = parseInt(req.params.activityId, 10);
        const classId = parseInt(req.params.classId, 10);

        const [activity] = await query('SELECT * FROM class_activities WHERE id = ? AND teacher_id = ?', [activityId, teacherId]);
        const cls = await requireOwnClass(teacherId, classId);

        if (!activity || activity.teacher_id !== teacherId || !cls) {
            setFlash(req, 'error', 'Access forbidden.');
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
            title: `Grading: ${activity.title} | EduShare`,
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
        const teacherId = req.session.user.id;
        const { submission_id, activity_id, class_id, student_id, score, feedback } = req.body;
        const isXhr = req.xhr || req.headers.accept?.includes('application/json');
        const deny = () => {
            if (isXhr) return res.status(403).json({ error: 'Access forbidden.' });
            setFlash(req, 'error', 'Access forbidden.');
            return res.redirect('back');
        };
        const invalid = () => {
            if (isXhr) return res.status(400).json({ error: 'Invalid score.' });
            setFlash(req, 'error', 'Invalid score.');
            return res.redirect('back');
        };

        const activityId = parseInt(activity_id, 10);
        const classId = parseInt(class_id, 10);
        const studentId = parseInt(student_id, 10);
        const submissionId = submission_id ? parseInt(submission_id, 10) : null;
        const numScore = parseFloat(score);

        if (!Number.isInteger(activityId) || activityId <= 0
            || !Number.isInteger(classId) || classId <= 0
            || !Number.isInteger(studentId) || studentId <= 0
            || (submission_id && (!Number.isInteger(submissionId) || submissionId <= 0))
            || !Number.isFinite(numScore)) {
            return invalid();
        }

        const [activity] = await query('SELECT * FROM class_activities WHERE id = ?', [activityId]);
        if (!activity || activity.teacher_id !== teacherId) return deny();

        const cls = await requireOwnClass(teacherId, classId);
        if (!cls) return deny();

        const enrollRows = await query(
            "SELECT id FROM enrollments WHERE class_id = ? AND student_id = ? AND status = 'active'",
            [classId, studentId]
        );
        if (enrollRows.length === 0) return deny();

        const colRows = await query(
            'SELECT id, max_score FROM gradebook_columns WHERE class_id = ? AND activity_id = ? LIMIT 1',
            [classId, activityId]
        );
        const maxScore = colRows[0] ? parseFloat(colRows[0].max_score) : parseFloat(activity.points);
        const cap = Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 100;
        const finalScore = Math.min(Math.max(numScore, 0), cap);

        if (submissionId) {
            const [sub] = await query(
                'SELECT * FROM activity_submissions WHERE id = ? AND activity_id = ? AND class_id = ? AND student_id = ?',
                [submissionId, activityId, classId, studentId]
            );
            if (!sub) return deny();
        }

        await withTransaction(async (conn) => {
            if (submissionId) {
                await conn.query(
                    `UPDATE activity_submissions
                     SET score = ?, feedback = ?, status = 'graded', graded_at = NOW()
                     WHERE id = ?`,
                    [finalScore, feedback || null, submissionId]
                );
            } else {
                await conn.query(
                    `INSERT INTO activity_submissions (activity_id, class_id, student_id, score, feedback, status, graded_at)
                     VALUES (?, ?, ?, ?, ?, 'graded', NOW())`,
                    [activityId, classId, studentId, finalScore, feedback || null]
                );
            }

            // Sync to Gradebook Column
            const [cols] = await conn.query(
                'SELECT id FROM gradebook_columns WHERE class_id = ? AND activity_id = ? LIMIT 1',
                [classId, activityId]
            );
            if (cols.length > 0) {
                await conn.query(
                    `INSERT INTO gradebook_entries (column_id, student_id, score, manual_override)
                     VALUES (?, ?, ?, 1)
                     ON DUPLICATE KEY UPDATE score = VALUES(score), manual_override = 1`,
                    [cols[0].id, studentId, finalScore]
                );
            }
        });

        // Notify the graded student (best-effort; re-grade re-arms the row).
        notifications.refreshStudent({
            studentId,
            classId,
            type: 'grade',
            title: `Graded: ${activity.title} — ${finalScore}/${cap}`,
            message: feedback ? String(feedback).slice(0, 200) : `Your work in ${cls.class_name} has been graded.`,
            linkUrl: `/student/activities/${activityId}/classes/${classId}/submit`,
            refType: 'grade-activity',
            refId: submissionId || activityId
        });

        if (isXhr) {
            return res.json({ success: true, score: finalScore });
        }

        setFlash(req, 'success', 'Submission graded successfully!');
        res.redirect('back');
    } catch (err) {
        console.error('Grade submission error:', err);
        if (req.xhr || req.headers.accept?.includes('application/json')) return res.status(500).json({ error: 'Failed to grade submission.' });
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
            title: 'My Material Library | EduShare',
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

        const filePath = `/files/materials/${req.file.filename}`;
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
            const owned = await query(
                `SELECT id FROM classes WHERE teacher_id = ? AND id IN (${classIds.map(() => '?').join(',')})`,
                [teacherUserId, ...classIds.map((v) => parseInt(v, 10))]
            );
            if (owned.length !== classIds.length) {
                setFlash(req, 'error', 'Access forbidden.');
                return res.redirect('/teacher/library');
            }
            for (const cId of classIds) {
                await query(
                    `INSERT IGNORE INTO class_materials (library_item_id, class_id) VALUES (?, ?)`,
                    [itemId, cId]
                );
            }
        }

        // Notify posted classes of the new material (best-effort).
        if (post_to_classes) {
            const postedIds = (Array.isArray(post_to_classes) ? post_to_classes : [post_to_classes]).map((v) => parseInt(v, 10));
            const postedTitle = String(title).trim();
            for (const cId of postedIds) {
                if (!Number.isInteger(cId)) continue;
                notifications.notifyClass({
                    classId: cId,
                    type: 'material',
                    title: `New material: ${postedTitle}`,
                    message: 'Your teacher posted a new learning material.',
                    linkFor: () => `/student/classes/${cId}`,
                    refType: 'material',
                    refId: itemId
                });
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
        const teacherUserId = req.session.user.id;
        const { item_id, class_ids } = req.body;
        if (!item_id || !class_ids) {
            setFlash(req, 'error', 'Item and at least one target class are required.');
            return res.redirect('/teacher/library');
        }

        const itemRows = await query(
            'SELECT id FROM library_items WHERE id = ? AND teacher_id = ?',
            [parseInt(item_id, 10), teacherUserId]
        );
        if (itemRows.length === 0) {
            setFlash(req, 'error', 'Access forbidden.');
            return res.redirect('/teacher/library');
        }

        const targetIds = Array.isArray(class_ids) ? class_ids : [class_ids];
        const owned = await query(
            `SELECT id FROM classes WHERE teacher_id = ? AND id IN (${targetIds.map(() => '?').join(',')})`,
            [teacherUserId, ...targetIds.map((v) => parseInt(v, 10))]
        );
        if (owned.length !== targetIds.length) {
            setFlash(req, 'error', 'Access forbidden.');
            return res.redirect('/teacher/library');
        }
        const [postedItem] = await query('SELECT title FROM library_items WHERE id = ?', [parseInt(item_id, 10)]);
        for (const cId of targetIds) {
            await query(
                `INSERT IGNORE INTO class_materials (library_item_id, class_id) VALUES (?, ?)`,
                [item_id, cId]
            );
        }

        // Notify posted classes (best-effort; deduped per student+item+class).
        const repostTitle = postedItem ? postedItem.title : 'learning material';
        for (const cId of targetIds) {
            const cidInt = parseInt(cId, 10);
            if (!Number.isInteger(cidInt)) continue;
            notifications.notifyClass({
                classId: cidInt,
                type: 'material',
                title: `New material: ${repostTitle}`,
                message: 'Your teacher posted a new learning material.',
                linkFor: () => `/student/classes/${cidInt}`,
                refType: 'material',
                refId: parseInt(item_id, 10)
            });
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
            'SELECT id, class_name, subject, grade_level, section, class_code FROM classes WHERE teacher_id = ? AND is_active = 1',
            [teacherUserId]
        );

        if (classes.length === 0) {
            return res.render('teacher/gradebook', {
                title: 'Gradebook | EduShare',
                classes: [],
                selectedClass: null,
                gradebookData: null
            });
        }

        const selectedClassId = parseInt(req.query.classId, 10) || classes[0].id;
        const selectedClass = classes.find(c => c.id === selectedClassId) || classes[0];

        const gradebookData = await gradebookService.getClassGradebook(selectedClass.id);

        res.render('teacher/gradebook', {
            title: `E-Class Record: ${selectedClass.class_name} | EduShare`,
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
        const teacherUserId = req.session.user.id;
        const classId = parseInt(req.params.classId, 10);
        const [cls] = await query('SELECT * FROM classes WHERE id = ? AND teacher_id = ?', [classId, teacherUserId]);
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
             WHERE s.grade_level = ? AND s.section = ? AND u.status = 'active'
             ORDER BY s.gender DESC, u.last_name ASC`,
            [teacher.advisory_grade || 'Grade 7', teacher.advisory_section || 'Rizal']
        );

        const pendingStudents = teacher.is_adviser ? await query(
            `SELECT s.id AS student_profile_id, s.student_id AS lrn, s.gender, s.grade_level, s.section,
                    u.id AS user_id, u.first_name, u.last_name, u.email, u.created_at
             FROM students s
             JOIN users u ON s.user_id = u.id
             WHERE s.grade_level = ? AND s.section = ? AND u.status = 'pending' AND u.role = 'student'
             ORDER BY u.created_at ASC`,
            [teacher.advisory_grade, teacher.advisory_section]
        ) : [];

        const maleCount = students.filter(s => s.gender === 'Male').length;
        const femaleCount = students.filter(s => s.gender === 'Female').length;

        const { ensureToken } = require('../middleware/csrf');
        ensureToken(req);

        // Transfer queues for this adviser: outgoing requests I filed
        // (still pending) + incoming requests addressed TO my section
        // (needing my receiver decision) + recent decided history.
        // Plus my pending unified change requests (edit/drop/restore/
        // deactivate) so I can track and cancel them.
        let outgoingTransfers = [];
        let incomingTransfers = [];
        let transferHistory = [];
        let outgoingChanges = [];
        if (teacher.is_adviser && teacher.advisory_grade && teacher.advisory_section) {
            try {
                outgoingTransfers = await query(
                    `SELECT tr.*, u.first_name, u.last_name, s.student_id AS lrn
                     FROM section_transfer_requests tr
                     JOIN students s ON tr.student_id = s.id
                     JOIN users u ON s.user_id = u.id
                     WHERE tr.requested_by = ? AND tr.status = 'pending'
                     ORDER BY tr.created_at DESC`,
                    [teacherUserId]
                );
                incomingTransfers = await query(
                    `SELECT tr.*, u.first_name, u.last_name, s.student_id AS lrn,
                            ru.first_name AS req_first, ru.last_name AS req_last
                     FROM section_transfer_requests tr
                     JOIN students s ON tr.student_id = s.id
                     JOIN users u ON s.user_id = u.id
                     JOIN users ru ON tr.requested_by = ru.id
                     WHERE tr.status = 'pending' AND tr.receiver_decision IS NULL
                       AND LOWER(TRIM(tr.to_grade)) = LOWER(TRIM(?))
                       AND LOWER(TRIM(tr.to_section)) = LOWER(TRIM(?))
                     ORDER BY tr.created_at ASC`,
                    [teacher.advisory_grade, teacher.advisory_section]
                );
                transferHistory = await query(
                    `SELECT tr.*, u.first_name, u.last_name, s.student_id AS lrn
                     FROM section_transfer_requests tr
                     JOIN students s ON tr.student_id = s.id
                     JOIN users u ON s.user_id = u.id
                     WHERE tr.status <> 'pending'
                       AND (tr.requested_by = ?
                            OR (LOWER(TRIM(tr.to_grade)) = LOWER(TRIM(?))
                                AND LOWER(TRIM(tr.to_section)) = LOWER(TRIM(?)))
                            OR (LOWER(TRIM(tr.from_grade)) = LOWER(TRIM(?))
                                AND LOWER(TRIM(tr.from_section)) = LOWER(TRIM(?))))
                     ORDER BY tr.updated_at DESC LIMIT 10`,
                    [teacherUserId, teacher.advisory_grade, teacher.advisory_section, teacher.advisory_grade, teacher.advisory_section]
                );
            } catch (tErr) {
                // Transfer table may not exist yet on a DB that hasn't
                // booted through the 2f migration — advisory must still render.
                console.error('Transfer queue load failed:', tErr.message || tErr);
            }
            try {
                outgoingChanges = await query(
                    `SELECT cr.*, u.first_name, u.last_name, s.student_id AS lrn
                     FROM student_change_requests cr
                     JOIN students s ON cr.student_id = s.id
                     JOIN users u ON s.user_id = u.id
                     WHERE cr.requested_by = ? AND cr.status = 'pending'
                     ORDER BY cr.created_at DESC`,
                    [teacherUserId]
                );
            } catch (cErr) {
                // Same 2g-migration guard as transfers above.
                console.error('Change-request queue load failed:', cErr.message || cErr);
            }
        }

        res.render('teacher/advisory', {
            title: `Advisory Section: ${teacher.advisory_grade} - ${teacher.advisory_section} | EduShare`,
            teacher,
            students,
            pendingStudents,
            outgoingTransfers,
            incomingTransfers,
            transferHistory,
            outgoingChanges,
            csrfToken: req.session.csrfToken,
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

async function approveStudent(req, res) {
    try {
        const teacherUserId = req.session.user.id;
        const teacherRows = await query(
            'SELECT * FROM teachers WHERE user_id = ?',
            [teacherUserId]
        );
        const teacher = teacherRows[0] || {};
        if (!teacher.is_adviser) {
            setFlash(req, 'error', 'Only class advisers can approve pending students.');
            return res.redirect('/teacher/advisory');
        }

        const targetId = parseInt(req.params.id, 10);
        const targetRows = await query(
            `SELECT u.id, u.status, u.first_name, u.last_name, s.grade_level, s.section
             FROM users u
             JOIN students s ON s.user_id = u.id
             WHERE u.id = ? AND u.role = 'student'`,
            [targetId]
        );
        if (targetRows.length === 0) {
            setFlash(req, 'error', 'Student not found.');
            return res.redirect('/teacher/advisory');
        }
        const target = targetRows[0];
        // Case-insensitive section match: the DB collation treats "rizal" =
        // "Rizal" in WHERE clauses, but this JS strict compare runs in Node
        // and would wrongly reject a pending student over casing alone.
        // (New registrations converge to the canonical spelling at insert,
        // so this is a safety net for legacy rows.)
        const sameGrade = String(target.grade_level || '').trim().toLowerCase()
            === String(teacher.advisory_grade || '').trim().toLowerCase();
        const sameSection = String(target.section || '').trim().replace(/\s+/g, ' ').toLowerCase()
            === String(teacher.advisory_section || '').trim().replace(/\s+/g, ' ').toLowerCase();
        if (target.status !== 'pending' || !sameGrade || !sameSection) {
            setFlash(req, 'error', 'You can only approve pending students in your advisory section.');
            return res.redirect('/teacher/advisory');
        }
        // Heal legacy casing on approval: the student's section becomes the
        // adviser's canonical spelling so future roster queries match exactly.
        try {
            if (target.section !== teacher.advisory_section) {
                await query('UPDATE students SET section = ? WHERE user_id = ?', [teacher.advisory_section, targetId]);
            }
        } catch (healErr) {
            console.error('Section casing heal failed:', healErr);
        }

        await query("UPDATE users SET status = 'active', is_active = 1 WHERE id = ?", [targetId]);

        // Enroll into EVERY active class matching the student's
        // grade/section (all subject classes, any teacher) — not just the
        // adviser's own class. Case-insensitive so legacy casing splits
        // can never strand a student outside their section's gradebooks.
        let enrolledCount = 0;
        try {
            const stuRows = await query('SELECT id FROM students WHERE user_id = ? LIMIT 1', [targetId]);
            const studentProfileId = stuRows[0] ? stuRows[0].id : null;
            if (studentProfileId) {
                const enrollmentService = require('../services/enrollmentService');
                enrolledCount = await enrollmentService.autoEnrollStudent(studentProfileId);
            }
        } catch (enrollErr) {
            console.error('Auto-enroll after approval failed:', enrollErr);
        }

        await query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, 'Registration Approved', ?, 'teacher')`,
            [teacherUserId, `Adviser approved registration for ${target.first_name} ${target.last_name} (user ID ${targetId})`]
        );

        setFlash(req, 'success', `Approved registration for ${target.first_name} ${target.last_name}. Enrolled in ${enrolledCount} class(es).`);
        res.redirect('/teacher/advisory');
    } catch (err) {
        console.error('Approve student error:', err);
        setFlash(req, 'error', 'Failed to approve student.');
        res.redirect('/teacher/advisory');
    }
}

// ============================================================
// Adviser student-lifecycle helpers. Every handler below is
// adviser-only AND own-section-only: the target student must sit in
// the acting teacher's advisory_grade/advisory_section (compared
// case-insensitively, matching the DB collation). No teacher route
// deletes accounts or touches email/LRN (identity stays admin-only).
// ============================================================

async function getAdviser(teacherUserId) {
    const rows = await query('SELECT * FROM teachers WHERE user_id = ? LIMIT 1', [teacherUserId]);
    return rows[0] || null;
}

function sameSection(aGrade, aSection, bGrade, bSection) {
    const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
    return norm(aGrade) === norm(bGrade) && norm(aSection) === norm(bSection);
}

async function getScopedStudent(targetUserId) {
    const rows = await query(
        `SELECT u.id AS user_id, u.status, u.is_active, u.first_name, u.last_name, u.email,
                s.id AS student_profile_id, s.student_id AS lrn, s.grade_level, s.section, s.gender
         FROM users u
         JOIN students s ON s.user_id = u.id
         WHERE u.id = ? AND u.role = 'student'
         LIMIT 1`,
        [targetUserId]
    );
    return rows[0] || null;
}

// ---- Unified change-request helpers (email/LRN edit + deactivate) ----

const CHANGEABLE_EDIT_FIELDS = ['first_name', 'last_name', 'gender', 'email', 'lrn'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function summarizeChangePayload(type, payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    if (type === 'edit') {
        const bits = [];
        if (p.first_name !== undefined) bits.push(`first name → "${p.first_name}"`);
        if (p.last_name !== undefined) bits.push(`last name → "${p.last_name}"`);
        if (p.gender !== undefined) bits.push(`gender → ${p.gender}`);
        if (p.email !== undefined) bits.push(`email → ${p.email}`);
        if (p.lrn !== undefined) bits.push(`LRN → ${p.lrn}`);
        return bits.length > 0 ? bits.join(', ') : 'no field changes';
    }
    if (type === 'drop') return 'enrollments → dropped (grades kept)';
    if (type === 'restore') return 'enrollments → active';
    if (type === 'deactivate') return 'account → deactivated (records kept)';
    return type;
}

// Validate an edit payload against the target's CURRENT values.
// Returns { changes } (only actually-changed keys) or { error }.
// Email/LRN collisions are checked here so the admin never approves
// a request that would violate a UNIQUE constraint at apply time.
async function validateEditPayload(input, target) {
    const changes = {};
    const firstName = input.first_name !== undefined ? String(input.first_name).trim() : undefined;
    const lastName = input.last_name !== undefined ? String(input.last_name).trim() : undefined;
    const gender = input.gender !== undefined ? String(input.gender).trim() : undefined;
    const email = input.email !== undefined ? String(input.email).trim().toLowerCase() : undefined;
    const lrn = input.lrn !== undefined ? String(input.lrn).replace(/[\s-]/g, '') : undefined;

    if (firstName !== undefined && firstName !== target.first_name) {
        if (!firstName || firstName.length > 100) return { error: 'First name must be 1-100 characters.' };
        changes.first_name = firstName;
    }
    if (lastName !== undefined && lastName !== target.last_name) {
        if (!lastName || lastName.length > 100) return { error: 'Last name must be 1-100 characters.' };
        changes.last_name = lastName;
    }
    if (gender !== undefined && gender !== target.gender) {
        if (!['Male', 'Female', 'Other'].includes(gender)) return { error: 'Select a valid gender.' };
        changes.gender = gender;
    }
    if (email !== undefined && email !== String(target.email || '').toLowerCase()) {
        if (email.length > 150 || !EMAIL_RE.test(email)) return { error: 'Enter a valid email address.' };
        const dup = await query('SELECT id FROM users WHERE LOWER(email) = ? AND id <> ? LIMIT 1', [email, target.user_id]);
        if (dup.length > 0) return { error: 'That email address is already in use.' };
        changes.email = email;
    }
    if (lrn !== undefined && lrn !== String(target.lrn || '')) {
        if (!/^\d{12}$/.test(lrn)) return { error: 'LRN must be exactly 12 digits.' };
        const dup = await query('SELECT id FROM students WHERE student_id = ? AND user_id <> ? LIMIT 1', [lrn, target.user_id]);
        if (dup.length > 0) return { error: 'That LRN is already in use.' };
        changes.lrn = lrn;
    }
    if (Object.keys(changes).length === 0) return { error: 'No changes — the values match what is already on file.' };
    return { changes };
}

// File a unified change request (edit/drop/restore/deactivate) for an
// active student in the adviser's own section. NOTHING is applied —
// the request (with the teacher's mandatory note) waits in the admin
// queue. One pending request per student across BOTH queues.
async function requestChange(req, res) {
    try {
        const teacher = await getAdviser(req.session.user.id);
        if (!teacher || !teacher.is_adviser) {
            setFlash(req, 'error', 'Only class advisers can file change requests.');
            return res.redirect('/teacher/advisory');
        }
        const targetId = parseInt(req.params.id, 10);
        const target = await getScopedStudent(targetId);
        if (!target) {
            setFlash(req, 'error', 'Student not found.');
            return res.redirect('/teacher/advisory');
        }
        if (target.status !== 'active' || !sameSection(target.grade_level, target.section, teacher.advisory_grade, teacher.advisory_section)) {
            setFlash(req, 'error', 'You can only file requests for active students in your advisory section.');
            return res.redirect('/teacher/advisory');
        }

        const type = String(req.body?.request_type || '').trim();
        const teacherNote = String(req.body?.teacher_note || req.body?.reason || '').trim();
        if (!['edit', 'drop', 'restore', 'deactivate'].includes(type)) {
            setFlash(req, 'error', 'Select a valid request type.');
            return res.redirect('/teacher/advisory');
        }
        if (teacherNote.length < 10 || teacherNote.length > 500) {
            setFlash(req, 'error', 'Explain the reason (10-500 characters) so the admin knows what to decide.');
            return res.redirect('/teacher/advisory');
        }

        let payload = {};
        if (type === 'edit') {
            const { changes, error } = await validateEditPayload(req.body || {}, target);
            if (error) {
                setFlash(req, 'error', error);
                return res.redirect('/teacher/advisory');
            }
            payload = changes;
        }

        const dup = await query(
            `SELECT 'change' AS src FROM student_change_requests WHERE student_id = ? AND status = 'pending'
             UNION ALL
             SELECT 'transfer' AS src FROM section_transfer_requests WHERE student_id = ? AND status = 'pending'
             LIMIT 1`,
            [target.student_profile_id, target.student_profile_id]
        ).catch(() => []);
        if (dup.length > 0) {
            setFlash(req, 'error', 'This student already has a pending request. Wait for it to be decided first.');
            return res.redirect('/teacher/advisory');
        }

        await query(
            `INSERT INTO student_change_requests (student_id, request_type, payload, teacher_note, requested_by)
             VALUES (?, ?, ?, ?, ?)`,
            [target.student_profile_id, type, JSON.stringify(payload), teacherNote, req.session.user.id]
        );
        await query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, 'Change Requested', ?, 'teacher')`,
            [req.session.user.id, `Adviser requested ${type} for ${target.first_name} ${target.last_name} (user ID ${targetId}): ${summarizeChangePayload(type, payload)}. Note: ${teacherNote}`]
        );

        setFlash(req, 'success', `Request filed for ${target.first_name} ${target.last_name} — an admin will review your note and decide.`);
        res.redirect('/teacher/advisory');
    } catch (err) {
        console.error('Request change error:', err);
        setFlash(req, 'error', 'Failed to file the request.');
        res.redirect('/teacher/advisory');
    }
}

// Cancel my own still-pending unified change request.
async function cancelChange(req, res) {
    try {
        const requestId = parseInt(req.params.requestId, 10);
        const rows = await query(
            "SELECT id, requested_by FROM student_change_requests WHERE id = ? AND status = 'pending' LIMIT 1",
            [requestId]
        ).catch(() => []);
        if (rows.length === 0) {
            setFlash(req, 'error', 'Request not found or no longer pending.');
            return res.redirect('/teacher/advisory');
        }
        if (rows[0].requested_by !== req.session.user.id) {
            setFlash(req, 'error', 'Only the requesting adviser can cancel this request.');
            return res.redirect('/teacher/advisory');
        }
        await query("UPDATE student_change_requests SET status = 'cancelled' WHERE id = ?", [requestId]);
        await query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, 'Change Cancelled', ?, 'teacher')`,
            [req.session.user.id, `Adviser cancelled change request #${requestId}`]
        );
        setFlash(req, 'info', 'Request cancelled.');
        res.redirect('/teacher/advisory');
    } catch (err) {
        console.error('Cancel change error:', err);
        setFlash(req, 'error', 'Failed to cancel the request.');
        res.redirect('/teacher/advisory');
    }
}

// Reject a pending registration in the adviser's own section.
// Mirror of approveStudent: nothing exists yet (no grades/records),
// so a status flip + audit row is the entire operation.
async function rejectStudent(req, res) {
    try {
        const teacher = await getAdviser(req.session.user.id);
        if (!teacher || !teacher.is_adviser) {
            setFlash(req, 'error', 'Only class advisers can reject pending students.');
            return res.redirect('/teacher/advisory');
        }
        const targetId = parseInt(req.params.id, 10);
        const target = await getScopedStudent(targetId);
        if (!target) {
            setFlash(req, 'error', 'Student not found.');
            return res.redirect('/teacher/advisory');
        }
        if (target.status !== 'pending' || !sameSection(target.grade_level, target.section, teacher.advisory_grade, teacher.advisory_section)) {
            setFlash(req, 'error', 'You can only reject pending students in your advisory section.');
            return res.redirect('/teacher/advisory');
        }

        await query("UPDATE users SET status = 'rejected', is_active = 0 WHERE id = ?", [targetId]);
        await query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, 'Registration Rejected', ?, 'teacher')`,
            [req.session.user.id, `Adviser rejected registration for ${target.first_name} ${target.last_name} (user ID ${targetId})`]
        );

        setFlash(req, 'info', `Rejected registration for ${target.first_name} ${target.last_name}.`);
        res.redirect('/teacher/advisory');
    } catch (err) {
        console.error('Reject student error:', err);
        setFlash(req, 'error', 'Failed to reject student.');
        res.redirect('/teacher/advisory');
    }
}

// Correct an active student's display identity (first/last name +
// gender). Email/LRN/grade/section are NOT editable here: email+LRN
// are login/DepEd identity (admin-only), and a grade/section change
// is a transfer, not an edit (see requestTransfer below).
// NOTE: direct apply. The unified request-queue covers email/LRN +
// delete; trivial name/gender typo fixes stay one-click so advisers
// are not blocked on admin availability for SF1 corrections.
async function editStudent(req, res) {
    try {
        const teacher = await getAdviser(req.session.user.id);
        if (!teacher || !teacher.is_adviser) {
            setFlash(req, 'error', 'Only class advisers can edit student information.');
            return res.redirect('/teacher/advisory');
        }
        const targetId = parseInt(req.params.id, 10);
        const target = await getScopedStudent(targetId);
        if (!target) {
            setFlash(req, 'error', 'Student not found.');
            return res.redirect('/teacher/advisory');
        }
        if (target.status !== 'active' || !sameSection(target.grade_level, target.section, teacher.advisory_grade, teacher.advisory_section)) {
            setFlash(req, 'error', 'You can only edit active students in your advisory section.');
            return res.redirect('/teacher/advisory');
        }

        const firstName = String(req.body?.first_name || '').trim();
        const lastName = String(req.body?.last_name || '').trim();
        const gender = String(req.body?.gender || '').trim();
        if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) {
            setFlash(req, 'error', 'First and last name are required (max 100 characters).');
            return res.redirect('/teacher/advisory');
        }
        if (!['Male', 'Female', 'Other'].includes(gender)) {
            setFlash(req, 'error', 'Select a valid gender.');
            return res.redirect('/teacher/advisory');
        }

        await query('UPDATE users SET first_name = ?, last_name = ? WHERE id = ?', [firstName, lastName, targetId]);
        await query('UPDATE students SET gender = ? WHERE user_id = ?', [gender, targetId]);
        await query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, 'Edit Student', ?, 'teacher')`,
            [req.session.user.id, `Adviser edited ${target.first_name} ${target.last_name} (user ID ${targetId}) → ${firstName} ${lastName}, gender ${gender}`]
        );

        setFlash(req, 'success', `Updated information for ${firstName} ${lastName}.`);
        res.redirect('/teacher/advisory');
    } catch (err) {
        console.error('Edit student error:', err);
        setFlash(req, 'error', 'Failed to update student.');
        res.redirect('/teacher/advisory');
    }
}

// Drop an active student from the adviser's section classes.
// Reversible + non-destructive: enrollments flip to 'dropped', the
// account stays active, and every grade/submission/attempt is kept.
// A typed reason (min 10 chars) is required and audit-logged.
// NOTE: direct apply. The unified request-queue covers email/LRN +
// delete; an adviser must be able to remove a disruptive or
// transferred-out learner from today's class without waiting.
async function dropStudent(req, res) {
    try {
        const teacher = await getAdviser(req.session.user.id);
        if (!teacher || !teacher.is_adviser) {
            setFlash(req, 'error', 'Only class advisers can drop students from the section.');
            return res.redirect('/teacher/advisory');
        }
        const targetId = parseInt(req.params.id, 10);
        const target = await getScopedStudent(targetId);
        if (!target) {
            setFlash(req, 'error', 'Student not found.');
            return res.redirect('/teacher/advisory');
        }
        if (target.status !== 'active' || !sameSection(target.grade_level, target.section, teacher.advisory_grade, teacher.advisory_section)) {
            setFlash(req, 'error', 'You can only drop active students in your advisory section.');
            return res.redirect('/teacher/advisory');
        }
        const reason = String(req.body?.reason || '').trim();
        if (reason.length < 10) {
            setFlash(req, 'error', 'Dropping a student requires a reason of at least 10 characters.');
            return res.redirect('/teacher/advisory');
        }

        const r = await query(
            `UPDATE enrollments SET status = 'dropped'
             WHERE student_id = ? AND status = 'active'`,
            [target.student_profile_id]
        );
        await query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, 'Drop Student', ?, 'teacher')`,
            [req.session.user.id, `Adviser dropped ${target.first_name} ${target.last_name} (user ID ${targetId}) from ${target.grade_level} - ${target.section} (${r.affectedRows} enrollment(s)). Reason: ${reason} (reversible; grades preserved)`]
        );

        setFlash(req, 'success', `Dropped ${target.first_name} ${target.last_name} from the section (${r.affectedRows} class(es)). Grades preserved — reversible.`);
        res.redirect('/teacher/advisory');
    } catch (err) {
        console.error('Drop student error:', err);
        setFlash(req, 'error', 'Failed to drop student.');
        res.redirect('/teacher/advisory');
    }
}

// Restore a previously dropped student (flip their section enrollments
// back to active + re-run auto-enroll for any new matching classes).
// NOTE: direct apply, same rationale as dropStudent above.
async function restoreStudent(req, res) {
    try {
        const teacher = await getAdviser(req.session.user.id);
        if (!teacher || !teacher.is_adviser) {
            setFlash(req, 'error', 'Only class advisers can restore dropped students.');
            return res.redirect('/teacher/advisory');
        }
        const targetId = parseInt(req.params.id, 10);
        const target = await getScopedStudent(targetId);
        if (!target) {
            setFlash(req, 'error', 'Student not found.');
            return res.redirect('/teacher/advisory');
        }
        if (target.status !== 'active' || !sameSection(target.grade_level, target.section, teacher.advisory_grade, teacher.advisory_section)) {
            setFlash(req, 'error', 'You can only restore students in your advisory section.');
            return res.redirect('/teacher/advisory');
        }

        await query(
            `UPDATE enrollments SET status = 'active'
             WHERE student_id = ? AND status = 'dropped'`,
            [target.student_profile_id]
        );
        const enrollmentService = require('../services/enrollmentService');
        const added = await enrollmentService.autoEnrollStudent(target.student_profile_id);
        await query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, 'Restore Student', ?, 'teacher')`,
            [req.session.user.id, `Adviser restored ${target.first_name} ${target.last_name} (user ID ${targetId}) to ${target.grade_level} - ${target.section} (${added} new enrollment(s))`]
        );

        setFlash(req, 'success', `Restored ${target.first_name} ${target.last_name} to the section.`);
        res.redirect('/teacher/advisory');
    } catch (err) {
        console.error('Restore student error:', err);
        setFlash(req, 'error', 'Failed to restore student.');
        res.redirect('/teacher/advisory');
    }
}

// File a section-transfer request for an active student in the
// adviser's own section. The student STAYS PUT until BOTH the
// receiving adviser and an admin approve (either order). One pending
// request per student — duplicates are rejected. Destination grade is
// whitelist-checked (7-12) and the section is canonicalized so the
// executed move lands on the exact known spelling.
async function requestTransfer(req, res) {
    try {
        const sectionService = require('../services/sectionService');
        const teacher = await getAdviser(req.session.user.id);
        if (!teacher || !teacher.is_adviser) {
            setFlash(req, 'error', 'Only class advisers can request section transfers.');
            return res.redirect('/teacher/advisory');
        }
        const targetId = parseInt(req.params.id, 10);
        const target = await getScopedStudent(targetId);
        if (!target) {
            setFlash(req, 'error', 'Student not found.');
            return res.redirect('/teacher/advisory');
        }
        if (target.status !== 'active' || !sameSection(target.grade_level, target.section, teacher.advisory_grade, teacher.advisory_section)) {
            setFlash(req, 'error', 'You can only request transfers for active students in your advisory section.');
            return res.redirect('/teacher/advisory');
        }

        const toGrade = sectionService.cleanStudentGrade(req.body?.to_grade);
        const rawSection = sectionService.cleanSection(req.body?.to_section);
        const reason = String(req.body?.reason || '').trim();
        if (!toGrade || !rawSection) {
            setFlash(req, 'error', 'Select the destination grade level and section.');
            return res.redirect('/teacher/advisory');
        }
        if (sameSection(target.grade_level, target.section, toGrade, rawSection)) {
            setFlash(req, 'error', 'The student is already in that section.');
            return res.redirect('/teacher/advisory');
        }
        if (reason.length < 10) {
            setFlash(req, 'error', 'A transfer request requires a reason of at least 10 characters.');
            return res.redirect('/teacher/advisory');
        }
        const toSection = await sectionService.canonicalizeSection(toGrade, rawSection);

        const dup = await query(
            "SELECT id FROM section_transfer_requests WHERE student_id = ? AND status = 'pending' LIMIT 1",
            [target.student_profile_id]
        );
        if (dup.length > 0) {
            setFlash(req, 'error', 'This student already has a pending transfer request.');
            return res.redirect('/teacher/advisory');
        }

        await query(
            `INSERT INTO section_transfer_requests
                (student_id, from_grade, from_section, to_grade, to_section, requested_by, reason)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [target.student_profile_id, target.grade_level, target.section, toGrade, toSection, req.session.user.id, reason]
        );
        await query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, 'Transfer Requested', ?, 'teacher')`,
            [req.session.user.id, `Adviser requested transfer of ${target.first_name} ${target.last_name} (user ID ${targetId}) from ${target.grade_level} - ${target.section} to ${toGrade} - ${toSection}. Reason: ${reason}`]
        );

        setFlash(req, 'success', `Transfer requested for ${target.first_name} ${target.last_name} → ${toGrade} - ${toSection}. Needs receiving-adviser + admin approval.`);
        res.redirect('/teacher/advisory');
    } catch (err) {
        console.error('Request transfer error:', err);
        setFlash(req, 'error', 'Failed to file the transfer request.');
        res.redirect('/teacher/advisory');
    }
}

// Receiving-adviser decision on an incoming transfer (destination =
// MY advisory section). A rejection kills the request immediately; an
// approval records my half — execution waits for the admin's half.
async function decideIncomingTransfer(req, res) {
    try {
        const teacher = await getAdviser(req.session.user.id);
        if (!teacher || !teacher.is_adviser) {
            setFlash(req, 'error', 'Only class advisers can decide incoming transfers.');
            return res.redirect('/teacher/advisory');
        }
        const requestId = parseInt(req.params.requestId, 10);
        const decision = req.body?.decision === 'approved' ? 'approved' : 'rejected';
        const decisionReason = String(req.body?.decision_reason || req.body?.reason || '').trim();

        const rows = await query(
            `SELECT tr.*, s.grade_level AS cur_grade, s.section AS cur_section,
                    u.first_name, u.last_name
             FROM section_transfer_requests tr
             JOIN students s ON tr.student_id = s.id
             JOIN users u ON s.user_id = u.id
             WHERE tr.id = ? AND tr.status = 'pending'
             LIMIT 1`,
            [requestId]
        );
        if (rows.length === 0) {
            setFlash(req, 'error', 'Transfer request not found or no longer pending.');
            return res.redirect('/teacher/advisory');
        }
        const tr = rows[0];
        // I am the receiver only if the destination matches my advisory.
        if (!sameSection(tr.to_grade, tr.to_section, teacher.advisory_grade, teacher.advisory_section)) {
            setFlash(req, 'error', 'This transfer is not addressed to your section.');
            return res.redirect('/teacher/advisory');
        }
        if (decision === 'rejected' && decisionReason.length < 10) {
            setFlash(req, 'error', 'Rejecting a transfer requires a reason of at least 10 characters.');
            return res.redirect('/teacher/advisory');
        }

        if (decision === 'rejected') {
            await query(
                `UPDATE section_transfer_requests
                 SET status = 'rejected', receiver_decided_by = ?, receiver_decision = 'rejected',
                     receiver_decided_at = NOW(), decision_reason = ?
                 WHERE id = ?`,
                [req.session.user.id, decisionReason, requestId]
            );
            await query(
                `INSERT INTO activity_logs (user_id, action, description, category)
                 VALUES (?, 'Transfer Rejected', ?, 'teacher')`,
                [req.session.user.id, `Receiving adviser rejected transfer of ${tr.first_name} ${tr.last_name} → ${tr.to_grade} - ${tr.to_section}. Reason: ${decisionReason}`]
            );
            setFlash(req, 'info', `Transfer for ${tr.first_name} ${tr.last_name} rejected.`);
            return res.redirect('/teacher/advisory');
        }

        await query(
            `UPDATE section_transfer_requests
             SET receiver_decided_by = ?, receiver_decision = 'approved', receiver_decided_at = NOW()
             WHERE id = ?`,
            [req.session.user.id, requestId]
        );
        // If the admin already approved, my approval completes the pair —
        // execute the move now.
        const updated = await query('SELECT admin_decision FROM section_transfer_requests WHERE id = ? LIMIT 1', [requestId]);
        if (updated[0] && updated[0].admin_decision === 'approved') {
            await executeTransfer(requestId, req.session.user.id, 'Receiving adviser completed dual approval');
        } else {
            await query(
                `INSERT INTO activity_logs (user_id, action, description, category)
                 VALUES (?, 'Transfer Approved (Receiver)', ?, 'teacher')`,
                [req.session.user.id, `Receiving adviser approved transfer of ${tr.first_name} ${tr.last_name} → ${tr.to_grade} - ${tr.to_section}. Waiting on admin approval.`]
            );
        }
        setFlash(req, 'success', `Transfer for ${tr.first_name} ${tr.last_name} approved. ${updated[0] && updated[0].admin_decision === 'approved' ? 'Move executed.' : 'Waiting on admin approval.'}`);
        res.redirect('/teacher/advisory');
    } catch (err) {
        console.error('Decide incoming transfer error:', err);
        setFlash(req, 'error', 'Failed to decide the transfer.');
        res.redirect('/teacher/advisory');
    }
}

// Cancel my own still-pending outgoing request (sender side).
async function cancelTransfer(req, res) {
    try {
        const requestId = parseInt(req.params.requestId, 10);
        const rows = await query(
            "SELECT id, requested_by, status FROM section_transfer_requests WHERE id = ? AND status = 'pending' LIMIT 1",
            [requestId]
        );
        if (rows.length === 0) {
            setFlash(req, 'error', 'Transfer request not found or no longer pending.');
            return res.redirect('/teacher/advisory');
        }
        if (rows[0].requested_by !== req.session.user.id) {
            setFlash(req, 'error', 'Only the requesting adviser can cancel this transfer.');
            return res.redirect('/teacher/advisory');
        }
        await query("UPDATE section_transfer_requests SET status = 'cancelled' WHERE id = ?", [requestId]);
        await query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, 'Transfer Cancelled', ?, 'teacher')`,
            [req.session.user.id, `Adviser cancelled section-transfer request #${requestId}`]
        );
        setFlash(req, 'info', 'Transfer request cancelled.');
        res.redirect('/teacher/advisory');
    } catch (err) {
        console.error('Cancel transfer error:', err);
        setFlash(req, 'error', 'Failed to cancel the transfer.');
        res.redirect('/teacher/advisory');
    }
}

// Execute a dual-approved transfer: update identity, drop old-section
// enrollments, enroll into every new-section class. Shared by the
// teacher-side (receiver completes) and admin-side (admin completes)
// paths so the move is identical whoever approves last.
async function executeTransfer(requestId, executorUserId, executorLabel) {
    const rows = await query(
        `SELECT tr.*, s.grade_level AS cur_grade, s.section AS cur_section, s.id AS sid,
                u.id AS uid, u.first_name, u.last_name
         FROM section_transfer_requests tr
         JOIN students s ON tr.student_id = s.id
         JOIN users u ON s.user_id = u.id
         WHERE tr.id = ? AND tr.status = 'pending'
         LIMIT 1`,
        [requestId]
    );
    if (rows.length === 0) return { ok: false };
    const tr = rows[0];

    await query('UPDATE students SET grade_level = ?, section = ? WHERE id = ?', [tr.to_grade, tr.to_section, tr.sid]);
    await query("UPDATE enrollments SET status = 'dropped' WHERE student_id = ? AND status = 'active'", [tr.sid]);
    const enrollmentService = require('../services/enrollmentService');
    const added = await enrollmentService.autoEnrollStudent(tr.sid);
    await query(
        `UPDATE section_transfer_requests SET status = 'approved' WHERE id = ?`,
        [requestId]
    );
    await query(
        `INSERT INTO activity_logs (user_id, action, description, category)
         VALUES (?, 'Transfer Executed', ?, 'teacher')`,
        [executorUserId, `${executorLabel}: moved ${tr.first_name} ${tr.last_name} (user ID ${tr.uid}) from ${tr.from_grade} - ${tr.from_section} to ${tr.to_grade} - ${tr.to_section} (${added} new enrollment(s); grades preserved)`]
    );
    return { ok: true, added, firstName: tr.first_name, lastName: tr.last_name };
}

async function lessonGenerator(req, res) {
    // Phase 0.2: admin kill-switch (system_settings.allow_ai_lesson).
    if (res.locals.school && res.locals.school.flags && res.locals.school.flags.allowAiLesson === false) {
        setFlash(req, 'info', 'The AI Lesson Generator is currently disabled by the school administrator.');
        return res.redirect('/teacher/dashboard');
    }
    try {
        const teacherUserId = req.session.user.id;
        const teacherClasses = await query(
            'SELECT id, class_name, subject, grade_level, section FROM classes WHERE teacher_id = ? AND is_active = 1',
            [teacherUserId]
        );
        // Self-declared teaching assignment (nullable until backfilled/admin-set).
        let teacherProfile = null;
        try {
            const prof = await query(
                'SELECT grade_level, section FROM teachers WHERE user_id = ? LIMIT 1',
                [teacherUserId]
            );
            teacherProfile = prof.length > 0 ? prof[0] : null;
        } catch { teacherProfile = null; }

        res.render('teacher/lesson-generator', {
            title: 'AI Lesson Discussion Deck | EduShare',
            classes: teacherClasses,
            teacherProfile
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
            title: 'AI Quiz Maker | EduShare',
            classes: teacherClasses,
            quizzes: myQuizzes,
            competencies: await query('SELECT code, description, term FROM competencies ORDER BY code ASC'),
            teacherProfile: await query(
                'SELECT grade_level, section FROM teachers WHERE user_id = ? LIMIT 1',
                [teacherUserId]
            ).then(r => (r.length > 0 ? r[0] : null)).catch(() => null)
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
    approveStudent,
    rejectStudent,
    editStudent,
    dropStudent,
    restoreStudent,
    requestTransfer,
    decideIncomingTransfer,
    cancelTransfer,
    requestChange,
    cancelChange,
    executeTransfer,
    lessonGenerator,
    quizMaker
};
