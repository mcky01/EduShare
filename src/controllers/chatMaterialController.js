const chatMaterialService = require('../services/chatMaterialService');

// GET /api/ai/chat/materials?subject=Science  (student-only)
async function list(req, res) {
    try {
        const studentProfileId = req.session.user.student_profile_id;
        if (!studentProfileId) {
            return res.status(403).json({ error: 'Class materials are available to enrolled students only.' });
        }
        const subject = typeof req.query.subject === 'string' ? req.query.subject.slice(0, 60) : '';
        const materials = await chatMaterialService.listForStudent(studentProfileId, subject);
        res.json({ success: true, subject, max: chatMaterialService.MAX_SELECTED, materials });
    } catch (err) {
        console.error('Chat materials list error:', err);
        res.status(500).json({ error: 'Could not load class materials.' });
    }
}

module.exports = { list };