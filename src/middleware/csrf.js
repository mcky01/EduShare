const crypto = require('crypto');

function ensureToken(req) {
    if (!req.session) return '';
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    return req.session.csrfToken;
}

function isJsonRequest(req) {
    if (req.xhr) return true;
    const accept = req.headers.accept || '';
    if (accept.includes('application/json')) return true;
    if (req.path.startsWith('/api/') || req.path === '/api') return true;
    return false;
}

function csrfFailure(req, res) {
    if (isJsonRequest(req)) {
        return res.status(403).json({ error: 'Security check failed.' });
    }
    // Authenticated users get sent back to context (flash) instead of the
    // sign-in card: CSRF expiry on a signed-in form should not look like logout.
    if (req.session && req.session.user && req.method === 'POST') {
        const { setFlash } = require('./branding');
        setFlash(req, 'error', 'Session expired. Please try that action again.');
        const back = req.get('Referer');
        const target = typeof back === 'string' && back.startsWith('/') ? back : 'back';
        return res.status(403).redirect(target);
    }
    return res.status(403).render('auth/login', {
        title: 'Sign In | EduShare',
        layout: 'layouts/auth',
        loginError: 'Security check failed. Please reload the sign-in page and try again.',
        credential: req.body?.credential || '',
        returnTo: req.body?.returnTo || '',
        csrfToken: req.session?.csrfToken || '',
    });
}

function checkToken(req) {
    const sent = req.body?._csrf || req.headers['x-csrf-token'] || req.headers['csrf-token'];
    if (!req.session || !req.session.csrfToken) {
        return false;
    }
    if (!sent || sent !== req.session.csrfToken) {
        return false;
    }
    return true;
}

function validateCsrf(req, res, next) {
    if (!checkToken(req)) {
        return csrfFailure(req, res);
    }
    next();
}

// Same check as validateCsrf but intended to run AFTER multer on
// multipart routes. Multer parses req.body, so _csrf is available here.
// Use as: router.post('/x', auth, upload.single('f'), csrfAfterMulter, ctrl).
function csrfAfterMulter(req, res, next) {
    if (!checkToken(req)) {
        return csrfFailure(req, res);
    }
    next();
}

module.exports = { ensureToken, validateCsrf, csrfAfterMulter };
