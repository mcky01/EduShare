const { query } = require('../config/database');
const env = require('../config/env');

let cachedSettings = null;
let lastFetch = 0;
// Cached session_timeout in minutes (from system_settings). See SETTINGS_KEYS note below.
let cachedSessionTimeoutMin = null;
// Cache-buster for unversioned static assets (CSS in particular). Bump this
// whenever public/css or other non-?v assets change so browsers re-fetch them.
const CSS_VERSION = '20260918';

async function getBrandingSettings() {
    const now = Date.now();
    if (cachedSettings && now - lastFetch < 30000) {
        return cachedSettings;
    }

    try {
        const rows = await query('SELECT setting_key, setting_value FROM system_settings');
        const map = {};
        for (const r of rows) {
            map[r.setting_key] = r.setting_value;
        }

        cachedSettings = {
            name: map.school_name || env.SCHOOL_NAME,
            abbr: map.school_abbr || env.SCHOOL_ABBR,
            motto: map.school_motto || env.SCHOOL_MOTTO,
            year: map.school_year || env.SCHOOL_YEAR,
            term: map.current_term || env.CURRENT_TERM,
            logo: map.school_logo || '/images/zahs-logo.png',
            // Phase 0.2: AI feature flags (seeded '1' in initDatabase; missing = enabled).
            flags: {
                allowStudentChat: map.allow_student_chat === undefined ? true : map.allow_student_chat !== '0',
                allowAiLesson: map.allow_ai_lesson === undefined ? true : map.allow_ai_lesson !== '0'
            }
        };
        // SETTINGS_KEYS known in system_settings: school_name, school_abbr, school_motto,
        // school_year, current_term, school_logo, session_timeout (minutes, default 120,
        // valid range 5..1440), allow_student_chat, allow_ai_lesson.
        // Settings load async — session cookie maxAge applied per-request below from cache.
        if (map.session_timeout !== undefined) {
            const mins = parseInt(map.session_timeout, 10);
            cachedSessionTimeoutMin = Number.isFinite(mins)
                ? Math.min(1440, Math.max(5, mins))
                : null;
        } else {
            cachedSessionTimeoutMin = null;
        }
        lastFetch = now;
        return cachedSettings;
    } catch {
        return {
            name: env.SCHOOL_NAME,
            abbr: env.SCHOOL_ABBR,
            motto: env.SCHOOL_MOTTO,
            year: env.SCHOOL_YEAR,
            term: env.CURRENT_TERM,
            logo: '/images/zahs-logo.png',
            flags: { allowStudentChat: true, allowAiLesson: true }
        };
    }
}

async function brandingMiddleware(req, res, next) {
    const { ensureToken } = require('./csrf');
    ensureToken(req);
    res.locals.csrfToken = req.session?.csrfToken || '';
    res.locals.school = await getBrandingSettings();
    res.locals.user = req.session?.user || null;
    res.locals.currentPath = req.path;
    res.locals.cssVersion = CSS_VERSION;

    // Student notification badge: unread count for the bell (0 for guests / non-students).
    // Best-effort single indexed COUNT; never breaks page render on DB error.
    res.locals.unreadNotifications = 0;
    try {
        const sessUser = req.session?.user;
        if (sessUser && sessUser.role === 'student' && sessUser.student_profile_id) {
            const sid = parseInt(sessUser.student_profile_id, 10);
            if (Number.isInteger(sid) && sid > 0) {
                const rows = await query('SELECT COUNT(*) AS cnt FROM notifications WHERE student_id = ? AND is_read = 0', [sid]);
                res.locals.unreadNotifications = rows[0] ? Number(rows[0].cnt) || 0 : 0;
            }
        }
    } catch { /* badge stays 0 */ }

    // Flash messages (single-use: read into res.locals, then clear AFTER
    // the response is sent so a slow session-store write cannot swallow
    // the flash before it is persisted. Clearing on 'finish' also keeps
    // concurrent in-flight requests from consuming each other's toasts.)
    res.locals.success = req.session?.flashSuccess || null;
    res.locals.error = req.session?.flashError || null;
    res.locals.info = req.session?.flashInfo || null;
    const hadFlash = !!(res.locals.success || res.locals.error || res.locals.info);

    if (req.session) {
        // Phase 7: apply cached session_timeout (minutes, clamped 5..1440) to cookie maxAge.
        // Default 24h comes from src/app.js; login sets explicit 12h at sign-in.
        if (cachedSessionTimeoutMin && req.session.cookie) {
            req.session.cookie.maxAge = cachedSessionTimeoutMin * 60 * 1000;
        }
        if (hadFlash) {
            res.on('finish', () => {
                // Best-effort consume: only clears if the flash we rendered is
                // still the stored one (never wipes a newer flash set later).
                const s = req.session;
                if (!s) return;
                if (res.locals.success && s.flashSuccess === res.locals.success) s.flashSuccess = null;
                if (res.locals.error && s.flashError === res.locals.error) s.flashError = null;
                if (res.locals.info && s.flashInfo === res.locals.info) s.flashInfo = null;
                // Persist the consume explicitly — express-session only saves
                // on req end, and 'finish' fires after that save already ran.
                if (typeof s.save === 'function') s.save(() => {});
            });
        }
    }

    next();
}

function setFlash(req, type, message) {
    if (!req.session) return;
    if (type === 'success') req.session.flashSuccess = message;
    if (type === 'error') req.session.flashError = message;
    if (type === 'info') req.session.flashInfo = message;
}

module.exports = {
    brandingMiddleware,
    setFlash,
    clearBrandingCache: () => { cachedSettings = null; }
};
