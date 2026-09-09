const { query } = require('../config/database');
const env = require('../config/env');

let cachedSettings = null;
let lastFetch = 0;

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
