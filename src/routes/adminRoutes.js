const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const intervention = require('../controllers/adminInterventionController');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const { validateCsrf, csrfAfterMulter } = require('../middleware/csrf');
const { uploadLogo } = require('../middleware/upload');

router.use(isAuthenticated);
router.use(requireRole('admin'));

router.get('/dashboard', adminController.dashboard);
router.get('/users', adminController.users);
router.post('/users', validateCsrf, adminController.createUser);
router.post('/users/:id/toggle-status', validateCsrf, adminController.toggleUserStatus);
router.post('/users/:id/approve', validateCsrf, adminController.approveUser);
router.post('/users/:id/reject', validateCsrf, adminController.rejectUser);
router.post('/users/:id/reset-password', validateCsrf, adminController.resetPassword);

router.get('/settings', adminController.settings);
router.post('/settings', uploadLogo.single('school_logo'), csrfAfterMulter, adminController.updateSettings);

router.get('/curriculum', adminController.curriculum);
router.get('/logs', adminController.logs);

// Phase 1 — Academic oversight (read-only). Placed after /users so the
// exact '/users' routes match first; '/users/:id' detail sits below.
router.get('/classes', adminController.classes);
router.get('/classes/:id', adminController.classDetail);
router.get('/gradebook', adminController.gradebook);
router.post('/gradebook/export', validateCsrf, adminController.exportGradebookPost);
router.get('/quizzes/:quizId', adminController.quizDetail);
router.get('/activities/:activityId', adminController.activityDetail);
router.get('/users/:id', adminController.userDetail);

// Phase 2 — Interventions (explicit, reason-gated, logged).
// Mutations stay admin-side only; teacher/student flows untouched.
router.post('/classes/:id/transfer', validateCsrf, intervention.transferClass);
router.post('/classes/:id/archive', validateCsrf, intervention.archiveClass);
router.post('/classes/:id/unarchive', validateCsrf, intervention.unarchiveClass);

router.post('/enrollments/:enrollmentId/move', validateCsrf, intervention.moveEnrollment);
router.post('/enrollments/:enrollmentId/drop', validateCsrf, intervention.dropEnrollment);
router.post('/enrollments/:enrollmentId/restore', validateCsrf, intervention.restoreEnrollment);

router.post('/gradebook/correct', validateCsrf, intervention.correctGrade);

router.post('/attempts/:attemptId/reset', validateCsrf, intervention.resetAttempt);
router.post('/section-quizzes/:sqId/window', validateCsrf, intervention.updateQuizWindow);

router.post('/materials/:itemId/unpost', validateCsrf, intervention.unpostMaterial);
router.post('/activities/:activityId/unpost', validateCsrf, intervention.unpostActivity);
router.post('/announcements/:annId/hide', validateCsrf, intervention.hideAnnouncement);
router.post('/announcements/:annId/show', validateCsrf, intervention.showAnnouncement);

router.get('/sessions', intervention.sessions);
router.post('/sessions/:sid/revoke', validateCsrf, intervention.revokeSession);
router.post('/users/:id/revoke-sessions', validateCsrf, intervention.revokeUserSessions);

router.post('/users/:id/edit', validateCsrf, intervention.editUser);
router.post('/users/create-admin', validateCsrf, intervention.createAdmin);
router.post('/users/bulk', validateCsrf, intervention.bulkUsers);
router.post('/transfers/:requestId/decide', validateCsrf, intervention.decideTransfer);
router.post('/change-requests/:requestId/decide', validateCsrf, intervention.decideChange);

// Batch A3: exports are state-changing GETs (audit write on every hit) —
// POST + CSRF only. GET export URLs now 404 (no handler).
router.post('/logs/export', validateCsrf, intervention.exportLogs);

module.exports = router;
