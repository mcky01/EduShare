const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const { validateCsrf, csrfAfterMulter } = require('../middleware/csrf');
const { uploadPlan } = require('../middleware/upload');

router.use(isAuthenticated);

router.post('/chat/stream', validateCsrf, aiController.chatStream);
router.get('/chat/history', aiController.getChatHistory);
router.get('/chat/status', aiController.getChatStatus);
router.delete('/chat/history', validateCsrf, aiController.clearChatHistory);

// Standalone plan parse (auto-parse on file select; teacher reviews before generating).
router.post('/lesson/parse', requireRole('teacher'), (req, res) => {
    uploadPlan.single('plan_file')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message || 'Plan upload failed.' });
        return csrfAfterMulter(req, res, () => aiController.parsePlan(req, res));
    });
});

// Plan-input lesson deck: optional plan file (paste-only also works).
router.post('/lesson/generate', requireRole('teacher'), (req, res, next) => {
    const ct = String(req.headers['content-type'] || '');
    if (ct.includes('multipart/form-data')) {
        return uploadPlan.single('plan_file')(req, res, (err) => {
            if (err) return res.status(400).json({ error: err.message || 'Plan upload failed.' });
            return csrfAfterMulter(req, res, () => aiController.generateLesson(req, res));
        });
    }
    return validateCsrf(req, res, () => aiController.generateLesson(req, res));
});
router.post('/lesson/save', requireRole('teacher'), validateCsrf, aiController.saveLessonToLibrary);
router.post('/lesson/export-pptx', requireRole('teacher'), validateCsrf, aiController.exportLessonPptx);

router.post('/quiz/generate', requireRole('teacher'), (req, res, next) => {
    const ct = String(req.headers['content-type'] || '');
    if (ct.includes('multipart/form-data')) {
        return uploadPlan.single('plan_file')(req, res, (err) => {
            if (err) return res.status(400).json({ error: err.message || 'Plan upload failed.' });
            return csrfAfterMulter(req, res, () => aiController.generateQuiz(req, res));
        });
    }
    return validateCsrf(req, res, () => aiController.generateQuiz(req, res));
});
router.post('/quiz/save', requireRole('teacher'), validateCsrf, aiController.saveQuiz);

module.exports = router;
