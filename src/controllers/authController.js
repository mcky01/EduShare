const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { query, withTransaction } = require('../config/database');
const { setFlash } = require('../middleware/branding');
const { requestOtp, verifyOtp, RateLimited, InvalidCode, ExpiredOrMissing } = require('../services/otpService');
const sectionService = require('../services/sectionService');

async function showLogin(req, res) {
    const { ensureToken } = require('../middleware/csrf');
    ensureToken(req);
    const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '';
    res.render('auth/login', {
        title: 'Sign In | EduShare',
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
        title: 'Sign In | EduShare',
        layout: 'layouts/auth',
        loginError: message,
        credential: cred || '',
        returnTo: isSafeReturnTo(returnTo) ? returnTo : '',
        csrfToken: req.session?.csrfToken || ''
    });
}

const GENERIC_LOGIN_ERROR = 'Invalid credentials. Check your school ID or email and password, then try again.';
const PENDING_LOGIN_NOTICE = 'Account pending approval. You will be notified once activated.';

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
        // All-digit input (spaces/dashes stripped) is always an LRN attempt:
        // exactly 12 digits -> student lookup; anything else -> helpful hint.
        const lrnDigits = looksLikeLrn(rawCred);
        if (!cred) {
            return renderLoginError(req, res, 400, GENERIC_LOGIN_ERROR, rawCred.trim(), safeReturnTo);
        }
        // Numeric identifiers must be full 12-digit LRNs; anything shorter is a typo.
        if (lrnDigits !== null && lrnDigits.length !== 12) {
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

        // Pre-password generic gate: missing accounts and deactivated
        // (non-pending) accounts stop here with no enumeration. Pending
        // accounts pass through to bcrypt + the post-password status gate
        // below, where a correct password yields the approval notice.
        if (!user || (!user.is_active && user.status !== 'pending')) {
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

        // Post-password status gate: correct password proven, so naming the
        // pending state reveals nothing to an attacker (wrong password stays
        // generic above). Non-active accounts never get a session.
        if (user.status !== 'active') {
            await logLoginAttempt(user.id, req, false);
            await delay(400);
            const notice = user.status === 'pending' ? PENDING_LOGIN_NOTICE : GENERIC_LOGIN_ERROR;
            return renderLoginError(req, res, 401, notice, rawCred.trim(), safeReturnTo);
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

        // Session: explicit 12-hour ceiling at sign-in (remember-me control removed
        // from login). Rolling refresh otherwise rides the 24h default in
        // src/app.js unless the branding middleware's session_timeout overrides.
        req.session.cookie.maxAge = 12 * 60 * 60 * 1000; // 12 hours

        await logLoginAttempt(user.id, req, true);

        if (user.force_password_change) {
            // Stash the same-role returnTo so the post-change redirect can honor it.
            if (safeReturnTo) req.session.returnTo = safeReturnTo;
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
    const stashed = typeof req.session?.returnTo === 'string' ? req.session.returnTo : '';
    res.render('auth/change-password', {
        title: 'Change Password | EduShare',
        layout: 'layouts/auth',
        csrfToken: req.session.csrfToken,
        returnTo: isSafeReturnTo(stashed) ? stashed : ''
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

        // Phase 7: rotate session ID after password change (fixation defense) and
        // rotate CSRF token — delete so ensureToken() issues a fresh one next request.
        const keptUser = { ...req.session.user, force_password_change: false };
        try {
            await new Promise((resolve, reject) => {
                req.session.regenerate((err) => (err ? reject(err) : resolve()));
            });
            req.session.user = keptUser;
        } catch {
            // Regenerate failed — fall back to in-place session + explicit save.
            req.session.user = keptUser;
            await new Promise((resolve) => req.session.save(() => resolve()));
        }
        delete req.session.csrfToken;
        setFlash(req, 'success', 'Password updated successfully!');

        const role = req.session.user.role;
        // Honor a stashed same-role returnTo (from the forced-change redirect at
        // login), then clear it so it can never replay on a later change.
        // NOTE: req.session.regenerate() above drops all session fields, so a
        // returnTo posted via the change-password form body is the live carrier;
        // the session copy survives only when regenerate fell back to in-place.
        const posted = typeof req.body?.returnTo === 'string' ? req.body.returnTo : '';
        const stashed = isSafeReturnTo(posted) ? posted
            : (typeof req.session.returnTo === 'string' ? req.session.returnTo : '');
        delete req.session.returnTo;
        const honored = isSafeReturnTo(stashed)
            && (stashed === `/${role}` || stashed.startsWith(`/${role}/`))
            ? stashed : null;
        if (honored) return res.redirect(honored);
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
            avatarUrl = `/files/avatars/${req.file.filename}`;
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
            res.clearCookie('connect.sid');
            res.redirect('/auth/login');
        });
    } else {
        res.redirect('/auth/login');
    }
}

// ---- Task 5: self-registration (OTP) ----

const TEACHER_EMAIL_DOMAIN = '@zahs.edu.ph';
const GENERIC_REGISTER_ERROR = 'Invalid details. Check your information and try again.';
const GENERIC_CODE_ERROR = 'Code invalid or expired. Request a new code and try again.';
const PASSWORD_RULE_MESSAGE = 'Password must be at least 10 characters with upper/lowercase letters and a number.';

// Grade vocabulary lives in sectionService (single 7-12 list shared by
// every surface). The local alias below stays so existing teacher-code
// references keep working without a wider rename.
const TEACHER_GRADES = sectionService.TEACHER_GRADES;

// Optional teacher self-declared fields: blank stays NULL (admin corrects at
// approval). Grade is whitelist-checked; section is free text (max 50 chars)
// since class assignments vary per teacher and SHS strands are not yet known.
function cleanTeacherGrade(raw) {
    const v = String(raw || '').trim();
    return TEACHER_GRADES.includes(v) ? v : null;
}

function cleanTeacherSection(raw) {
    const v = String(raw || '').trim().slice(0, 50);
    return v.length > 0 ? v : null;
}

function validPassword(raw) {
    const pw = String(raw || '');
    return pw.length >= 10 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw);
}

function validName(raw) {
    return typeof raw === 'string' && raw.trim().length >= 1 && raw.trim().length <= 100;
}

function normalizeLrn(raw) {
    return String(raw || '').replace(/[\s-]/g, '');
}

function renderRegisterError(res, status, message, preservedForms, csrfToken) {
    const teacherForm = { first_name: '', last_name: '', email: '', ...(preservedForms?.teacherForm || {}) };
    const studentForm = { first_name: '', last_name: '', email: '', lrn: '', ...(preservedForms?.studentForm || {}) };
    return res.status(status).render('auth/register', {
        title: 'Create Account | EduShare',
        layout: 'layouts/auth',
        csrfToken: csrfToken || '',
        teacherForm,
        studentForm,
        registerError: message,
        codeSentTo: preservedForms?.codeSentTo || null,
        activeTab: preservedForms?.activeTab || 'teacher',
        studentGrades: sectionService.STUDENT_GRADES
    });
}

function renderRegisterPage(req, res, overrides = {}) {
    const { ensureToken } = require('../middleware/csrf');
    ensureToken(req);
    return res.render('auth/register', {
        title: 'Create Account | EduShare',
        layout: 'layouts/auth',
        csrfToken: req.session.csrfToken,
        teacherForm: {},
        studentForm: {},
        registerError: null,
        codeSentTo: null,
        activeTab: 'teacher',
        studentGrades: sectionService.STUDENT_GRADES,
        ...overrides
    });
}

async function showRegister(req, res) {
    return renderRegisterPage(req, res);
}

async function requestTeacherCode(req, res) {
    try {
        const { ensureToken } = require('../middleware/csrf');
        ensureToken(req);
        const csrfToken = req.session.csrfToken;
        const first_name = String(req.body?.first_name || '').trim();
        const last_name = String(req.body?.last_name || '').trim();
        const email = String(req.body?.email || '').trim().toLowerCase();
        const grade_level = cleanTeacherGrade(req.body?.grade_level);
        const section = cleanTeacherSection(req.body?.section);
        const preserved = { teacherForm: { first_name, last_name, email, grade_level: grade_level || '', section: section || '' }, studentForm: {}, activeTab: 'teacher' };
        if (!validName(first_name) || !validName(last_name)) {
            return renderRegisterError(res, 400, 'Enter your first and last name.', preserved, csrfToken);
        }
        if (!email.endsWith(TEACHER_EMAIL_DOMAIN)) {
            return renderRegisterError(res, 400, `Teacher registration requires a ${TEACHER_EMAIL_DOMAIN} email.`, preserved, csrfToken);
        }
        if (!validPassword(req.body?.password)) {
            return renderRegisterError(res, 400, PASSWORD_RULE_MESSAGE, preserved, csrfToken);
        }
        const existing = await query('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1', [email]);
        if (existing.length > 0) {
            return renderRegisterError(res, 400, GENERIC_REGISTER_ERROR, preserved, csrfToken);
        }
        try {
            await requestOtp(email, 'teacher_register');
        } catch (err) {
            if (err instanceof RateLimited) {
                return renderRegisterError(res, 429, 'Too many code requests. Please wait 15 minutes.', preserved, csrfToken);
            }
            throw err;
        }
        return renderRegisterPage(req, res, {
            teacherForm: { first_name, last_name, email, grade_level: grade_level || '', section: section || '' },
            codeSentTo: email,
            activeTab: 'teacher'
        });
    } catch (err) {
        console.error('Teacher request-code error:', err);
        try {
            return renderRegisterError(res, 500, GENERIC_REGISTER_ERROR, { activeTab: 'teacher' }, req.session?.csrfToken || '');
        } catch {
            setFlash(req, 'error', GENERIC_REGISTER_ERROR);
            return res.redirect('/auth/register');
        }
    }
}

async function verifyTeacherRegister(req, res) {
    try {
        const { ensureToken } = require('../middleware/csrf');
        ensureToken(req);
        const csrfToken = req.session.csrfToken;
        const first_name = String(req.body?.first_name || '').trim();
        const last_name = String(req.body?.last_name || '').trim();
        const email = String(req.body?.email || '').trim().toLowerCase();
        const password = String(req.body?.password || '');
        const code = String(req.body?.code || '').trim();
        const grade_level = cleanTeacherGrade(req.body?.grade_level);
        const section = cleanTeacherSection(req.body?.section);
        const preserved = { teacherForm: { first_name, last_name, email, grade_level: grade_level || '', section: section || '' }, studentForm: {}, activeTab: 'teacher' };
        if (!validName(first_name) || !validName(last_name)) {
            return renderRegisterError(res, 400, 'Enter your first and last name.', preserved, csrfToken);
        }
        if (!email.endsWith(TEACHER_EMAIL_DOMAIN)) {
            return renderRegisterError(res, 400, `Teacher registration requires a ${TEACHER_EMAIL_DOMAIN} email.`, preserved, csrfToken);
        }
        if (!validPassword(password)) {
            return renderRegisterError(res, 400, PASSWORD_RULE_MESSAGE, preserved, csrfToken);
        }
        if (!/^\d{6}$/.test(code)) {
            return renderRegisterError(res, 400, GENERIC_CODE_ERROR, preserved, csrfToken);
        }
        const existing = await query('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1', [email]);
        if (existing.length > 0) {
            return renderRegisterError(res, 400, GENERIC_REGISTER_ERROR, preserved, csrfToken);
        }
        try {
            await verifyOtp(email, 'teacher_register', code);
        } catch (err) {
            if (err instanceof InvalidCode || err instanceof ExpiredOrMissing) {
                return renderRegisterError(res, 400, GENERIC_CODE_ERROR, preserved, csrfToken);
            }
            throw err;
        }
        const hash = await bcrypt.hash(password, 10);
        const newUserId = await withTransaction(async (conn) => {
            const [userRes] = await conn.query(
                `INSERT INTO users (first_name, last_name, email, password_hash, role, is_active, status, force_password_change)
                 VALUES (?, ?, ?, ?, 'teacher', 0, 'pending', 0)`,
                [first_name, last_name, email, hash]
            );
            await conn.query(
                `INSERT INTO teachers (user_id, employee_id, department, specialization, grade_level, section)
                 VALUES (?, NULL, 'Junior High School', 'General Education', ?, ?)`,
                [userRes.insertId, grade_level, section]
            );
            return userRes.insertId;
        });
        try {
            await query(
                `INSERT INTO activity_logs (user_id, action, description, category, ip_address, user_agent)
                 VALUES (?, 'Registration Submitted', 'Teacher account submitted for admin approval', 'account', ?, ?)`,
                [newUserId, req.ip, (req.headers['user-agent'] || '').slice(0, 255)]
            );
        } catch {
            // Never block registration on audit-log failure.
        }
        setFlash(req, 'success', 'Account created — wait for admin approval.');
        return res.redirect('/auth/login');
    } catch (err) {
        console.error('Teacher verify error:', err);
        try {
            return renderRegisterError(res, 500, GENERIC_REGISTER_ERROR, { activeTab: 'teacher' }, req.session?.csrfToken || '');
        } catch {
            setFlash(req, 'error', GENERIC_REGISTER_ERROR);
            return res.redirect('/auth/register');
        }
    }
}

// Public type-to-search lookup: which sections exist for a grade.
// The section input never dumps the whole list — q (min 1 char) is
// required, results are capped at 8 plain strings (no teacher names,
// emails, or class codes leak), and grade_level is whitelist-checked
// so an attacker cannot scrape the full section roster at once.
async function suggestSections(req, res) {
    try {
        const gradeLevel = String(req.query?.grade_level || '').trim();
        const q = String(req.query?.q || '').trim();
        if (!sectionService.STUDENT_GRADES.includes(gradeLevel) || q.length < 1) {
            return res.json({ sections: [] });
        }
        const sections = await sectionService.suggestSections(gradeLevel, q.slice(0, 50));
        return res.json({ sections });
    } catch (err) {
        console.error('Section suggest error:', err);
        return res.json({ sections: [] });
    }
}

async function requestStudentCode(req, res) {
    try {
        const { ensureToken } = require('../middleware/csrf');
        ensureToken(req);
        const csrfToken = req.session.csrfToken;
        const first_name = String(req.body?.first_name || '').trim();
        const last_name = String(req.body?.last_name || '').trim();
        const email = String(req.body?.email || '').trim().toLowerCase();
        const lrn = normalizeLrn(req.body?.lrn);
        // Grade/section declared at signup so the admin + adviser can route
        // the approval to the right class. Converged to the canonical
        // spelling when the grade already has one (soft-match: free text
        // still accepted so students are never blocked by teacher rollout).
        const grade_level = sectionService.cleanStudentGrade(req.body?.grade_level);
        const rawSection = sectionService.cleanSection(req.body?.section);
        const gender = sectionService.cleanGender(req.body?.gender, 'Other');
        const preserved = { studentForm: { first_name, last_name, email, lrn, grade_level: grade_level || '', section: rawSection || '', gender }, teacherForm: {}, activeTab: 'student' };
        if (!validName(first_name) || !validName(last_name)) {
            return renderRegisterError(res, 400, 'Enter your first and last name.', preserved, csrfToken);
        }
        if (!grade_level || !rawSection) {
            return renderRegisterError(res, 400, 'Select your grade level and section so your adviser can find your registration.', preserved, csrfToken);
        }
        if (!/^\d{12}$/.test(lrn)) {
            return renderRegisterError(res, 400, 'Student LRN must be exactly 12 digits. Check the number and try again.', preserved, csrfToken);
        }
        if (!email.includes('@')) {
            return renderRegisterError(res, 400, GENERIC_REGISTER_ERROR, preserved, csrfToken);
        }
        if (!validPassword(req.body?.password)) {
            return renderRegisterError(res, 400, PASSWORD_RULE_MESSAGE, preserved, csrfToken);
        }
        const dupEmail = await query('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1', [email]);
        const dupLrn = await query('SELECT id FROM students WHERE student_id = ? LIMIT 1', [lrn]);
        if (dupEmail.length > 0 || dupLrn.length > 0) {
            return renderRegisterError(res, 400, GENERIC_REGISTER_ERROR, preserved, csrfToken);
        }
        try {
            await requestOtp(email, 'student_register');
        } catch (err) {
            if (err instanceof RateLimited) {
                return renderRegisterError(res, 429, 'Too many code requests. Please wait 15 minutes.', preserved, csrfToken);
            }
            throw err;
        }
        // Canonicalize now so the verify step shows the exact spelling that
        // will be saved (picked from the lookup, or the trimmed free text).
        const section = await sectionService.canonicalizeSection(grade_level, rawSection);
        return renderRegisterPage(req, res, {
            studentForm: { first_name, last_name, email, lrn, grade_level, section, gender },
            codeSentTo: email,
            activeTab: 'student'
        });
    } catch (err) {
        console.error('Student request-code error:', err);
        try {
            return renderRegisterError(res, 500, GENERIC_REGISTER_ERROR, { activeTab: 'student' }, req.session?.csrfToken || '');
        } catch {
            setFlash(req, 'error', GENERIC_REGISTER_ERROR);
            return res.redirect('/auth/register');
        }
    }
}

async function verifyStudentRegister(req, res) {
    try {
        const { ensureToken } = require('../middleware/csrf');
        ensureToken(req);
        const csrfToken = req.session.csrfToken;
        const first_name = String(req.body?.first_name || '').trim();
        const last_name = String(req.body?.last_name || '').trim();
        const email = String(req.body?.email || '').trim().toLowerCase();
        const lrn = normalizeLrn(req.body?.lrn);
        const password = String(req.body?.password || '');
        const code = String(req.body?.code || '').trim();
        // Re-validate the hidden grade/section/gender fields: the code step
        // re-posts them as hidden inputs, so the final write must not trust
        // them blindly (a forged POST could land in any section otherwise).
        const grade_level = sectionService.cleanStudentGrade(req.body?.grade_level);
        const rawSection = sectionService.cleanSection(req.body?.section);
        const gender = sectionService.cleanGender(req.body?.gender, 'Other');
        const preserved = { studentForm: { first_name, last_name, email, lrn, grade_level: grade_level || '', section: rawSection || '', gender }, teacherForm: {}, activeTab: 'student' };
        if (!validName(first_name) || !validName(last_name)) {
            return renderRegisterError(res, 400, 'Enter your first and last name.', preserved, csrfToken);
        }
        if (!grade_level || !rawSection) {
            return renderRegisterError(res, 400, 'Your grade level and section are missing. Start registration again so your adviser can find you.', preserved, csrfToken);
        }
        if (!/^\d{12}$/.test(lrn)) {
            return renderRegisterError(res, 400, 'Student LRN must be exactly 12 digits. Check the number and try again.', preserved, csrfToken);
        }
        if (!email.includes('@')) {
            return renderRegisterError(res, 400, GENERIC_REGISTER_ERROR, preserved, csrfToken);
        }
        if (!validPassword(password)) {
            return renderRegisterError(res, 400, PASSWORD_RULE_MESSAGE, preserved, csrfToken);
        }
        if (!/^\d{6}$/.test(code)) {
            return renderRegisterError(res, 400, GENERIC_CODE_ERROR, preserved, csrfToken);
        }
        const dupEmail = await query('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1', [email]);
        const dupLrn = await query('SELECT id FROM students WHERE student_id = ? LIMIT 1', [lrn]);
        if (dupEmail.length > 0 || dupLrn.length > 0) {
            return renderRegisterError(res, 400, GENERIC_REGISTER_ERROR, preserved, csrfToken);
        }
        try {
            await verifyOtp(email, 'student_register', code);
        } catch (err) {
            if (err instanceof InvalidCode || err instanceof ExpiredOrMissing) {
                return renderRegisterError(res, 400, GENERIC_CODE_ERROR, preserved, csrfToken);
            }
            throw err;
        }
        const hash = await bcrypt.hash(password, 10);
        const newUserId = await withTransaction(async (conn) => {
            const [userRes] = await conn.query(
                `INSERT INTO users (first_name, last_name, email, password_hash, role, is_active, status, force_password_change)
                 VALUES (?, ?, ?, ?, 'student', 0, 'pending', 0)`,
                [first_name, last_name, email, hash]
            );
            // Converge to the canonical section spelling when one exists
            // for this grade (e.g. typed "rizal" -> saved "Rizal"), so the
            // adviser roster + approval queries match exactly.
            const section = await sectionService.canonicalizeSection(grade_level, rawSection);
            await conn.query(
                `INSERT INTO students (user_id, student_id, grade_level, section, gender)
                 VALUES (?, ?, ?, ?, ?)`,
                [userRes.insertId, lrn, grade_level, section, gender]
            );
            return userRes.insertId;
        });
        try {
            await query(
                `INSERT INTO activity_logs (user_id, action, description, category, ip_address, user_agent)
                 VALUES (?, 'Registration Submitted', ?, 'account', ?, ?)`,
                [newUserId, `Student account submitted for admin approval (${grade_level} - ${section})`, req.ip, (req.headers['user-agent'] || '').slice(0, 255)]
            );
        } catch {
            // Never block registration on audit-log failure.
        }
        setFlash(req, 'success', 'Account created — wait for admin approval.');
        return res.redirect('/auth/login');
    } catch (err) {
        console.error('Student verify error:', err);
        try {
            return renderRegisterError(res, 500, GENERIC_REGISTER_ERROR, { activeTab: 'student' }, req.session?.csrfToken || '');
        } catch {
            setFlash(req, 'error', GENERIC_REGISTER_ERROR);
            return res.redirect('/auth/register');
        }
    }
}

// ---- Forgot / reset password via email OTP (purpose 'password_reset') ----

const RESET_INVALID_CODE = 'Code invalid or expired. Request a new code and try again.';
// Anti-enumeration: request/verify pages never reveal whether an email exists.
const RESET_SENT_NOTICE = 'If an account exists for that email, a verification code was sent.';

function renderForgotPage(req, res, overrides = {}) {
    const { ensureToken } = require('../middleware/csrf');
    ensureToken(req);
    return res.render('auth/forgot-password', {
        title: 'Forgot Password | EduShare',
        layout: 'layouts/auth',
        csrfToken: req.session.csrfToken,
        email: '',
        codeSentTo: null,
        forgotError: null,
        sentNotice: RESET_SENT_NOTICE,
        ...overrides
    });
}

function renderForgotError(res, status, message, preserved, csrfToken) {
    return res.status(status).render('auth/forgot-password', {
        title: 'Forgot Password | EduShare',
        layout: 'layouts/auth',
        csrfToken: csrfToken || '',
        email: preserved?.email || '',
        codeSentTo: preserved?.codeSentTo || null,
        forgotError: message,
        sentNotice: RESET_SENT_NOTICE
    });
}

function renderResetPage(req, res, email, overrides = {}) {
    const { ensureToken } = require('../middleware/csrf');
    ensureToken(req);
    return res.render('auth/reset-password', {
        title: 'Set New Password | EduShare',
        layout: 'layouts/auth',
        csrfToken: req.session.csrfToken,
        email,
        resetError: null,
        ...overrides
    });
}

function renderResetError(res, status, message, email, csrfToken) {
    return res.status(status).render('auth/reset-password', {
        title: 'Set New Password | EduShare',
        layout: 'layouts/auth',
        csrfToken: csrfToken || '',
        email,
        resetError: message
    });
}

async function showForgot(req, res) {
    return renderForgotPage(req, res);
}

// Step 1: mint an OTP for any syntactically valid email. Unknown addresses take
// the same success path (no OTP minted, same notice) to avoid enumeration.
// Rejected + pending users may still reset (they may need access to appeal).
async function requestResetCode(req, res) {
    try {
        const { ensureToken } = require('../middleware/csrf');
        ensureToken(req);
        const csrfToken = req.session.csrfToken;
        const email = String(req.body?.email || '').trim().toLowerCase();
        const preserved = { email, codeSentTo: null };
        if (!email.includes('@') || email.length > 150) {
            return renderForgotError(res, 400, 'Enter the email address linked to your account.', preserved, csrfToken);
        }
        const rows = await query('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1', [email]);
        if (rows.length === 0) {
            // Pretend a code was sent — same shape/timing as the real path.
            await delay(200);
            return renderForgotPage(req, res, { email, codeSentTo: email, forgotError: null });
        }
        try {
            await requestOtp(email, 'password_reset');
        } catch (err) {
            if (err instanceof RateLimited) {
                return renderForgotError(res, 429, 'Too many code requests. Please wait 15 minutes and try again.', preserved, csrfToken);
            }
            throw err;
        }
        return renderForgotPage(req, res, { email, codeSentTo: email });
    } catch (err) {
        console.error('Forgot request-code error:', err);
        try {
            return renderForgotError(res, 500, 'Something went wrong. Please try again.', { email: String(req.body?.email || '') }, req.session?.csrfToken || '');
        } catch {
            setFlash(req, 'error', 'Something went wrong. Please try again.');
            return res.redirect('/auth/forgot-password');
        }
    }
}

// Step 2: verify email+code+new passwords in ONE POST (mirrors register verify).
// The code is consumed only if the password update succeeds.
async function verifyResetCode(req, res) {
    try {
        const { ensureToken } = require('../middleware/csrf');
        ensureToken(req);
        const csrfToken = req.session.csrfToken;
        const email = String(req.body?.email || '').trim().toLowerCase();
        const code = String(req.body?.code || '').trim();
        const newPassword = String(req.body?.new_password || '');
        const confirmPassword = String(req.body?.confirm_password || '');
        if (!email.includes('@')) {
            return renderResetError(res, 400, 'Enter the email address linked to your account.', email, csrfToken);
        }
        if (!/^\d{6}$/.test(code)) {
            return renderResetError(res, 400, RESET_INVALID_CODE, email, csrfToken);
        }
        if (!validPassword(newPassword)) {
            return renderResetError(res, 400, PASSWORD_RULE_MESSAGE, email, csrfToken);
        }
        if (newPassword !== confirmPassword) {
            return renderResetError(res, 400, 'New passwords do not match.', email, csrfToken);
        }
        try {
            await verifyOtp(email, 'password_reset', code);
        } catch (err) {
            if (err instanceof InvalidCode || err instanceof ExpiredOrMissing) {
                return renderResetError(res, 400, RESET_INVALID_CODE, email, csrfToken);
            }
            throw err;
        }
        return doResetPassword(req, res, { email, newPassword, csrfToken });
    } catch (err) {
        console.error('Reset verify error:', err);
        try {
            return renderResetError(res, 500, 'Something went wrong. Please try again.', String(req.body?.email || ''), req.session?.csrfToken || '');
        } catch {
            setFlash(req, 'error', 'Something went wrong. Please try again.');
            return res.redirect('/auth/forgot-password');
        }
    }
}

// Step 2b: GET after a fresh code request — shows the new-password form for the
// verified-sent address (code itself is entered in the form, no signed token).
async function showReset(req, res) {
    const { ensureToken } = require('../middleware/csrf');
    ensureToken(req);
    const email = String(req.query?.email || '').trim().toLowerCase();
    return renderResetPage(req, res, email.includes('@') ? email : '');
}

async function doResetPassword(req, res, verified = null) {
    try {
        const email = verified?.email ?? String(req.body?.email || '').trim().toLowerCase();
        const newPassword = verified?.newPassword ?? String(req.body?.new_password || '');
        const confirmPassword = verified ? verified.newPassword : String(req.body?.confirm_password || '');
        const csrfToken = verified?.csrfToken ?? req.session?.csrfToken ?? '';
        if (!email.includes('@')) {
            return renderResetError(res, 400, 'Enter the email address linked to your account.', email, csrfToken);
        }
        if (!validPassword(newPassword)) {
            return renderResetError(res, 400, PASSWORD_RULE_MESSAGE, email, csrfToken);
        }
        if (newPassword !== confirmPassword) {
            return renderResetError(res, 400, 'New passwords do not match.', email, csrfToken);
        }
        const rows = await query('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1', [email]);
        if (rows.length === 0) {
            // Keep the anti-enumeration promise: same generic success path.
            setFlash(req, 'success', 'Password updated. Sign in with your new password.');
            return res.redirect('/auth/login');
        }
        const hash = await bcrypt.hash(newPassword, 10);
        await query(
            'UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?',
            [hash, rows[0].id]
        );
        try {
            await query(
                `INSERT INTO activity_logs (user_id, action, description, category, ip_address, user_agent)
                 VALUES (?, 'Password Reset', 'Password reset via email verification code', 'security', ?, ?)`,
                [rows[0].id, req.ip, (req.headers['user-agent'] || '').slice(0, 255)]
            );
        } catch {
            // Never block a reset on audit-log failure.
        }
        setFlash(req, 'success', 'Password updated. Sign in with your new password.');
        return res.redirect('/auth/login');
    } catch (err) {
        console.error('Reset password error:', err);
        try {
            return renderResetError(res, 500, 'Something went wrong. Please try again.', String(req.body?.email || verified?.email || ''), req.session?.csrfToken || '');
        } catch {
            setFlash(req, 'error', 'Something went wrong. Please try again.');
            return res.redirect('/auth/forgot-password');
        }
    }
}

module.exports = {
    showLogin,
    login,
    showChangePassword,
    changePassword,
    updateProfile,
    logout,
    showRegister,
    suggestSections,
    requestTeacherCode,
    verifyTeacherRegister,
    requestStudentCode,
    verifyStudentRegister,
    showForgot,
    requestResetCode,
    showReset,
    verifyResetCode
};
