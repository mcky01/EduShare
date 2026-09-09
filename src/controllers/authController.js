const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { query } = require('../config/database');
const { setFlash } = require('../middleware/branding');

async function showLogin(req, res) {
    const { ensureToken } = require('../middleware/csrf');
    ensureToken(req);
    const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '';
    res.render('auth/login', {
        title: 'Sign In | EduShare 2.0',
        layout: 'layouts/auth',
        loginError: null,
        credential: '',
        returnTo: isSafeReturnTo(returnTo) ? returnTo : '',
        csrfToken: req.session.csrfToken
    });
}

function isSafeReturnTo(target) {
    if (!target || typeof target !== 'string') return false;
    if (!target.startsWith('/') || target.startsWith('//')) return false;
    if (target.includes('\\') || target.includes(' ') || target.toLowerCase().startsWith('/auth/login')) return false;
    return true;
}

function normalizeCredential(raw) {
    return String(raw || '').trim().toLowerCase();
}

// Server-side portal detection (mirrors client badge, but login never trusts it).
// LRN digits -> student lookup first, school email / EMP- -> teacher, admin@ -> admin.
// Every branch falls through to the next, so no identifier shape can lock a user out.
function looksLikeLrn(raw) {
    const digits = String(raw || '').trim().replace(/[\s-]/g, '');
    return /^\d+$/.test(digits) && digits.length > 0 ? digits : null;
}

function resolveRedirect(user, returnTo) {
    if (isSafeReturnTo(returnTo)) {
        const prefix = `/${user.role}/`;
        if (returnTo === `/${user.role}` || returnTo.startsWith(prefix)) return returnTo;
    }
    if (user.role === 'admin') return '/admin/dashboard';
    if (user.role === 'teacher') return '/teacher/dashboard';
    return '/student/dashboard';
}

function renderLoginError(req, res, status, message, cred, returnTo) {
    return res.status(status).render('auth/login', {
        title: 'Sign In | EduShare 2.0',
        layout: 'layouts/auth',
        loginError: message,
        credential: cred || '',
        returnTo: isSafeReturnTo(returnTo) ? returnTo : '',
        csrfToken: req.session?.csrfToken || ''
    });
}

const GENERIC_LOGIN_ERROR = 'Invalid credentials. Check your school ID or email and password, then try again.';

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logLoginAttempt(userId, req, success) {
    try {
        if (!userId) return;
        await query(
            `INSERT INTO activity_logs (user_id, action, description, category, ip_address, user_agent)
             VALUES (?, ?, ?, 'security', ?, ?)`,
            [
                userId,
                success ? 'Login Success' : 'Login Failed',
                success ? 'User successfully signed in' : 'Failed sign-in attempt rejected',
                req.ip,
                (req.headers['user-agent'] || '').slice(0, 255)
            ]
        );
    } catch {
        // Never block login on audit-log failure.
    }
}

async function login(req, res) {
    try {
        const { credential, password, returnTo } = req.body;
        const rawCred = typeof credential === 'string' ? credential : '';
        const safeReturnTo = isSafeReturnTo(returnTo) ? returnTo : '';

        if (!credential || !password) {
            return renderLoginError(req, res, 400, 'Enter your school ID or email and password to sign in.', rawCred.trim(), safeReturnTo);
        }

        const cred = normalizeCredential(rawCred);
        const lrnDigits = looksLikeLrn(rawCred);
        if (!cred) {
            return renderLoginError(req, res, 400, GENERIC_LOGIN_ERROR, rawCred.trim(), safeReturnTo);
        }
        // Numeric identifiers must be full 12-digit LRNs; anything shorter is a typo.
        if (!lrnDigits && /^[\d\s-]+$/.test(rawCred.trim())) {
            return renderLoginError(req, res, 400, 'Student LRN must be exactly 12 digits. Check the number and try again.', rawCred.trim(), safeReturnTo);
        }
        let user = null;

        // 1) LRN digits -> student record (covers spaced/dashed LRN typing too).
        if (lrnDigits) {
            const rows = await query(
                `SELECT u.*, s.id AS student_profile_id, s.student_id AS lrn, s.grade_level, s.section, s.gender
                 FROM users u
                 JOIN students s ON u.id = s.user_id
                 WHERE s.student_id = ? AND u.role = 'student'
                 LIMIT 1`,
                [lrnDigits]
            );
            if (rows.length > 0) user = rows[0];
        }

        // 2) Teacher by employee ID or school email.
        if (!user) {
            const rows = await query(
                `SELECT u.*, t.id AS teacher_profile_id, t.employee_id, t.department, t.specialization, t.is_adviser, t.advisory_grade, t.advisory_section
                 FROM users u
                 JOIN teachers t ON u.id = t.user_id
                 WHERE (LOWER(t.employee_id) = ? OR LOWER(u.email) = ?) AND u.role = 'teacher'
                 LIMIT 1`,
                [cred, cred]
            );
            if (rows.length > 0) user = rows[0];
        }

        // 3) Admin by email.
        if (!user) {
            const rows = await query(
                'SELECT * FROM users WHERE LOWER(email) = ? AND role = \'admin\' LIMIT 1',
                [cred]
            );
            if (rows.length > 0) user = rows[0];
        }

        // 4) Any remaining account by email (e.g. student email login).
        if (!user) {
            const fallbackRows = await query(
                'SELECT * FROM users WHERE LOWER(email) = ? LIMIT 1',
                [cred]
            );
            if (fallbackRows.length > 0) {
                user = fallbackRows[0];
                if (user.role === 'student' && !user.student_profile_id) {
                    const prof = await query('SELECT id AS student_profile_id, student_id AS lrn, grade_level, section FROM students WHERE user_id = ? LIMIT 1', [user.id]);
                    if (prof.length > 0) Object.assign(user, prof[0]);
                }
                if (user.role === 'teacher' && !user.teacher_profile_id) {
                    const prof = await query('SELECT id AS teacher_profile_id, employee_id, department, specialization, is_adviser, advisory_grade, advisory_section FROM teachers WHERE user_id = ? LIMIT 1', [user.id]);
                    if (prof.length > 0) Object.assign(user, prof[0]);
                }
            }
        }

        if (!user || !user.is_active) {
            if (user && user.id) await logLoginAttempt(user.id, req, false);
            await delay(400);
            return renderLoginError(req, res, 401, GENERIC_LOGIN_ERROR, rawCred.trim(), safeReturnTo);
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            await logLoginAttempt(user.id, req, false);
            await delay(400);
            return renderLoginError(req, res, 401, GENERIC_LOGIN_ERROR, rawCred.trim(), safeReturnTo);
        }

        // Update last login
        await query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

        // Log to activity_logs
        await query(
            `INSERT INTO activity_logs (user_id, action, description, category, ip_address, user_agent)
             VALUES (?, 'Login', 'User successfully signed in', 'account', ?, ?)`,
            [user.id, req.ip, req.headers['user-agent']?.slice(0, 255) || '']
        );

        // Rotate the session ID on successful login (prevents session fixation).
        await new Promise((resolve, reject) => {
            req.session.regenerate((err) => (err ? reject(err) : resolve()));
        });

        // Store session
        req.session.user = {
            id: user.id,
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email,
            role: user.role,
            avatar_url: user.avatar_url || null,
            force_password_change: !!user.force_password_change,
            // Extra role profiles
            student_profile_id: user.student_profile_id || null,
            lrn: user.lrn || null,
            grade_level: user.grade_level || null,
            section: user.section || null,
            teacher_profile_id: user.teacher_profile_id || null,
            is_adviser: !!user.is_adviser,
            advisory_grade: user.advisory_grade || null,
            advisory_section: user.advisory_section || null
        };

        // Fixed 12-hour session (remember-me control removed from login).
        req.session.cookie.maxAge = 12 * 60 * 60 * 1000; // 12 hours

        await logLoginAttempt(user.id, req, true);

        if (user.force_password_change) {
            return res.redirect('/auth/change-password');
        }

        return res.redirect(resolveRedirect(user, safeReturnTo));
    } catch (err) {
        console.error('Login error:', err);
        try {
            const returnTo = req.body?.returnTo;
            const safeReturnTo = isSafeReturnTo(returnTo) ? returnTo : '';
            return renderLoginError(req, res, 500, 'Something went wrong signing you in. Please try again.', String(req.body?.credential || ''), safeReturnTo);
        } catch {
            setFlash(req, 'error', 'An error occurred while signing in.');
            return res.redirect('/auth/login');
        }
    }
}

async function showChangePassword(req, res) {
    const { ensureToken } = require('../middleware/csrf');
    ensureToken(req);
    res.render('auth/change-password', {
        title: 'Change Password | EduShare 2.0',
        layout: 'layouts/auth',
        csrfToken: req.session.csrfToken
    });
}

async function changePassword(req, res) {
    try {
        const { current_password, new_password, confirm_password } = req.body;
        const userId = req.session.user.id;

        if (!new_password || new_password.length < 10 || !/[a-z]/.test(new_password) || !/[A-Z]/.test(new_password) || !/\d/.test(new_password)) {
            setFlash(req, 'error', 'New password must be at least 10 characters with upper/lowercase letters and a number.');
            return res.redirect('/auth/change-password');
        }

        if (new_password !== confirm_password) {
            setFlash(req, 'error', 'New passwords do not match.');
            return res.redirect('/auth/change-password');
        }

        // If not force change, verify current password
        if (!req.session.user.force_password_change) {
            const rows = await query('SELECT password_hash FROM users WHERE id = ?', [userId]);
            if (rows.length === 0) return res.redirect('/auth/login');
            const match = await bcrypt.compare(current_password, rows[0].password_hash);
            if (!match) {
                setFlash(req, 'error', 'Current password is incorrect.');
                return res.redirect('/auth/change-password');
            }
        }

        const newHash = await bcrypt.hash(new_password, 10);
        await query(
            'UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?',
            [newHash, userId]
        );

        req.session.user.force_password_change = false;
        setFlash(req, 'success', 'Password updated successfully!');

        const role = req.session.user.role;
        if (role === 'admin') return res.redirect('/admin/dashboard');
        if (role === 'teacher') return res.redirect('/teacher/dashboard');
        return res.redirect('/student/dashboard');
    } catch (err) {
        console.error('Change password error:', err);
        setFlash(req, 'error', 'Failed to update password.');
        return res.redirect('/auth/change-password');
    }
}

async function updateProfile(req, res) {
    try {
        const userId = req.session.user.id;
        const { first_name, last_name } = req.body;

        if (!first_name || !last_name) {
            setFlash(req, 'error', 'First name and last name are required.');
            return res.redirect('back');
        }

        let avatarUrl = req.session.user.avatar_url;
        if (req.file) {
            avatarUrl = `/uploads/avatars/${req.file.filename}`;
        }

        await query(
            'UPDATE users SET first_name = ?, last_name = ?, avatar_url = ? WHERE id = ?',
            [first_name.trim(), last_name.trim(), avatarUrl, userId]
        );

        req.session.user.first_name = first_name.trim();
        req.session.user.last_name = last_name.trim();
        req.session.user.avatar_url = avatarUrl;

        setFlash(req, 'success', 'Profile updated successfully!');
        res.redirect('back');
    } catch (err) {
        console.error('Update profile error:', err);
        setFlash(req, 'error', 'Failed to update profile.');
        res.redirect('back');
    }
}

async function logout(req, res) {
    if (req.session) {
        req.session.destroy(() => {
            res.redirect('/auth/login');
        });
    } else {
        res.redirect('/auth/login');
    }
}

module.exports = {
    showLogin,
    login,
    showChangePassword,
    changePassword,
    updateProfile,
    logout
};
