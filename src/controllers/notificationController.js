// Student notification reader API (JSON). All routes are student-scoped:
// the student profile id always comes from the session, never from params.
const notifications = require('../services/notificationService');

function studentProfileId(req) {
    return req.session && req.session.user ? req.session.user.student_profile_id : null;
}

// GET /api/notifications?limit=20&offset=0&unread=1
async function list(req, res) {
    try {
        const sid = studentProfileId(req);
        if (!sid) return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        const items = await notifications.getForStudent(sid, {
            limit: req.query.limit,
            offset: req.query.offset,
            unreadOnly: req.query.unread === '1' || req.query.unread === 'true'
        });
        const unread = await notifications.unreadCount(sid);
        res.json({ success: true, unread, items });
    } catch (err) {
        console.error('Notifications list error:', err);
        res.status(500).json({ error: 'Failed to load notifications.' });
    }
}

// GET /api/notifications/unread-count -> { unread }
async function count(req, res) {
    try {
        const sid = studentProfileId(req);
        if (!sid) return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        res.json({ unread: await notifications.unreadCount(sid) });
    } catch (err) {
        console.error('Notifications count error:', err);
        res.status(500).json({ error: 'Failed to load notification count.' });
    }
}

// POST /api/notifications/:id/read
async function markOne(req, res) {
    try {
        const sid = studentProfileId(req);
        if (!sid) return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        const { updated } = await notifications.markRead(sid, req.params.id);
        if (!updated) return res.status(404).json({ error: 'Notification not found.' });
        res.json({ success: true, unread: await notifications.unreadCount(sid) });
    } catch (err) {
        console.error('Notification mark-read error:', err);
        res.status(500).json({ error: 'Failed to update notification.' });
    }
}

// POST /api/notifications/read-all
async function markAll(req, res) {
    try {
        const sid = studentProfileId(req);
        if (!sid) return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        const { updated } = await notifications.markAllRead(sid);
        res.json({ success: true, updated, unread: 0 });
    } catch (err) {
        console.error('Notifications mark-all error:', err);
        res.status(500).json({ error: 'Failed to update notifications.' });
    }
}

module.exports = { list, count, markOne, markAll };
