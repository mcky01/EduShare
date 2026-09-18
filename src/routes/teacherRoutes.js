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
router.post('/advisory/reject/:id', validateCsrf, teacherController.rejectStudent);
router.post('/advisory/edit/:id', validateCsrf, teacherController.editStudent);
router.post('/advisory/drop/:id', validateCsrf, teacherController.dropStudent);
router.post('/advisory/restore/:id', validateCsrf, teacherController.restoreStudent);
router.post('/advisory/transfer/:id', validateCsrf, teacherController.requestTransfer);
router.post('/advisory/transfers/:requestId/decide', validateCsrf, teacherController.decideIncomingTransfer);
router.post('/advisory/transfers/:requestId/cancel', validateCsrf, teacherController.cancelTransfer);
router.post('/advisory/change/:id', validateCsrf, teacherController.requestChange);
router.post('/advisory/changes/:requestId/cancel', validateCsrf, teacherController.cancelChange);
router.get('/lesson-generator', teacherController.lessonGenerator);
router.get('/quiz-maker', teacherController.quizMaker);

module.exports = router;
