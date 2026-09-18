const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { query, withTransaction } = require('../config/database');
const { setFlash, clearBrandingCache } = require('../middleware/branding');
const aiService = require('../services/aiService');
const sectionService = require('../services/sectionService');
const enrollmentService = require('../services/enrollmentService');

async function dashboard(req, res) {
    try {
        const [teacherCount] = await query('SELECT COUNT(*) AS count FROM users WHERE role = "teacher"');
        const [studentCount] = await query('SELECT COUNT(*) AS count FROM users WHERE role = "student"');
        const [classCount] = await query('SELECT COUNT(*) AS count FROM classes WHERE is_active = 1');
        const [activeCount] = await query('SELECT COUNT(*) AS count FROM users WHERE is_active = 1');
        // Phase 1.6: pending-approval banner count (single cheap indexed query).
        const [pendingCount] = await query("SELECT COUNT(*) AS count FROM users WHERE status = 'pending'");

        const recentUsers = await query(
            `SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.is_active, u.created_at,
                    s.student_id AS lrn, t.employee_id
             FROM users u
             LEFT JOIN students s ON u.id = s.user_id
             LEFT JOIN teachers t ON u.id = t.user_id
             ORDER BY u.created_at DESC LIMIT 5`
        );

        const recentLogs = await query(
            `SELECT al.*, u.first_name, u.last_name, u.role
             FROM activity_logs al
             JOIN users u ON al.user_id = u.id
             ORDER BY al.created_at DESC LIMIT 8`
        );

        const isAiHealthy = await aiService.isHealthy();

        res.render('admin/dashboard', {
            title: 'Admin Dashboard | EduShare',
            stats: {
                teachers: teacherCount.count,
                students: studentCount.count,
                classes: classCount.count,
                activeUsers: activeCount.count,
                pending: pendingCount.count
            },
            recentUsers,
            recentLogs,
            isAiHealthy
        });
    } catch (err) {
        console.error('Admin dashboard error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function users(req, res) {
    try {
        const selectedRole = req.query.role || 'all';
        const selectedStatus = req.query.status || 'all';
        const search = req.query.q ? `%${req.query.q.trim()}%` : null;

        // Server-side sorting (whitelisted — column names never come
        // straight from the query string into SQL). Default stays
        // newest-first so fresh registrations surface for approval.
        //   name  -> last_name, first_name (alphabetical roster checks)
        //   role  -> role, then name (groups teachers/students/admins)
        //   level -> students by grade/section/name, teachers by
        //            employee_id, admins last (raw values, not the
        //            rendered "LRN:/ID:" mashup, which can't sort
        //            meaningfully across roles)
        //   status -> lifecycle order, then newest first
        const SORTS = {
            name: 'u.last_name ASC, u.first_name ASC, u.created_at DESC',
            name_desc: 'u.last_name DESC, u.first_name DESC, u.created_at DESC',
            role: "FIELD(u.role, 'teacher', 'student', 'admin'), u.last_name ASC, u.first_name ASC",
            role_desc: "FIELD(u.role, 'admin', 'student', 'teacher'), u.last_name ASC, u.first_name ASC",
            level: "CASE WHEN u.role = 'student' THEN 0 WHEN u.role = 'teacher' THEN 1 ELSE 2 END, s.grade_level ASC, s.section ASC, t.employee_id ASC, u.last_name ASC, u.first_name ASC",
            level_desc: "CASE WHEN u.role = 'student' THEN 0 WHEN u.role = 'teacher' THEN 1 ELSE 2 END, s.grade_level DESC, s.section DESC, t.employee_id DESC, u.last_name DESC, u.first_name DESC",
            status: "FIELD(u.status, 'pending', 'active', 'rejected'), u.created_at DESC",
            status_desc: "FIELD(u.status, 'rejected', 'active', 'pending'), u.created_at DESC",
            newest: 'u.created_at DESC',
            oldest: 'u.created_at ASC'
        };
        const requestedSort = String(req.query.sort || 'newest');
        const sortKey = Object.prototype.hasOwnProperty.call(SORTS, requestedSort) ? requestedSort : 'newest';

        let sql = `
            SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.is_active, u.status, u.created_at, u.last_login,
                   s.id AS student_profile_id, s.student_id AS lrn, s.grade_level, s.section, s.gender,
                   t.id AS teacher_profile_id, t.employee_id, t.department, t.specialization, t.grade_level AS teacher_grade, t.section AS teacher_section, t.is_adviser, t.advisory_grade, t.advisory_section
            FROM users u
            LEFT JOIN students s ON u.id = s.user_id
            LEFT JOIN teachers t ON u.id = t.user_id
            WHERE 1=1
        `;
        const params = [];

        if (selectedRole !== 'all') {
            sql += ' AND u.role = ?';
            params.push(selectedRole);
        }

        if (selectedStatus !== 'all') {
            sql += ' AND u.status = ?';
            params.push(selectedStatus);
        }

        if (search) {
            sql += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR s.student_id LIKE ? OR t.employee_id LIKE ?)';
            params.push(search, search, search, search, search);
        }

        sql += ` ORDER BY ${SORTS[sortKey]}`;

        const userList = await query(sql, params);

        const { ensureToken } = require('../middleware/csrf');
        ensureToken(req);

        // Phase 0.1: pop the single-use reset-password handoff (set by resetPassword
        // below). Shown exactly once on the next render, never persisted.
        // Batch A5: no-store so the plaintext never lands in disk cache.
        const resetPwOnce = req.session.resetPwOnce || null;
        req.session.resetPwOnce = null;
        if (resetPwOnce) {
            res.set('Cache-Control', 'no-store');
        }

        // Pending queues (adviser flows). Loaded here so they render
        // inside the users page pending area.
        let pendingTransfers = [];
        try {
            pendingTransfers = await require('./adminInterventionController').transferQueueData();
        } catch {
            pendingTransfers = [];
        }
        let pendingChanges = [];
        try {
            pendingChanges = await require('./adminInterventionController').changeQueueData();
        } catch {
            pendingChanges = [];
        }

        res.render('admin/users', {
            title: 'User Management | EduShare',
            users: userList,
            selectedRole,
            selectedStatus,
            searchQuery: req.query.q || '',
            csrfToken: req.session.csrfToken,
            resetPwOnce,
            pendingTransfers,
            pendingChanges,
            sortKey
        });
    } catch (err) {
        console.error('Admin users error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEACHER_EMAIL_DOMAIN = '@zahs.edu.ph';
const GENERIC_DUP_ERROR = 'Account details already in use.';
const PASSWORD_RULE_MESSAGE = 'Password must be at least 10 characters with upper/lowercase letters and a number.';

function validPassword(raw) {
    const pw = String(raw || '');
    return pw.length >= 10 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw);
}

function validName(raw) {
    return typeof raw === 'string' && raw.trim().length >= 1 && raw.trim().length <= 100;
}

function validEmail(raw) {
    const email = String(raw || '').trim();
    return email.length <= 150 && EMAIL_RE.test(email);
}

async function createUser(req, res) {
    try {
        const { role, first_name, last_name, email, password, employee_id, department, specialization, is_adviser, advisory_grade, advisory_section, student_id, grade_level, section, gender } = req.body;

        if (!first_name || !last_name || !email || !password || !role) {
            setFlash(req, 'error', 'All core fields are required.');
            return res.redirect('/admin/users');
        }

        if (!['teacher', 'student'].includes(role)) {
            setFlash(req, 'error', 'Invalid role.');
            return res.redirect('/admin/users');
        }

        const cleanFirst = String(first_name).trim();
        const cleanLast = String(last_name).trim();
        const cleanEmail = String(email).trim().toLowerCase();

        if (!validName(cleanFirst) || !validName(cleanLast)) {
            setFlash(req, 'error', 'First and last name must be 1-100 characters.');
            return res.redirect('/admin/users');
        }

        if (!validEmail(cleanEmail)) {
            setFlash(req, 'error', 'Enter a valid email address.');
            return res.redirect('/admin/users');
        }

        if (role === 'teacher' && !cleanEmail.endsWith(TEACHER_EMAIL_DOMAIN)) {
            setFlash(req, 'error', `Teacher email must end with ${TEACHER_EMAIL_DOMAIN}.`);
            return res.redirect('/admin/users');
        }

        if (!validPassword(password)) {
            setFlash(req, 'error', PASSWORD_RULE_MESSAGE);
            return res.redirect('/admin/users');
        }

        const existing = await query('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1', [cleanEmail]);
        if (existing.length > 0) {
            setFlash(req, 'error', GENERIC_DUP_ERROR);
            return res.redirect('/admin/users');
        }

        const cleanEmployeeId = employee_id ? String(employee_id).trim() : '';
        if (role === 'teacher' && cleanEmployeeId) {
            const empDup = await query('SELECT id FROM teachers WHERE employee_id = ? LIMIT 1', [cleanEmployeeId]);
            if (empDup.length > 0) {
                setFlash(req, 'error', GENERIC_DUP_ERROR);
                return res.redirect('/admin/users');
            }
        }

        const cleanStudentId = student_id ? String(student_id).trim() : '';
        if (role === 'student' && cleanStudentId) {
            const lrnDup = await query('SELECT id FROM students WHERE student_id = ? LIMIT 1', [cleanStudentId]);
            if (lrnDup.length > 0) {
                setFlash(req, 'error', GENERIC_DUP_ERROR);
                return res.redirect('/admin/users');
            }
        }

        const hash = await bcrypt.hash(password, 10);

        // Student path: validate grade/gender against the shared vocabulary
        // and converge the section to the canonical spelling when the grade
        // already has one (same soft-match rule as self-registration, so
        // admin-created accounts never introduce new casing splits).
        // Teacher-adviser path: same 7-12 whitelist + canonical section.
        let finalStudentGrade = null;
        let finalStudentSection = null;
        let finalAdvisoryGrade = null;
        let finalAdvisorySection = null;
        if (role === 'teacher' && is_adviser === '1') {
            if (advisory_grade && !sectionService.GRADES_7_12.includes(String(advisory_grade).trim())) {
                setFlash(req, 'error', 'Select a valid advisory grade (Grade 7 to Grade 12).');
                return res.redirect('/admin/users');
            }
            finalAdvisoryGrade = advisory_grade ? String(advisory_grade).trim() : null;
            if (finalAdvisoryGrade) {
                finalAdvisorySection = await sectionService.canonicalizeSection(
                    finalAdvisoryGrade,
                    sectionService.cleanSection(advisory_section)
                );
            }
        }
        if (role === 'student') {
            finalStudentGrade = sectionService.cleanStudentGrade(grade_level) || 'Grade 7';
            finalStudentSection = await sectionService.canonicalizeSection(
                finalStudentGrade,
                sectionService.cleanSection(section) || 'Rizal'
            );
        }

        let newStudentProfileId = null;
        await withTransaction(async (conn) => {
            const [userRes] = await conn.query(
                `INSERT INTO users (first_name, last_name, email, password_hash, role, is_active, force_password_change)
                 VALUES (?, ?, ?, ?, ?, 1, 1)`,
                [cleanFirst, cleanLast, cleanEmail, hash, role]
            );
            const newUserId = userRes.insertId;

            if (role === 'teacher') {
                await conn.query(
                    `INSERT INTO teachers (user_id, employee_id, department, specialization, is_adviser, advisory_grade, advisory_section)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        newUserId,
                        cleanEmployeeId || `EMP-${Date.now().toString().slice(-4)}`,
                        department || 'Junior High School',
                        specialization || 'General',
                        is_adviser === '1' ? 1 : 0,
                        is_adviser === '1' ? finalAdvisoryGrade : null,
                        is_adviser === '1' ? finalAdvisorySection : null
                    ]
                );
            } else if (role === 'student') {
                const [stuRes] = await conn.query(
                    `INSERT INTO students (user_id, student_id, grade_level, section, gender)
                     VALUES (?, ?, ?, ?, ?)`,
                    [
                        newUserId,
                        cleanStudentId || Date.now().toString(),
                        finalStudentGrade,
                        finalStudentSection,
                        ['Male', 'Female', 'Other'].includes(gender) ? gender : 'Male'
                    ]
                );
                newStudentProfileId = stuRes.insertId;
            }

            // Log admin action
            await conn.query(
                `INSERT INTO activity_logs (user_id, action, description, category)
                 VALUES (?, 'Create User', ?, 'admin')`,
                [req.session.user.id, `Created ${role} account for ${cleanFirst} ${cleanLast} (${cleanEmail})`]
            );
        });

        // Admin-created students are active immediately, so enroll right
        // away into every active class matching their grade/section —
        // otherwise they would be invisible in rosters/gradebooks exactly
        // like an approved-but-unenrolled registration.
        let createdEnrolled = 0;
        if (role === 'student' && newStudentProfileId) {
            createdEnrolled = await enrollmentService.autoEnrollStudent(newStudentProfileId);
        }

        setFlash(req, 'success', role === 'student'
            ? `Successfully created student account for ${cleanFirst} ${cleanLast}! Enrolled in ${createdEnrolled} class(es).`
            : `Successfully created ${role} account for ${cleanFirst} ${cleanLast}!`);
        res.redirect(`/admin/users?role=${role}`);
    } catch (err) {
        console.error('Create user error:', err);
        if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) {
            setFlash(req, 'error', GENERIC_DUP_ERROR);
        } else {
            setFlash(req, 'error', 'Failed to create user.');
        }
        res.redirect('/admin/users');
    }
}

async function toggleUserStatus(req, res) {
    try {
        const targetId = parseInt(req.params.id, 10);
        if (targetId === req.session.user.id) {
            setFlash(req, 'error', 'You cannot deactivate your own administrative account.');
            return res.redirect('/admin/users');
        }

        const rows = await query('SELECT is_active, status, first_name, last_name FROM users WHERE id = ?', [targetId]);
        if (rows.length === 0) {
            setFlash(req, 'error', 'User not found.');
            return res.redirect('/admin/users');
        }

        const newStatus = rows[0].is_active ? 0 : 1;
        await query("UPDATE users SET is_active = ?, status = IF(? = 1, 'active', status) WHERE id = ?", [newStatus, newStatus, targetId]);

        await query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, 'Toggle Status', ?, 'admin')`,
            [req.session.user.id, `Set status of user ${rows[0].first_name} ${rows[0].last_name} to ${newStatus ? 'active' : 'inactive'}`]
        );

        setFlash(req, 'success', `User status updated to ${newStatus ? 'Active' : 'Inactive'}.`);
        res.redirect('back');
    } catch (err) {
        console.error('Toggle status error:', err);
        setFlash(req, 'error', 'Failed to update user status.');
        res.redirect('/admin/users');
    }
}

async function approveUser(req, res) {
    try {
        const targetId = parseInt(req.params.id, 10);
        const rows = await query('SELECT status, role, first_name, last_name FROM users WHERE id = ?', [targetId]);
        if (rows.length === 0) {
            setFlash(req, 'error', 'User not found.');
            return res.redirect('/admin/users');
        }
        if (rows[0].status !== 'pending') {
            setFlash(req, 'error', 'Only pending registrations can be approved.');
            return res.redirect('/admin/users');
        }

        // Students: activate + enroll into every matching class so they
        // immediately appear in section rosters/gradebooks (oversight +
        // teacher). Teachers/admins keep the plain activation path.
        if (rows[0].role === 'student') {
            const result = await approveStudentAndEnroll(targetId, req.session.user.id, 'Admin');
            if (!result.ok) {
                setFlash(req, 'error', result.reason === 'not-found' ? 'User not found.' : 'Only pending registrations can be approved.');
                return res.redirect('/admin/users');
            }
            setFlash(req, 'success', `Approved registration for ${result.firstName} ${result.lastName}. Enrolled in ${result.enrolled} class(es) — they now appear in sections and gradebooks.`);
            return res.redirect('/admin/users');
        }

        await query("UPDATE users SET status = 'active', is_active = 1 WHERE id = ?", [targetId]);

        await query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, 'Registration Approved', ?, 'admin')`,
            [req.session.user.id, `Approved registration for ${rows[0].first_name} ${rows[0].last_name} (user ID ${targetId})`]
        );

        setFlash(req, 'success', `Approved registration for ${rows[0].first_name} ${rows[0].last_name}. They now appear under All users.`);
        res.redirect('/admin/users');
    } catch (err) {
        console.error('Approve user error:', err);
        setFlash(req, 'error', 'Failed to approve registration.');
        res.redirect('/admin/users');
    }
}

async function approveStudentAndEnroll(targetId, approverId, approverLabel) {
    // Shared student-activation path: flip pending -> active, then enroll
    // into EVERY active class matching the student's grade/section (not
    // just one teacher's class). Returns { ok, firstName, lastName, enrolled }.
    const targetRows = await query(
        `SELECT u.id, u.status, u.first_name, u.last_name, s.id AS student_profile_id
         FROM users u
         JOIN students s ON s.user_id = u.id
         WHERE u.id = ? AND u.role = 'student'
         LIMIT 1`,
        [targetId]
    );
    if (targetRows.length === 0) return { ok: false, reason: 'not-found' };
    if (targetRows[0].status !== 'pending') return { ok: false, reason: 'not-pending' };

    await query("UPDATE users SET status = 'active', is_active = 1 WHERE id = ?", [targetId]);
    const enrolled = await enrollmentService.autoEnrollStudent(targetRows[0].student_profile_id);
    await query(
        `INSERT INTO activity_logs (user_id, action, description, category)
         VALUES (?, 'Registration Approved', ?, 'admin')`,
        [approverId, `${approverLabel} approved registration for ${targetRows[0].first_name} ${targetRows[0].last_name} (user ID ${targetId}), enrolled in ${enrolled} class(es)`]
    );
    return { ok: true, firstName: targetRows[0].first_name, lastName: targetRows[0].last_name, enrolled };
}

async function rejectUser(req, res) {
    try {
        const targetId = parseInt(req.params.id, 10);
        const rows = await query('SELECT status, first_name, last_name FROM users WHERE id = ?', [targetId]);
        if (rows.length === 0) {
            setFlash(req, 'error', 'User not found.');
            return res.redirect('/admin/users');
        }
        if (rows[0].status !== 'pending') {
            setFlash(req, 'error', 'Only pending registrations can be rejected.');
            return res.redirect('/admin/users');
        }

        await query("UPDATE users SET status = 'rejected', is_active = 0 WHERE id = ?", [targetId]);

        await query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, 'Registration Rejected', ?, 'admin')`,
            [req.session.user.id, `Rejected registration for ${rows[0].first_name} ${rows[0].last_name} (user ID ${targetId})`]
        );

        setFlash(req, 'info', `Rejected registration for ${rows[0].first_name} ${rows[0].last_name}. They now appear under All users.`);
        res.redirect('/admin/users');
    } catch (err) {
        console.error('Reject user error:', err);
        setFlash(req, 'error', 'Failed to reject registration.');
        res.redirect('/admin/users');
    }
}

async function resetPassword(req, res) {
    try {
        const targetId = parseInt(req.params.id, 10);
        if (targetId === req.session.user.id) {
            setFlash(req, 'error', 'You cannot reset your own password from here.');
            return res.redirect('/admin/users');
        }

        const rows = await query('SELECT id, role FROM users WHERE id = ? LIMIT 1', [targetId]);
        if (rows.length === 0) {
            setFlash(req, 'error', 'User not found.');
            return res.redirect('/admin/users');
        }

        const tempPassword = crypto.randomBytes(16).toString('base64url');
        const hash = await bcrypt.hash(tempPassword, 10);

        await query(
            'UPDATE users SET password_hash = ?, force_password_change = 1 WHERE id = ?',
            [hash, targetId]
        );

        // Phase 7 limitation note: other active sessions for the target user are NOT
        // destroyed here. A LIKE-based DELETE on sessions.data is fragile (JSON shape,
        // escaping, false positives) and the store has no userId index. Instead,
        // force_password_change=1 forces a redirect to /auth/change-password on the
        // target's next request via the isAuthenticated gate (src/middleware/auth.js),
        // so a compromised password cannot be used to keep working normally.
        await query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, 'Password Reset', ?, 'security')`,
            [req.session.user.id, `Reset password for user ID ${targetId}`]
        );

        if (process.env.NODE_ENV !== 'production') {
            console.log(`[EduShare] Password reset hash saved for user ID ${targetId}.`);
        }

        // Phase 0.1: stash the plaintext for a single-use handoff banner on the
        // next users-page render. The users() action pops it, so a refresh or
        // second admin never sees it again. Never logged, never persisted.
        req.session.resetPwOnce = { userId: targetId, password: tempPassword };

        setFlash(req, 'success', 'Temporary password generated. Share it securely with the user.');
        res.redirect('back');
    } catch (err) {
        console.error('Reset password error:', err);
        setFlash(req, 'error', 'Failed to reset password.');
        res.redirect('/admin/users');
    }
}

async function settings(req, res) {
    try {
        const rows = await query('SELECT * FROM system_settings ORDER BY category ASC, id ASC');
        const map = {};
        for (const r of rows) {
            map[r.setting_key] = r.setting_value;
        }

        res.render('admin/settings', {
            title: 'School Settings | EduShare',
            settings: map
        });
    } catch (err) {
        console.error('Admin settings error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function updateSettings(req, res) {
    try {
        const { school_name, school_abbr, school_motto, school_year, current_term, session_timeout } = req.body;

        // Phase 0.2: session_timeout clamped to the 5..1440 range enforced by
        // brandingMiddleware; AI flags are checkboxes (unchecked boxes don't POST).
        let timeoutVal = session_timeout;
        if (timeoutVal !== undefined) {
            const mins = parseInt(timeoutVal, 10);
            if (!Number.isFinite(mins)) {
                setFlash(req, 'error', 'Session timeout must be a number of minutes (5-1440).');
                return res.redirect('/admin/settings');
            }
            timeoutVal = String(Math.min(1440, Math.max(5, mins)));
        }

        const updates = [
            ['school_name', school_name],
            ['school_abbr', school_abbr],
            ['school_motto', school_motto],
            ['school_year', school_year],
            ['current_term', current_term],
            ['session_timeout', timeoutVal],
            ['allow_student_chat', req.body.allow_student_chat === '1' ? '1' : '0'],
            ['allow_ai_lesson', req.body.allow_ai_lesson === '1' ? '1' : '0']
        ];

        if (req.file) {
            updates.push(['school_logo', `/files/logos/${req.file.filename}`]);
        }

        // Batch A2: reason-gate — settings include security controls
        // (session_timeout, AI flags), so every save must state why.
        const settingsReason = String(req.body.reason || '').trim();
        if (settingsReason.length < 10) {
            setFlash(req, 'error', 'Saving settings requires a reason of at least 10 characters.');
            return res.redirect('/admin/settings');
        }

        // Snapshot old values for changed-keys logging.
        const beforeRows = await query('SELECT setting_key, setting_value FROM system_settings');
        const before = {};
        for (const r of beforeRows) before[r.setting_key] = r.setting_value;

        for (const [k, v] of updates) {
            if (v !== undefined) {
                await query(
                    `INSERT INTO system_settings (setting_key, setting_value)
                     VALUES (?, ?)
                     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                    [k, v]
                );
            }
        }

        const changed = updates
            .filter(([k, v]) => v !== undefined && before[k] !== v)
            .map(([k]) => k);

        await query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, 'Update Settings', ?, 'admin')`,
            [req.session.user.id,
             `Updated settings${changed.length ? ` (${changed.join(', ')})` : ' (no values changed)'}. Reason: ${settingsReason}`]
        );

        clearBrandingCache();
        setFlash(req, 'success', 'School settings updated successfully!');
        res.redirect('/admin/settings');
    } catch (err) {
        console.error('Update settings error:', err);
        setFlash(req, 'error', 'Failed to update settings: ' + err.message);
        res.redirect('/admin/settings');
    }
}

async function curriculum(req, res) {
    try {
        const docs = await query('SELECT * FROM curriculum_documents ORDER BY created_at DESC');
        const comps = await query('SELECT * FROM competencies ORDER BY code ASC');

        res.render('admin/curriculum', {
            title: 'Curriculum & Standards | EduShare',
            documents: docs,
            competencies: comps
        });
    } catch (err) {
        console.error('Curriculum view error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function logs(req, res) {
    try {
        const category = req.query.category || 'all';
        const search = req.query.q ? `%${String(req.query.q).trim()}%` : null;
        // Batch B3: LEFT JOIN so rows from deleted accounts still appear.
        // Q4: shared WHERE builder for list + count (read-only q/page params).
        let where = 'WHERE 1=1';
        const params = [];

        if (category !== 'all') {
            where += ' AND al.category = ?';
            params.push(category);
        }
        if (search) {
            where += ' AND (al.action LIKE ? OR al.description LIKE ? OR u.email LIKE ?)';
            params.push(search, search, search);
        }

        const PAGE_SIZE = 50;
        let page = parseInt(req.query.page, 10);
        if (!Number.isInteger(page) || page < 1) page = 1;

        const [countRow] = await query(
            `SELECT COUNT(*) AS total FROM activity_logs al LEFT JOIN users u ON al.user_id = u.id ${where}`,
            params
        );
        const total = countRow.total;
        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        if (page > totalPages) page = totalPages;
        const offset = (page - 1) * PAGE_SIZE;

        const logRows = await query(
            `SELECT al.*, al.user_id AS actor_id,
                   COALESCE(u.first_name, '(deleted)') AS first_name,
                   COALESCE(u.last_name, 'account') AS last_name,
                   COALESCE(u.email, '') AS email,
                   COALESCE(u.role, 'unknown') AS role
            FROM activity_logs al
            LEFT JOIN users u ON al.user_id = u.id
            ${where}
            ORDER BY al.created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
            params
        );

        const { ensureToken } = require('../middleware/csrf');
        ensureToken(req);

        res.render('admin/logs', {
            title: 'System Activity Logs | EduShare',
            logs: logRows,
            selectedCategory: category,
            searchQuery: req.query.q || '',
            page,
            totalPages,
            total,
            pageSize: PAGE_SIZE,
            csrfToken: req.session.csrfToken
        });
    } catch (err) {
        console.error('Logs view error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

// ============================================================
// Phase 1 — Academic oversight (read-only) lives in
// adminOversightController.js to keep this file focused on
// identity/settings. Delegating stubs below preserve the
// adminController.* interface used by adminRoutes.
// ============================================================
const oversight = require('./adminOversightController');

async function classes(req, res) { return oversight.classes(req, res); }
async function classDetail(req, res) { return oversight.classDetail(req, res); }
async function gradebook(req, res) { return oversight.gradebook(req, res); }
async function exportGradebook(req, res) { return oversight.exportGradebook(req, res); }
async function exportGradebookPost(req, res) { return oversight.exportGradebookPost(req, res); }
async function quizDetail(req, res) { return oversight.quizDetail(req, res); }
async function activityDetail(req, res) { return oversight.activityDetail(req, res); }
async function userDetail(req, res) { return oversight.userDetail(req, res); }

module.exports = {
    dashboard,
    users,
    userDetail,
    createUser,
    toggleUserStatus,
    approveUser,
    rejectUser,
    resetPassword,
    settings,
    updateSettings,
    curriculum,
    logs,
    classes,
    classDetail,
    gradebook,
    exportGradebook,
    exportGradebookPost,
    quizDetail,
    activityDetail
};
