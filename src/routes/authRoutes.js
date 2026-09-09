const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { isAuthenticated, isGuest } = require('../middleware/auth');
const { uploadAvatar } = require('../middleware/upload');
const { validateCsrf } = require('../middleware/csrf');

router.get('/login', isGuest, authController.showLogin);
router.post('/login', isGuest, validateCsrf, authController.login);

router.get('/change-password', isAuthenticated, authController.showChangePassword);
router.post('/change-password', isAuthenticated, validateCsrf, authController.changePassword);

router.post('/profile', isAuthenticated, uploadAvatar.single('avatar'), authController.updateProfile);

router.get('/logout', authController.logout);
router.post('/logout', authController.logout);

module.exports = router;
