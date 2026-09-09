const aiService = require('../services/aiService');
const { query, withTransaction } = require('../config/database');

async function chatStream(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
        const { message, subject = 'General', grade = 'Grade 7' } = req.body;
        const studentUserId = req.session.user.id;

        if (!message) {
            res.write(`data: ${JSON.stringify({ error: 'Message cannot be empty' })}\n\n`);
            return res.end();
        }

        const systemPrompt = `You are the friendly, encouraging, and highly knowledgeable AI Study Buddy & Tutor at Zeferino Arroyo High School (Iriga City, motto: "Basta Zeferinian, Magaling Yan!").
You are tutoring a ${grade} student in ${subject}.
Answer clearly with age-appropriate explanations, bullet points, and real-world examples.
Guide the student using the Socratic method when appropriate.
Keep your tone respectful, inspiring, and aligned with DepEd MATATAG curriculum values.`;

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message }
        ];

        let fullAiResponse = '';

        for await (const chunk of aiService.chatStream(messages)) {
            fullAiResponse += chunk;
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        }

        // Save to chat_history
        await query(
            `INSERT INTO chat_history (user_id, subject, grade_level, user_message, ai_response, provider_used)
             VALUES (?, ?, ?, ?, ?, 'Ollama Qwen 2.5 7B')`,
            [studentUserId, subject, grade, message, fullAiResponse]
        );

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
    } catch (err) {
        console.error('Chat stream error:', err);
        res.write(`data: ${JSON.stringify({ error: 'AI tutor error: ' + err.message })}\n\n`);
        res.end();
    }
}

async function getChatHistory(req, res) {
    try {
        const studentUserId = req.session.user.id;
        const rows = await query(
            'SELECT * FROM chat_history WHERE user_id = ? ORDER BY created_at ASC LIMIT 50',
            [studentUserId]
        );
        res.json({ history: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function clearChatHistory(req, res) {
    try {
        const studentUserId = req.session.user.id;
        await query('DELETE FROM chat_history WHERE user_id = ?', [studentUserId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function generateLesson(req, res) {
    try {
        const { topic, grade_level, subject, competency, instructions } = req.body;
        const teacherUserId = req.session.user.id;

        const prompt = `You are a curriculum expert preparing an exemplary DepEd MATATAG lesson for Zeferino Arroyo High School.
Subject: ${subject || 'English'}
Grade Level: ${grade_level || 'Grade 7'}
Topic: ${topic}
Competency: ${competency || 'General Standard'}
Teacher Instructions: ${instructions || 'Focus on active engagement and value integration'}

Generate a structured lesson presentation in valid JSON with this schema:
{
  "topic": "${topic}",
  "gradeLevel": "${grade_level}",
  "subject": "${subject}",
  "competency": "${competency}",
  "duration": "60 minutes",
  "slides": [
    {
      "slideNumber": 1,
      "title": "Slide Title",
      "type": "intro|hook|concept|analysis|practice|reflection",
      "content": "Markdown text for slide"
    }
  ]
}`;

        const lessonData = await aiService.generateJSON(
            prompt,
            () => aiService.getFallbackLesson(topic, grade_level, subject, competency)
        );

        // Save draft to ai_content
        const saveRes = await query(
            `INSERT INTO ai_content (user_id, content_type, topic, content, metadata)
             VALUES (?, 'lesson', ?, ?, ?)`,
            [teacherUserId, topic, JSON.stringify(lessonData), JSON.stringify({ subject, grade_level, competency })]
        );

        res.json({
            success: true,
            lessonId: saveRes.insertId,
            lesson: lessonData
        });
    } catch (err) {
        console.error('Generate lesson error:', err);
        res.status(500).json({ error: err.message });
    }
}

async function saveLessonToLibrary(req, res) {
    try {
        const { title, lesson_json, class_ids } = req.body;
        const teacherUserId = req.session.user.id;

        const parsed = typeof lesson_json === 'string' ? JSON.parse(lesson_json) : lesson_json;

        await withTransaction(async (conn) => {
            const [libRes] = await conn.query(
                `INSERT INTO library_items (teacher_id, title, description, subject, grade_level, source)
                 VALUES (?, ?, ?, ?, ?, 'ai_lesson')`,
                [
                    teacherUserId,
                    title || parsed.topic || 'AI Generated Lesson',
                    `AI Generated Lesson Plan on ${parsed.topic || ''} (${parsed.competency || ''})`,
                    parsed.subject || 'General',
                    parsed.gradeLevel || 'Grade 7'
                ]
            );
            const itemId = libRes.insertId;

            if (class_ids) {
                const targetIds = Array.isArray(class_ids) ? class_ids : [class_ids];
                for (const cId of targetIds) {
                    await conn.query(
                        `INSERT IGNORE INTO class_materials (library_item_id, class_id) VALUES (?, ?)`,
                        [itemId, cId]
                    );
                }
            }
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Save lesson to library error:', err);
        res.status(500).json({ error: err.message });
    }
}

async function generateQuiz(req, res) {
    try {
        const { topic, grade_level, subject, mc_count = 3, tf_count = 2, id_count = 1 } = req.body;

        const totalQ = (parseInt(mc_count, 10) || 3) + (parseInt(tf_count, 10) || 2) + (parseInt(id_count, 10) || 1);

        const prompt = `Generate a ${totalQ}-question quiz in valid JSON for Grade: ${grade_level}, Subject: ${subject}, Topic: ${topic}.
Include ${mc_count} multiple_choice, ${tf_count} true_false, and ${id_count} identification questions.
Format as a JSON array of objects:
[
  {
    "question_text": "...",
    "question_type": "multiple_choice",
    "points": 1,
    "explanation": "...",
    "options": [
      { "option_text": "...", "is_correct": 1 },
      { "option_text": "...", "is_correct": 0 }
    ]
  }
]`;

        const questions = await aiService.generateJSON(
            prompt,
            () => aiService.getFallbackQuiz(topic, grade_level, subject, totalQ)
        );

        res.json({
            success: true,
            questions
        });
    } catch (err) {
        console.error('Generate quiz error:', err);
        res.status(500).json({ error: err.message });
    }
}

async function saveQuiz(req, res) {
    try {
        const { title, description, subject, grade_level, time_limit, passing_score, questions, class_ids } = req.body;
        const teacherUserId = req.session.user.id;

        if (!title || !questions || questions.length === 0) {
            return res.status(400).json({ error: 'Quiz title and questions are required.' });
        }

        let quizId;
        await withTransaction(async (conn) => {
            const [qRes] = await conn.query(
                `INSERT INTO quizzes (teacher_id, title, description, subject, grade_level, total_questions, time_limit_minutes, passing_score)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    teacherUserId,
                    title.trim(),
                    description?.trim() || null,
                    subject || 'General',
                    grade_level || 'Grade 7',
                    questions.length,
                    parseInt(time_limit, 10) || 15,
                    parseInt(passing_score, 10) || 60
                ]
            );
            quizId = qRes.insertId;

            for (let i = 0; i < questions.length; i++) {
                const q = questions[i];
                const [qRow] = await conn.query(
                    `INSERT INTO quiz_questions (quiz_id, question_text, question_type, points, order_index, explanation)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [quizId, q.question_text, q.question_type, q.points || 1, i + 1, q.explanation || null]
                );
                const questionId = qRow.insertId;

                if (q.options && q.options.length > 0) {
                    for (let j = 0; j < q.options.length; j++) {
                        const opt = q.options[j];
                        await conn.query(
                            `INSERT INTO quiz_options (question_id, option_text, is_correct, order_index)
                             VALUES (?, ?, ?, ?)`,
                            [questionId, opt.option_text, opt.is_correct ? 1 : 0, j + 1]
                        );
                    }
                }
            }

            // Assign to class sections
            if (class_ids) {
                const targetIds = Array.isArray(class_ids) ? class_ids : [class_ids];
                for (const cId of targetIds) {
                    await conn.query(
                        `INSERT INTO section_quizzes (quiz_id, class_id, is_published)
                         VALUES (?, ?, 1)`,
                        [quizId, cId]
                    );

                    // Auto link to Gradebook Column
                    const [catRows] = await conn.query(
                        'SELECT id FROM gradebook_categories WHERE class_id = ? AND category_code = "written_works" LIMIT 1',
                        [cId]
                    );
                    if (catRows.length > 0) {
                        await conn.query(
                            `INSERT INTO gradebook_columns (class_id, category_id, column_name, max_score, source_type, quiz_id)
                             VALUES (?, ?, ?, ?, 'quiz', ?)`,
                            [cId, catRows[0].id, title.trim(), questions.length, quizId]
                        );
                    }
                }
            }
        });

        res.json({ success: true, quizId });
    } catch (err) {
        console.error('Save quiz error:', err);
        res.status(500).json({ error: err.message });
    }
}

module.exports = {
    chatStream,
    getChatHistory,
    clearChatHistory,
    generateLesson,
    saveLessonToLibrary,
    generateQuiz,
    saveQuiz
};
