// ============================================================
// enrollmentService.js — keeps `enrollments` in sync with the
// student's grade/section identity.
//
// Root cause it fixes: class-detail rosters, gradebooks (teacher +
// admin oversight), and admin class-detail all read students via
//   FROM enrollments e JOIN students s ...
// but creating/approving a student only wrote `users` + `students`
// rows — no `enrollments` row. So a brand-new "Grade 7 - Rizal"
// student was invisible in every section/gradebook view. Only the
// narrow adviser-approval path ever inserted an enrollment (and only
// into the adviser's OWN class), while admin approvals inserted none.
//
// Rule (per approved design): a student belongs to EVERY active class
// matching their grade_level + section (one school section, many
// subject classes/teachers) — not just the adviser's class.
// Matching is case-insensitive (LOWER()) so legacy casing splits
// ("rizal" vs "Rizal") can never strand a student again.
//
// All writes are INSERT IGNORE / idempotent: safe to call on every
// activation path and safe to re-run as a boot backfill for the
// existing invisible students.
// ============================================================
const { query } = require('../config/database');

function norm(s) {
    return String(s || '').trim().replace(/\s+/g, ' ');
}

// Enroll one student profile into every active class matching their
// current grade_level + section. Returns the number of NEW rows.
// Never throws — enrollment must never block an approval.
async function autoEnrollStudent(studentProfileId) {
    try {
        const prof = await query(
            'SELECT grade_level, section FROM students WHERE id = ? LIMIT 1',
            [studentProfileId]
        );
        if (prof.length === 0) return 0;
        const grade = norm(prof[0].grade_level);
        const section = norm(prof[0].section);
        if (!grade || !section) return 0;

        const classes = await query(
            `SELECT id FROM classes
              WHERE is_active = 1
                AND LOWER(TRIM(grade_level)) = LOWER(?)
                AND LOWER(TRIM(section)) = LOWER(?)`,
            [grade, section]
        );
        let added = 0;
        for (const c of classes) {
            const r = await query(
                "INSERT IGNORE INTO enrollments (student_id, class_id, status) VALUES (?, ?, 'active')",
                [studentProfileId, c.id]
            );
            if (r.affectedRows > 0) added += 1;
        }
        return added;
    } catch (err) {
        console.error('[enrollmentService] auto-enroll failed:', err.message || err);
        return 0;
    }
}

// Same as above but starting from a users.id (approval handlers only
// have the user id). Resolves the student profile first.
async function autoEnrollUser(userId) {
    try {
        const rows = await query('SELECT id FROM students WHERE user_id = ? LIMIT 1', [userId]);
        if (rows.length === 0) return 0;
        return autoEnrollStudent(rows[0].id);
    } catch (err) {
        console.error('[enrollmentService] auto-enroll-by-user failed:', err.message || err);
        return 0;
    }
}

// One-time backfill (idempotent): enroll every ACTIVE student who has
// no enrollment row into all active classes matching their
// grade/section. Runs at boot; INSERT IGNORE makes re-runs no-ops.
async function backfillMissingEnrollments() {
    try {
        const orphans = await query(
            `SELECT s.id
              FROM students s
              JOIN users u ON s.user_id = u.id
              WHERE u.status = 'active' AND u.is_active = 1
                AND NOT EXISTS (
                    SELECT 1 FROM enrollments e
                    WHERE e.student_id = s.id AND e.status = 'active'
                )`
        );
        let studentsFixed = 0;
        let rowsAdded = 0;
        for (const o of orphans) {
            const added = await autoEnrollStudent(o.id);
            if (added > 0) {
                studentsFixed += 1;
                rowsAdded += added;
            }
        }
        if (studentsFixed > 0 || orphans.length > 0) {
            console.log(
                `[enrollmentService] backfill: ${studentsFixed}/${orphans.length} unenrolled active student(s) matched to classes (${rowsAdded} enrollment row(s) added).`
            );
        }
        return { studentsFixed, rowsAdded };
    } catch (err) {
        console.error('[enrollmentService] backfill failed:', err.message || err);
        return { studentsFixed: 0, rowsAdded: 0 };
    }
}

module.exports = {
    autoEnrollStudent,
    autoEnrollUser,
    backfillMissingEnrollments
};
