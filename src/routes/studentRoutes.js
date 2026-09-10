const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const { uploadSubmission } = require('../middleware/upload');
const { validateCsrf, csrfAfterMulter } = require('../middleware/csrf');

router.use(isAuthenticated);
router.use(requireRole('student'));

router.get('/dashboard', studentController.dashboard);
router.get('/classes', studentController.classes);
router.post('/classes/join', validateCsrf, studentController.joinClass);
router.get('/classes/:id', studentController.classView);

router.get('/activities/:activityId/classes/:classId/submit', studentController.viewActivitySubmit);
router.post('/activities/:activityId/classes/:classId/submit', uploadSubmission.single('submission_file'), csrfAfterMulter, studentController.submitActivity);

router.get('/quizzes/:quizId/take', studentController.takeQuiz);
router.post('/quizzes/:quizId/submit', validateCsrf, studentController.submitQuiz);
router.get('/quizzes/:attemptId/result', studentController.quizResult);

router.get('/chatbot', studentController.chatbot);

module.exports = router;
