const aiService = require('../services/aiService');
const retrievalService = require('../services/retrievalService');
const groundingService = require('../services/groundingService');
const validationService = require('../services/validationService');
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
        res.write(`data: ${JSON.stringify({ error: 'AI service unavailable.' })}\n\n`);
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
        res.status(500).json({ error: 'AI service unavailable.' });
    }
}

async function clearChatHistory(req, res) {
    try {
        const studentUserId = req.session.user.id;
        await query('DELETE FROM chat_history WHERE user_id = ?', [studentUserId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'AI service unavailable.' });
    }
}

async function generateLesson(req, res) {
    try {
        const { topic, grade_level, subject, competency, instructions, term, competency_code,
            approach, integration, resources, language, assessment,
            class_profile, inclusion, duration, content_standard, performance_standard, bow_week } = req.body;
        if (!topic || !String(topic).trim()) {
            return res.status(400).json({ error: 'Topic is required.' });
        }
        const prefs = {
            approach: Array.isArray(approach) ? approach.filter(Boolean).slice(0, 8) : [],
            integration: Array.isArray(integration) ? integration.filter(Boolean).slice(0, 8) : [],
            resources: Array.isArray(resources) ? resources.filter(Boolean).slice(0, 8) : [],
            language: String(language || '').slice(0, 60),
            assessment: Array.isArray(assessment) ? assessment.filter(Boolean).slice(0, 8) : [],
            class_profile: String(class_profile || '').slice(0, 500),
            inclusion: String(inclusion || '').slice(0, 500),
            duration: String(duration || '').slice(0, 60),
            content_standard: String(content_standard || '').slice(0, 500),
            performance_standard: String(performance_standard || '').slice(0, 500),
            bow_week: String(bow_week || '').slice(0, 30)
        };
        const teacherUserId = req.session.user.id;
        const normalizedTerm = groundingService.normalizeTerm(term);

        const retrieval = await retrievalService.retrieve({
            topic: [topic, prefs.bow_week, prefs.content_standard].filter(Boolean).join(' '),
            subject: subject || 'English',
            grade_level: grade_level || 'Grade 7',
            term: normalizedTerm,
            competency_code: competency_code || null
        });

        const { grounded, prompt, system } = groundingService.buildLessonPrompt({
            topic,
            subject,
            grade_level,
            competency,
            term: normalizedTerm,
            instructions,
            retrieval,
            prefs
        });

        // Lesson-scoped sampling: tighter + less creative than global chat/quiz
        // defaults (0.7/4096), so other AI features are unaffected.
        const lessonSampling = { temperature: 0.3, topP: 0.85, maxTokens: 3000 };
        const lessonData = await aiService.generateJSON(
            prompt,
            () => aiService.getFallbackLesson(topic, grade_level, subject, competency),
            system ? { system, ...lessonSampling } : lessonSampling
        );
        const lesson = validationService.normalizeLesson(lessonData);

        const validation = validationService.validateLesson(lesson, prefs);
        const metaComp = lesson.meta?.competency || lesson.competency;
        if (typeof metaComp === 'string' && metaComp.length > 60) {
            const short = (competency_code || competency || 'General Standard').slice(0, 60);
            lesson.meta.competency = short;
            lesson.competency = short;
            validation.issues.push('competency_trimmed');
        }
        const needsReview = !validation.valid || !grounded;

        // Save draft to ai_content (persistence failure must not lose generated lesson)
        const citations = retrievalService.formatCitations(retrieval.chunks);
        const metadata = {
            subject,
            grade_level,
            competency,
            competency_code: competency_code || null,
            term: normalizedTerm,
            grounded,
            retrieval_reason: retrieval.reason,
            citations,
            validation: validation.issues,
            needsReview,
            prefs
        };
        let lessonId = null;
        let saveWarning = null;
        try {
            const saveRes = await query(
                `INSERT INTO ai_content (user_id, content_type, topic, content, metadata)
                 VALUES (?, 'lesson', ?, ?, ?)`,
                [teacherUserId, topic, JSON.stringify(lesson), JSON.stringify(metadata)]
            );
            lessonId = saveRes.insertId;
            await query(
                `INSERT INTO activity_logs (user_id, action, description, category)
                 VALUES (?, 'ai_lesson_generate', ?, 'teacher')`,
                [teacherUserId, `Lesson "${topic}" grounded=${grounded} sources=${citations.length} term=${normalizedTerm || 'none'}`]
            );
        } catch (saveErr) {
            console.error('Lesson draft persistence failed (returning unsaved lesson):', saveErr.message);
            saveWarning = 'Draft could not be saved; review and save manually.';
        }

        res.json({
            success: true,
            lessonId,
            lesson,
            grounded,
            retrieval_reason: retrieval.reason,
            sources: citations,
            validation: validation.issues,
            needsReview,
            saveWarning
        });
    } catch (err) {
        console.error('Generate lesson error:', err);
        res.status(500).json({ error: 'AI service unavailable.' });
    }
}

async function saveLessonToLibrary(req, res) {
    try {
        const { title, lesson_json, class_ids, confirmed, lessonId, grounded } = req.body;
        const teacherUserId = req.session.user.id;

        // Server-side gate: re-validate structure AND grounding, never trust client flags.
        // Ungrounded/invalid lessons require explicit teacher confirmation.
        // Grounding resolved in order: generate-time lessonId draft metadata > explicit
        // grounded flag > citations present in slides. Direct API posts without a draft
        // prove no grounding, so they need confirmation.
        const parsed = validationService.normalizeLesson(
            (() => { try { const p = typeof lesson_json === 'string' ? JSON.parse(lesson_json) : lesson_json; return (p && typeof p === 'object') ? p : null; } catch { return null; } })()
        );
        if (!parsed) {
            return res.status(400).json({ error: 'Invalid lesson data.' });
        }
        const gate = validationService.validateLesson(parsed);
        let wasGrounded = grounded === true || grounded === 'true' || grounded === 1;
        if (lessonId) {
            const drafts = await query(
                'SELECT metadata FROM ai_content WHERE id = ? AND user_id = ? AND content_type = ?',
                [parseInt(lessonId, 10) || 0, teacherUserId, 'lesson']
            );
            if (drafts.length > 0) {
                try {
                    const meta = typeof drafts[0].metadata === 'string' ? JSON.parse(drafts[0].metadata) : drafts[0].metadata;
                    wasGrounded = meta?.grounded === true;
                } catch { wasGrounded = false; }
            } else {
                wasGrounded = false;
            }
        } else if (grounded === undefined) {
            const slides = Array.isArray(parsed.slides) ? parsed.slides : [];
            const cited = slides.filter((s) => /\[S\d+\]/.test(validationService.slideLines(s).join(' '))).length;
            wasGrounded = cited > 0 && cited >= Math.ceil(slides.length / 2);
        }
        if ((!gate.valid || !wasGrounded) && confirmed !== true && confirmed !== 'true' && confirmed !== 1) {
            return res.status(422).json({
                error: !wasGrounded ? 'Lesson is ungrounded. Confirm teacher review before saving.' : 'Lesson needs teacher review before saving.',
                validation: gate.issues,
                needsReview: true,
                grounded: wasGrounded
            });
        }

        let targetIds = [];
        if (class_ids) {
            const rawIds = Array.isArray(class_ids) ? class_ids : [class_ids];
            targetIds = rawIds.map((v) => parseInt(v, 10)).filter((v) => Number.isInteger(v));
            if (targetIds.length > 0) {
                const owned = await query(
                    `SELECT id FROM classes WHERE teacher_id = ? AND id IN (${targetIds.map(() => '?').join(',')})`,
                    [teacherUserId, ...targetIds]
                );
                if (owned.length !== targetIds.length) {
                    return res.status(403).json({ error: 'Access forbidden.' });
                }
            }
        }

        let savedItemId = null;
        await withTransaction(async (conn) => {
            const [libRes] = await conn.query(
                `INSERT INTO library_items (teacher_id, title, description, subject, grade_level, source, lesson_content)
                 VALUES (?, ?, ?, ?, ?, 'ai_lesson', ?)`,
                [
                    teacherUserId,
                    title || parsed.meta?.topic || parsed.topic || 'AI Generated Lesson',
                    `AI Generated Lesson Plan on ${parsed.meta?.topic || parsed.topic || ''} (${parsed.meta?.competency || parsed.competency || ''})`,
                    parsed.meta?.subject || parsed.subject || 'General',
                    parsed.meta?.grade_level || parsed.gradeLevel || 'Grade 7',
                    JSON.stringify(parsed)
                ]
            );
            const itemId = libRes.insertId;
            savedItemId = itemId;

            if (targetIds.length > 0) {
                for (const cId of targetIds) {
                    await conn.query(
                        `INSERT IGNORE INTO class_materials (library_item_id, class_id) VALUES (?, ?)`,
                        [itemId, cId]
                    );
                }
            }
        });

        res.json({ success: true, itemId: savedItemId, posted: targetIds.length });
    } catch (err) {
        console.error('Save lesson to library error:', err);
        res.status(500).json({ error: 'AI service unavailable.' });
    }
}

async function generateQuiz(req, res) {
    try {
        const { topic, grade_level, subject, mc_count = 3, tf_count = 2, id_count = 1, term, competency, competency_code } = req.body;
        if (!topic || !String(topic).trim()) {
            return res.status(400).json({ error: 'Topic is required.' });
        }

        const totalQ = (parseInt(mc_count, 10) || 3) + (parseInt(tf_count, 10) || 2) + (parseInt(id_count, 10) || 1);
        const normalizedTerm = groundingService.normalizeTerm(term);

        const retrieval = await retrievalService.retrieve({
            topic,
            subject: subject || 'General',
            grade_level: grade_level || 'Grade 7',
            term: normalizedTerm,
            competency_code: competency_code || null
        });

        const { grounded, prompt } = groundingService.buildQuizPrompt({
            topic,
            subject,
            grade_level,
            term: normalizedTerm,
            competency,
            mc_count,
            tf_count,
            id_count,
            totalQ,
            retrieval
        });

        const questions = await aiService.generateJSON(
            prompt,
            () => aiService.getFallbackQuiz(topic, grade_level, subject, totalQ)
        );

        const citations = retrievalService.formatCitations(retrieval.chunks);
        const quizValidation = validationService.validateQuiz(questions, totalQ);

        res.json({
            success: true,
            questions,
            grounded,
            retrieval_reason: retrieval.reason,
            sources: citations,
            validation: quizValidation.issues,
            needsReview: !quizValidation.valid || !grounded
        });
    } catch (err) {
        console.error('Generate quiz error:', err);
        res.status(500).json({ error: 'AI service unavailable.' });
    }
}

async function saveQuiz(req, res) {
    try {
        const { title, description, subject, grade_level, time_limit, passing_score, questions, class_ids, confirmed, grounded } = req.body;
        const teacherUserId = req.session.user.id;

        if (!title || !questions || questions.length === 0) {
            return res.status(400).json({ error: 'Quiz title and questions are required.' });
        }

        // Server-side gate: structure + grounding. Ungrounded quizzes need confirmation.
        // No draft lookup exists for quizzes, so grounding comes from the generate-time
        // flag or explanation citations; direct posts without either need confirmation.
        const quizGate = validationService.validateQuiz(questions, questions.length);
        let quizGrounded = grounded === true || grounded === 'true' || grounded === 1;
        if (grounded === undefined) {
            const cited = questions.filter((q) => /\[S\d+\]/.test(String(q.explanation || ''))).length;
            quizGrounded = cited > 0 && cited >= Math.ceil(questions.length / 2);
        }
        if ((!quizGate.valid || !quizGrounded) && confirmed !== true && confirmed !== 'true' && confirmed !== 1) {
            return res.status(422).json({
                error: !quizGrounded ? 'Quiz is ungrounded. Confirm teacher review before publishing.' : 'Quiz needs teacher review before publishing.',
                validation: quizGate.issues,
                needsReview: true,
                grounded: quizGrounded
            });
        }

        let quizTargetIds = [];
        if (class_ids) {
            const rawQuizIds = Array.isArray(class_ids) ? class_ids : [class_ids];
            quizTargetIds = rawQuizIds.map((v) => parseInt(v, 10)).filter((v) => Number.isInteger(v));
            if (quizTargetIds.length > 0) {
                const ownedQuiz = await query(
                    `SELECT id FROM classes WHERE teacher_id = ? AND id IN (${quizTargetIds.map(() => '?').join(',')})`,
                    [teacherUserId, ...quizTargetIds]
                );
                if (ownedQuiz.length !== quizTargetIds.length) {
                    return res.status(403).json({ error: 'Access forbidden.' });
                }
            }
        }

        let quizId;
        const totalPoints = questions.reduce((sum, q) => sum + (Number(q.points) || 1), 0);
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
            if (quizTargetIds.length > 0) {
                for (const cId of quizTargetIds) {
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
                            [cId, catRows[0].id, title.trim(), totalPoints, quizId]
                        );
                    }
                }
            }
        });

        res.json({ success: true, quizId });
    } catch (err) {
        console.error('Save quiz error:', err);
        res.status(500).json({ error: 'AI service unavailable.' });
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
