const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const { validateCsrf } = require('../middleware/csrf');

router.use(isAuthenticated);
router.use(requireRole('student'));

router.get('/', notificationController.list);
router.get('/unread-count', notificationController.count);
router.post('/read-all', validateCsrf, notificationController.markAll);
router.post('/:id/read', validateCsrf, notificationController.markOne);

module.exports = router;
