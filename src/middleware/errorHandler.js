const multer = require('multer');
const { setFlash } = require('./branding');

function isJsonRequest(req) {
    if (req.xhr) return true;
    const accept = req.headers.accept || '';
    if (accept.includes('application/json')) return true;
    if (req.path.startsWith('/api/') || req.path === '/api') return true;
    return false;
}

function multerErrorHandler(err, req, res, next) {
    const isMulterError = err instanceof multer.MulterError;
    const isFileFilterError = err instanceof Error && (
        err.message === 'Only image files (JPG, PNG, GIF, WEBP) are allowed!' ||
        err.message === 'File type not allowed.'
    );
    if (!isMulterError && !isFileFilterError) {
        return next(err);
    }
    let message = err.message || 'File upload failed.';
    if (isMulterError && err.code === 'LIMIT_FILE_SIZE') {
        message = 'File too large.';
    }
    if (isJsonRequest(req)) {
        return res.status(400).json({ error: message });
    }
    setFlash(req, 'error', message);
    const back = req.get('Referer') || req.headers.referer;
    if (back) {
        return res.redirect('back');
    }
    return res.status(400).render('errors/400', {
        title: '400 - Bad Request',
        message
    });
}

function notFoundHandler(req, res, next) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ error: 'Endpoint or resource not found.' });
    }
    res.status(404).render('errors/404', {
        title: '404 - Page Not Found',
        message: 'The page you requested could not be found or has moved.'
    });
}

function globalErrorHandler(err, req, res, next) {
    console.error('🔥 Server Error:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(500).json({
            error: 'An unexpected server error occurred.',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
    res.status(500).render('errors/500', {
        title: '500 - Server Error',
        message: 'An internal error occurred while processing your request.',
        error: process.env.NODE_ENV === 'development' ? err : null
    });
}

module.exports = {
    multerErrorHandler,
    notFoundHandler,
    globalErrorHandler
};
