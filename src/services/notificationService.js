// ========================================================
// notificationService — fan-out + read API for student notifications
// Writers: teacher/admin actions call notifyClass / notifyStudent.
//   Never throws: notification failure must not break the main action
//   (grading, posting, publishing). All writers catch internally and
//   return { created } counts for logging.
// Readers: student-scoped list / unreadCount / markRead / markAllRead.
//   Every reader filters by students.id (profile id from session),
//   never by a client-supplied id.
// Dedupe: UNIQUE(student_id, ref_type, ref_id, class_id) + INSERT IGNORE
//   so retries, double-clicks, and re-posts never create duplicates.
// ========================================================
const { query } = require('../config/database');

const TYPES = ['announcement', 'activity', 'material', 'quiz', 'grade', 'enrollment', 'reminder', 'system'];

function truncate(str, max = 500) {
    if (str === null || str === undefined) return null;
    const s = String(str).trim();
    if (!s) return null;
    return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

async function activeStudentIds(classId) {
    const rows = await query(
        "SELECT student_id FROM enrollments WHERE class_id = ? AND status = 'active'",
        [classId]
    );
    return rows.map((r) => r.student_id);
}

// Fan out one notification row per active student in the class.
// linkFor: (studentId) => deep-link URL string (same for all is fine).
async function notifyClass({ classId, type, title, message, linkFor, refType, refId }) {
    try {
        const cid = parseInt(classId, 10);
        if (!Number.isInteger(cid) || cid <= 0) return { created: 0 };
        if (!TYPES.includes(type)) type = 'system';
        const cleanTitle = truncate(title, 255) || 'New update';
        const cleanMessage = truncate(message, 500);
        // Coalesce to '' / 0: MySQL UNIQUE treats NULL as distinct, which
        // would silently disable dedupe for any ref-less call.
        const ref = refType ? String(refType).slice(0, 50) : '';
        const refIdInt = refId === null || refId === undefined ? NaN : parseInt(refId, 10);
        const safeRefId = Number.isInteger(refIdInt) ? refIdInt : 0;

        const studentIds = await activeStudentIds(cid);
        if (studentIds.length === 0) return { created: 0 };

        let created = 0;
        // Bulk INSERT IGNORE in chunks (999-row MySQL placeholder headroom).
        const CHUNK = 200;
        for (let i = 0; i < studentIds.length; i += CHUNK) {
            const chunk = studentIds.slice(i, i + CHUNK);
            const values = [];
            const placeholders = chunk.map((sid) => {
                let link = null;
                try {
                    link = typeof linkFor === 'function' ? linkFor(sid) : linkFor;
                } catch { link = null; }
                values.push(sid, cid, type, cleanTitle, cleanMessage, truncate(link, 500), ref, safeRefId);
                return '(?, ?, ?, ?, ?, ?, ?, ?)';
            });
            const res = await query(
                `INSERT IGNORE INTO notifications
                 (student_id, class_id, type, title, message, link_url, ref_type, ref_id)
                 VALUES ${placeholders.join(', ')}`,
                values
            );
            created += (res && typeof res.affectedRows === 'number') ? res.affectedRows : 0;
        }
        return { created };
    } catch (err) {
        console.error('notifyClass error:', err.message || err);
        return { created: 0 };
    }
}

async function notifyStudent({ studentId, classId, type, title, message, linkUrl, refType, refId }) {
    try {
        const sid = parseInt(studentId, 10);
        if (!Number.isInteger(sid) || sid <= 0) return { created: 0 };
        if (!TYPES.includes(type)) type = 'system';
        const cid = classId === null || classId === undefined ? null : parseInt(classId, 10);
        const res = await query(
            `INSERT IGNORE INTO notifications
             (student_id, class_id, type, title, message, link_url, ref_type, ref_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                sid,
                Number.isInteger(cid) && cid > 0 ? cid : null,
                type,
                truncate(title, 255) || 'New update',
                truncate(message, 500),
                truncate(linkUrl, 500),
                refType ? String(refType).slice(0, 50) : '',
                refId === null || refId === undefined || !Number.isInteger(parseInt(refId, 10)) ? 0 : parseInt(refId, 10)
            ]
        );
        return { created: (res && typeof res.affectedRows === 'number') ? res.affectedRows : 0 };
    } catch (err) {
        console.error('notifyStudent error:', err.message || err);
        return { created: 0 };
    }
}

// Same as notifyStudent, but a repeat event (e.g. teacher re-grades) re-arms
// the existing row: new title/message, back to unread. Used ONLY for grade
// paths; announcement/activity/material/quiz writers keep INSERT IGNORE so
// edits and double-clicks never re-spam students.
async function refreshStudent({ studentId, classId, type, title, message, linkUrl, refType, refId }) {
    try {
        const sid = parseInt(studentId, 10);
        if (!Number.isInteger(sid) || sid <= 0) return { created: 0 };
        if (!TYPES.includes(type)) type = 'system';
        const cid = classId === null || classId === undefined ? null : parseInt(classId, 10);
        const ref = refType ? String(refType).slice(0, 50) : '';
        const parsedRef = refId === null || refId === undefined ? NaN : parseInt(refId, 10);
        const safeRefId = Number.isInteger(parsedRef) ? parsedRef : 0;
        const res = await query(
            `INSERT INTO notifications
             (student_id, class_id, type, title, message, link_url, ref_type, ref_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE title = VALUES(title), message = VALUES(message),
                 link_url = VALUES(link_url), is_read = 0, read_at = NULL`,
            [
                sid,
                Number.isInteger(cid) && cid > 0 ? cid : null,
                type,
                truncate(title, 255) || 'New update',
                truncate(message, 500),
                truncate(linkUrl, 500),
                ref,
                safeRefId
            ]
        );
        return { created: (res && typeof res.affectedRows === 'number') ? res.affectedRows : 0 };
    } catch (err) {
        console.error('refreshStudent error:', err.message || err);
        return { created: 0 };
    }
}

async function getForStudent(studentId, { limit = 20, offset = 0, unreadOnly = false } = {}) {
    const sid = parseInt(studentId, 10);
    if (!Number.isInteger(sid) || sid <= 0) return [];
    const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
    const off = Math.max(parseInt(offset, 10) || 0, 0);
    const rows = await query(
        `SELECT n.*, c.class_name
         FROM notifications n
         LEFT JOIN classes c ON n.class_id = c.id
         WHERE n.student_id = ?${unreadOnly ? ' AND n.is_read = 0' : ''}
         ORDER BY n.created_at DESC
         LIMIT ? OFFSET ?`,
        [sid, lim, off]
    );
    return rows;
}

async function unreadCount(studentId) {
    const sid = parseInt(studentId, 10);
    if (!Number.isInteger(sid) || sid <= 0) return 0;
    const rows = await query(
        'SELECT COUNT(*) AS cnt FROM notifications WHERE student_id = ? AND is_read = 0',
        [sid]
    );
    return rows[0] ? Number(rows[0].cnt) : 0;
}

async function markRead(studentId, notificationId) {
    const sid = parseInt(studentId, 10);
    const nid = parseInt(notificationId, 10);
    if (!Number.isInteger(sid) || sid <= 0 || !Number.isInteger(nid) || nid <= 0) {
        return { updated: 0 };
    }
    const res = await query(
        'UPDATE notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND student_id = ? AND is_read = 0',
        [nid, sid]
    );
    return { updated: (res && typeof res.affectedRows === 'number') ? res.affectedRows : 0 };
}

async function markAllRead(studentId) {
    const sid = parseInt(studentId, 10);
    if (!Number.isInteger(sid) || sid <= 0) return { updated: 0 };
    const res = await query(
        'UPDATE notifications SET is_read = 1, read_at = NOW() WHERE student_id = ? AND is_read = 0',
        [sid]
    );
    return { updated: (res && typeof res.affectedRows === 'number') ? res.affectedRows : 0 };
}

module.exports = {
    TYPES,
    notifyClass,
    notifyStudent,
    refreshStudent,
    getForStudent,
    unreadCount,
    markRead,
    markAllRead
};
