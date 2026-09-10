const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const { validateCsrf } = require('../middleware/csrf');

router.use(isAuthenticated);

router.post('/chat/stream', validateCsrf, aiController.chatStream);
router.get('/chat/history', aiController.getChatHistory);
router.delete('/chat/history', validateCsrf, aiController.clearChatHistory);

router.post('/lesson/generate', requireRole('teacher'), validateCsrf, aiController.generateLesson);
router.post('/lesson/save', requireRole('teacher'), validateCsrf, aiController.saveLessonToLibrary);

router.post('/quiz/generate', requireRole('teacher'), validateCsrf, aiController.generateQuiz);
router.post('/quiz/save', requireRole('teacher'), validateCsrf, aiController.saveQuiz);

module.exports = router;
