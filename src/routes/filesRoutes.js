const express = require('express');
const path = require('path');
const fs = require('fs');
const { isAuthenticated } = require('../middleware/auth');
const { query } = require('../config/database');
const { uploadsBase } = require('../middleware/upload');

const router = express.Router();

router.use(isAuthenticated);

const FILENAME_RE = /^[a-f0-9]{32}\.(pdf|docx|pptx|xlsx|txt|jpg|jpeg|png|gif|webp)$/;
const ALLOWED_SUBDIRS = ['materials', 'submissions', 'avatars', 'logos'];
const INLINE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

function deny(res) {
    return res.status(404).render('errors/404', {
        title: '404 - Page Not Found',
        message: 'The page you requested could not be found or has moved.'
    });
}

router.get('/:subDir/:filename', async (req, res) => {
    try {
        const { subDir, filename } = req.params;
        const user = req.session && req.session.user;

        if (!ALLOWED_SUBDIRS.includes(subDir) || !FILENAME_RE.test(filename)) {
            return deny(res);
        }

        const absPath = path.join(uploadsBase, subDir, filename);
        if (!absPath.startsWith(uploadsBase + path.sep)) {
            return deny(res);
        }
        if (!fs.existsSync(absPath)) {
            return deny(res);
        }

        const like = `%${filename}`;

        // Admin bypasses ownership checks (still authenticated + validated).
        const isAdmin = user && user.role === 'admin';

        if (subDir === 'avatars' || subDir === 'logos') {
            // Any authenticated user may view avatars / school logos.
        } else if (subDir === 'submissions') {
            const rows = await query(
                'SELECT id, activity_id, student_id FROM activity_submissions WHERE file_path LIKE ? LIMIT 1',
                [like]
            );
            const sub = rows[0];
            if (!sub) return deny(res);
            if (!isAdmin) {
                if (user.role === 'student' && sub.student_id === user.student_profile_id) {
                    // owner student — allowed
                } else if (user.role === 'teacher') {
                    const acts = await query(
                        'SELECT teacher_id FROM class_activities WHERE id = ? LIMIT 1',
                        [sub.activity_id]
                    );
                    if (!acts[0] || acts[0].teacher_id !== user.id) return deny(res);
                } else {
                    return deny(res);
                }
            }
        } else if (subDir === 'materials') {
            // Activity attachments live under materials/ too (class_activities.file_path).
            const libRows = await query(
                'SELECT id, teacher_id FROM library_items WHERE file_path LIKE ? LIMIT 1',
                [like]
            );
            const actRows = await query(
                'SELECT id, teacher_id FROM class_activities WHERE file_path LIKE ? LIMIT 1',
                [like]
            );
            const lib = libRows[0];
            const act = actRows[0];
            if (!lib && !act) return deny(res);
            if (!isAdmin) {
                const ownerId = lib ? lib.teacher_id : act.teacher_id;
                if (user.role === 'teacher' && ownerId === user.id) {
                    // owning teacher — allowed
                } else if (user.role === 'teacher') {
                    // Teacher of a class where the item/activity is posted.
                    let posted = [];
                    if (lib) {
                        posted = await query(
                            `SELECT c.id FROM class_materials cm
                             JOIN classes c ON cm.class_id = c.id
                             WHERE cm.library_item_id = ? AND c.teacher_id = ? LIMIT 1`,
                            [lib.id, user.id]
                        );
                    } else {
                        posted = await query(
                            `SELECT c.id FROM activity_posts ap
                             JOIN classes c ON ap.class_id = c.id
                             WHERE ap.activity_id = ? AND c.teacher_id = ? LIMIT 1`,
                            [act.id, user.id]
                        );
                    }
                    if (posted.length === 0) return deny(res);
                } else if (user.role === 'student') {
                    const profileId = user.student_profile_id;
                    if (!profileId) return deny(res);
                    let enrolled = [];
                    if (lib) {
                        enrolled = await query(
                            `SELECT e.id FROM enrollments e
                             JOIN class_materials cm ON cm.class_id = e.class_id
                             WHERE cm.library_item_id = ? AND e.student_id = ? AND e.status = 'active' LIMIT 1`,
                            [lib.id, profileId]
                        );
                    } else {
                        enrolled = await query(
                            `SELECT e.id FROM enrollments e
                             JOIN activity_posts ap ON ap.class_id = e.class_id
                             WHERE ap.activity_id = ? AND e.student_id = ? AND e.status = 'active' LIMIT 1`,
                            [act.id, profileId]
                        );
                    }
                    if (enrolled.length === 0) return deny(res);
                } else {
                    return deny(res);
                }
            }
        }

        const ext = path.extname(filename).toLowerCase().slice(1);
        const disposition = INLINE_EXTS.includes(ext) ? 'inline' : 'attachment';
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Content-Disposition', `${disposition}; filename="${filename}"`);
        return res.sendFile(absPath);
    } catch (err) {
        console.error('Files route error:', err);
        return deny(res);
    }
});

module.exports = router;
