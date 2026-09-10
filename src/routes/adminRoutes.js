const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
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

module.exports = router;
