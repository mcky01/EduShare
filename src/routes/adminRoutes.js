const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const { uploadLogo } = require('../middleware/upload');

router.use(isAuthenticated);
router.use(requireRole('admin'));

router.get('/dashboard', adminController.dashboard);
router.get('/users', adminController.users);
router.post('/users', adminController.createUser);
router.post('/users/:id/toggle-status', adminController.toggleUserStatus);
router.post('/users/:id/reset-password', adminController.resetPassword);

router.get('/settings', adminController.settings);
router.post('/settings', uploadLogo.single('school_logo'), adminController.updateSettings);

router.get('/curriculum', adminController.curriculum);
router.get('/logs', adminController.logs);

module.exports = router;
