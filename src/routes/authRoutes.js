const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { isAuthenticated, isGuest } = require('../middleware/auth');
const { uploadAvatar } = require('../middleware/upload');
const { validateCsrf } = require('../middleware/csrf');
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

// Temporary stubs until Task 5 implements the real handlers in
// authController. Each route prefers the real handler when present,
// so Task 5 only needs to export them — no route changes required.
const stubRegisterPage = (req, res) => res.status(200).send('register');

router.get('/login', isGuest, authController.showLogin);
router.post('/login', isGuest, validateCsrf, authController.login);

router.get('/change-password', isAuthenticated, authController.showChangePassword);
router.post('/change-password', isAuthenticated, validateCsrf, authController.changePassword);

router.post('/profile', isAuthenticated, uploadAvatar.single('avatar'), authController.updateProfile);

router.get('/logout', authController.logout);
router.post('/logout', authController.logout);

const stubOtpAction = (req, res) => res.status(200).json({ ok: true });

router.get('/register', isGuest, authController.showRegister || stubRegisterPage);
router.post('/register/teacher/request-code', isGuest, otpRequestLimiter, validateCsrf, authController.requestTeacherCode || stubOtpAction);
router.post('/register/teacher/verify', isGuest, otpVerifyLimiter, validateCsrf, authController.verifyTeacherRegister || stubOtpAction);
router.post('/register/student/request-code', isGuest, otpRequestLimiter, validateCsrf, authController.requestStudentCode || stubOtpAction);
router.post('/register/student/verify', isGuest, otpVerifyLimiter, validateCsrf, authController.verifyStudentRegister || stubOtpAction);

module.exports = router;
