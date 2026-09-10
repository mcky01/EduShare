const { query } = require('../config/database');

async function search(req, res) {
    try {
        const q = req.query.q ? req.query.q.trim() : '';
        if (!q || q.length < 2) {
            return res.json({ results: [] });
        }

        const searchTerm = `%${q}%`;
        const user = req.session.user;

        const results = [];

        // 1. Search Classes
        const classes = await query(
            `SELECT id, class_name, subject, grade_level, section, class_code 
             FROM classes 
             WHERE is_active = 1 AND (class_name LIKE ? OR subject LIKE ? OR class_code LIKE ?)
             LIMIT 5`,
            [searchTerm, searchTerm, searchTerm]
        );
        for (const c of classes) {
            results.push({
                type: 'Class',
                title: c.class_name,
                subtitle: `${c.grade_level} - ${c.section} (${c.subject}) • Code: ${c.class_code}`,
                url: user.role === 'teacher' ? `/teacher/classes/${c.id}` : `/student/classes/${c.id}`,
                badge: 'badge-emerald'
            });
        }

        // 2. Search Materials
        const materials = await query(
            `SELECT id, title, subject, grade_level, file_type, file_path
             FROM library_items
             WHERE title LIKE ? OR description LIKE ?
             LIMIT 5`,
            [searchTerm, searchTerm]
        );
        for (const m of materials) {
            results.push({
                type: 'Material',
                title: m.title,
                subtitle: `${m.grade_level} ${m.subject} • ${m.file_type || 'Document'}`,
                url: m.file_path || '#',
                badge: 'badge-amber',
                external: true
            });
        }

        // 3. Search Quizzes
        const quizzes = await query(
            `SELECT id, title, subject, grade_level, total_questions
             FROM quizzes
             WHERE is_active = 1 AND (title LIKE ? OR description LIKE ?)
             LIMIT 5`,
            [searchTerm, searchTerm]
        );
        for (const qz of quizzes) {
            results.push({
                type: 'Quiz',
                title: qz.title,
                subtitle: `${qz.grade_level} ${qz.subject} • ${qz.total_questions} Questions`,
                url: user.role === 'teacher' ? '/teacher/quiz-maker' : `/student/quizzes/${qz.id}/take`,
                badge: 'badge-emerald'
            });
        }

        // 4. If Admin, also search users
        if (user.role === 'admin') {
            const users = await query(
                `SELECT id, first_name, last_name, email, role
                 FROM users
                 WHERE first_name LIKE ? OR last_name LIKE ? OR email LIKE ?
                 LIMIT 5`,
                [searchTerm, searchTerm, searchTerm]
            );
            for (const u of users) {
                results.push({
                    type: 'User',
                    title: `${u.first_name} ${u.last_name}`,
                    subtitle: `${u.role.toUpperCase()} • ${u.email}`,
                    url: `/admin/users?q=${encodeURIComponent(u.email)}`,
                    badge: 'badge-gray'
                });
            }
        }

        res.json({ results });
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: 'Search failed.' });
    }
}

module.exports = { search };
