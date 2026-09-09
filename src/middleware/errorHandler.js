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
    notFoundHandler,
    globalErrorHandler
};
