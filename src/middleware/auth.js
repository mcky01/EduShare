function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        if (req.session.user.force_password_change && !req.path.startsWith('/auth/change-password') && !req.path.startsWith('/auth/logout')) {
            return res.redirect('/auth/change-password');
        }
        return next();
    }
    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }
    const target = req.originalUrl && req.originalUrl !== '/' ? `?returnTo=${encodeURIComponent(req.originalUrl)}` : '';
    return res.redirect(`/auth/login${target}`);
}

function requireRole(role) {
    return (req, res, next) => {
        if (!req.session || !req.session.user) {
            return res.redirect('/auth/login');
        }
        if (req.session.user.role !== role) {
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(403).json({ error: 'Access forbidden: Insufficient permissions.' });
            }
            return res.status(403).render('errors/403', {
                title: 'Access Forbidden'
            });
        }
        next();
    };
}

function isGuest(req, res, next) {
    if (req.session && req.session.user) {
        const role = req.session.user.role;
        if (role === 'admin') return res.redirect('/admin/dashboard');
        if (role === 'teacher') return res.redirect('/teacher/dashboard');
        if (role === 'student') return res.redirect('/student/dashboard');
    }
    next();
}

module.exports = {
    isAuthenticated,
    requireRole,
    isGuest
};
