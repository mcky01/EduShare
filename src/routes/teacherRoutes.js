const express = require('express');
const router = express.Router();
const teacherController = require('../controllers/teacherController');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const { validateCsrf, csrfAfterMulter } = require('../middleware/csrf');
const { uploadMaterial } = require('../middleware/upload');

router.use(isAuthenticated);
router.use(requireRole('teacher'));

router.get('/dashboard', teacherController.dashboard);
router.get('/classes', teacherController.classes);
router.post('/classes', validateCsrf, teacherController.createClass);
router.get('/classes/:id', teacherController.classDetail);
router.post('/classes/:id/announcements', validateCsrf, teacherController.postAnnouncement);

router.post('/activities', uploadMaterial.single('activity_file'), csrfAfterMulter, teacherController.createActivity);
router.get('/activities/:activityId/classes/:classId/grading', teacherController.viewActivityGrading);
router.post('/activities/grade', validateCsrf, teacherController.gradeSubmission);

router.get('/library', teacherController.library);
router.post('/library/upload', uploadMaterial.single('material_file'), csrfAfterMulter, teacherController.uploadLibraryItem);
router.post('/library/repost', validateCsrf, teacherController.repostLibraryItem);

router.get('/gradebook', teacherController.gradebook);
router.get('/gradebook/:classId/export', teacherController.exportGradebook);

router.get('/advisory', teacherController.advisory);
router.post('/advisory/approve/:id', validateCsrf, teacherController.approveStudent);
router.get('/lesson-generator', teacherController.lessonGenerator);
router.get('/quiz-maker', teacherController.quizMaker);

module.exports = router;
