const express = require('express');
const router = express.Router();
const curriculumController = require('../controllers/curriculumController');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const { validateCsrf, csrfAfterMulter } = require('../middleware/csrf');
const { uploadCurriculum } = require('../middleware/upload');

router.use(isAuthenticated);

router.post(
    '/ingest',
    requireRole('admin'),
    uploadCurriculum.single('curriculum_file'),
    csrfAfterMulter,
    curriculumController.ingestDocument
);
router.get('/chunks', requireRole('admin'), curriculumController.listChunks);
router.post('/preview-sources', requireRole('teacher'), validateCsrf, curriculumController.previewSources);

module.exports = router;
