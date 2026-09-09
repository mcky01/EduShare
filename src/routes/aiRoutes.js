const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const { isAuthenticated } = require('../middleware/auth');

router.use(isAuthenticated);

router.post('/chat/stream', aiController.chatStream);
router.get('/chat/history', aiController.getChatHistory);
router.delete('/chat/history', aiController.clearChatHistory);

router.post('/lesson/generate', aiController.generateLesson);
router.post('/lesson/save', aiController.saveLessonToLibrary);

router.post('/quiz/generate', aiController.generateQuiz);
router.post('/quiz/save', aiController.saveQuiz);

module.exports = router;
