// ============================================================
// Phase 1 — Academic oversight (read-only).
// Same SELECTs as the teacher side minus the `teacher_id = ?`
// ownership clause. No mutations here; every destructive or
// intervention power stays in Phase 2. File downloads resolve
// through the /files admin bypass (see src/routes/filesRoutes.js).
// ============================================================
const { query } = require('../config/database');
const { setFlash } = require('../middleware/branding');

async function classes(req, res) {
    try {
        const q = req.query.q ? `%${req.query.q.trim()}%` : null;
        const grade = req.query.grade || 'all';
        const hideEmpty = req.query.hideEmpty === '1';

        let sql = `
            SELECT c.*, u.first_name AS teacher_first, u.last_name AS teacher_last, u.email AS teacher_email,
                   (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = c.id AND e.status = 'active') AS student_count,
                   (SELECT COUNT(*) FROM class_materials cm WHERE cm.class_id = c.id) AS material_count,
                   (SELECT COUNT(*) FROM activity_posts ap WHERE ap.class_id = c.id) AS activity_count,
                   (SELECT COUNT(*) FROM section_quizzes sq WHERE sq.class_id = c.id) AS quiz_count
            FROM classes c
            JOIN users u ON c.teacher_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (grade !== 'all') {
            sql += ' AND c.grade_level = ?';
            params.push(grade);
        }

        if (q) {
            sql += ' AND (c.class_name LIKE ? OR c.class_code LIKE ? OR c.subject LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)';
            params.push(q, q, q, q, q);
        }

        if (hideEmpty) {
            sql += ` AND EXISTS (SELECT 1 FROM enrollments e WHERE e.class_id = c.id AND e.status = 'active')`;
        }

        sql += ' ORDER BY c.grade_level ASC, c.subject ASC, c.section ASC, c.is_active DESC, c.created_at DESC';

        const classList = await query(sql, params);
        const gradeRows = await query('SELECT DISTINCT grade_level FROM classes ORDER BY grade_level ASC');

        // Group rows by grade for the collapsible grouped table.
        // Groups preserve Subject → Section order from the query above.
        const groups = [];
        const groupIndex = new Map();
        for (const c of classList) {
            const key = c.grade_level || 'Ungraded';
            if (!groupIndex.has(key)) {
                groupIndex.set(key, groups.length);
                groups.push({ grade: key, classes: [], classCount: 0, studentCount: 0, teacherSet: new Set(), emptyCount: 0 });
            }
            const g = groups[groupIndex.get(key)];
            g.classes.push(c);
            g.classCount += 1;
            g.studentCount += Number(c.student_count) || 0;
            g.teacherSet.add(c.teacher_id);
            if ((Number(c.student_count) || 0) === 0) g.emptyCount += 1;
        }
        for (const g of groups) {
            g.teacherCount = g.teacherSet.size;
            delete g.teacherSet;
        }

        // Coverage signals: active classes with zero students, and
        // sections known from students/teachers with no active class.
        // "Known sections" = distinct grade/section pairs from active
        // students + active advisers (same vocabulary as the section
        // autocomplete), minus pairs that have an active class.
        let coverageGaps = [];
        try {
            const knownPairs = await query(
                `SELECT grade_level, section FROM (
                    SELECT s.grade_level, s.section FROM students s
                    JOIN users u ON s.user_id = u.id
                    WHERE u.status = 'active' AND u.is_active = 1
                    UNION
                    SELECT t.advisory_grade AS grade_level, t.advisory_section AS section
                    FROM teachers t JOIN users u ON t.user_id = u.id
                    WHERE t.is_adviser = 1 AND t.advisory_grade IS NOT NULL
                      AND t.advisory_section IS NOT NULL
                      AND u.status = 'active' AND u.is_active = 1
                 ) k GROUP BY grade_level, section`
            );
            const activePairs = await query(
                `SELECT grade_level, section FROM classes WHERE is_active = 1 GROUP BY grade_level, section`
            );
            const activeSet = new Set(activePairs.map((r) => `${String(r.grade_level).trim().toLowerCase()}|${String(r.section).trim().toLowerCase()}`));
            coverageGaps = knownPairs
                .filter((r) => r.grade_level && r.section)
                .filter((r) => !activeSet.has(`${String(r.grade_level).trim().toLowerCase()}|${String(r.section).trim().toLowerCase()}`))
                .map((r) => ({ grade_level: r.grade_level, section: r.section }));
        } catch {
            coverageGaps = [];
        }

        const { ensureToken } = require('../middleware/csrf');
        ensureToken(req);

        res.render('admin/classes', {
            title: 'Academic Oversight — Classes | EduShare',
            classes: classList,
            groups,
            grades: gradeRows.map(r => r.grade_level),
            selectedGrade: grade,
            searchQuery: req.query.q || '',
            hideEmpty,
            coverageGaps,
            csrfToken: req.session.csrfToken
        });
    } catch (err) {
        console.error('Admin classes error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function classDetail(req, res) {
    try {
        const classId = parseInt(req.params.id, 10);
        if (!Number.isInteger(classId) || classId <= 0) {
            setFlash(req, 'error', 'Class not found.');
            return res.redirect('/admin/classes');
        }

        const classRows = await query(
            `SELECT c.*, u.first_name AS teacher_first, u.last_name AS teacher_last, u.email AS teacher_email
             FROM classes c
             JOIN users u ON c.teacher_id = u.id
             WHERE c.id = ?`,
            [classId]
        );
        if (classRows.length === 0) {
            setFlash(req, 'error', 'Class not found.');
            return res.redirect('/admin/classes');
        }
        const cls = classRows[0];

        // Same five SELECTs as teacherController.classDetail, minus ownership.
        // Deliberately no availableLibrary query: posting is a Phase 2 power.
        const materials = await query(
            `SELECT cm.id AS post_id, cm.posted_at, li.*
             FROM class_materials cm
             JOIN library_items li ON cm.library_item_id = li.id
             WHERE cm.class_id = ?
             ORDER BY cm.posted_at DESC`,
            [classId]
        );

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

        const quizzes = await query(
            `SELECT q.*, sq.is_published, sq.start_time, sq.end_time,
                    (SELECT COUNT(*) FROM quiz_attempts WHERE quiz_id = q.id AND class_id = ?) AS attempt_count
             FROM quizzes q
             JOIN section_quizzes sq ON q.id = sq.quiz_id
             WHERE sq.class_id = ?
             ORDER BY q.created_at DESC`,
            [classId, classId]
        );

        const announcements = await query(
            `SELECT a.*,
                    (SELECT COUNT(*) FROM announcement_reads WHERE announcement_id = a.id) AS read_count
             FROM announcements a
             WHERE a.class_id = ?
             ORDER BY a.is_pinned DESC, a.created_at DESC`,
            [classId]
        );

        const students = await query(
            `SELECT s.id AS student_profile_id, s.student_id AS lrn, s.gender, s.grade_level, s.section,
                    u.id AS user_id, u.first_name, u.last_name, u.email, u.avatar_url, e.enrollment_date, e.status AS enrollment_status, e.id AS enrollment_id
             FROM enrollments e
             JOIN students s ON e.student_id = s.id
             JOIN users u ON s.user_id = u.id
             WHERE e.class_id = ?
             ORDER BY e.status ASC, s.gender DESC, u.last_name ASC, u.first_name ASC`,
            [classId]
        );

        // Phase 2: intervention context — active-teacher list for transfer,
        // other active classes for enrollment moves, recent interventions.
        const activeTeachers = await query(
            `SELECT id, first_name, last_name, email FROM users
             WHERE role = 'teacher' AND status = 'active' AND is_active = 1 AND id <> ?
             ORDER BY last_name ASC, first_name ASC`,
            [cls.teacher_id]
        );
        const otherClasses = await query(
            `SELECT id, class_name, class_code FROM classes WHERE is_active = 1 AND id <> ? ORDER BY class_name ASC`,
            [classId]
        );
        const interventions = await query(
            `SELECT al.action, al.description, al.created_at, u.first_name, u.last_name
             FROM activity_logs al JOIN users u ON al.user_id = u.id
             WHERE al.description LIKE ? OR al.description LIKE ?
             ORDER BY al.created_at DESC LIMIT 5`,
            [`%(${cls.class_code})%`, `%${cls.class_name}%`]
        );

        const { ensureToken } = require('../middleware/csrf');
        ensureToken(req);

        res.render('admin/class-detail', {
            title: `${cls.class_name} (Oversight) | EduShare`,
            cls,
            materials,
            activities,
            quizzes,
            announcements,
            students,
            activeTab: req.query.tab || 'materials',
            activeTeachers,
            otherClasses,
            interventions,
            csrfToken: req.session.csrfToken
        });
    } catch (err) {
        console.error('Admin class detail error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function gradebook(req, res) {
    try {
        const gradebookService = require('../services/gradebookService');
        const classList = await query(
            `SELECT c.id, c.class_name, c.subject, c.grade_level, c.section, c.class_code,
                    (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = c.id AND e.status = 'active') AS student_count,
                    u.first_name AS teacher_first, u.last_name AS teacher_last
             FROM classes c
             JOIN users u ON c.teacher_id = u.id
             WHERE c.is_active = 1
             ORDER BY c.grade_level ASC, c.subject ASC, c.section ASC, c.class_name ASC`
        );

        // Grouped selector: grade → classes (same ordering as the
        // classes oversight page) so the dropdown mirrors that page.
        const gbGroups = [];
        const gbIndex = new Map();
        for (const c of classList) {
            const key = c.grade_level || 'Ungraded';
            if (!gbIndex.has(key)) {
                gbIndex.set(key, gbGroups.length);
                gbGroups.push({ grade: key, classes: [] });
            }
            gbGroups[gbIndex.get(key)].classes.push(c);
        }

        // View-model guard: the ECR template's step-1/2 blocks reference
        // `selectedClass` inside conditions. On those steps the variable
        // is null — but EJS evaluates `cond && selectedClass` left to
        // right... except the project's EJS build parses a bare
        // `selectedClass` reference in ANY position as fatal at compile
        // time (see note in gradebook.ejs). So always pass a defined
        // object: empty shells on steps 1-2, real row on step 3.
        const noClass = { id: 0, class_name: '', subject: '', grade_level: '', section: '', class_code: '', teacher_first: '', teacher_last: '' };

        if (classList.length === 0) {
            return res.render('admin/gradebook', {
                title: 'Gradebooks (Oversight) | EduShare',
                classes: [],
                classGroups: [],
                view: 'empty',
                selectedGrade: null,
                gradeGroups: [],
                selectedClass: noClass,
                gradebookData: null,
                students: [],
                overrideSet: []
            });
        }

        // 3-step drill-down: no classId → grade grid (step 1), UNLESS
        // there is exactly one class (today's reality) — then open its
        // ECR directly so the single-class behavior is unchanged.
        // grade=Grade+X → section list with stats (step 2).
        // classId=N → full ECR (step 3).
        const requestedClassId = parseInt(req.query.classId, 10);
        const requestedGrade = typeof req.query.grade === 'string' ? req.query.grade.trim() : '';

        const renderShell = (extra) => res.render('admin/gradebook', {
            title: 'Gradebooks (Oversight) | EduShare',
            classes: classList,
            classGroups: gbGroups,
            view: 'grades',
            selectedGrade: null,
            gradeGroups: [],
            selectedClass: noClass,
            gradebookData: null,
            students: [],
            overrideSet: [],
            csrfToken: require('../middleware/csrf').ensureToken(req),
            ...extra
        });

        if (!Number.isInteger(requestedClassId) || requestedClassId <= 0) {
            if (classList.length === 1 && !requestedGrade) {
                // Single-class fast path: identical to the old behavior.
                return renderECR(req, res, classList, gbGroups, classList[0]);
            }
            if (requestedGrade) {
                const group = gbGroups.find((g) => g.grade === requestedGrade);
                if (!group) {
                    return renderShell({ view: 'grades' });
                }
                // Step 2: per-section stats for this grade (worst-first).
                const overviews = await gradebookService.getOverviewForClasses(group.classes.map((c) => c.id));
                const byId = new Map(overviews.map((o) => [o.classId, o]));
                const sections = group.classes.map((c) => ({ ...c, stats: byId.get(c.id) || null }));
                sections.sort((a, b) => {
                    const ar = a.stats?.passRate ?? 101;
                    const br = b.stats?.passRate ?? 101;
                    if (ar !== br) return ar - br;
                    return (b.stats?.failed || 0) - (a.stats?.failed || 0);
                });
                const totals = sections.reduce((t, s) => {
                    t.enrolled += s.stats?.enrolled || 0;
                    t.passed += s.stats?.passed || 0;
                    t.failed += s.stats?.failed || 0;
                    return t;
                }, { enrolled: 0, passed: 0, failed: 0 });
                return renderShell({ view: 'sections', selectedGrade: requestedGrade, gradeGroups: gbGroups, sections, totals });
            }
            // Step 1: grade grid with per-grade rollups.
            const gradeGroups = [];
            for (const g of gbGroups) {
                const overviews = await gradebookService.getOverviewForClasses(g.classes.map((c) => c.id));
                let enrolled = 0, passed = 0, failed = 0, empty = 0, noScores = 0;
                for (const o of overviews) {
                    enrolled += o.enrolled; passed += o.passed; failed += o.failed;
                    if (o.enrolled === 0) empty += 1;
                    else if (!o.hasScores) noScores += 1;
                }
                gradeGroups.push({
                    grade: g.grade,
                    classCount: g.classes.length,
                    enrolled, passed, failed,
                    passRate: enrolled > 0 ? Math.round((passed / enrolled) * 100) : null,
                    empty, noScores
                });
            }
            return renderShell({ view: 'grades', gradeGroups });
        }

        const selectedClass = classList.find(c => c.id === requestedClassId) || null;
        if (!selectedClass) {
            return renderShell({ view: 'grades' });
        }
        return renderECR(req, res, classList, gbGroups, selectedClass, requestedGrade || selectedClass.grade_level);
    } catch (err) {
        console.error('Admin gradebook error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

// Step 3 renderer: the full ECR drill-down for one class. Shared by
// the single-class fast path and explicit ?classId= navigation.
// backGrade keeps the breadcrumb/tabs pointed at the section list the
// admin came from (falls back to the class's own grade).
async function renderECR(req, res, classList, gbGroups, selectedClass, backGrade) {
    const gradebookService = require('../services/gradebookService');
    const gradebookData = await gradebookService.getClassGradebook(selectedClass.id);

    // Phase 2.3: correction context — students + columns for the modal,
    // plus override flags so admin edits render distinctly.
    const students = await query(
        `SELECT s.id, u.first_name, u.last_name
         FROM enrollments e
         JOIN students s ON e.student_id = s.id
         JOIN users u ON s.user_id = u.id
         WHERE e.class_id = ? AND e.status = 'active'
         ORDER BY u.last_name ASC, u.first_name ASC`,
        [selectedClass.id]
    );
    const overrides = await query(
        `SELECT ge.column_id, ge.student_id FROM gradebook_entries ge
         JOIN gradebook_columns gc ON ge.column_id = gc.id
         WHERE gc.class_id = ? AND ge.manual_override = 1`,
        [selectedClass.id]
    );
    const overrideSet = new Set(overrides.map((o) => `${o.column_id}:${o.student_id}`));

    const { ensureToken } = require('../middleware/csrf');
    ensureToken(req);

    res.render('admin/gradebook', {
        title: `E-Class Record (Oversight): ${selectedClass.class_name} | EduShare`,
        classes: classList,
        classGroups: gbGroups,
        view: 'ecr',
        selectedGrade: backGrade || selectedClass.grade_level,
        gradeGroups: [],
        selectedClass,
        gradebookData,
        students,
        overrideSet: [...overrideSet],
        csrfToken: req.session.csrfToken
    });
}

async function exportGradebook(req, res) {
    try {
        const exportService = require('../services/exportService');
        const gradebookService = require('../services/gradebookService');
        // Batch A3: POST-only export (route POST /admin/gradebook/export) —
        // classId comes from the form body, never from a GET URL.
        const classId = parseInt(req.body.class_id, 10);
        if (!Number.isInteger(classId) || classId <= 0) {
            setFlash(req, 'error', 'Select a class to export.');
            return res.redirect('/admin/gradebook');
        }
        const [cls] = await query('SELECT * FROM classes WHERE id = ?', [classId]);
        if (!cls) return res.status(404).send('Class not found');

        const gradebookData = await gradebookService.getClassGradebook(classId);
        const csvContent = exportService.generateGradebookCSV(gradebookData, cls.class_name);

        await query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, 'Export Gradebook', ?, 'admin')`,
            [req.session.user.id, `Exported E-Class Record CSV for ${cls.class_name} (${cls.class_code})`]
        );

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="Gradebook-${cls.class_code}.csv"`);
        res.send(csvContent);
    } catch (err) {
        console.error('Admin export gradebook error:', err);
        res.status(500).send('Error exporting gradebook');
    }
}

// Batch A3: thin POST wrapper preserving the adminController.* interface.
async function exportGradebookPost(req, res) {
    return exportGradebook(req, res);
}

async function quizDetail(req, res) {
    try {
        const quizId = parseInt(req.params.quizId, 10);
        if (!Number.isInteger(quizId) || quizId <= 0) {
            setFlash(req, 'error', 'Quiz not found.');
            return res.redirect('/admin/classes');
        }

        const quizRows = await query(
            `SELECT q.*, u.first_name AS teacher_first, u.last_name AS teacher_last
             FROM quizzes q
             JOIN users u ON q.teacher_id = u.id
             WHERE q.id = ?`,
            [quizId]
        );
        if (quizRows.length === 0) {
            setFlash(req, 'error', 'Quiz not found.');
            return res.redirect('/admin/classes');
        }

        const questions = await query(
            `SELECT qq.*, qo.id AS option_id, qo.option_text, qo.is_correct, qo.order_index AS option_order
             FROM quiz_questions qq
             LEFT JOIN quiz_options qo ON qo.question_id = qq.id
             WHERE qq.quiz_id = ?
             ORDER BY qq.order_index ASC, qo.order_index ASC`,
            [quizId]
        );

        const postings = await query(
            `SELECT sq.*, c.class_name, c.class_code
             FROM section_quizzes sq
             JOIN classes c ON sq.class_id = c.id
             WHERE sq.quiz_id = ?`,
            [quizId]
        );

        const attempts = await query(
            `SELECT qa.*, c.class_name, u.first_name, u.last_name, s.student_id AS lrn
             FROM quiz_attempts qa
             JOIN students s ON qa.student_id = s.id
             JOIN users u ON s.user_id = u.id
             JOIN classes c ON qa.class_id = c.id
             WHERE qa.quiz_id = ?
             ORDER BY qa.completed_at DESC LIMIT 100`,
            [quizId]
        );

        res.render('admin/quiz-detail', {
            title: `Quiz (Oversight): ${quizRows[0].title} | EduShare`,
            quiz: quizRows[0],
            questions,
            postings,
            attempts,
            csrfToken: require('../middleware/csrf').ensureToken(req)
        });
    } catch (err) {
        console.error('Admin quiz detail error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function activityDetail(req, res) {
    try {
        const activityId = parseInt(req.params.activityId, 10);
        if (!Number.isInteger(activityId) || activityId <= 0) {
            setFlash(req, 'error', 'Activity not found.');
            return res.redirect('/admin/classes');
        }

        const actRows = await query(
            `SELECT ca.*, u.first_name AS teacher_first, u.last_name AS teacher_last
             FROM class_activities ca
             JOIN users u ON ca.teacher_id = u.id
             WHERE ca.id = ?`,
            [activityId]
        );
        if (actRows.length === 0) {
            setFlash(req, 'error', 'Activity not found.');
            return res.redirect('/admin/classes');
        }

        const postings = await query(
            `SELECT ap.*, c.class_name, c.class_code
             FROM activity_posts ap
             JOIN classes c ON ap.class_id = c.id
             WHERE ap.activity_id = ?`,
            [activityId]
        );

        const submissions = await query(
            `SELECT sub.*, c.class_name, u.first_name, u.last_name, s.student_id AS lrn
             FROM activity_submissions sub
             JOIN students s ON sub.student_id = s.id
             JOIN users u ON s.user_id = u.id
             JOIN classes c ON sub.class_id = c.id
             WHERE sub.activity_id = ?
             ORDER BY sub.submitted_at DESC LIMIT 100`,
            [activityId]
        );

        res.render('admin/activity-detail', {
            title: `Activity (Oversight): ${actRows[0].title} | EduShare`,
            activity: actRows[0],
            postings,
            submissions,
            csrfToken: require('../middleware/csrf').ensureToken(req)
        });
    } catch (err) {
        console.error('Admin activity detail error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function userDetail(req, res) {
    try {
        const userId = parseInt(req.params.id, 10);
        if (!Number.isInteger(userId) || userId <= 0) {
            setFlash(req, 'error', 'User not found.');
            return res.redirect('/admin/users');
        }

        // Explicit columns only: password_hash must never reach the view.
        const userRows = await query(
            `SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.is_active, u.status,
                    u.force_password_change, u.avatar_url, u.last_login, u.created_at, u.updated_at,
                    s.id AS student_profile_id, s.student_id AS lrn, s.grade_level, s.section, s.gender,
                    t.id AS teacher_profile_id, t.employee_id, t.department, t.specialization,
                    t.grade_level AS teacher_grade, t.section AS teacher_section,
                    t.is_adviser, t.advisory_grade, t.advisory_section
             FROM users u
             LEFT JOIN students s ON u.id = s.user_id
             LEFT JOIN teachers t ON u.id = t.user_id
             WHERE u.id = ?
             LIMIT 1`,
            [userId]
        );
        if (userRows.length === 0) {
            setFlash(req, 'error', 'User not found.');
            return res.redirect('/admin/users');
        }
        const profile = userRows[0];

        const relations = { enrollments: [], attempts: [], submissions: [], classesOwned: [], counts: {} };
        if (profile.role === 'student' && profile.student_profile_id) {
            const sid = profile.student_profile_id;
            relations.enrollments = await query(
                `SELECT e.*, c.class_name, c.class_code, c.subject
                 FROM enrollments e
                 JOIN classes c ON e.class_id = c.id
                 WHERE e.student_id = ?
                 ORDER BY c.class_name ASC`,
                [sid]
            );
            relations.attempts = await query(
                `SELECT qa.score, qa.percentage, qa.passed, qa.status, qa.completed_at, q.title AS quiz_title, c.class_name
                 FROM quiz_attempts qa
                 JOIN quizzes q ON qa.quiz_id = q.id
                 JOIN classes c ON qa.class_id = c.id
                 WHERE qa.student_id = ?
                 ORDER BY qa.completed_at DESC LIMIT 20`,
                [sid]
            );
            relations.submissions = await query(
                `SELECT sub.score, sub.status, sub.submitted_at, ca.title AS activity_title, c.class_name
                 FROM activity_submissions sub
                 JOIN class_activities ca ON sub.activity_id = ca.id
                 JOIN classes c ON sub.class_id = c.id
                 WHERE sub.student_id = ?
                 ORDER BY sub.submitted_at DESC LIMIT 20`,
                [sid]
            );
        } else if (profile.role === 'teacher') {
            relations.classesOwned = await query(
                `SELECT c.*, (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = c.id AND e.status = 'active') AS student_count
                 FROM classes c
                 WHERE c.teacher_id = ?
                 ORDER BY c.created_at DESC`,
                [userId]
            );
            const [libRow] = await query('SELECT COUNT(*) AS count FROM library_items WHERE teacher_id = ?', [userId]);
            const [quizRow] = await query('SELECT COUNT(*) AS count FROM quizzes WHERE teacher_id = ?', [userId]);
            const [actRow] = await query('SELECT COUNT(*) AS count FROM class_activities WHERE teacher_id = ?', [userId]);
            relations.counts = {
                library: libRow.count,
                quizzes: quizRow.count,
                activities: actRow.count
            };
        }

        const recentLogs = await query(
            `SELECT action, description, category, ip_address, created_at
             FROM activity_logs
             WHERE user_id = ?
             ORDER BY created_at DESC LIMIT 20`,
            [userId]
        );

        const { ensureToken } = require('../middleware/csrf');
        ensureToken(req);

        res.render('admin/user-detail', {
            title: `${profile.first_name} ${profile.last_name} (Oversight) | EduShare`,
            profile,
            relations,
            recentLogs,
            csrfToken: req.session.csrfToken
        });
    } catch (err) {
        console.error('Admin user detail error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

module.exports = {
    classes,
    classDetail,
    gradebook,
    exportGradebook,
    exportGradebookPost,
    quizDetail,
    activityDetail,
    userDetail
};
