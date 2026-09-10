const { query } = require('../config/database');
const env = require('../config/env');

let cachedSettings = null;
let lastFetch = 0;
// Cached session_timeout in minutes (from system_settings). See SETTINGS_KEYS note below.
let cachedSessionTimeoutMin = null;

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
            logo: map.school_logo || '/images/zahs-logo.png'
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
            logo: '/images/zahs-logo.png'
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

    // Flash messages
    res.locals.success = req.session?.flashSuccess || null;
    res.locals.error = req.session?.flashError || null;
    res.locals.info = req.session?.flashInfo || null;

    if (req.session) {
        req.session.flashSuccess = null;
        req.session.flashError = null;
        req.session.flashInfo = null;
        // Phase 7: apply cached session_timeout (minutes, clamped 5..1440) to cookie maxAge.
        // Default 24h comes from src/app.js; login sets explicit 12h at sign-in.
        if (cachedSessionTimeoutMin && req.session.cookie) {
            req.session.cookie.maxAge = cachedSessionTimeoutMin * 60 * 1000;
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
