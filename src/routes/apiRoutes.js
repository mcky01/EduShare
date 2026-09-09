const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const { isAuthenticated } = require('../middleware/auth');
const { query } = require('../config/database');

router.use(isAuthenticated);

router.get('/search', searchController.search);

// Interactive Gradebook AJAX cell update
router.post('/gradebook/entry', async (req, res) => {
    try {
        const { column_id, student_id, score } = req.body;
        const numScore = parseFloat(score);

        if (isNaN(numScore)) {
            return res.status(400).json({ error: 'Invalid score number' });
        }

        await query(
            `INSERT INTO gradebook_entries (column_id, student_id, score, manual_override)
             VALUES (?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE score = VALUES(score), manual_override = 1`,
            [column_id, student_id, numScore]
        );

        res.json({ success: true, score: numScore });
    } catch (err) {
        console.error('Gradebook entry AJAX error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
