// ============================================================
// Phase 2 Ã¢â‚¬â€ Intervention powers (explicit, reason-gated, logged).
// The admin never acts *as* the teacher: every POST here lives
// under /admin/... behind requireRole('admin'). Grade/record
// touches require a typed reason and write an activity_logs row.
// Reversible where cheap: transfer, archive, unpublish, hide,
// drop, revoke. No DELETE FROM on learning records (the single
// exception is quiz-attempt reset in Task 2.4, documented there).
// ============================================================
const { query, withTransaction } = require('../config/database');
const { setFlash } = require('../middleware/branding');
const sectionService = require('../services/sectionService');
const enrollmentService = require('../services/enrollmentService');

// Shared reason gate: returns the trimmed reason or sends the
// redirect + flash and returns null.
function requireReason(req, res, backTo, minLen) {
    const reason = String(req.body.reason || '').trim();
    if (reason.length < minLen) {
        setFlash(req, 'error', `A reason of at least ${minLen} characters is required for this administrative action.`);
        res.redirect(backTo);
        return null;
    }
    return reason;
}

async function logAction(adminId, action, description, category) {
    await query(
        `INSERT INTO activity_logs (user_id, action, description, category)
         VALUES (?, ?, ?, ?)`,
        [adminId, action, description, category || 'admin']
    );
}

// ---------- Task 2.1: class transfer + archive/restore ----------

async function transferClass(req, res) {
    try {
        const classId = parseInt(req.params.id, 10);
        const backTo = Number.isInteger(classId) && classId > 0 ? `/admin/classes/${classId}` : '/admin/classes';
        if (!Number.isInteger(classId) || classId <= 0) {
            setFlash(req, 'error', 'Class not found.');
            return res.redirect('/admin/classes');
        }
        const newTeacherId = parseInt(req.body.new_teacher_id, 10);
        if (!Number.isInteger(newTeacherId) || newTeacherId <= 0) {
            setFlash(req, 'error', 'Select a receiving teacher.');
            return res.redirect(backTo);
        }
        const reason = requireReason(req, res, backTo, 10);
        if (!reason) return;

        const [cls] = await query(
            `SELECT c.*, u.first_name AS teacher_first, u.last_name AS teacher_last
             FROM classes c JOIN users u ON c.teacher_id = u.id WHERE c.id = ?`,
            [classId]
        );
        if (!cls) {
            setFlash(req, 'error', 'Class not found.');
            return res.redirect('/admin/classes');
        }
        if (cls.teacher_id === newTeacherId) {
            setFlash(req, 'error', 'This class already belongs to the selected teacher.');
            return res.redirect(backTo);
        }

        const [target] = await query(
            `SELECT id, first_name, last_name, email FROM users
             WHERE id = ? AND role = 'teacher' AND status = 'active' AND is_active = 1 LIMIT 1`,
            [newTeacherId]
        );
        if (!target) {
            setFlash(req, 'error', 'Receiving teacher must be an active teacher account.');
            return res.redirect(backTo);
        }

        await mutateWithAudit(async (conn) => {
            await conn.query('UPDATE classes SET teacher_id = ? WHERE id = ?', [newTeacherId, classId]);
            return {
                adminId: req.session.user.id,
                action: 'Transfer Class',
                description:
                    `Transferred class "${cls.class_name}" (${cls.class_code}) from ${cls.teacher_first} ${cls.teacher_last} to ${target.first_name} ${target.last_name}. Reason: ${reason} ` +
                    `(class shell, enrollments, gradebook and postings moved; authored library/activities/quizzes stay attributed to the original teacher)`
            };
        });

        setFlash(req, 'success', `Class transferred to ${target.first_name} ${target.last_name}. Roster, gradebook and postings moved with it.`);
        res.redirect(backTo);
    } catch (err) {
        console.error('Admin transfer class error:', err);
        setFlash(req, 'error', 'Failed to transfer class.');
        res.redirect(backTo);
    }
}

async function archiveClass(req, res) {
    try {
        const classId = parseInt(req.params.id, 10);
        const backTo = Number.isInteger(classId) && classId > 0 ? `/admin/classes/${classId}` : '/admin/classes';
        if (!Number.isInteger(classId) || classId <= 0) {
            setFlash(req, 'error', 'Class not found.');
            return res.redirect('/admin/classes');
        }
        const [cls] = await query('SELECT * FROM classes WHERE id = ?', [classId]);
        if (!cls) {
            setFlash(req, 'error', 'Class not found.');
            return res.redirect('/admin/classes');
        }
        if (!cls.is_active) {
            setFlash(req, 'info', 'This class is already archived.');
            return res.redirect(backTo);
        }

        const [enr] = await query(
            "SELECT COUNT(*) AS count FROM enrollments WHERE class_id = ? AND status = 'active'",
            [classId]
        );
        // Archiving with active enrollments needs a longer handover/closure note.
        const minLen = enr.count > 0 ? 20 : 10;
        const reason = requireReason(req, res, backTo, minLen);
        if (!reason) return;

        await mutateWithAudit(async (conn) => {
            await conn.query('UPDATE classes SET is_active = 0 WHERE id = ?', [classId]);
            return {
                adminId: req.session.user.id,
                action: 'Archive Class',
                description: `Archived class "${cls.class_name}" (${cls.class_code}) with ${enr.count} active enrollment(s). Reason: ${reason}`
            };
        });

        setFlash(req, 'success', `Class "${cls.class_name}" archived. Join-code enrollment is now closed.`);
        res.redirect(backTo);
    } catch (err) {
        console.error('Admin archive class error:', err);
        setFlash(req, 'error', 'Failed to archive class.');
        res.redirect(backTo);
    }
}

async function unarchiveClass(req, res) {
    try {
        const classId = parseInt(req.params.id, 10);
        const backTo = Number.isInteger(classId) && classId > 0 ? `/admin/classes/${classId}` : '/admin/classes';
        if (!Number.isInteger(classId) || classId <= 0) {
            setFlash(req, 'error', 'Class not found.');
            return res.redirect('/admin/classes');
        }
        const [cls] = await query('SELECT * FROM classes WHERE id = ?', [classId]);
        if (!cls) {
            setFlash(req, 'error', 'Class not found.');
            return res.redirect('/admin/classes');
        }
        if (cls.is_active) {
            setFlash(req, 'info', 'This class is already active.');
            return res.redirect(backTo);
        }
        const reason = requireReason(req, res, backTo, 10);
        if (!reason) return;

        await mutateWithAudit(async (conn) => {
            await conn.query('UPDATE classes SET is_active = 1 WHERE id = ?', [classId]);
            return {
                adminId: req.session.user.id,
                action: 'Unarchive Class',
                description: `Restored class "${cls.class_name}" (${cls.class_code}) to active. Reason: ${reason}`
            };
        });

        setFlash(req, 'success', `Class "${cls.class_name}" restored to active.`);
        res.redirect(backTo);
    } catch (err) {
        console.error('Admin unarchive class error:', err);
        setFlash(req, 'error', 'Failed to restore class.');
        res.redirect('/admin/classes');
    }
}

// ---------- Task 2.2: enrollment move / drop / restore ----------

// Shared enrollment full-detail fetch (Batch C: was copy-pasted 3x).
async function getEnrollmentFull(enrollmentId) {
    const [enr] = await query(
        `SELECT e.*, s.student_id AS lrn, u.first_name, u.last_name,
                c.class_name, c.class_code
         FROM enrollments e
         JOIN students s ON e.student_id = s.id
         JOIN users u ON s.user_id = u.id
         JOIN classes c ON e.class_id = c.id
         WHERE e.id = ?`,
        [enrollmentId]
    );
    return enr || null;
}

// Shared announcement fetch with class context (Batch C: was duplicated).
async function getAnnouncementWithClass(annId) {
    const [ann] = await query(
        `SELECT a.*, c.class_name, c.class_code FROM announcements a
         JOIN classes c ON a.class_id = c.id WHERE a.id = ?`,
        [annId]
    );
    return ann || null;
}

// Batch D: run a state mutation + its audit row atomically. The work
// callback receives the conn and returns the log {action, description,
// category}; the log write joins the same transaction so a log failure
// rolls the mutation back instead of leaving silent state drift.
async function mutateWithAudit(work) {
    await withTransaction(async (conn) => {
        const log = await work(conn);
        await conn.query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, ?, ?, ?)`,
            [log.adminId, log.action, log.description, log.category || 'admin']
        );
    });
}

async function moveEnrollment(req, res) {
    try {
        const enrollmentId = parseInt(req.params.enrollmentId, 10);
        const targetClassId = parseInt(req.body.class_id, 10);
        if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
            setFlash(req, 'error', 'Enrollment not found.');
            return res.redirect('/admin/classes');
        }
        if (!Number.isInteger(targetClassId) || targetClassId <= 0) {
            setFlash(req, 'error', 'Select a destination class.');
            return res.redirect('/admin/classes');
        }

        const enr = await getEnrollmentFull(enrollmentId);
        if (!enr) {
            setFlash(req, 'error', 'Enrollment not found.');
            return res.redirect('/admin/classes');
        }
        const backTo = `/admin/classes/${enr.class_id}?tab=students`;
        if (enr.class_id === targetClassId) {
            setFlash(req, 'error', 'Student is already in the selected class.');
            return res.redirect(backTo);
        }
        const reason = requireReason(req, res, backTo, 10);
        if (!reason) return;

        const [dest] = await query('SELECT * FROM classes WHERE id = ? AND is_active = 1', [targetClassId]);
        if (!dest) {
            setFlash(req, 'error', 'Destination class must be an active class.');
            return res.redirect(backTo);
        }
        const dup = await query(
            'SELECT id FROM enrollments WHERE student_id = ? AND class_id = ? AND status = ? LIMIT 1',
            [enr.student_id, targetClassId, enr.status]
        );
        if (dup.length > 0) {
            setFlash(req, 'error', 'Student already has this enrollment in the destination class.');
            return res.redirect(backTo);
        }

        await mutateWithAudit(async (conn) => {
            await conn.query('UPDATE enrollments SET class_id = ? WHERE id = ?', [targetClassId, enrollmentId]);
            return {
                adminId: req.session.user.id,
                action: 'Move Enrollment',
                description:
                    `Moved ${enr.first_name} ${enr.last_name} (LRN ${enr.lrn}) from "${enr.class_name}" (${enr.class_code}) to "${dest.class_name}" (${dest.class_code}). ` +
                    `Reason: ${reason} (grade history stays in the source class; the destination starts a clean grade slate)`
            };
        });

        setFlash(req, 'success', `Moved ${enr.first_name} ${enr.last_name} to ${dest.class_name}. Grade history stays in the source class.`);
        res.redirect(`/admin/classes/${targetClassId}?tab=students`);
    } catch (err) {
        console.error('Admin move enrollment error:', err);
        setFlash(req, 'error', 'Failed to move enrollment.');
        res.redirect(backTo);
    }
}

async function dropEnrollment(req, res) {
    try {
        const enrollmentId = parseInt(req.params.enrollmentId, 10);
        if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
            setFlash(req, 'error', 'Enrollment not found.');
            return res.redirect('/admin/classes');
        }
        const enr = await getEnrollmentFull(enrollmentId);
        if (!enr) {
            setFlash(req, 'error', 'Enrollment not found.');
            return res.redirect('/admin/classes');
        }
        const backTo = `/admin/classes/${enr.class_id}?tab=students`;
        if (enr.status !== 'active') {
            setFlash(req, 'info', 'This enrollment is not active.');
            return res.redirect(backTo);
        }
        const reason = requireReason(req, res, backTo, 10);
        if (!reason) return;

        await mutateWithAudit(async (conn) => {
            await conn.query("UPDATE enrollments SET status = 'dropped' WHERE id = ?", [enrollmentId]);
            return {
                adminId: req.session.user.id,
                action: 'Drop Enrollment',
                description: `Dropped ${enr.first_name} ${enr.last_name} (LRN ${enr.lrn}) from "${enr.class_name}" (${enr.class_code}). Reason: ${reason} (reversible)`
            };
        });

        setFlash(req, 'success', `Dropped ${enr.first_name} ${enr.last_name} from ${enr.class_name}. Reversible.`);
        res.redirect(backTo);
    } catch (err) {
        console.error('Admin drop enrollment error:', err);
        setFlash(req, 'error', 'Failed to drop enrollment.');
        res.redirect(backTo);
    }
}

async function restoreEnrollment(req, res) {
    try {
        const enrollmentId = parseInt(req.params.enrollmentId, 10);
        if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
            setFlash(req, 'error', 'Enrollment not found.');
            return res.redirect('/admin/classes');
        }
        const enr = await getEnrollmentFull(enrollmentId);
        if (!enr) {
            setFlash(req, 'error', 'Enrollment not found.');
            return res.redirect('/admin/classes');
        }
        const backTo = `/admin/classes/${enr.class_id}?tab=students`;
        if (enr.status === 'active') {
            setFlash(req, 'info', 'This enrollment is already active.');
            return res.redirect(backTo);
        }
        const reason = requireReason(req, res, backTo, 10);
        if (!reason) return;

        await mutateWithAudit(async (conn) => {
            await conn.query("UPDATE enrollments SET status = 'active' WHERE id = ?", [enrollmentId]);
            return {
                adminId: req.session.user.id,
                action: 'Restore Enrollment',
                description: `Restored ${enr.first_name} ${enr.last_name} (LRN ${enr.lrn}) to "${enr.class_name}" (${enr.class_code}). Reason: ${reason}`
            };
        });

        setFlash(req, 'success', `Restored ${enr.first_name} ${enr.last_name} to ${enr.class_name}.`);
        res.redirect(backTo);
    } catch (err) {
        console.error('Admin restore enrollment error:', err);
        setFlash(req, 'error', 'Failed to restore enrollment.');
        res.redirect(backTo);
    }
}

// ---------- Task 2.3: grade correction with reason ----------

async function correctGrade(req, res) {
    try {
        const columnId = parseInt(req.body.column_id, 10);
        const studentId = parseInt(req.body.student_id, 10);
        const numScore = parseFloat(req.body.score);
        const backTo = req.body.class_id ? `/admin/gradebook?classId=${parseInt(req.body.class_id, 10)}` : '/admin/gradebook';

        if (!Number.isInteger(columnId) || columnId <= 0
            || !Number.isInteger(studentId) || studentId <= 0
            || typeof req.body.score === 'undefined' || Number.isNaN(numScore)) {
            setFlash(req, 'error', 'Invalid correction request.');
            return res.redirect(backTo);
        }
        const reason = requireReason(req, res, backTo, 10);
        if (!reason) return;

        // Same validation spine as POST /api/gradebook/entry, minus ownership.
        const columns = await query(
            `SELECT gc.id, gc.class_id, gc.max_score, gc.column_name, c.class_name, c.class_code
             FROM gradebook_columns gc JOIN classes c ON gc.class_id = c.id
             WHERE gc.id = ?`,
            [columnId]
        );
        if (!columns || columns.length === 0) {
            setFlash(req, 'error', 'Gradebook column not found.');
            return res.redirect(backTo);
        }
        const column = columns[0];

        const foundStudents = await query(
            `SELECT s.id, u.first_name, u.last_name FROM students s
             JOIN users u ON s.user_id = u.id WHERE s.id = ?`,
            [studentId]
        );
        if (!foundStudents || foundStudents.length === 0) {
            setFlash(req, 'error', 'Student not found.');
            return res.redirect(backTo);
        }

        const enrolled = await query(
            `SELECT enrollments.id FROM enrollments
             WHERE enrollments.class_id = ? AND enrollments.student_id = ? AND enrollments.status = 'active'`,
            [column.class_id, studentId]
        );
        if (!enrolled || enrolled.length === 0) {
            setFlash(req, 'error', 'Student is not actively enrolled in this class.');
            return res.redirect(backTo);
        }

        const maxScore = parseFloat(column.max_score);
        if (Number.isNaN(maxScore) || numScore < 0 || numScore > maxScore) {
            setFlash(req, 'error', `Score must be between 0 and ${column.max_score}.`);
            return res.redirect(backTo);
        }

        const [oldRow] = await query(
            'SELECT score FROM gradebook_entries WHERE column_id = ? AND student_id = ?',
            [columnId, studentId]
        );
        const oldScore = oldRow ? Number(oldRow.score) : null;

        await mutateWithAudit(async (conn) => {
            await conn.query(
                'INSERT INTO gradebook_entries (column_id, student_id, score, manual_override) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE score = VALUES(score), manual_override = 1',
                [columnId, studentId, numScore]
            );
            return {
                adminId: req.session.user.id,
                action: 'Grade Correction',
                category: 'security',
                description: 'Corrected grade col ' + columnId + ' student ' + studentId + ': ' + (oldScore == null ? 'ungraded' : oldScore) + ' to ' + numScore + '. Reason: ' + reason + ' (manual_override=1)'
            };
        });

        setFlash(req, 'success', 'Grade corrected: ' + (oldScore == null ? 'ungraded' : oldScore) + ' to ' + numScore + '.');
        res.redirect(backTo);
    } catch (err) {
        console.error('Admin grade correction error:', err);
        setFlash(req, 'error', 'Failed to correct grade.');
        res.redirect(backTo);
    }
}

// ---------- Task 2.4: quiz attempt reset + window extension ----------

async function resetAttempt(req, res) {
    try {
        const attemptId = parseInt(req.params.attemptId, 10);
        if (!Number.isInteger(attemptId) || attemptId <= 0) {
            setFlash(req, 'error', 'Attempt not found.');
            return res.redirect('/admin/classes');
        }
        const [att] = await query(
            `SELECT qa.*, q.title AS quiz_title, c.class_name, c.class_code, u.first_name, u.last_name
             FROM quiz_attempts qa
             JOIN quizzes q ON qa.quiz_id = q.id
             JOIN classes c ON qa.class_id = c.id
             JOIN students s ON qa.student_id = s.id
             JOIN users u ON s.user_id = u.id
             WHERE qa.id = ?`,
            [attemptId]
        );
        if (!att) {
            setFlash(req, 'error', 'Attempt not found.');
            return res.redirect('/admin/classes');
        }
        const backTo = `/admin/quizzes/${att.quiz_id}`;
        const reason = requireReason(req, res, backTo, 10);
        if (!reason) return;

        const clearCell = req.body.clear_gradebook_cell === '1' || req.body.clear_gradebook_cell === 'on';

        await withTransaction(async (conn) => {
            // The single hard delete in Phase 2: unique_student_quiz blocks
            // retake otherwise, so answers + attempt must go together.
            await conn.query('DELETE FROM quiz_attempt_answers WHERE attempt_id = ?', [attemptId]);
            await conn.query('DELETE FROM quiz_attempts WHERE id = ?', [attemptId]);
            if (clearCell) {
                await conn.query(
                    `DELETE ge FROM gradebook_entries ge
                     JOIN gradebook_columns gc ON ge.column_id = gc.id
                     WHERE gc.class_id = ? AND gc.quiz_id = ? AND ge.student_id = ?`,
                    [att.class_id, att.quiz_id, att.student_id]
                );
            }
            await conn.query(
                `INSERT INTO activity_logs (user_id, action, description, category)
                 VALUES (?, 'Reset Quiz Attempt', ?, 'security')`,
                [req.session.user.id,
                 `Reset quiz attempt for ${att.first_name} ${att.last_name} Ã¢â‚¬â€ "${att.quiz_title}" in "${att.class_name}" (${att.class_code}). ` +
                 `Discarded score ${att.score}/${att.max_score} (${att.percentage}%). Gradebook cell ${clearCell ? 'cleared' : 'kept'}. Reason: ${reason}`]
            );
        });

        setFlash(req, 'success', `Attempt reset for ${att.first_name} ${att.last_name}. They can now retake the quiz.`);
        res.redirect(backTo);
    } catch (err) {
        console.error('Admin reset attempt error:', err);
        setFlash(req, 'error', 'Failed to reset attempt.');
        res.redirect('/admin/classes');
    }
}

async function updateQuizWindow(req, res) {
    try {
        const sqId = parseInt(req.params.sqId, 10);
        if (!Number.isInteger(sqId) || sqId <= 0) {
            setFlash(req, 'error', 'Quiz posting not found.');
            return res.redirect('/admin/classes');
        }
        const [sq] = await query(
            `SELECT sq.*, q.title AS quiz_title, c.class_name, c.class_code
             FROM section_quizzes sq
             JOIN quizzes q ON sq.quiz_id = q.id
             JOIN classes c ON sq.class_id = c.id
             WHERE sq.id = ?`,
            [sqId]
        );
        if (!sq) {
            setFlash(req, 'error', 'Quiz posting not found.');
            return res.redirect('/admin/classes');
        }
        const backTo = `/admin/quizzes/${sq.quiz_id}`;
        const reason = requireReason(req, res, backTo, 10);
        if (!reason) return;

        const toNull = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
        const start = toNull(req.body.start_time);
        const end = toNull(req.body.end_time);
        if (start && end && new Date(end) <= new Date(start)) {
            setFlash(req, 'error', 'End time must be after start time.');
            return res.redirect(backTo);
        }
        const published = req.body.is_published === '1' || req.body.is_published === 'on' ? 1 : 0;

        await mutateWithAudit(async (conn) => {
            await conn.query(
                'UPDATE section_quizzes SET start_time = ?, end_time = ?, is_published = ? WHERE id = ?',
                [start, end, published, sqId]
            );
            return {
                adminId: req.session.user.id,
                action: 'Update Quiz Window',
                description: 'Updated window for quiz posting ' + sqId + ': ' + (start || 'no start') + ' to ' + (end || 'no end') + ', ' + (published ? 'published' : 'hidden') + '. Reason: ' + reason
            };
        });

        setFlash(req, 'success', 'Quiz window updated.');
        res.redirect(backTo);
    } catch (err) {
        console.error('Admin update quiz window error:', err);
        setFlash(req, 'error', 'Failed to update quiz window.');
        res.redirect(backTo);
    }
}

// ---------- Task 2.5: content takedown (unpost / hide, all reversible) ----------

async function unpostMaterial(req, res) {
    try {
        const itemId = parseInt(req.params.itemId, 10);
        const classId = parseInt(req.body.class_id, 10);
        if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(classId) || classId <= 0) {
            setFlash(req, 'error', 'Invalid takedown request.');
            return res.redirect('/admin/classes');
        }
        const backTo = `/admin/classes/${classId}?tab=materials`;
        const reason = requireReason(req, res, backTo, 10);
        if (!reason) return;

        const [row] = await query(
            `SELECT cm.id AS post_id, li.title, c.class_name, c.class_code
             FROM class_materials cm
             JOIN library_items li ON cm.library_item_id = li.id
             JOIN classes c ON cm.class_id = c.id
             WHERE cm.library_item_id = ? AND cm.class_id = ?`,
            [itemId, classId]
        );
        if (!row) {
            setFlash(req, 'error', 'This material is not posted in that class.');
            return res.redirect(backTo);
        }

        // Join row only: the library item survives for the teacher.
        await mutateWithAudit(async (conn) => {
            await conn.query('DELETE FROM class_materials WHERE library_item_id = ? AND class_id = ?', [itemId, classId]);
            return {
                adminId: req.session.user.id,
                action: 'Unpost Material',
                description: 'Unposted material ' + itemId + ' from class ' + classId + '. Reason: ' + reason + ' (library kept)'
            };
        });

        setFlash(req, 'success', `Unposted "${row.title}" from ${row.class_name}. The teacher's library copy is untouched.`);
        res.redirect(backTo);
    } catch (err) {
        console.error('Admin unpost material error:', err);
        setFlash(req, 'error', 'Failed to unpost material.');
        res.redirect('/admin/classes');
    }
}

async function unpostActivity(req, res) {
    try {
        const activityId = parseInt(req.params.activityId, 10);
        const classId = parseInt(req.body.class_id, 10);
        if (!Number.isInteger(activityId) || activityId <= 0 || !Number.isInteger(classId) || classId <= 0) {
            setFlash(req, 'error', 'Invalid takedown request.');
            return res.redirect('/admin/classes');
        }
        const backTo = `/admin/classes/${classId}?tab=activities`;
        const reason = requireReason(req, res, backTo, 10);
        if (!reason) return;

        const [row] = await query(
            `SELECT ap.id AS post_id, ca.title, c.class_name, c.class_code
             FROM activity_posts ap
             JOIN class_activities ca ON ap.activity_id = ca.id
             JOIN classes c ON ap.class_id = c.id
             WHERE ap.activity_id = ? AND ap.class_id = ?`,
            [activityId, classId]
        );
        if (!row) {
            setFlash(req, 'error', 'This activity is not posted in that class.');
            return res.redirect(backTo);
        }

        // Join row only: submissions and grades are preserved for audit.
        await mutateWithAudit(async (conn) => {
            await conn.query('DELETE FROM activity_posts WHERE activity_id = ? AND class_id = ?', [activityId, classId]);
            return {
                adminId: req.session.user.id,
                action: 'Unpost Activity',
                description: 'Unposted activity ' + activityId + ' from class ' + classId + '. Reason: ' + reason + ' (submissions preserved)'
            };
        });

        setFlash(req, 'success', `Unposted "${row.title}" from ${row.class_name}. Submissions and grades are preserved.`);
        res.redirect(backTo);
    } catch (err) {
        console.error('Admin unpost activity error:', err);
        setFlash(req, 'error', 'Failed to unpost activity.');
        res.redirect('/admin/classes');
    }
}

async function hideAnnouncement(req, res) {
    try {
        const annId = parseInt(req.params.annId, 10);
        if (!Number.isInteger(annId) || annId <= 0) {
            setFlash(req, 'error', 'Announcement not found.');
            return res.redirect('/admin/classes');
        }
        const [ann] = await query(
            `SELECT a.*, c.class_name, c.class_code FROM announcements a
             JOIN classes c ON a.class_id = c.id WHERE a.id = ?`,
            [annId]
        );
        if (!ann) {
            setFlash(req, 'error', 'Announcement not found.');
            return res.redirect('/admin/classes');
        }
        const backTo = `/admin/classes/${ann.class_id}?tab=announcements`;
        if (!ann.is_published) {
            setFlash(req, 'info', 'This announcement is already hidden.');
            return res.redirect(backTo);
        }
        const reason = requireReason(req, res, backTo, 10);
        if (!reason) return;

        await mutateWithAudit(async (conn) => {
            await conn.query('UPDATE announcements SET is_published = 0, is_pinned = 0 WHERE id = ?', [annId]);
            return {
                adminId: req.session.user.id,
                action: 'Hide Announcement',
                description: 'Hid announcement ID ' + annId + '. Reason: ' + reason + ' (reversible)'
            };
        });

        setFlash(req, 'success', 'Announcement hidden from the student feed. Reversible via Show.');
        res.redirect(backTo);
    } catch (err) {
        console.error('Admin hide announcement error:', err);
        setFlash(req, 'error', 'Failed to hide announcement.');
        res.redirect('/admin/classes');
    }
}

async function showAnnouncement(req, res) {
    try {
        const annId = parseInt(req.params.annId, 10);
        if (!Number.isInteger(annId) || annId <= 0) {
            setFlash(req, 'error', 'Announcement not found.');
            return res.redirect('/admin/classes');
        }
        const [ann] = await query(
            `SELECT a.*, c.class_name, c.class_code FROM announcements a
             JOIN classes c ON a.class_id = c.id WHERE a.id = ?`,
            [annId]
        );
        if (!ann) {
            setFlash(req, 'error', 'Announcement not found.');
            return res.redirect('/admin/classes');
        }
        const backTo = `/admin/classes/${ann.class_id}?tab=announcements`;
        if (ann.is_published) {
            setFlash(req, 'info', 'This announcement is already visible.');
            return res.redirect(backTo);
        }
        const reason = requireReason(req, res, backTo, 10);
        if (!reason) return;

        await mutateWithAudit(async (conn) => {
            await conn.query('UPDATE announcements SET is_published = 1 WHERE id = ?', [annId]);
            return {
                adminId: req.session.user.id,
                action: 'Show Announcement',
                description: 'Restored announcement ID ' + annId + '. Reason: ' + reason
            };
        });

        setFlash(req, 'success', 'Announcement restored to the student feed.');
        res.redirect(backTo);
    } catch (err) {
        console.error('Admin show announcement error:', err);
        setFlash(req, 'error', 'Failed to restore announcement.');
        res.redirect('/admin/classes');
    }
}

// ---------- Task 2.6: sessions view + revoke ----------

function parseSessionUser(data) {
    try {
        const sess = JSON.parse(data);
        const u = sess && sess.user;
        if (!u || typeof u.id === 'undefined') return null;
        return { id: u.id, email: u.email || '', first_name: u.first_name || '', last_name: u.last_name || '', role: u.role || '' };
    } catch {
        return null;
    }
}

async function sessions(req, res) {
    try {
        const filterId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
        const rows = await query('SELECT session_id, expires, data FROM `sessions` WHERE expires >= ? ORDER BY expires DESC LIMIT 200', [Date.now()]);
        let list = rows.map((r) => ({
            session_id: r.session_id,
            short_id: String(r.session_id).slice(0, 12),
            expires: new Date(Number(r.expires)),
            is_current: r.session_id === req.sessionID,
            user: parseSessionUser(r.data)
        }));
        if (Number.isInteger(filterId) && filterId > 0) {
            list = list.filter((s) => s.user && Number(s.user.id) === filterId);
        }
        const { ensureToken } = require('../middleware/csrf');
        ensureToken(req);
        res.render('admin/sessions', {
            title: 'Active Sessions | EduShare',
            sessions: list,
            filterUserId: Number.isInteger(filterId) && filterId > 0 ? filterId : '',
            csrfToken: req.session.csrfToken
        });
    } catch (err) {
        console.error('Admin sessions error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

async function revokeSession(req, res) {
    try {
        const sid = String(req.params.sid || '');
        const backTo = '/admin/sessions';
        if (!sid || sid.length > 128) {
            setFlash(req, 'error', 'Invalid session.');
            return res.redirect(backTo);
        }
        if (sid === req.sessionID) {
            setFlash(req, 'error', 'You cannot revoke your own current session.');
            return res.redirect(backTo);
        }
        const [srow] = await query('SELECT data FROM `sessions` WHERE session_id = ? LIMIT 1', [sid]);
        const who = srow ? parseSessionUser(srow.data) : null;
        const reason = requireReason(req, res, backTo, 10);
        if (!reason) return;

        await mutateWithAudit(async (conn) => {
            await conn.query('DELETE FROM `sessions` WHERE session_id = ?', [sid]);
            return {
                adminId: req.session.user.id,
                action: 'Revoke Session',
                description: 'Revoked session ' + sid.slice(0, 12) + (who ? ' for ' + who.first_name + ' ' + who.last_name : '') + '. Reason: ' + reason
            };
        });

        setFlash(req, 'success', 'Session revoked. The device signs out on its next request.');
        res.redirect(backTo);
    } catch (err) {
        console.error('Admin revoke session error:', err);
        setFlash(req, 'error', 'Failed to revoke session.');
        res.redirect('/admin/sessions');
    }
}

async function revokeUserSessions(req, res) {
    try {
        const userId = parseInt(req.params.id, 10);
        if (!Number.isInteger(userId) || userId <= 0) {
            setFlash(req, 'error', 'User not found.');
            return res.redirect('/admin/users');
        }
        const backTo = `/admin/users/${userId}`;
        if (userId === req.session.user.id) {
            setFlash(req, 'error', 'You cannot revoke your own sessions from here. Sign out instead.');
            return res.redirect('/admin/users');
        }
        const reason = requireReason(req, res, backTo, 10);
        if (!reason) return;

        // Explicit admin action with a reported count: the LIKE match on the
        // JSON blob is acceptable here because the admin sees the outcome and
        // can retry. (Contrast with resetPassword, where silent auto-revoke
        // would fail invisibly Ã¢â‚¬â€ hence explicit-only by design.)
        const [target] = await query('SELECT first_name, last_name, email FROM users WHERE id = ? LIMIT 1', [userId]);
        // JSON-shape-aware LIKE: sessions store JSON.stringify(sess) with a
        // "user":{"id":N,...} object, so this prefix cannot match id 13 for
        // id 3. Own current row excluded explicitly. Explicit-only by design:
        // the admin sees the revoked count and can retry (contrast with
        // resetPassword, where silent auto-revoke would fail invisibly).
        const res1 = await query(
            'DELETE FROM `sessions` WHERE `data` LIKE ? AND session_id <> ?',
            [`%"user":{"id":${userId}%`, req.sessionID]
        );

        const revoked = (res1 && res1.affectedRows) || 0;
        // Batch C: zero-row revoke is reported, never hidden — the flash and
        // audit row below always carry the count.
        await logAction(
            req.session.user.id,
            'Revoke User Sessions',
            `Revoked ${revoked} session(s) for ${target ? `${target.first_name} ${target.last_name} (${target.email})` : `user ID ${userId}`}. Reason: ${reason}`
        );

        setFlash(req, 'success', revoked > 0
            ? `Revoked ${revoked} session(s). The user signs out on next request.`
            : 'No other active sessions found for this user (0 revoked). Nothing was signed out.');
        res.redirect(backTo);
    } catch (err) {
        console.error('Admin revoke user sessions error:', err);
        setFlash(req, 'error', 'Failed to revoke sessions.');
        res.redirect('/admin/users');
    }
}

// ---------- Task 2.7: identity completion ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEACHER_EMAIL_DOMAIN = '@zahs.edu.ph';

async function editUser(req, res) {
    try {
        const userId = parseInt(req.params.id, 10);
        if (!Number.isInteger(userId) || userId <= 0) {
            setFlash(req, 'error', 'User not found.');
            return res.redirect('/admin/users');
        }
        const backTo = `/admin/users/${userId}`;
        const { first_name, last_name, email } = req.body;
        const cleanFirst = String(first_name || '').trim();
        const cleanLast = String(last_name || '').trim();
        const cleanEmail = String(email || '').trim().toLowerCase();

        if (!cleanFirst || !cleanLast || !cleanEmail
            || cleanFirst.length > 100 || cleanLast.length > 100
            || cleanEmail.length > 150 || !EMAIL_RE.test(cleanEmail)) {
            setFlash(req, 'error', 'Enter a valid first name, last name, and email address.');
            return res.redirect(backTo);
        }

        const [existing] = await query('SELECT id, role, first_name, last_name, email FROM users WHERE id = ? LIMIT 1', [userId]);
        if (!existing) {
            setFlash(req, 'error', 'User not found.');
            return res.redirect('/admin/users');
        }
        if (existing.role === 'teacher' && !cleanEmail.endsWith(TEACHER_EMAIL_DOMAIN)) {
            setFlash(req, 'error', `Teacher email must end with ${TEACHER_EMAIL_DOMAIN}.`);
            return res.redirect(backTo);
        }
        const dup = await query('SELECT id FROM users WHERE LOWER(email) = ? AND id <> ? LIMIT 1', [cleanEmail, userId]);
        if (dup.length > 0) {
            setFlash(req, 'error', 'That email address is already in use.');
            return res.redirect(backTo);
        }

        // Role-profile extras (same vocab as createUser).
        const { department, specialization, is_adviser, advisory_grade, advisory_section, grade_level, section, gender } = req.body;

        // Validate grade inputs against the shared 7-12 vocabulary and
        // converge sections to the canonical spelling (same soft-match rule
        // as registration: unknown grades are rejected, unknown sections
        // pass through trimmed so the edit is never blocked).
        let cleanAdvisoryGrade = null;
        let cleanAdvisorySection = null;
        if (is_adviser === '1') {
            const g = String(advisory_grade || '').trim();
            if (!sectionService.GRADES_7_12.includes(g)) {
                setFlash(req, 'error', 'Select a valid advisory grade (Grade 7 to Grade 12).');
                return res.redirect(backTo);
            }
            cleanAdvisoryGrade = g;
            cleanAdvisorySection = await sectionService.canonicalizeSection(g, sectionService.cleanSection(advisory_section));
        }
        let cleanStudentGrade = null;
        let cleanStudentSection = null;
        if (existing.role === 'student') {
            if (grade_level) {
                const g = sectionService.cleanStudentGrade(grade_level);
                if (!g) {
                    setFlash(req, 'error', 'Select a valid grade level (Grade 7 to Grade 12).');
                    return res.redirect(backTo);
                }
                cleanStudentGrade = g;
            }
            if (section) {
                const targetGrade = cleanStudentGrade || (await query('SELECT grade_level FROM students WHERE user_id = ? LIMIT 1', [userId]).then(r => r[0]?.grade_level).catch(() => null));
                cleanStudentSection = await sectionService.canonicalizeSection(targetGrade, sectionService.cleanSection(section));
            }
        }

        await withTransaction(async (conn) => {
            await conn.query(
                'UPDATE users SET first_name = ?, last_name = ?, email = ? WHERE id = ?',
                [cleanFirst, cleanLast, cleanEmail, userId]
            );
            if (existing.role === 'teacher') {
                await conn.query(
                    `UPDATE teachers SET department = COALESCE(?, department), specialization = COALESCE(?, specialization),
                                      is_adviser = ?, advisory_grade = ?, advisory_section = ? WHERE user_id = ?`,
                    [department || null, specialization || null,
                     is_adviser === '1' ? 1 : 0,
                     is_adviser === '1' ? cleanAdvisoryGrade : null,
                     is_adviser === '1' ? cleanAdvisorySection : null,
                     userId]
                );
            } else if (existing.role === 'student') {
                await conn.query(
                    `UPDATE students SET grade_level = COALESCE(?, grade_level), section = COALESCE(?, section),
                                      gender = COALESCE(?, gender) WHERE user_id = ?`,
                    [cleanStudentGrade, cleanStudentSection, gender || null, userId]
                );
            }
            await conn.query(
                `INSERT INTO activity_logs (user_id, action, description, category)
                 VALUES (?, 'Edit User', ?, 'admin')`,
                [req.session.user.id, `Edited ${existing.role} ${existing.first_name} ${existing.last_name} (${existing.email}) Ã¢â€ â€™ ${cleanFirst} ${cleanLast} (${cleanEmail})`]
            );
        });

        setFlash(req, 'success', 'User profile updated.');
        res.redirect(backTo);
    } catch (err) {
        console.error('Admin edit user error:', err);
        setFlash(req, 'error', 'Failed to update user.');
        res.redirect('/admin/users');
    }
}

async function createAdmin(req, res) {
    try {
        const bcrypt = require('bcrypt');
        const { first_name, last_name, email, password, reason, current_password } = req.body;
        const cleanFirst = String(first_name || '').trim();
        const cleanLast = String(last_name || '').trim();
        const cleanEmail = String(email || '').trim().toLowerCase();

        if (!cleanFirst || !cleanLast || !cleanEmail || !password
            || cleanFirst.length > 100 || cleanLast.length > 100
            || cleanEmail.length > 150 || !EMAIL_RE.test(cleanEmail)) {
            setFlash(req, 'error', 'All fields are required with a valid email address.');
            return res.redirect('/admin/users?role=admin');
        }
        const pw = String(password);
        if (pw.length < 10 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) {
            setFlash(req, 'error', 'Password must be at least 10 characters with upper/lowercase letters and a number.');
            return res.redirect('/admin/users?role=admin');
        }
        // Batch A1: reason-gate â€” minting a peer admin must state why.
        const typedReason = String(reason || '').trim();
        if (typedReason.length < 10) {
            setFlash(req, 'error', 'Creating an administrator requires a reason of at least 10 characters.');
            return res.redirect('/admin/users?role=admin');
        }
        // Batch A1: re-authenticate â€” prove the actor still holds the password.
        if (!current_password) {
            setFlash(req, 'error', 'Confirm your own current password to create an administrator.');
            return res.redirect('/admin/users?role=admin');
        }
        const [selfRows] = await query('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [req.session.user.id]);
        if (!selfRows || !(await bcrypt.compare(String(current_password), selfRows.password_hash))) {
            setFlash(req, 'error', 'Your current password was incorrect. No administrator was created.');
            return res.redirect('/admin/users?role=admin');
        }
        const dup = await query('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1', [cleanEmail]);
        if (dup.length > 0) {
            setFlash(req, 'error', 'That email address is already in use.');
            return res.redirect('/admin/users?role=admin');
        }

        const hash = await bcrypt.hash(pw, 10);
        await mutateWithAudit(async (conn) => {
            const [insRes] = await conn.query(
                `INSERT INTO users (first_name, last_name, email, password_hash, role, is_active, status, force_password_change)
                 VALUES (?, ?, ?, ?, 'admin', 1, 'active', 1)`,
                [cleanFirst, cleanLast, cleanEmail, hash]
            );
            return {
                adminId: req.session.user.id,
                action: 'Create Admin',
                category: 'security',
                description: 'Created administrator account for ' + cleanFirst + ' ' + cleanLast + ' (' + cleanEmail + ', user ID ' + insRes.insertId + '). Reason: ' + typedReason + ' (actor re-authenticated)'
            };
        });

        setFlash(req, 'success', `Administrator account created for ${cleanFirst} ${cleanLast}. They must change the password on first sign-in.`);
        res.redirect('/admin/users?role=admin');
    } catch (err) {
        console.error('Admin create admin error:', err);
        setFlash(req, 'error', 'Failed to create administrator.');
        res.redirect('/admin/users?role=admin');
    }
}

async function bulkUsers(req, res) {
    try {
        let ids = req.body.ids;
        if (!ids) {
            setFlash(req, 'error', 'Select at least one pending account.');
            return res.redirect('/admin/users?status=pending');
        }
        if (!Array.isArray(ids)) ids = [ids];
        const cleanIds = [...new Set(ids.map((v) => parseInt(v, 10)).filter((n) => Number.isInteger(n) && n > 0))];
        const decision = req.body.decision === 'reject' ? 'reject' : 'approve';
        if (cleanIds.length === 0) {
            setFlash(req, 'error', 'Select at least one pending account.');
            return res.redirect('/admin/users?status=pending');
        }
        if (cleanIds.length > 200) {
            setFlash(req, 'error', 'Bulk actions are limited to 200 accounts at a time.');
            return res.redirect('/admin/users?status=pending');
        }

        let done = 0; let skipped = 0; let enrolledTotal = 0;
        await withTransaction(async (conn) => {
            for (const id of cleanIds) {
                const [rows] = await conn.query("SELECT id, status, role, first_name, last_name FROM users WHERE id = ? AND status = 'pending' LIMIT 1", [id]);
                if (rows.length === 0) { skipped++; continue; }
                if (decision === 'approve') {
                    await conn.query("UPDATE users SET status = 'active', is_active = 1 WHERE id = ?", [id]);
                    // Students: enroll into every matching class now that
                    // they are active (same rule as single approval).
                    if (rows[0].role === 'student') {
                        const [prof] = await conn.query('SELECT id FROM students WHERE user_id = ? LIMIT 1', [id]);
                        if (prof.length > 0) {
                            const clsRows = await conn.query(
                                `SELECT c.id FROM classes c
                                  JOIN students s ON s.id = ?
                                  WHERE c.is_active = 1
                                    AND LOWER(TRIM(c.grade_level)) = LOWER(TRIM(s.grade_level))
                                    AND LOWER(TRIM(c.section)) = LOWER(TRIM(s.section))`,
                                [prof[0].id]
                            );
                            for (const c of clsRows) {
                                const ins = await conn.query(
                                    "INSERT IGNORE INTO enrollments (student_id, class_id, status) VALUES (?, ?, 'active')",
                                    [prof[0].id, c.id]
                                );
                                if (ins.affectedRows > 0) enrolledTotal += 1;
                            }
                        }
                    }
                } else {
                    await conn.query("UPDATE users SET status = 'rejected', is_active = 0 WHERE id = ?", [id]);
                }
                done++;
            }
            await conn.query(
                `INSERT INTO activity_logs (user_id, action, description, category)
                 VALUES (?, 'Bulk Registration Review', ?, 'admin')`,
                [req.session.user.id, `Bulk ${decision}: ${done} account(s) processed, ${skipped} skipped (no longer pending), ${enrolledTotal} class enrollment(s) added`]
            );
        });

        setFlash(req, decision === 'approve' ? 'success' : 'info',
            `Bulk ${decision}: ${done} account(s) processed${skipped ? `, ${skipped} skipped (no longer pending)` : ''}. They now appear under All users.`);
        res.redirect('/admin/users');
    } catch (err) {
        console.error('Admin bulk users error:', err);
        setFlash(req, 'error', 'Bulk action failed.');
        res.redirect('/admin/users?status=pending');
    }
}

// ---------- Task 2.8: audit export ----------

async function exportLogs(req, res) {
    try {
        // Batch A3: POST-only export (route POST /admin/logs/export) â€”
        // filters come from the form body, never from a GET URL.
        const category = req.body.category || 'all';
        const q = req.body.q ? `%${String(req.body.q).trim()}%` : null;
        let sql = `
            SELECT al.created_at,
                   COALESCE(u.first_name, '(deleted)') AS first_name,
                   COALESCE(u.last_name, 'account') AS last_name,
                   COALESCE(u.email, '') AS email,
                   COALESCE(u.role, 'unknown') AS role,
                   al.action, al.description, al.category, al.ip_address
            FROM activity_logs al
            LEFT JOIN users u ON al.user_id = u.id
            WHERE 1=1
        `;
        const params = [];
        if (category !== 'all') {
            sql += ' AND al.category = ?';
            params.push(category);
        }
        if (q) {
            sql += ' AND (al.action LIKE ? OR al.description LIKE ? OR u.email LIKE ?)';
            params.push(q, q, q);
        }
        sql += ' ORDER BY al.created_at DESC LIMIT 5000';
        const rows = await query(sql, params);

        await logAction(
            req.session.user.id,
            'Export Audit Log',
            `Exported ${rows.length} audit row(s) to CSV (category=${category}${q ? ', filtered' : ''})`
        );

        const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
        const lines = [`"EduShare Audit Export"`, `"Generated: ${new Date().toLocaleString()}"`, ''];
        lines.push(['Timestamp', 'First Name', 'Last Name', 'Email', 'Role', 'Action', 'Details', 'Category', 'IP'].map(esc).join(','));
        for (const r of rows) {
            lines.push([r.created_at, r.first_name, r.last_name, r.email, r.role, r.action, r.description, r.category, r.ip_address].map(esc).join(','));
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="AuditLog-${category}.csv"`);
        res.send(lines.join('\n'));
    } catch (err) {
        console.error('Admin export logs error:', err);
        res.status(500).render('errors/500', { error: err });
    }
}

// ---------- Section transfer requests (dual approval queue) ----------

// Admin queue: every pending transfer with student + requester names.
// Renders into the users page (pending section) — no new top-level nav.
async function transferQueueData() {
    try {
        return await query(
            `SELECT tr.*, u.first_name, u.last_name, s.student_id AS lrn,
                    s.grade_level AS cur_grade, s.section AS cur_section,
                    ru.first_name AS req_first, ru.last_name AS req_last
             FROM section_transfer_requests tr
             JOIN students s ON tr.student_id = s.id
             JOIN users u ON s.user_id = u.id
             WHERE tr.status = 'pending'
             ORDER BY tr.created_at ASC`
        );
    } catch {
        // Table may not exist yet on a DB that hasn't booted through
        // the 2f migration — queue renders empty instead of 500ing.
        return [];
    }
}

// Admin decision on a pending transfer. A rejection kills the request
// immediately. An approval records the admin half — if the receiving
// adviser already approved, the move executes now (shared executor in
// teacherController so the outcome is identical either way).
async function decideTransfer(req, res) {
    try {
        const requestId = parseInt(req.params.requestId, 10);
        const decision = req.body?.decision === 'approved' ? 'approved' : 'rejected';
        const reason = String(req.body?.reason || req.body?.decision_reason || '').trim();
        if (!Number.isInteger(requestId) || requestId <= 0) {
            setFlash(req, 'error', 'Transfer request not found.');
            return res.redirect('/admin/users?status=pending');
        }
        if (reason.length < 10) {
            setFlash(req, 'error', 'Deciding a transfer requires a reason of at least 10 characters.');
            return res.redirect('/admin/users?status=pending');
        }

        const rows = await query(
            `SELECT tr.*, u.first_name, u.last_name
             FROM section_transfer_requests tr
             JOIN students s ON tr.student_id = s.id
             JOIN users u ON s.user_id = u.id
             WHERE tr.id = ? AND tr.status = 'pending'
             LIMIT 1`,
            [requestId]
        );
        if (rows.length === 0) {
            setFlash(req, 'error', 'Transfer request not found or no longer pending.');
            return res.redirect('/admin/users?status=pending');
        }
        const tr = rows[0];

        if (decision === 'rejected') {
            await query(
                `UPDATE section_transfer_requests
                 SET status = 'rejected', admin_decided_by = ?, admin_decision = 'rejected',
                     admin_decided_at = NOW(), decision_reason = ?
                 WHERE id = ?`,
                [req.session.user.id, reason, requestId]
            );
            await logAction(req.session.user.id, 'Transfer Rejected',
                `Admin rejected transfer of ${tr.first_name} ${tr.last_name} → ${tr.to_grade} - ${tr.to_section}. Reason: ${reason}`);
            setFlash(req, 'info', `Transfer for ${tr.first_name} ${tr.last_name} rejected.`);
            return res.redirect('/admin/users?status=pending');
        }

        await query(
            `UPDATE section_transfer_requests
             SET admin_decided_by = ?, admin_decision = 'approved', admin_decided_at = NOW(),
                 decision_reason = ?
             WHERE id = ?`,
            [req.session.user.id, reason, requestId]
        );
        const updated = await query('SELECT receiver_decision FROM section_transfer_requests WHERE id = ? LIMIT 1', [requestId]);
        if (updated[0] && updated[0].receiver_decision === 'approved') {
            const teacherController = require('./teacherController');
            const result = await teacherController.executeTransfer(requestId, req.session.user.id, 'Admin completed dual approval');
            await logAction(req.session.user.id, 'Transfer Approved',
                `Admin approved transfer of ${tr.first_name} ${tr.last_name} → ${tr.to_grade} - ${tr.to_section}. Reason: ${reason}. Move executed (${result.added || 0} new enrollment(s)).`);
            setFlash(req, 'success', `Transfer for ${tr.first_name} ${tr.last_name} approved — moved to ${tr.to_grade} - ${tr.to_section}.`);
        } else {
            await logAction(req.session.user.id, 'Transfer Approved (Admin)',
                `Admin approved transfer of ${tr.first_name} ${tr.last_name} → ${tr.to_grade} - ${tr.to_section}. Reason: ${reason}. Waiting on receiving adviser.`);
            setFlash(req, 'success', `Transfer for ${tr.first_name} ${tr.last_name} approved. Waiting on the receiving adviser.`);
        }
        res.redirect('/admin/users?status=pending');
    } catch (err) {
        console.error('Admin decide transfer error:', err);
        setFlash(req, 'error', 'Failed to decide the transfer.');
        res.redirect('/admin/users?status=pending');
    }
}

// ---------- Unified change requests (edit/drop/restore/deactivate) ----------

const CHANGE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Admin queue: every pending unified change request with student,
// requester, current values, and the teacher's note. The note is
// rendered prominently — it is what the admin decides on.
async function changeQueueData() {
    try {
        const rows = await query(
            `SELECT cr.*, u.first_name, u.last_name, u.email AS cur_email, u.status AS cur_status,
                    s.student_id AS cur_lrn, s.grade_level AS cur_grade, s.section AS cur_section,
                    s.gender AS cur_gender,
                    ru.first_name AS req_first, ru.last_name AS req_last
             FROM student_change_requests cr
             JOIN students s ON cr.student_id = s.id
             JOIN users u ON s.user_id = u.id
             JOIN users ru ON cr.requested_by = ru.id
             WHERE cr.status = 'pending'
             ORDER BY cr.created_at ASC`
        );
        return rows.map((r) => {
            let payload = {};
            try { payload = r.payload ? JSON.parse(r.payload) : {}; }
            catch { payload = {}; }
            return { ...r, payload };
        });
    } catch {
        // Table may not exist yet on a DB that hasn't booted through
        // the 2g migration — queue renders empty instead of 500ing.
        return [];
    }
}

// Execute an APPROVED change request. Re-validates everything the
// teacher-side validated (collisions, formats) because the world may
// have changed while the request sat in the queue: an email taken
// since filing must fail cleanly, never violate UNIQUE at apply time.
async function applyChangeRequest(cr) {
    const type = cr.request_type;
    const p = cr.payload || {};
    const [stu] = await query(
        `SELECT s.id AS sid, s.grade_level, s.section, u.id AS uid, u.status,
                u.first_name, u.last_name, u.email, s.student_id AS lrn, s.gender
         FROM students s JOIN users u ON s.user_id = u.id
         WHERE s.id = ? LIMIT 1`,
        [cr.student_id]
    );
    if (!stu) return { ok: false, message: 'Student record no longer exists.' };
    if (stu.status !== 'active') return { ok: false, message: 'Student is no longer active.' };

    if (type === 'edit') {
        const sets = [];
        const vals = [];
        if (p.first_name !== undefined) {
            const v = String(p.first_name).trim();
            if (!v || v.length > 100) return { ok: false, message: 'Stored first name is invalid.' };
            sets.push('first_name = ?'); vals.push(v);
        }
        if (p.last_name !== undefined) {
            const v = String(p.last_name).trim();
            if (!v || v.length > 100) return { ok: false, message: 'Stored last name is invalid.' };
            sets.push('last_name = ?'); vals.push(v);
        }
        if (p.email !== undefined) {
            const v = String(p.email).trim().toLowerCase();
            if (v.length > 150 || !CHANGE_EMAIL_RE.test(v)) return { ok: false, message: 'Stored email is invalid.' };
            const dup = await query('SELECT id FROM users WHERE LOWER(email) = ? AND id <> ? LIMIT 1', [v, stu.uid]);
            if (dup.length > 0) return { ok: false, message: 'That email was taken while the request was pending.' };
            sets.push('email = ?'); vals.push(v);
        }
        if (sets.length > 0) {
            await query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...vals, stu.uid]);
        }
        const sSets = [];
        const sVals = [];
        if (p.gender !== undefined) {
            if (!['Male', 'Female', 'Other'].includes(p.gender)) return { ok: false, message: 'Stored gender is invalid.' };
            sSets.push('gender = ?'); sVals.push(p.gender);
        }
        if (p.lrn !== undefined) {
            const v = String(p.lrn).replace(/[\s-]/g, '');
            if (!/^\d{12}$/.test(v)) return { ok: false, message: 'Stored LRN is invalid.' };
            const dup = await query('SELECT id FROM students WHERE student_id = ? AND id <> ? LIMIT 1', [v, stu.sid]);
            if (dup.length > 0) return { ok: false, message: 'That LRN was taken while the request was pending.' };
            sSets.push('student_id = ?'); sVals.push(v);
        }
        if (sSets.length > 0) {
            await query(`UPDATE students SET ${sSets.join(', ')} WHERE id = ?`, [...sVals, stu.sid]);
        }
        return { ok: true, detail: 'identity updated' };
    }
    if (type === 'drop') {
        const r = await query("UPDATE enrollments SET status = 'dropped' WHERE student_id = ? AND status = 'active'", [stu.sid]);
        return { ok: true, detail: `${r.affectedRows} enrollment(s) dropped` };
    }
    if (type === 'restore') {
        await query("UPDATE enrollments SET status = 'active' WHERE student_id = ? AND status = 'dropped'", [stu.sid]);
        const added = await enrollmentService.autoEnrollStudent(stu.sid);
        return { ok: true, detail: `enrollments restored (${added} new)` };
    }
    if (type === 'deactivate') {
        // Deactivate-only BY DESIGN: status flip + session revoke, zero
        // row deletion. Grades, submissions, attempts, and audit history
        // stay for SF1/reporting; the account simply cannot sign in.
        await query("UPDATE users SET status = 'rejected', is_active = 0 WHERE id = ?", [stu.uid]);
        await query('DELETE FROM `sessions` WHERE `data` LIKE ?', [`%"user":{"id":${stu.uid}%`]);
        return { ok: true, detail: 'account deactivated, records preserved' };
    }
    return { ok: false, message: 'Unknown request type.' };
}

// Admin decision on a pending unified change request. Rejection needs
// the admin's own decision note (shared context for the teacher).
// Approval executes via applyChangeRequest; an execution failure
// rejects the request with the failure reason instead of 500ing.
async function decideChange(req, res) {
    try {
        const requestId = parseInt(req.params.requestId, 10);
        const decision = req.body?.decision === 'approved' ? 'approved' : 'rejected';
        const note = String(req.body?.decision_note || req.body?.reason || '').trim();
        if (!Number.isInteger(requestId) || requestId <= 0) {
            setFlash(req, 'error', 'Request not found.');
            return res.redirect('/admin/users?status=pending');
        }
        if (note.length < 10 || note.length > 500) {
            setFlash(req, 'error', 'Give a decision note (10-500 characters) so the teacher understands your call.');
            return res.redirect('/admin/users?status=pending');
        }

        const rows = await query(
            `SELECT cr.*, u.first_name, u.last_name
             FROM student_change_requests cr
             JOIN students s ON cr.student_id = s.id
             JOIN users u ON s.user_id = u.id
             WHERE cr.id = ? AND cr.status = 'pending'
             LIMIT 1`,
            [requestId]
        );
        if (rows.length === 0) {
            setFlash(req, 'error', 'Request not found or no longer pending.');
            return res.redirect('/admin/users?status=pending');
        }
        let payload = {};
        try { payload = rows[0].payload ? JSON.parse(rows[0].payload) : {}; } catch { payload = {}; }
        const cr = { ...rows[0], payload };

        if (decision === 'rejected') {
            await query(
                `UPDATE student_change_requests
                 SET status = 'rejected', decided_by = ?, decision_note = ?, decided_at = NOW()
                 WHERE id = ?`,
                [req.session.user.id, note, requestId]
            );
            await logAction(req.session.user.id, 'Change Rejected',
                `Admin rejected ${cr.request_type} request for ${cr.first_name} ${cr.last_name} (req #${requestId}). Admin note: ${note}`);
            setFlash(req, 'info', `Request rejected — the teacher will see your note.`);
            return res.redirect('/admin/users?status=pending');
        }

        const result = await applyChangeRequest(cr);
        if (!result.ok) {
            await query(
                `UPDATE student_change_requests
                 SET status = 'rejected', decided_by = ?, decision_note = ?, decided_at = NOW()
                 WHERE id = ?`,
                [req.session.user.id, `Auto-rejected at apply time: ${result.message} Admin note: ${note}`, requestId]
            );
            await logAction(req.session.user.id, 'Change Failed',
                `Admin approved ${cr.request_type} request for ${cr.first_name} ${cr.last_name} (req #${requestId}) but apply failed: ${result.message}. Admin note: ${note}`);
            setFlash(req, 'error', `Could not apply: ${result.message} The request was marked rejected.`);
            return res.redirect('/admin/users?status=pending');
        }

        await query(
            `UPDATE student_change_requests
             SET status = 'approved', decided_by = ?, decision_note = ?, decided_at = NOW()
             WHERE id = ?`,
            [req.session.user.id, note, requestId]
        );
        await logAction(req.session.user.id, 'Change Approved',
            `Admin approved ${cr.request_type} request for ${cr.first_name} ${cr.last_name} (req #${requestId}): ${result.detail}. Teacher note was: ${cr.teacher_note}. Admin note: ${note}`);
        setFlash(req, 'success', `Request approved and applied (${result.detail}).`);
        res.redirect('/admin/users?status=pending');
    } catch (err) {
        console.error('Admin decide change error:', err);
        setFlash(req, 'error', 'Failed to decide the request.');
        res.redirect('/admin/users?status=pending');
    }
}

module.exports = {
    requireReason,
    logAction,
    transferClass,
    archiveClass,
    unarchiveClass,
    moveEnrollment,
    dropEnrollment,
    restoreEnrollment,
    correctGrade,
    resetAttempt,
    updateQuizWindow,
    unpostMaterial,
    unpostActivity,
    hideAnnouncement,
    showAnnouncement,
    sessions,
    revokeSession,
    revokeUserSessions,
    editUser,
    createAdmin,
    bulkUsers,
    transferQueueData,
    decideTransfer,
    changeQueueData,
    decideChange,
    exportLogs
};
