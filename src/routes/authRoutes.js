const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { isAuthenticated, isGuest } = require('../middleware/auth');
const { uploadAvatar } = require('../middleware/upload');
const { validateCsrf, csrfAfterMulter } = require('../middleware/csrf');
const rateLimit = require('express-rate-limit');

const otpRequestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method !== 'POST',
    message: 'Too many code requests. Please wait 15 minutes.'
});
const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method !== 'POST',
    message: 'Too many attempts. Please wait 15 minutes.'
});

router.get('/login', isGuest, authController.showLogin);
router.post('/login', isGuest, validateCsrf, authController.login);

router.get('/change-password', isAuthenticated, authController.showChangePassword);
router.post('/change-password', isAuthenticated, validateCsrf, authController.changePassword);

router.post('/profile', isAuthenticated, uploadAvatar.single('avatar'), csrfAfterMulter, authController.updateProfile);

router.get('/logout', (req, res) => res.redirect('/auth/login'));
router.post('/logout', authController.logout);

router.get('/register', isGuest, authController.showRegister);
router.post('/register/teacher/request-code', isGuest, otpRequestLimiter, validateCsrf, authController.requestTeacherCode);
router.post('/register/teacher/verify', isGuest, otpVerifyLimiter, validateCsrf, authController.verifyTeacherRegister);
router.post('/register/student/request-code', isGuest, otpRequestLimiter, validateCsrf, authController.requestStudentCode);
router.post('/register/student/verify', isGuest, otpVerifyLimiter, validateCsrf, authController.verifyStudentRegister);

module.exports = router;
