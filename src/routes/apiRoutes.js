const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const { validateCsrf } = require('../middleware/csrf');
const { query } = require('../config/database');

router.use(isAuthenticated);

router.get('/search', searchController.search);

// Interactive Gradebook AJAX cell update
router.post('/gradebook/entry', requireRole('teacher'), validateCsrf, async (req, res) => {
    try {
        const columnId = parseInt(req.body.column_id, 10);
        const studentId = parseInt(req.body.student_id, 10);
        const numScore = parseFloat(req.body.score);

        if (!Number.isInteger(columnId) || columnId <= 0 || !Number.isInteger(studentId) || studentId <= 0 || typeof req.body.score === 'undefined' || Number.isNaN(numScore)) {
            return res.status(400).json({ error: 'Invalid request.' });
        }

        const columns = await query(
            'SELECT id, class_id, max_score FROM gradebook_columns WHERE id = ?',
            [columnId]
        );
        if (!columns || columns.length === 0) {
            return res.status(404).json({ error: 'Resource not found.' });
        }
        const column = columns[0];

        const owned = await query(
            'SELECT id FROM classes WHERE id = ? AND teacher_id = ?',
            [column.class_id, req.session.user.id]
        );
        if (!owned || owned.length === 0) {
            return res.status(403).json({ error: 'Access forbidden.' });
        }

        const foundStudents = await query(
            'SELECT id FROM students WHERE id = ?',
            [studentId]
        );
        if (!foundStudents || foundStudents.length === 0) {
            return res.status(403).json({ error: 'Access forbidden.' });
        }

        const enrolled = await query(
            `SELECT enrollments.id FROM enrollments JOIN students ON students.id = enrollments.student_id WHERE enrollments.class_id = ? AND students.id = ? AND enrollments.status = 'active'`,
            [column.class_id, studentId]
        );
        if (!enrolled || enrolled.length === 0) {
            return res.status(403).json({ error: 'Access forbidden.' });
        }

        const maxScore = parseFloat(column.max_score);
        if (Number.isNaN(maxScore) || numScore < 0 || numScore > maxScore) {
            return res.status(400).json({ error: 'Invalid request.' });
        }

        await query(
            `INSERT INTO gradebook_entries (column_id, student_id, score, manual_override)
             VALUES (?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE score = VALUES(score), manual_override = 1`,
            [columnId, studentId, numScore]
        );

        res.json({ success: true, score: numScore });
    } catch (err) {
        console.error('Gradebook entry AJAX error:', err);
        res.status(500).json({ error: 'Failed to save score.' });
    }
});

module.exports = router;
