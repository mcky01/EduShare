const express = require('express');
const router = express.Router();
const teacherController = require('../controllers/teacherController');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const { validateCsrf } = require('../middleware/csrf');
const { uploadMaterial } = require('../middleware/upload');

router.use(isAuthenticated);
router.use(requireRole('teacher'));

router.get('/dashboard', teacherController.dashboard);
router.get('/classes', teacherController.classes);
router.post('/classes', teacherController.createClass);
router.get('/classes/:id', teacherController.classDetail);
router.post('/classes/:id/announcements', teacherController.postAnnouncement);

router.post('/activities', uploadMaterial.single('activity_file'), teacherController.createActivity);
router.get('/activities/:activityId/classes/:classId/grading', teacherController.viewActivityGrading);
router.post('/activities/grade', teacherController.gradeSubmission);

router.get('/library', teacherController.library);
router.post('/library/upload', uploadMaterial.single('material_file'), teacherController.uploadLibraryItem);
router.post('/library/repost', teacherController.repostLibraryItem);

router.get('/gradebook', teacherController.gradebook);
router.get('/gradebook/:classId/export', teacherController.exportGradebook);

router.get('/advisory', teacherController.advisory);
router.post('/advisory/approve/:id', validateCsrf, teacherController.approveStudent);
router.get('/lesson-generator', teacherController.lessonGenerator);
router.get('/quiz-maker', teacherController.quizMaker);

module.exports = router;
