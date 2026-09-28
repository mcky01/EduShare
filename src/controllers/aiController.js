const aiService = require('../services/aiService');
const groundingService = require('../services/groundingService');
const validationService = require('../services/validationService');
const planParseService = require('../services/planParseService');
const crypto = require('crypto');
const fs = require('fs');
const { query, withTransaction } = require('../config/database');
const notifications = require('../services/notificationService');

const VALID_CHAT_SUBJECTS = ['English', 'Mathematics', 'Science', 'Araling Panlipunan', 'Filipino', 'General'];
const VALID_CHAT_GRADES = ['Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'];
const CHAT_HISTORY_LIMIT = 30;
const CHAT_CONTEXT_TURNS = 6;

const cleanChatSubject = (value) => VALID_CHAT_SUBJECTS.includes(String(value || '').trim()) ? String(value).trim() : 'General';
const cleanChatGrade = (value) => VALID_CHAT_GRADES.includes(String(value || '').trim()) ? String(value).trim() : 'Grade 7';

// Keep only the requested number of each question type (in order) and drop any
// type the teacher asked for 0 of. Guarantees the generated quiz never exceeds or
// mixes in unrequested types; a shortfall is caught by validateQuiz's mix check.
function enforceQuizMix(questions, mix) {
    if (!Array.isArray(questions) || !mix || typeof mix !== 'object') return questions;
    const seen = { multiple_choice: 0, true_false: 0, identification: 0 };
    const out = [];
    for (const q of questions) {
        const type = q && q.question_type;
        if (!(type in seen)) continue;
        const want = Number(mix[type]) || 0;
        if (want <= 0 || seen[type] >= want) continue;
        seen[type] += 1;
        out.push(q);
    }
    return out;
}

async function chatStream(req, res) {
    // Phase 0.2: admin kill-switch (system_settings.allow_student_chat).
    if (res.locals.school && res.locals.school.flags && res.locals.school.flags.allowStudentChat === false) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        res.write(`data: ${JSON.stringify({ error: 'The AI Study Tutor is currently disabled by the school administrator.' })}\n\n`);
        return res.end();
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
        const rawMessage = typeof req.body.message === 'string' ? req.body.message : '';
        const message = rawMessage.trim().slice(0, 2000);
        const subject = cleanChatSubject(req.body.subject);
        const grade = cleanChatGrade(req.body.grade || req.session.user.grade_level);
        const studentUserId = req.session.user.id;

        if (!message || message.length < 2) {
            res.write(`data: ${JSON.stringify({ error: 'Please type a question (at least 2 characters) so I can help you study.' })}\n\n`);
            return res.end();
        }

        const systemPrompt = `You are the friendly, encouraging, and highly knowledgeable AI Study Buddy & Tutor at Zeferino Arroyo High School (Iriga City, motto: "Basta Zeferinian, Magaling Yan!").
You are tutoring a ${grade} student in ${subject}.
Answer clearly with age-appropriate explanations, bullet points, and real-world examples.
Guide the student using the Socratic method when appropriate: ask one short follow-up question at the end when it helps learning.
Keep your tone respectful, inspiring, and aligned with DepEd MATATAG curriculum values.
Use Markdown: short headings, **bold** key terms, bullet lists, and numbered steps. Keep answers focused (under ~350 words unless the student asks for more).`;

        // Multi-turn memory: last N exchanges for this subject (or General)
        // so follow-ups like "give me an example" keep their context.
        let historyTurns = [];
        try {
            const recent = await query(
                `SELECT user_message, ai_response FROM chat_history
                  WHERE user_id = ? AND (subject = ? OR subject = 'General')
                  ORDER BY created_at DESC LIMIT ?`,
                [studentUserId, subject === 'General' ? 'General' : subject, CHAT_CONTEXT_TURNS]
            );
            // History rows relevant to both: subject-specific + General, newest first
            const mixed = subject === 'General'
                ? recent
                : await query(
                    `SELECT user_message, ai_response FROM chat_history
                      WHERE user_id = ? AND subject IN (?, 'General')
                      ORDER BY created_at DESC LIMIT ?`,
                    [studentUserId, subject, CHAT_CONTEXT_TURNS]
                );
            historyTurns = (subject === 'General' ? recent : mixed).reverse();
        } catch { historyTurns = []; }

        const messages = [{ role: 'system', content: systemPrompt }];
        for (const turn of historyTurns) {
            if (turn.user_message) messages.push({ role: 'user', content: String(turn.user_message).slice(0, 1500) });
            if (turn.ai_response) messages.push({ role: 'assistant', content: String(turn.ai_response).slice(0, 2500) });
        }
        messages.push({ role: 'user', content: message });

        let fullAiResponse = '';
        let provider = 'fallback';

        for await (const chunk of aiService.chatStream(messages, { onSource: (s) => { provider = s; } })) {
            fullAiResponse += chunk;
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        }

        const providerUsed = provider === 'nine_router'
            ? `9Router ${process.env.NINE_ROUTER_MODEL || 'free model'}`
            : provider === 'ollama' ? 'Ollama Qwen 2.5 7B' : 'Offline study guide';

        // Save to chat_history
        try {
            await query(
                `INSERT INTO chat_history (user_id, subject, grade_level, user_message, ai_response, provider_used)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [studentUserId, subject, grade, message, fullAiResponse.slice(0, 20000), providerUsed]
            );
        } catch (saveErr) {
            console.warn('Chat history save skipped:', saveErr.message);
        }

        res.write(`data: ${JSON.stringify({ done: true, provider: providerUsed })}\n\n`);
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
        const subject = typeof req.query.subject === 'string' ? req.query.subject : '';
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || CHAT_HISTORY_LIMIT));
        const params = [studentUserId];
        let where = 'user_id = ?';
        if (subject && VALID_CHAT_SUBJECTS.includes(subject) && subject !== 'General') {
            where += ' AND subject IN (?, \'General\')';
            params.push(subject);
        }
        // Cap long answers in list payloads; full text still streams live.
        const rows = await query(
            `SELECT id, subject, grade_level, user_message,
                    LEFT(ai_response, 6000) AS ai_response, provider_used, created_at
              FROM chat_history WHERE ${where} ORDER BY created_at DESC LIMIT ?`,
            [...params, limit]
        );
        res.json({ history: rows.reverse(), total: rows.length });
    } catch (err) {
        res.status(500).json({ error: 'AI service unavailable.' });
    }
}

async function getChatStatus(req, res) {
    try {
        const [countRows] = [await query(
            'SELECT COUNT(*) AS total FROM chat_history WHERE user_id = ?',
            [req.session.user.id]
        )];
        const online = await aiService.isHealthy();
        const nine = aiService.nineRouterConfigured ? aiService.nineRouterConfigured() : false;
        res.json({
            online,
            provider: online
                ? (nine ? `9Router ${process.env.NINE_ROUTER_MODEL || 'free model'} (+ Ollama fallback)` : 'Ollama Qwen 2.5 7B')
                : 'Offline study guide',
            savedExchanges: countRows ? Number(countRows.total) || 0 : 0
        });
    } catch {
        res.json({ online: false, provider: 'Offline study guide', savedExchanges: 0 });
    }
}

async function clearChatHistory(req, res) {
    try {
        const studentUserId = req.session.user.id;
        // Scoped clear: ?subject=Science removes that subject's exchanges
        // only; bare DELETE keeps the legacy clear-everything behavior.
        const subject = typeof req.query.subject === 'string' ? req.query.subject : '';
        if (subject && VALID_CHAT_SUBJECTS.includes(subject) && subject !== 'General') {
            await query('DELETE FROM chat_history WHERE user_id = ? AND subject = ?', [studentUserId, subject]);
        } else {
            await query('DELETE FROM chat_history WHERE user_id = ?', [studentUserId]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'AI service unavailable.' });
    }
}

async function parsePlan(req, res) {
    // Standalone parse endpoint for the wizard's auto-parse-on-upload flow.
    // Returns extracted text + structured metadata so the teacher can review
    // and edit before generating. Uses mammoth (docx), pdf-parse getTable (pdf),
    // or direct table parsing (html-masquerading .doc).
    if (res.locals.school && res.locals.school.flags && res.locals.school.flags.allowAiLesson === false) {
        return res.status(403).json({ error: 'The AI Lesson Generator is currently disabled by the school administrator.' });
    }
    try {
        if (!req.file || !req.file.path) {
            return res.status(400).json({ error: 'No file received. Choose a PDF, DOCX, DOC, or TXT plan file.' });
        }
        let parsed;
        try {
            const buf = await fs.promises.readFile(req.file.path);
            parsed = await planParseService.parsePlanFile(buf, {
                originalName: req.file.originalname || '',
                mimetype: req.file.mimetype || ''
            });
        } catch (parseErr) {
            const msg = String(parseErr && parseErr.message || '');
            if (/no text|empty|scanned|image/i.test(msg) || (parsed && !parsed.planText)) {
                return res.status(422).json({ error: "We couldn't read text in this file (it may be a scanned image). Please paste the plan text manually or upload a DOCX file." });
            }
            return res.status(422).json({ error: msg || 'Could not parse this plan file. Try pasting the text manually.' });
        } finally {
            fs.promises.unlink(req.file.path).catch(() => {});
        }
        if (!parsed || !parsed.planText || parsed.planText.trim().length < 50) {
            return res.status(422).json({ error: "We couldn't read text in this file (it may be a scanned image). Please paste the plan text manually or upload a DOCX file." });
        }
        // Auto-fill hints: topic (lesson title), subject, grade from header/meta blocks.
        const metaText = (parsed.sections || []).filter((s) => s.role === 'meta' || /title|subject|grade|header/i.test(s.title || '')).map((s) => s.text).join('\n');
        const allText = parsed.planText;
        const pick = (re) => {
            const m = allText.match(re);
            return m ? m[1].trim().slice(0, 200) : '';
        };
        const topic = pick(/lesson\s+title\s*[:\-]?\s*([^\n]{4,200})/i)
            || pick(/title\s*[:\-]?\s*([^\n]{4,200})/i);
        const subject = pick(/learning\s+area\/s\s*[:\-]?\s*([^\n]{2,60})/i)
            || pick(/subject\s*[:\-]?\s*([^\n]{2,60})/i);
        const gradeM = allText.match(/grade\s*(\d{1,2})/i);
        const grade = gradeM ? `Grade ${gradeM[1]}` : '';
        const sectionCounts = {};
        (parsed.sections || []).forEach((s) => {
            if (!s.role || s.role === 'meta' || s.role === 'other') return;
            sectionCounts[s.role] = (sectionCounts[s.role] || 0) + 1;
        });
        // Editable grid: row-label x session-column cells mirroring the plan's
        // own table layout, so teachers review/edit per cell instead of raw text.
        const grid = planParseService.buildEditableGrid(parsed);
        // Cap cell payload (~400 chars shown, full text kept server-side by ref).
        const gridView = {
            columns: grid.columns,
            shared: grid.shared.map((sh) => ({ key: sh.key, title: sh.title, ref: sh.ref, preview: String(sh.text || '').slice(0, 400) })),
            rows: grid.rows.map((r) => ({
                key: r.key,
                title: r.title,
                role: r.role,
                cells: Object.fromEntries(Object.entries(r.cells || {}).map(([col, txt]) => [col, String(txt || '').slice(0, 2000)])),
                refs: r.refs
            }))
        };
        res.json({
            success: true,
            planText: parsed.planText,
            grid: gridView,
            source: parsed.source,
            tableCount: parsed.tableCount || 0,
            sections: (parsed.sections || []).map((s) => ({ ref: s.ref, role: s.role, title: s.title, sessions: s.sessions || [] })),
            sessions: parsed.sessions || [],
            coverage: parsed.coverage || {},
            sectionCounts,
            warnings: parsed.warnings || [],
            suggestions: { topic, subject, grade, metaText: metaText.slice(0, 2000) }
        });
    } catch (err) {
        console.error('Parse plan error:', err);
        res.status(500).json({ error: 'Plan parser unavailable. Paste the plan text manually.' });
    }
}

async function generateLesson(req, res) {
    // Phase 0.2: admin kill-switch (system_settings.allow_ai_lesson).
    if (res.locals.school && res.locals.school.flags && res.locals.school.flags.allowAiLesson === false) {
        return res.status(403).json({ error: 'The AI Lesson Generator is currently disabled by the school administrator.' });
    }
    try {
        // Plan-input contract: plan_text (paste) and/or plan_file (upload) is the
        // source of truth. CG/BOW retrieval is no longer used for lessons.
        let planRaw = String(req.body.plan_text || '');
        let planSource = 'paste';
        if (req.file && req.file.path) {
            try {
                const buf = await fs.promises.readFile(req.file.path);
                const parsed = await planParseService.parsePlanFile(buf, {
                    originalName: req.file.originalname || '',
                    mimetype: req.file.mimetype || ''
                });
                const fileText = parsed.planText || '';
                planRaw = [planRaw.trim(), fileText.trim()].filter(Boolean).join('\n\n');
                planSource = req.body.plan_text && String(req.body.plan_text).trim() ? 'paste+file' : 'file';
                req.planParsed = parsed;
            } finally {
                fs.promises.unlink(req.file.path).catch(() => {});
            }
        }
        const planFormat = ['ilaw', 'dll', 'dlp'].includes(String(req.body.plan_format || '').toLowerCase())
            ? String(req.body.plan_format).toLowerCase() : 'ilaw';
        const focusSession = /^S[1-5]$/i.test(String(req.body.focus_session || ''))
            ? String(req.body.focus_session).toUpperCase() : '';
        // Table-edited grid (JSON string): teacher's per-cell edits win over the
        // textarea. Rebuild tagged text from the stored full parse.
        if (req.body.plan_grid) {
            try {
                const gridEdits = JSON.parse(req.body.plan_grid);
                const baseRaw = String(req.body.plan_grid_base || planRaw);
                const base = planParseService.parsePastedText(planParseService.sanitizePlanText(baseRaw));
                const rebuilt = planParseService.gridToTagged(base, gridEdits);
                if (rebuilt && rebuilt.planText && rebuilt.planText.trim().length >= 200) {
                    planRaw = rebuilt.planText;
                    planSource = `${planSource}+grid`;
                    req.planParsed = rebuilt;
                }
            } catch { /* fall through to textarea path */ }
        }
        const cleanPlan = planParseService.sanitizePlanText(planRaw);
        if (!cleanPlan || cleanPlan.length < 200) {
            return res.status(400).json({ error: 'Paste your DLL/DLP/ILAW lesson plan (or upload the file). At least 200 characters of plan text is required.' });
        }
        const parsed = req.planParsed && req.planParsed.sections && req.planParsed.sections.length
            ? req.planParsed
            : planParseService.parsePastedText(cleanPlan);
        // Tagged sections become the prompt's <lesson_plan>. Cap keeps Qwen context safe.
        const planText = parsed.planText;
        const planHash = crypto.createHash('sha256').update(cleanPlan).digest('hex').slice(0, 16);
        const coverage = parsed.coverage || {};
        const topic = String(req.body.topic || '').trim().slice(0, 300)
            || cleanPlan.split('\n').map((l) => l.trim()).filter((l) => l.length > 10).slice(0, 1).join(' ').slice(0, 300)
            || 'Lesson from plan';
        // Competency is plan-carried verbatim (descriptive text as-is).
        const planCompLine = cleanPlan.split('\n').map((l) => l.trim())
            .find((l) => /learning\s+competency|content\s+standard|performance\s+standard/i.test(l) && l.length > 8) || '';
        const competency = String(req.body.competency || '').slice(0, 500) || planCompLine.slice(0, 500);
        const { grade_level, subject, instructions } = req.body;
        const prefs = {
            approach: Array.isArray(req.body.approach) ? req.body.approach.filter(Boolean).slice(0, 8) : [],
            integration: Array.isArray(req.body.integration) ? req.body.integration.filter(Boolean).slice(0, 8) : [],
            resources: Array.isArray(req.body.resources) ? req.body.resources.filter(Boolean).slice(0, 8) : [],
            language: String(req.body.language || '').slice(0, 60),
            assessment: Array.isArray(req.body.assessment) ? req.body.assessment.filter(Boolean).slice(0, 8) : [],
            class_profile: String(req.body.class_profile || parsed.sessions && '' || '').slice(0, 500),
            inclusion: String(req.body.inclusion || '').slice(0, 500),
            duration: String(req.body.duration || '').slice(0, 60),
            plan_coverage: coverage,
            require_plan_coverage: true
        };
        // Auto-carry the focused session's Learner Context as class-profile default.
        if (!prefs.class_profile && focusSession) {
            const ctx = (parsed.sections || [])
                .filter((s) => (s.sessions || []).includes(focusSession) && /learner\s+context|barrier|profile/i.test(`${s.title} ${s.text}`.slice(0, 400)))
                .map((s) => s.text).join(' ').slice(0, 500);
            if (ctx) prefs.class_profile = ctx;
        }
        const teacherUserId = req.session.user.id;

        const { grounded, prompt, system, source } = groundingService.buildLessonPrompt({
            plan_text: planText,
            plan_format: planFormat,
            focus_session: focusSession,
            topic,
            subject: subject || 'General',
            grade_level: grade_level || 'Grade 7',
            instructions,
            prefs,
            plan_sections: parsed.sections
        });

        // Optional AI Declaration closing statement (ILAW "Declaration of AI Use").
        const includeDecl = req.body.include_ai_declaration === true
            || req.body.include_ai_declaration === 'true'
            || req.body.include_ai_declaration === '1'
            || req.body.include_ai_declaration === 1;

        // Lesson-scoped sampling for an 8-12 slide discussion deck (larger than the old 6-slide cap).
        // defaults (0.7/4096), so other AI features are unaffected.
        const lessonSampling = { temperature: 0.3, topP: 0.85, maxTokens: 5000 };
        const lessonData = await aiService.generateJSON(
            prompt,
            () => aiService.getFallbackLesson(topic, grade_level, subject, competency),
            system ? { system, ...lessonSampling } : lessonSampling
        );
        const lesson = validationService.normalizeLesson(lessonData);

        // Optional AI Declaration closing statement (post-generation append, never
        // part of the model contract): keeps slide count/order validators honest.
        if (includeDecl && Array.isArray(lesson.slides)) {
            const hasDecl = lesson.slides.some((s) => String(s.id || '').toLowerCase() === 'declaration');
            if (!hasDecl) {
                const sessTxt = focusSession ? ` for ${focusSession}` : '';
                lesson.slides.push({
                    id: 'declaration',
                    slideNumber: lesson.slides.length + 1,
                    type: 'declaration',
                    title: 'Declaration of AI Use',
                    content: [`This deck was AI-translated from my ${planFormat.toUpperCase()} lesson plan${sessTxt}; I reviewed it for accuracy and fit.`],
                    bullets: [`This deck was AI-translated from my ${planFormat.toUpperCase()} lesson plan${sessTxt}; I reviewed it for accuracy and fit.`],
                    student_task: '',
                    speaker_notes: 'Read the declaration briefly; affirm teacher review.',
                    notes: '',
                    teacher_tip: ''
                });
            }
        }

        const validation = validationService.validateLesson(lesson, prefs);
        // Plan-carried competency stays verbatim (descriptive text as-is).
        // Trim only the display copy when excessively long; keep the issue trace.
        const metaComp = lesson.meta?.competency || lesson.competency;
        if (typeof metaComp === 'string' && metaComp.length > 500) {
            const short = String(competency || metaComp).slice(0, 500);
            lesson.meta.competency = short;
            lesson.competency = short;
            validation.issues.push('competency_trimmed');
        }
        const needsReview = !validation.valid || !grounded;

        // Save draft to ai_content (persistence failure must not lose generated lesson)
        const citations = (parsed.sections || []).map((s) => ({ ref: s.ref, role: s.role, title: s.title }));
        const metadata = {
            subject: subject || 'General',
            grade_level: grade_level || 'Grade 7',
            competency,
            plan_format: planFormat,
            focus_session: focusSession,
            plan_source: planSource,
            plan_hash: planHash,
            coverage,
            grounded,
            source: source || 'teacher_plan',
            citations,
            validation: validation.issues,
            needsReview,
            prefs: { ...prefs, plan_coverage: undefined, require_plan_coverage: undefined },
            include_ai_declaration: includeDecl
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
                [teacherUserId, `Plan deck "${topic}" format=${planFormat} session=${focusSession || 'all'} sections=${parsed.sections.length}`]
            );
        } catch (saveErr) {
            console.error('Lesson draft persistence failed (returning unsaved lesson):', saveErr.message);
            saveWarning = 'Draft could not be saved; review and save manually.';
        }

        // Prep checklist: plan Learning Resources filtered to the focused session.
        const prep = (parsed.sections || [])
            .filter((s) => /resource|material/i.test(`${s.title} ${s.text}`.slice(0, 300)))
            .flatMap((s) => {
                if (!focusSession || (s.sessions || []).includes(focusSession) || (s.sessions || []).length === 0) return [s.text];
                return [];
            }).join('\n').split('\n').map((l) => l.trim()).filter((l) => l.length > 2).slice(0, 20);

        res.json({
            success: true,
            lessonId,
            lesson,
            grounded,
            source: source || 'teacher_plan',
            plan_format: planFormat,
            focus_session: focusSession,
            sessions: parsed.sessions || [],
            coverage,
            plan_warnings: parsed.warnings || [],
            prep,
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

        // Server-side gate: re-validate structure AND plan traceability, never
        // trust client flags. Untouched/invalid lessons need teacher confirmation.
        // Traceability resolved in order: generate-time lessonId draft metadata >
        // explicit grounded flag > [P#]/[S#] refs present in slides.
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
            // Traceability lives in teacher_script now (never on projection).
            const traceOf = (s) => `${validationService.slideScript(s)} ${validationService.slideLines(s).join(' ')}`;
            const cited = slides.filter((s) => /\[P\d+\]/.test(traceOf(s)) || /\[S\d+\]/.test(traceOf(s))).length;
            wasGrounded = cited > 0 && cited >= Math.ceil(slides.length / 2);
        }
        if ((!gate.valid || !wasGrounded) && confirmed !== true && confirmed !== 'true' && confirmed !== 1) {
            return res.status(422).json({
                error: !wasGrounded ? 'Lesson is not traceable to the plan. Confirm teacher review before saving.' : 'Lesson needs teacher review before saving.',
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
        // Dual-grounded quiz: teacher plan (Assessment first) + generated deck.
        const { topic, grade_level, subject, mc_count = 3, tf_count = 2, id_count = 1, competency,
            plan_text, plan_format, focus_session, lesson_json } = req.body;
        if (!topic || !String(topic).trim()) {
            return res.status(400).json({ error: 'Topic is required.' });
        }

        // Preserve an explicit 0 (e.g. an all-identification quiz); only fall back
        // to the default when the field is missing or not a non-negative integer.
        const toCount = (v, def) => {
            const n = parseInt(v, 10);
            return Number.isInteger(n) && n >= 0 ? Math.min(n, 50) : def;
        };
        const mcN = toCount(mc_count, 3);
        const tfN = toCount(tf_count, 2);
        const idN = toCount(id_count, 1);
        const totalQ = mcN + tfN + idN;
        if (totalQ < 1) {
            return res.status(400).json({ error: 'Select at least one question type (multiple choice, true/false, or identification).' });
        }
        let deck = null;
        try {
            deck = typeof lesson_json === 'string' ? JSON.parse(lesson_json) : lesson_json;
            if (!deck || typeof deck !== 'object' || !Array.isArray(deck.slides)) deck = null;
        } catch { deck = null; }
        let planTagged = null;
        let planForPrompt = String(plan_text || '');
        if (req.file && req.file.path) {
            try {
                const buf = await fs.promises.readFile(req.file.path);
                const parsedFile = await planParseService.parsePlanFile(buf, {
                    originalName: req.file.originalname || '',
                    mimetype: req.file.mimetype || ''
                });
                planForPrompt = [planForPrompt.trim(), parsedFile.planText || ''].filter(Boolean).join('\n\n');
                planTagged = parsedFile;
            } finally {
                fs.promises.unlink(req.file.path).catch(() => {});
            }
        }
        if (planForPrompt && planForPrompt.trim().length >= 200 && !planTagged) {
            planTagged = planParseService.parsePastedText(planParseService.sanitizePlanText(planForPrompt));
            planForPrompt = planTagged.planText;
        }

        const { grounded, prompt, source } = groundingService.buildQuizPrompt({
            topic,
            subject,
            grade_level,
            competency,
            mc_count: mcN,
            tf_count: tfN,
            id_count: idN,
            totalQ,
            plan_text: planForPrompt,
            plan_format,
            focus_session,
            lesson_json: deck
        });

        const questions = await aiService.generateJSON(
            prompt,
            () => aiService.getFallbackQuiz(topic, grade_level, subject, totalQ)
        );

        const isFallback = !!(questions && questions.__isFallback);
        const expectedMix = { multiple_choice: mcN, true_false: tfN, identification: idN };
        // Deterministically honor the requested type mix: drop any type with a 0
        // count and any overflow beyond the requested number. Fallback output is
        // left untouched (it is already flagged for teacher review).
        const finalized = isFallback ? questions : enforceQuizMix(questions, expectedMix);

        const citations = planTagged ? (planTagged.sections || []).map((s) => ({ ref: s.ref, role: s.role, title: s.title })) : [];
        const quizValidation = validationService.validateQuiz(finalized, totalQ, { require_plan_refs: !!planTagged, expected_mix: expectedMix });

        res.json({
            success: true,
            questions: finalized,
            grounded: isFallback ? false : grounded,
            source: isFallback ? 'fallback' : (source || (planTagged ? 'teacher_plan' : 'none')),
            isFallback,
            focus_session: /^S[1-5]$/i.test(String(focus_session || '')) ? String(focus_session).toUpperCase() : '',
            deck_aligned: !!deck,
            sources: citations,
            validation: quizValidation.issues,
            needsReview: isFallback || !quizValidation.valid || !grounded
        });
    } catch (err) {
        console.error('Generate quiz error:', err);
        res.status(500).json({ error: 'AI service unavailable.' });
    }
}

async function saveQuiz(req, res) {
    try {
        const { title, description, subject, grade_level, time_limit, passing_score, questions, class_ids, confirmed, grounded, is_fallback } = req.body;
        const teacherUserId = req.session.user.id;

        // Block saving a fallback quiz unless the teacher explicitly confirms
        if (is_fallback === true || is_fallback === 'true' || is_fallback === 1) {
            if (confirmed !== true && confirmed !== 'true' && confirmed !== 1) {
                return res.status(422).json({
                    error: 'This quiz was generated from the offline fallback, not the AI. Edit it or confirm to publish anyway.',
                    needsReview: true,
                    isFallback: true
                });
            }
        }

        if (!title || !questions || questions.length === 0) {
            return res.status(400).json({ error: 'Quiz title and questions are required.' });
        }

        // Server-side gate: structure + plan traceability. Quizzes without plan
        // refs need confirmation. Legacy [S#] refs still count.
        const quizGate = validationService.validateQuiz(questions, questions.length);
        let quizGrounded = grounded === true || grounded === 'true' || grounded === 1;
        if (grounded === undefined) {
            const cited = questions.filter((q) => /\[P\d+\]/.test(String(q.explanation || '')) || /\[S\d+\]/.test(String(q.explanation || ''))).length;
            quizGrounded = cited > 0 && cited >= Math.ceil(questions.length / 2);
        }
        if ((!quizGate.valid || !quizGrounded) && confirmed !== true && confirmed !== 'true' && confirmed !== 1) {
            return res.status(422).json({
                error: !quizGrounded ? 'Quiz is not traceable to the plan. Confirm teacher review before publishing.' : 'Quiz needs teacher review before publishing.',
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

        // Hard gate: identification items MUST have a recoverable expected answer.
        // A question with no answer key can never be graded correctly, so it is
        // blocked here before any rows are written (no partial quiz in DB).
        const identIssues = [];
        questions.forEach((q, i) => {
            if (q && q.question_type === 'identification' && validationService.resolveIdentificationAnswer(q).length === 0) {
                identIssues.push(`q${i + 1}_ident_needs_answer`);
            }
        });
        if (identIssues.length > 0) {
            const noun = identIssues.length > 1 ? 's' : '';
            const nums = identIssues.map((s) => s.replace('_ident_needs_answer', '')).join(', ');
            return res.status(422).json({
                error: `Identification question${noun} ${nums} ${identIssues.length > 1 ? 'have' : 'has'} no expected answer. Add the correct answer (comma-separate accepted variants) before publishing.`,
                validation: identIssues,
                needsReview: true
            });
        }

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

                // Normalize TF + MC options before saving (AI returns `answer` for TF,
                // not an options array — so we synthesize True/False here).
                let normalizedOptions = Array.isArray(q.options) ? q.options : [];

                // If options are strings (some models do this), convert to objects.
                if (normalizedOptions.length > 0 && typeof normalizedOptions[0] === 'string') {
                    normalizedOptions = normalizedOptions.map((txt, idx) => ({
                        option_text: txt,
                        is_correct: (idx === (q.correct_index ?? 0)) ? 1 : 0
                    }));
                }

                // True/False: synthesize the two required radio options.
                if (q.question_type === 'true_false' && normalizedOptions.length === 0) {
                    // AI can use `answer`, `correct_answer`, or `correct` for the value.
                    const raw = q.answer ?? q.correct_answer ?? q.correct;
                    const correctBool = (raw === true || raw === 1 || String(raw).toLowerCase().trim() === 'true');
                    normalizedOptions = [
                        { option_text: 'True',  is_correct: correctBool ? 1 : 0 },
                        { option_text: 'False', is_correct: correctBool ? 0 : 1 }
                    ];
                }

                // Identification: store every accepted answer as its own
                // is_correct=1 quiz_option. resolveIdentificationAnswer handles
                // accept[]/answer/correct_answer/correct/single-option/explanation.
                // The pre-insert gate above guarantees at least one alias exists.
                if (q.question_type === 'identification' && normalizedOptions.length === 0) {
                    const aliases = validationService.resolveIdentificationAnswer(q);
                    if (aliases.length > 0) {
                        normalizedOptions = aliases.map((text) => ({ option_text: text, is_correct: 1 }));
                    } else {
                        console.warn(
                            `⚠️ Identification question ${questionId} has no extractable answer. ` +
                            `Students will not be graded correctly. ` +
                            `Q: "${(q.question_text || '').slice(0, 60)}..." ` +
                            `Explanation: "${(q.explanation || '').slice(0, 100)}..."`
                        );
                    }
                }

                // Save all normalized options (MC + synthesized TF).
                if (normalizedOptions.length > 0) {
                    for (let j = 0; j < normalizedOptions.length; j++) {
                        const opt = normalizedOptions[j];
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

        // Notify each assigned class of the newly published quiz (best-effort).
        if (quizId && quizTargetIds.length > 0) {
            const quizTitle = String(title).trim();
            for (const cId of quizTargetIds) {
                notifications.notifyClass({
                    classId: cId,
                    type: 'quiz',
                    title: `New quiz to take: ${quizTitle}`,
                    message: `${questions.length} items. Check your class to start.`,
                    linkFor: () => `/student/quizzes/${quizId}/take`,
                    refType: 'quiz',
                    refId: quizId
                });
            }
        }

        res.json({ success: true, quizId });
    } catch (err) {
        console.error('Save quiz error:', err);
        res.status(500).json({ error: 'AI service unavailable.' });
    }
}

async function exportLessonPptx(req, res) {
    // POST + CSRF (exports never use GET). Accepts deck JSON (pre-save) or
    // draft/library ids. Streams a real 16:9 .pptx (PptxGenJS).
    if (res.locals.school && res.locals.school.flags && res.locals.school.flags.allowAiLesson === false) {
        return res.status(403).json({ error: 'The AI Lesson Generator is currently disabled by the school administrator.' });
    }
    try {
        const teacherUserId = req.session.user.id;
        const deck = await require('../services/pptxService').loadDeckForExport({
            lesson_json: req.body.lesson_json,
            lessonId: req.body.lessonId,
            itemId: req.body.itemId,
            userId: teacherUserId
        });
        const schoolName = (res.locals.school && (res.locals.school.name || res.locals.school.school_name)) || undefined;
        const motto = (res.locals.school && res.locals.school.motto) || undefined;
        const { buffer, filename } = await require('../services/pptxService').buildPptxBuffer(deck, {
            ...(schoolName ? { schoolName } : {}),
            ...(motto ? { motto } : {})
        });
        try {
            await query(
                `INSERT INTO activity_logs (user_id, action, description, category)
                 VALUES (?, 'ai_lesson_export_pptx', ?, 'teacher')`,
                [teacherUserId, `Exported "${filename}" (${buffer.length} bytes)`]
            );
        } catch { /* logging must not block download */ }
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
        res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
        res.setHeader('Content-Length', String(buffer.length));
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.send(buffer);
    } catch (err) {
        console.error('Export PPTX error:', err.message);
        const status = /No lesson found/.test(err.message || '') ? 404 : 500;
        return res.status(status).json({ error: err.message || 'PPTX export failed.' });
    }
}

module.exports = {
    chatStream,
    getChatHistory,
    getChatStatus,
    clearChatHistory,
    parsePlan,
    generateLesson,
    saveLessonToLibrary,
    exportLessonPptx,
    generateQuiz,
    saveQuiz
};
