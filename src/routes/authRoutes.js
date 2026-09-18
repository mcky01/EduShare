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
// Dedicated limiter for the forgot/reset code-request step (5 per 15 min per IP).
const resetRequestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method !== 'POST',
    message: 'Too many code requests. Please wait 15 minutes.'
});
// Dedicated limiter for the forgot/reset verify step (10 per 15 min per IP).
const resetVerifyLimiter = rateLimit({
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
// Public type-to-search section lookup (grade + q required, capped plain
// strings only). Same 5/15min IP window as the OTP request step so the
// unauthenticated endpoint cannot be scraped rapidly.
const sectionSuggestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method !== 'GET',
    message: { error: 'Too many requests. Please wait 15 minutes.' }
});
router.get('/sections', sectionSuggestLimiter, authController.suggestSections);
router.post('/register/teacher/request-code', isGuest, otpRequestLimiter, validateCsrf, authController.requestTeacherCode);
router.post('/register/teacher/verify', isGuest, otpVerifyLimiter, validateCsrf, authController.verifyTeacherRegister);
router.post('/register/student/request-code', isGuest, otpRequestLimiter, validateCsrf, authController.requestStudentCode);
router.post('/register/student/verify', isGuest, otpVerifyLimiter, validateCsrf, authController.verifyStudentRegister);

// Forgot / reset password via email OTP (purpose 'password_reset').
// Register-like two-step shape: POST request-code mints the code and re-renders
// forgot-password with the email+code+new-passwords form; POST verify checks the
// code and updates the password in one step; GET /reset-password exposes the
// standalone new-password form directly (it posts to /verify, so a code is always
// required — there is no code-less reset path).
router.get('/forgot-password', isGuest, authController.showForgot);
router.post('/forgot-password/request-code', isGuest, resetRequestLimiter, validateCsrf, authController.requestResetCode);
router.post('/forgot-password/verify', isGuest, resetVerifyLimiter, validateCsrf, authController.verifyResetCode);
router.get('/reset-password', isGuest, authController.showReset);

module.exports = router;
