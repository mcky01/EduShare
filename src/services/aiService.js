const env = require('../config/env');

const DEFAULT_TIMEOUT_MS = env.AI_TIMEOUT_MS || 120000;

// Health check: Probes Ollama to see if model is available
async function isHealthy() {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(`${env.OLLAMA_BASE_URL}/api/tags`, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) return false;
        const data = await res.json();
        return (data.models || []).some(m => m.name.toLowerCase().includes('qwen'));
    } catch {
        return false;
    }
}

// Non-streaming chat completion
async function chat(messages, { json = false, temperature = 0.7, maxTokens = 4096, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const healthy = await isHealthy();
    if (!healthy) {
        return null; // Will trigger graceful fallback
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const body = {
            model: env.OLLAMA_MODEL,
            messages,
            stream: false,
            options: {
                num_predict: maxTokens,
                temperature
            }
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
        return null;
    } finally {
        clearTimeout(timer);
    }
}

// Single prompt wrapper
async function complete(prompt, options = {}) {
    return chat([{ role: 'user', content: prompt }], options);
}

// Async generator yielding chunks for real-time streaming
async function* chatStream(messages, { temperature = 0.7, maxTokens = 2048 } = {}) {
    const healthy = await isHealthy();
    if (!healthy) {
        // Yield intelligent fallback streaming response
        const fallbackText = getFallbackChatResponse(messages);
        const words = fallbackText.split(' ');
        for (const word of words) {
            yield word + ' ';
            await new Promise(r => setTimeout(r, 40));
        }
        return;
    }

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

        const res = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

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
                        yield chunk.message.content;
                    }
                } catch {
                    // Ignore keep-alives or partials
                }
            }
        }
    } catch (err) {
        console.warn('⚠️ Ollama stream interrupted, serving fallback:', err.message);
        const fallbackText = getFallbackChatResponse(messages);
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
    try {
        const text = await complete(prompt, { json: true, ...options });
        if (text) {
            return parseLooseJson(text);
        }
    } catch (err) {
        console.warn('⚠️ generateJSON parse issue, using smart generator:', err.message);
    }
    return fallbackGenerator();
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

    return `Hello! I am your **EduShare 2.0 AI Study Tutor** here at Zeferino Arroyo High School.\n\n` +
        `I am ready to help you with:\n` +
        `* Clarifying key concepts in English, Mathematics, Science, and Social Studies.\n` +
        `* Breaking down DepEd MATATAG competencies into manageable review points.\n` +
        `* Providing sample questions and reviewing your answers.\n\n` +
        `Regarding your question: *"${lastUserMsg.slice(0, 80)}..."*\n\n` +
        `To master this topic, focus on the fundamental definitions, identify practical examples from everyday life, and practice solving exercises. What specific part would you like to examine together?`;
}

function getFallbackLesson(topic, gradeLevel, subject, competencyCode) {
    return {
        topic: topic || 'Elements of Literary Texts & Value Integration',
        gradeLevel: gradeLevel || 'Grade 7',
        subject: subject || 'English',
        competency: competencyCode || 'EN7LIT-I-1: Analyze literary texts as expressions of values',
        duration: '60 minutes',
        slides: [
            {
                slideNumber: 1,
                title: 'Introduction & Learning Objectives',
                type: 'intro',
                content: `Welcome students! Today's lesson focuses on **${topic || 'Literary Elements'}**.\n\n` +
                    `* **Learning Target**: Identify key literary elements and analyze how characters resolve ethical dilemmas.\n` +
                    `* **School Value**: Integrity, Perseverance, and Excellence (*Basta Zeferinian, Magaling Yan!*).\n` +
                    `* **DepEd Standard**: Aligned with MATATAG Curriculum Guide.`
            },
            {
                slideNumber: 2,
                title: 'Hook & Motivational Activity',
                type: 'hook',
                content: `### Think-Pair-Share\n\n` +
                    `Consider this scenario: You found a wallet inside the school gymnasium containing ₱500 and a student ID.\n\n` +
                    `1. What is your immediate reaction?\n` +
                    `2. How do communal expectations and family upbringing guide your next decision?\n` +
                    `3. Share your thoughts with your seatmate for 3 minutes.`
            },
            {
                slideNumber: 3,
                title: 'Core Concept Presentation',
                type: 'concept',
                content: `### The 5 Core Narrative Elements\n\n` +
                    `* **Character**: The individuals whose desires and motives propel the narrative.\n` +
                    `* **Setting**: The geographical, temporal, and social backdrop of the events.\n` +
                    `* **Conflict**: The driving obstacle — Internal (*Man vs. Self*) or External (*Man vs. Society/Nature*).\n` +
                    `* **Plot**: The structured progression: Exposition ➔ Rising Action ➔ Climax ➔ Falling Action ➔ Resolution.\n` +
                    `* **Theme**: The underlying universal truth or value articulated by the work.`
            },
            {
                slideNumber: 4,
                title: 'Exemplar Text Deep Dive',
                type: 'analysis',
                content: `### Close Reading: Local Folktale Excerpt\n\n` +
                    `*"The elder brother chose the humble bamboo staff, knowing that humility bends but never breaks in the storm."*\n\n` +
                    `* **Analysis**:\n` +
                    `  - The bamboo staff symbolizes cultural resilience (*Katatagan*).\n` +
                    `  - Contrast with the iron rod representing rigid arrogance.\n` +
                    `  - Reflect on how Philippine literature reflects communal solidarity.`
            },
            {
                slideNumber: 5,
                title: 'Guided Practice & Formative Task',
                type: 'practice',
                content: `### Collaborative Group Activity (4 Members per group)\n\n` +
                    `Complete the **Story Map Graphic Organizer**:\n` +
                    `1. Identify the protagonist and antagonist.\n` +
                    `2. Pinpoint the turning point (climax).\n` +
                    `3. State the moral resolution in one concise sentence.`
            },
            {
                slideNumber: 6,
                title: 'Summary & Value Reflection',
                type: 'reflection',
                content: `### Exit Ticket\n\n` +
                    `Write your answer on a 1/4 sheet of paper:\n\n` +
                    `> *"Which character action resonated most with your personal values, and why?"*\n\n` +
                    `**Assignment**: Read Chapter 2 of the assigned reader for tomorrow's recitation.`
            }
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
    chat,
    complete,
    chatStream,
    generateJSON,
    parseLooseJson,
    getFallbackChatResponse,
    getFallbackLesson,
    getFallbackQuiz
};
