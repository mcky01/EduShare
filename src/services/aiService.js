const env = require('../config/env');

const DEFAULT_TIMEOUT_MS = env.AI_TIMEOUT_MS || 120000;
const NINE_ROUTER_TIMEOUT_MS = env.NINE_ROUTER_TIMEOUT_MS || 90000;

function nineRouterConfigured() {
    return !!(env.NINE_ROUTER_BASE_URL && env.NINE_ROUTER_API_KEY && env.NINE_ROUTER_MODEL);
}

function nineRouterFirst() {
    return (env.AI_PRIMARY || 'nine_router') !== 'ollama';
}

function baseUrl() {
    return String(env.NINE_ROUTER_BASE_URL || '').replace(/\/$/, '');
}

// Minimal OpenAI-compatible chat call against the 9Router gateway.
// Returns non-empty assistant text, or null when unusable (so callers fall through).
async function nineRouterChat(messages, { json = false, temperature = 0.7, maxTokens = 4096, timeoutMs = NINE_ROUTER_TIMEOUT_MS } = {}) {
    if (!nineRouterConfigured()) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const body = { model: env.NINE_ROUTER_MODEL, messages, max_tokens: maxTokens, temperature, stream: false };
        if (json) body.response_format = { type: 'json_object' };
        const res = await fetch(`${baseUrl()}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.NINE_ROUTER_API_KEY}` },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        if (!res.ok) {
            console.warn(`NineRouter chat failed: HTTP ${res.status}`);
            return null;
        }
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (typeof text === 'string' && text.trim().length > 0) return text;
        console.warn('NineRouter returned empty content; falling through.');
        return null;
    } catch (err) {
        console.warn('NineRouter chat error:', err.message);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

// SSE relay for OpenAI-style stream: yields delta.content chunks; resolves
// true when at least one non-empty chunk arrived. Never throws.
async function* nineRouterChatStream(messages, { temperature = 0.7, maxTokens = 2048, timeoutMs = NINE_ROUTER_TIMEOUT_MS, onFirstChunk } = {}) {
    let gotContent = false;
    if (!nineRouterConfigured()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${baseUrl()}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.NINE_ROUTER_API_KEY}` },
            body: JSON.stringify({ model: env.NINE_ROUTER_MODEL, messages, max_tokens: maxTokens, temperature, stream: true }),
            signal: controller.signal
        });
        if (!res.ok || !res.body) {
            console.warn(`NineRouter stream failed: HTTP ${res.status}`);
            return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let notifyFirst = true;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const t = line.trim();
                if (!t || !t.startsWith('data:')) continue;
                const payload = t.slice(5).trim();
                if (payload === '[DONE]') continue;
                try {
                    const evt = JSON.parse(payload);
                    const piece = evt?.choices?.[0]?.delta?.content
                        ?? evt?.choices?.[0]?.message?.content
                        ?? '';
                    if (piece) {
                        if (notifyFirst) { notifyFirst = false; try { if (typeof onFirstChunk === 'function') onFirstChunk(); } catch { /* ignore */ } }
                        gotContent = true;
                        yield piece;
                    }
                } catch { /* ignore partial frames */ }
            }
        }
    } catch (err) {
        console.warn('NineRouter stream error:', err.message);
    } finally {
        clearTimeout(timer);
    }
    if (!gotContent) console.warn('NineRouter stream yielded nothing; falling through.');
}

async function ollamaHealthy() {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(`${env.OLLAMA_BASE_URL}/api/tags`, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) return false;
        const data = await res.json();
        return (data.models || []).length > 0;
    } catch {
        return false;
    }
}

// Health check: true when EITHER provider can serve. Powers the admin
// dashboard dot and the chat status endpoint.
async function isHealthy() {
    if (nineRouterFirst() && nineRouterConfigured()) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(`${baseUrl()}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.NINE_ROUTER_API_KEY}` },
                body: JSON.stringify({ model: env.NINE_ROUTER_MODEL, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
                signal: controller.signal
            });
            clearTimeout(timer);
            if (res.ok) {
                const data = await res.json().catch(() => null);
                const text = data?.choices?.[0]?.message?.content;
                if (typeof text === 'string') return true;
            }
        } catch { /* fall through to Ollama probe */ }
    }
    return ollamaHealthy();
}

// Non-streaming chat completion (topP/repeatPenalty forwarded only when set;
// chatbot + quiz callers keep existing defaults)
async function chat(messages, { json = false, temperature = 0.7, maxTokens = 4096, timeoutMs = DEFAULT_TIMEOUT_MS, topP = null, repeatPenalty = null } = {}) {
    // Provider order: 9Router first (when AI_PRIMARY != 'ollama'), else Ollama first.
    // Either way a miss falls through to the other provider, then null (offline fallback).
    const tryNineFirst = nineRouterFirst();
    if (tryNineFirst) {
        const viaNine = await nineRouterChat(messages, { json, temperature, maxTokens });
        if (viaNine) return viaNine;
    }
    const healthy = await ollamaHealthy();
    if (!healthy) {
        if (!tryNineFirst) {
            const viaNine = await nineRouterChat(messages, { json, temperature, maxTokens });
            if (viaNine) return viaNine;
        }
        return null; // Will trigger graceful fallback
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const options = {
            num_predict: maxTokens,
            temperature
        };
        if (topP !== null && topP !== undefined) options.top_p = topP;
        if (repeatPenalty !== null && repeatPenalty !== undefined) options.repeat_penalty = repeatPenalty;
        const body = {
            model: env.OLLAMA_MODEL,
            messages,
            stream: false,
            options
        };
        if (json) body.format = 'json';

        const res = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });

        if (!res.ok) return null;
        const data = await res.json();
        return (data.message && data.message.content) || null;
    } catch (err) {
        console.warn('⚠️ Ollama chat error:', err.message);
        if (tryNineFirst) return null;
        const viaNine = await nineRouterChat(messages, { json, temperature, maxTokens });
        if (viaNine) return viaNine;
        return null;
    } finally {
        clearTimeout(timer);
    }
}

// Single prompt wrapper (supports optional { system } for system-role priming)
async function complete(prompt, options = {}) {
    const { system, ...rest } = options || {};
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });
    return chat(messages, rest);
}

// Async generator yielding chunks for real-time streaming.
// onSource (optional) is called once with the winning provider
// ('nine_router' | 'ollama') when the first live chunk arrives, or
// 'fallback' when the offline engine answers instead — lets callers label
// which provider actually produced the response.
async function* chatStream(messages, { temperature = 0.7, maxTokens = 2048, onSource } = {}) {
    const emit = (source) => { try { if (typeof onSource === 'function') onSource(source); } catch { /* never break streaming */ } };
    const streamFallback = async function* () {
        emit('fallback');
        const fallbackText = getFallbackChatResponse(messages);
        const words = fallbackText.split(' ');
        for (const word of words) {
            yield word + ' ';
            await new Promise(r => setTimeout(r, 40));
        }
    };
    const tryNineFirst = nineRouterFirst();
    // Fast path: 9Router stream first when it is the primary provider.
    if (tryNineFirst && nineRouterConfigured()) {
        let streamed = false;
        for await (const piece of nineRouterChatStream(messages, { temperature, maxTokens, onFirstChunk: () => emit('nine_router') })) {
            streamed = true;
            yield piece;
        }
        if (streamed) return;
    }
    const healthy = await ollamaHealthy();
    if (!healthy) {
        if (!tryNineFirst && nineRouterConfigured()) {
            let streamed = false;
            for await (const piece of nineRouterChatStream(messages, { temperature, maxTokens, onFirstChunk: () => emit('nine_router') })) {
                streamed = true;
                yield piece;
            }
            if (streamed) return;
        }
        yield* streamFallback();
        return;
    }

    let usedOllama = false;
    try {
        const body = {
            model: env.OLLAMA_MODEL,
            messages,
            stream: true,
            options: {
                num_predict: maxTokens,
                temperature
            }
        };

        const streamController = new AbortController();
        const streamTimer = setTimeout(() => streamController.abort(), DEFAULT_TIMEOUT_MS);
        let res;
        try {
            res = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: streamController.signal
            });
        } finally {
            clearTimeout(streamTimer);
        }

        if (!res.ok) {
            throw new Error(`Ollama stream error: ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const chunk = JSON.parse(trimmed);
                    if (chunk.message && chunk.message.content) {
                        if (!usedOllama) { usedOllama = true; emit('ollama'); }
                        yield chunk.message.content;
                    }
                } catch {
                    // Ignore keep-alives or partials
                }
            }
        }
    } catch (err) {
        console.warn('⚠️ Ollama stream interrupted:', err.message);
        if (!usedOllama && !tryNineFirst && nineRouterConfigured()) {
            let streamed = false;
            for await (const piece of nineRouterChatStream(messages, { temperature, maxTokens, onFirstChunk: () => emit('nine_router') })) {
                streamed = true;
                yield piece;
            }
            if (streamed) return;
        }
        emit(usedOllama ? 'ollama' : 'fallback');
        const fallbackText = getFallbackChatResponse(messages);
        if (usedOllama) {
            yield '\n\n*(Live connection dropped — continuing with the offline study guide below.)*\n\n';
        }
        yield fallbackText;
    }
}

// Robust JSON parser tolerating markdown fences
function parseLooseJson(text) {
    if (!text || !text.trim()) throw new Error('Empty AI response');
    let clean = text.trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/, '');
    try {
        return JSON.parse(clean);
    } catch {
        const firstBrace = clean.indexOf('{');
        const firstBracket = clean.indexOf('[');
        let start = -1;
        let isObj = true;

        if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
            start = firstBrace;
            isObj = true;
        } else if (firstBracket !== -1) {
            start = firstBracket;
            isObj = false;
        }

        if (start === -1) throw new Error('No JSON structure found in output');

        const closeChar = isObj ? '}' : ']';
        const end = clean.lastIndexOf(closeChar);
        if (end <= start) throw new Error('Incomplete JSON found');

        return JSON.parse(clean.slice(start, end + 1));
    }
}

// Generate structured JSON
async function generateJSON(prompt, fallbackGenerator, options = {}) {
    let lastErr = null;
    try {
        const text = await complete(prompt, { json: true, ...options });
        if (text) {
            return parseLooseJson(text);
        }
        lastErr = new Error('AI returned empty response');
    } catch (err) {
        lastErr = err;
        console.warn('generateJSON parse issue:', err.message);
    }
    // Signal to caller that a fallback is being used.
    const fallback = fallbackGenerator();
    if (fallback && typeof fallback === 'object') {
        Object.defineProperty(fallback, '__isFallback', {
            value: true, enumerable: false, writable: false, configurable: true
        });
    }
    return fallback;
}

// ==========================================
// Intelligent DepEd-Aligned Fallback Engines
// ==========================================

function getFallbackChatResponse(messages) {
    const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || '';
    const q = lastUserMsg.toLowerCase();

    if (q.includes('metaphor') || q.includes('simile') || q.includes('figure of speech')) {
        return `Hello! As your Zeferino Arroyo High School AI Study Tutor, let's explore figures of speech:\n\n` +
            `1. **Simile**: A comparison between two different things using connective words like *"as"* or *"like"*.\n` +
            `   *Example*: "Her laughter was as warm as the morning sun over Mt. Iriga."\n\n` +
            `2. **Metaphor**: A direct comparison that states one thing is another, without using "like" or "as".\n` +
            `   *Example*: "Time is a thief that steals our moments."\n\n` +
            `3. **Personification**: Giving human traits, emotions, or behaviors to animals, objects, or nature.\n` +
            `   *Example*: "The wind whispered through the acacia trees."\n\n` +
            `Would you like to try writing an example sentence of each?`;
    }

    if (q.includes('photosynthesis') || q.includes('chloroplast') || q.includes('biology')) {
        return `Hello Zeferinian! Here is a simple explanation of **Photosynthesis** for your science studies:\n\n` +
            `**Photosynthesis** is the process by which green plants transform light energy into chemical energy stored in glucose.\n\n` +
            `* **Formula**: Carbon Dioxide ($CO_2$) + Water ($H_2O$) + Sunlight ➔ Glucose ($C_6H_{12}O_6$) + Oxygen ($O_2$)\n` +
            `* **Location**: Takes place primarily in the **chloroplasts** containing chlorophyll.\n` +
            `* **Two Stages**:\n` +
            `  1. *Light-Dependent Reactions* (in thylakoids) produce ATP and NADPH while releasing oxygen.\n` +
            `  2. *Calvin Cycle / Light-Independent* (in stroma) fixes carbon into sugar.\n\n` +
            `Do you want to practice explaining the inputs and outputs?`;
    }

    if (q.includes('quadratic') || q.includes('formula') || q.includes('math')) {
        return `Greetings! Let's review the **Quadratic Formula**:\n\n` +
            `For any quadratic equation in standard form: $ax^2 + bx + c = 0$ (where $a \\neq 0$):\n\n` +
            `$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$\n\n` +
            `* **Discriminant ($D = b^2 - 4ac$)**:\n` +
            `  - If $D > 0$: Two distinct real roots\n` +
            `  - If $D = 0$: One real root (repeated)\n` +
            `  - If $D < 0$: Two complex conjugate roots\n\n` +
            `Give me an equation like $x^2 - 5x + 6 = 0$ and we can solve it step-by-step!`;
    }

    return `Hello! I am your **EduShare AI Study Tutor** here at Zeferino Arroyo High School.\n\n` +
        `I am ready to help you with:\n` +
        `* Clarifying key concepts in English, Mathematics, Science, and Social Studies.\n` +
        `* Breaking down DepEd MATATAG competencies into manageable review points.\n` +
        `* Providing sample questions and reviewing your answers.\n\n` +
        `Regarding your question: *"${lastUserMsg.slice(0, 80)}..."*\n\n` +
        `To master this topic, focus on the fundamental definitions, identify practical examples from everyday life, and practice solving exercises. What specific part would you like to examine together?`;
}

function getFallbackLesson(topic, gradeLevel, subject, competencyCode) {
    const t = topic || 'Elements of Literary Texts & Value Integration';
    const g = gradeLevel || 'Grade 7';
    const s = subject || 'English';
    const c = String(competencyCode || 'EN7LIT-I-1').split(':')[0].slice(0, 20);
    const B = (id, title, lines, visual, script, speech = '', task = '') => ({ id, title, content: lines, bullets: lines, slide_text: lines, visual_prompt: visual, teacher_script: script, student_task: task, speaker_notes: speech, teacher_tip: '', notes: '' });
    return {
        meta: { subject: s, grade_level: g, topic: t, competency: c, term: '', duration: '60 minutes', language: '', approach: '' },
        topic: t,
        gradeLevel: g,
        subject: s,
        competency: c,
        duration: '60 minutes',
        slides: [
            B('objectives', 'Lesson Objectives & Why It Matters', [
                `Today: ${t}`,
                'By the end, you can name story parts',
                'Link: recall the last story'
            ], 'Objectives on a chalkboard, classroom setting', 'Read the objectives aloud (1 min), then ask who remembers the last story. Offline fallback — review before class.', 'Read the objectives aloud (1 min), then ask who remembers the last story.', 'Write one objective in your own words'),
            B('hook', 'Hook: Quick Scenario', [
                'Wallet found in the gym',
                'What is your reaction?',
                'Share with a seatmate'
            ], 'Two learners discussing, school corridor', 'Run a 3-minute pair share on the wallet scenario, then take 2 answers.', 'Run the scenario as a 3-minute pair share, then take 2 answers.', 'Discuss your reaction with a seatmate'),
            B('explain', 'Meaning: Core Terms First', [
                'Character drives the narrative',
                'Setting: where and when',
                'Conflict: inner vs outer'
            ], 'Story map diagram on a board', 'Explain each term simply (4 min) with one familiar example each.', 'Explain each term simply (4 min) with one familiar example each.', 'List each term with one example'),
            B('explain_2', 'Meaning: Plot and Theme', [
                'Plot: beginning to end',
                'Theme: universal truth',
                'Stories teach values'
            ], 'Open book showing story arc', 'Connect plot and theme to the wallet scenario (3 min).', 'Connect plot and theme to the wallet scenario (3 min).', 'Write one sentence linking plot to theme'),
            B('example', 'Examples From the Text', [
                'Bamboo staff folktale excerpt',
                'Bamboo means humility',
                'Humility vs arrogance'
            ], 'Tall bamboo stalks, village background', 'Read the excerpt aloud, then point to the humility line.', 'Read the excerpt aloud, then point to the humility line.', 'Underline the line showing humility'),
            B('discuss', 'Discuss: What Do You Notice?', [
                'What does bamboo symbolize?',
                'Which choice shows integrity?',
                'Connect to real life'
            ], 'Learners raising hands in discussion', 'Cold-call 3 learners; land on humility as the key insight.', 'Cold-call 3 learners; land on humility as the key insight.', 'Share one real-life connection'),
            B('activity', 'Group Activity: Story Map', [
                'Groups of 4',
                'Complete the story map',
                'One-sentence climax'
            ], 'Small groups writing on manila paper', 'Give 10 minutes for group work; success means every box is filled.', 'Give 10 minutes for group work; success means every box is filled.', 'Complete the group story map'),
            B('check', 'Quick Check Before We End', [
                'Show fingers: 1 to 3',
                'Name one story part',
                'Fix one example together'
            ], 'Learner holding up fingers', 'Use the finger check (2 min) and fix gaps on the spot.', 'Use the finger check (2 min) and fix gaps on the spot.', 'Answer the recitation prompt'),
            B('wrap', 'Wrap-Up and Exit Ticket', [
                'Stories reveal values',
                'Exit ticket: one value',
                'Next: read Chapter 2'
            ], 'Exit tickets collected on a desk', 'Collect exit tickets on 1/4 sheet; preview Chapter 2.', 'Collect exit tickets on 1/4 sheet; preview Chapter 2.', 'Write your exit ticket')
        ]
    };
}

function getFallbackQuiz(topic, gradeLevel, subject, count = 5) {
    return [
        {
            question_text: `What is the primary function of the climax in a narrative structure?`,
            question_type: 'multiple_choice',
            points: 1,
            explanation: 'The climax is the highest point of tension and the turning point of the plot.',
            options: [
                { option_text: 'To introduce the characters and setting', is_correct: 0 },
                { option_text: 'The turning point and moment of greatest tension', is_correct: 1 },
                { option_text: 'To conclude the story and tie up loose ends', is_correct: 0 },
                { option_text: 'To describe the physical appearance of the author', is_correct: 0 }
            ]
        },
        {
            question_text: `In literature, an internal conflict is characterized as "Character vs. Self".`,
            question_type: 'true_false',
            points: 1,
            explanation: 'Internal conflict happens within a character mind regarding emotions, ethics, or tough decisions.',
            options: [
                { option_text: 'True', is_correct: 1 },
                { option_text: 'False', is_correct: 0 }
            ]
        },
        {
            question_text: `What figure of speech uses extreme exaggeration to make a point or evoke strong feelings?`,
            question_type: 'identification',
            points: 1,
            explanation: 'Hyperbole is purposeful exaggeration used for emphasis or comedic/dramatic effect.',
            accept: ['hyperbole'],
            options: [
                { option_text: 'hyperbole', is_correct: 1 }
            ]
        },
        {
            question_text: `Which element best reflects the author underlying message or moral perspective in the text?`,
            question_type: 'multiple_choice',
            points: 1,
            explanation: 'Theme represents the universal insight or message conveyed through the narrative.',
            options: [
                { option_text: 'Theme', is_correct: 1 },
                { option_text: 'Protagonist', is_correct: 0 },
                { option_text: 'Dialogue', is_correct: 0 },
                { option_text: 'Genre', is_correct: 0 }
            ]
        },
        {
            question_text: `The setting of a story only encompasses the geographic location and has no relation to the historical time period.`,
            question_type: 'true_false',
            points: 1,
            explanation: 'Setting encompasses time period, geographical location, season, and social context.',
            options: [
                { option_text: 'True', is_correct: 0 },
                { option_text: 'False', is_correct: 1 }
            ]
        }
    ].slice(0, count);
}

module.exports = {
    isHealthy,
    ollamaHealthy,
    nineRouterConfigured,
    chat,
    complete,
    chatStream,
    generateJSON,
    parseLooseJson,
    getFallbackChatResponse,
    getFallbackLesson,
    getFallbackQuiz
};
