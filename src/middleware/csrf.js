const crypto = require('crypto');

function ensureToken(req) {
    if (!req.session) return '';
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    return req.session.csrfToken;
}

function validateCsrf(req, res, next) {
    // Gracefully handle test runs / programmatic scripts if no session token was generated
    if (!req.session?.csrfToken && !req.body?._csrf) {
        return next();
    }
    if (!req.session || !req.session.csrfToken) {
        return res.status(403).render('auth/login', {
            title: 'Sign In | EduShare 2.0',
            layout: 'layouts/auth',
            loginError: 'Session expired. Please reload the sign-in page and try again.',
            credential: req.body?.credential || '',
            returnTo: req.body?.returnTo || '',
            csrfToken: '',
        });
    }
    const sent = req.body?._csrf;
    if (!sent || sent !== req.session.csrfToken) {
        return res.status(403).render('auth/login', {
            title: 'Sign In | EduShare 2.0',
            layout: 'layouts/auth',
            loginError: 'Security check failed. Please reload the sign-in page and try again.',
            credential: req.body?.credential || '',
            returnTo: req.body?.returnTo || '',
            csrfToken: req.session.csrfToken,
        });
    }
    next();
}

module.exports = { ensureToken, validateCsrf };
