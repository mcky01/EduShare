const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { query, withTransaction } = require('../config/database');
const { setFlash, clearBrandingCache } = require('../middleware/branding');
const aiService = require('../services/aiService');

async function dashboard(req, res) {
    try {
        const [teacherCount] = await query('SELECT COUNT(*) AS count FROM users WHERE role = "teacher"');
        const [studentCount] = await query('SELECT COUNT(*) AS count FROM users WHERE role = "student"');
        const [classCount] = await query('SELECT COUNT(*) AS count FROM classes WHERE is_active = 1');
        const [activeCount] = await query('SELECT COUNT(*) AS count FROM users WHERE is_active = 1');

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
            title: 'Admin Dashboard | EduShare 2.0',
            stats: {
                teachers: teacherCount.count,
                students: studentCount.count,
                classes: classCount.count,
                activeUsers: activeCount.count
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

        let sql = `
            SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.is_active, u.status, u.created_at, u.last_login,
                   s.id AS student_profile_id, s.student_id AS lrn, s.grade_level, s.section, s.gender,
                   t.id AS teacher_profile_id, t.employee_id, t.department, t.specialization, t.is_adviser, t.advisory_grade, t.advisory_section
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

        sql += ' ORDER BY u.created_at DESC';

        const userList = await query(sql, params);

        const { ensureToken } = require('../middleware/csrf');
        ensureToken(req);

        res.render('admin/users', {
            title: 'User Management | EduShare 2.0',
            users: userList,
            selectedRole,
            selectedStatus,
            searchQuery: req.query.q || '',
            csrfToken: req.session.csrfToken
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
                        is_adviser === '1' ? advisory_grade : null,
                        is_adviser === '1' ? advisory_section : null
                    ]
                );
            } else if (role === 'student') {
                await conn.query(
                    `INSERT INTO students (user_id, student_id, grade_level, section, gender)
                     VALUES (?, ?, ?, ?, ?)`,
                    [
                        newUserId,
                        cleanStudentId || Date.now().toString(),
                        grade_level || 'Grade 7',
                        section || 'Rizal',
                        gender || 'Male'
                    ]
                );
            }

            // Log admin action
            await conn.query(
                `INSERT INTO activity_logs (user_id, action, description, category)
                 VALUES (?, 'Create User', ?, 'admin')`,
                [req.session.user.id, `Created ${role} account for ${cleanFirst} ${cleanLast} (${cleanEmail})`]
            );
        });

        setFlash(req, 'success', `Successfully created ${role} account for ${cleanFirst} ${cleanLast}!`);
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
        const rows = await query('SELECT status, first_name, last_name FROM users WHERE id = ?', [targetId]);
        if (rows.length === 0) {
            setFlash(req, 'error', 'User not found.');
            return res.redirect('/admin/users?status=pending');
        }
        if (rows[0].status !== 'pending') {
            setFlash(req, 'error', 'Only pending registrations can be approved.');
            return res.redirect('/admin/users?status=pending');
        }

        await query("UPDATE users SET status = 'active', is_active = 1 WHERE id = ?", [targetId]);

        await query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, 'Registration Approved', ?, 'admin')`,
            [req.session.user.id, `Approved registration for ${rows[0].first_name} ${rows[0].last_name} (user ID ${targetId})`]
        );

        setFlash(req, 'success', `Approved registration for ${rows[0].first_name} ${rows[0].last_name}.`);
        res.redirect('/admin/users?status=pending');
    } catch (err) {
        console.error('Approve user error:', err);
        setFlash(req, 'error', 'Failed to approve registration.');
        res.redirect('/admin/users?status=pending');
    }
}

async function rejectUser(req, res) {
    try {
        const targetId = parseInt(req.params.id, 10);
        const rows = await query('SELECT status, first_name, last_name FROM users WHERE id = ?', [targetId]);
        if (rows.length === 0) {
            setFlash(req, 'error', 'User not found.');
            return res.redirect('/admin/users?status=pending');
        }
        if (rows[0].status !== 'pending') {
            setFlash(req, 'error', 'Only pending registrations can be rejected.');
            return res.redirect('/admin/users?status=pending');
        }

        await query("UPDATE users SET status = 'rejected', is_active = 0 WHERE id = ?", [targetId]);

        await query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, 'Registration Rejected', ?, 'admin')`,
            [req.session.user.id, `Rejected registration for ${rows[0].first_name} ${rows[0].last_name} (user ID ${targetId})`]
        );

        setFlash(req, 'info', `Rejected registration for ${rows[0].first_name} ${rows[0].last_name}.`);
        res.redirect('/admin/users?status=pending');
    } catch (err) {
        console.error('Reject user error:', err);
        setFlash(req, 'error', 'Failed to reject registration.');
        res.redirect('/admin/users?status=pending');
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
            console.log(`[EduShare 2.0] Password reset hash saved for user ID ${targetId}.`);
        }

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
            title: 'School Settings | EduShare 2.0',
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

        const updates = [
            ['school_name', school_name],
            ['school_abbr', school_abbr],
            ['school_motto', school_motto],
            ['school_year', school_year],
            ['current_term', current_term],
            ['session_timeout', session_timeout]
        ];

        if (req.file) {
            updates.push(['school_logo', `/files/logos/${req.file.filename}`]);
        }

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
            title: 'Curriculum & Standards | EduShare 2.0',
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
        let sql = `
            SELECT al.*, u.first_name, u.last_name, u.email, u.role
            FROM activity_logs al
            JOIN users u ON al.user_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (category !== 'all') {
            sql += ' AND al.category = ?';
            params.push(category);
        }

        sql += ' ORDER BY al.created_at DESC LIMIT 100';

        const logRows = await query(sql, params);

        res.render('admin/logs', {
            title: 'System Activity Logs | EduShare 2.0',
            logs: logRows,
            selectedCategory: category
        });
    } catch (err) {
        console.error('Logs view error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

module.exports = {
    dashboard,
    users,
    createUser,
    toggleUserStatus,
    approveUser,
    rejectUser,
    resetPassword,
    settings,
    updateSettings,
    curriculum,
    logs
};
