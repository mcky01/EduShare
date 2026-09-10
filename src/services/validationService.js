const EXPECTED_ORDER = ['intro', 'hook', 'concept', 'analysis', 'practice', 'reflection'];
const VALID_TYPES = new Set(EXPECTED_ORDER);

const STOPWORDS = new Set('a,an,the,and,or,of,in,on,for,to,with,by,from,as,at,is,are,was,were,be,been,being,it,its,this,that,these,those,into,through,between,across,within,without,under,over,about,into,per,via,using,use,used,meaning,purpose,clarity,target,audience,original,various,appropriate,significant,learners,demonstrate,learners,grade'.split(','));

function topicTokens(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

function topicAlignment(topic, competencyText) {
    const t = new Set(topicTokens(topic));
    const c = new Set(topicTokens(competencyText));
    if (!t.size || !c.size) return { ratio: 0, overlap: [] };
    const overlap = [...t].filter((w) => c.has(w) || [...c].some((cw) => cw.startsWith(w.slice(0, 5)) || w.startsWith(cw.slice(0, 5))));
    return { ratio: overlap.length / t.size, overlap };
}

function asLines(v) {
    if (Array.isArray(v)) return v.map((x) => String(x || ''));
    if (typeof v === 'string' && v) return [v];
    return [];
}

// Dual-read: new shape (bullets/student_task/teacher_tip) + legacy (content/notes).
// New fields win when present, so normalized slides (which carry both the
// merged `content` and the original fields) never double-count lines.
function slideLines(s) {
    const fromNew = [...asLines(s.bullets), ...asLines(s.student_task)];
    if (fromNew.length) return fromNew;
    return asLines(s.content);
}

function slideTip(s) {
    if (typeof s.teacher_tip === 'string' && s.teacher_tip) return s.teacher_tip;
    if (typeof s.notes === 'string') return s.notes;
    return '';
}

// High-precision script/narration line patterns (flag-only phase).
// Deliberately narrow: action verbs like discuss/ask/explain are legitimate
// verb-first student tasks, so they are NOT matched here.
const SCRIPT_LINE_PATTERNS = [
    /\bteacher\s+says?\b/i,
    /\bsay\s+to\s+the\s+class\b/i,
    /\bgood\s+(morning|afternoon)(\s+class)?\b/i,
    /^(teacher|students?)\s*:/i,
    /\b(I will|we will|let us)\b/i,
    /^["']\s*(good|hello|hi|welcome|class|today)/i
];

function flagScriptLines(slides) {
    const hits = [];
    (slides || []).forEach((s, i) => {
        slideLines(s).forEach((line) => {
            if (SCRIPT_LINE_PATTERNS.some((re) => re.test(line))) {
                hits.push(`slide_${i + 1}_script_line`);
            }
        });
    });
    return hits;
}

function normalizeLesson(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    const slides = Array.isArray(raw.slides) ? raw.slides : [];
    const normSlides = slides.map((s, i) => ({
        id: String(s.id || s.type || EXPECTED_ORDER[i] || `slide${i + 1}`).toLowerCase(),
        slideNumber: typeof s.slideNumber === 'number' ? s.slideNumber : i + 1,
        type: String(s.type || s.id || EXPECTED_ORDER[i] || '').toLowerCase(),
        title: s.title || '',
        content: slideLines(s),
        bullets: asLines(s.bullets),
        student_task: typeof s.student_task === 'string' ? s.student_task : '',
        notes: slideTip(s),
        teacher_tip: typeof s.teacher_tip === 'string' ? s.teacher_tip : ''
    }));
    const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
    return {
        meta: {
            subject: meta.subject || raw.subject || 'General',
            grade_level: meta.grade_level || raw.gradeLevel || raw.grade_level || 'Grade 7',
            topic: meta.topic || raw.topic || '',
            competency: meta.competency || raw.competency || 'General Standard',
            term: meta.term || raw.term || '',
            duration: meta.duration || raw.duration || '60 minutes',
            language: meta.language || '',
            approach: meta.approach || ''
        },
        topic: meta.topic || raw.topic || '',
        subject: meta.subject || raw.subject || 'General',
        gradeLevel: meta.grade_level || raw.gradeLevel || 'Grade 7',
        competency: meta.competency || raw.competency || 'General Standard',
        duration: meta.duration || raw.duration || '60 minutes',
        slides: normSlides
    };
}

function validateLesson(lesson, prefs = {}) {
    const issues = [];
    if (!lesson || typeof lesson !== 'object') return { valid: false, issues: ['empty_lesson'] };
    const norm = normalizeLesson(lesson);
    const slides = norm.slides;
    if (slides.length !== 6) issues.push(`slide_count_${slides.length}_ne_6`);
    const ids = slides.map((s) => String(s.id || '').toLowerCase());
    EXPECTED_ORDER.forEach((t, i) => {
        if (ids[i] !== t) issues.push(`slide_${i + 1}_expected_${t}_got_${ids[i] || 'missing'}`);
    });
    slides.forEach((s, i) => {
        if (!VALID_TYPES.has(String(s.id || '').toLowerCase())) issues.push(`slide_${i + 1}_bad_id`);
        if (!s.title || !String(s.title).trim()) issues.push(`slide_${i + 1}_missing_title`);
        const lines = slideLines(s).filter((x) => x.trim());
        if (!lines.length) issues.push(`slide_${i + 1}_missing_content`);
        if (lines.some((x) => x.length > 140)) issues.push(`slide_${i + 1}_line_too_long`);
        if (/teacher says|say to the class|narrat/i.test(lines.join(' ')) && lines.join(' ').length > 400) issues.push(`slide_${i + 1}_script_like`);
        slideLines(s).forEach((line) => {
            if (SCRIPT_LINE_PATTERNS.some((re) => re.test(line))) issues.push(`slide_${i + 1}_script_line`);
        });
        // New-shape structural checks (only when the model used the new fields).
        if (Array.isArray(s.bullets) && s.bullets.length) {
            if (s.bullets.length > 6) issues.push(`slide_${i + 1}_too_many_bullets`);
            if (s.bullets.some((x) => String(x).split(/\s+/).filter(Boolean).length > 25)) issues.push(`slide_${i + 1}_bullet_too_long`);
        }
        if (typeof s.student_task === 'string' && s.student_task) {
            if (!/^[A-Z][a-z]*/.test(s.student_task.trim()) || !/^(identify|solve|write|discuss|compare|explain|analyze|create|list|describe|underline|complete|answer|share|present|demonstrate|illustrate|examine|evaluate|design|draw|match|sort|predict|infer|justify|reflect)\b/i.test(s.student_task.trim())) issues.push(`slide_${i + 1}_task_not_verb_led`);
        } else if (Array.isArray(s.bullets) && s.bullets.length) {
            issues.push(`slide_${i + 1}_missing_task`);
        }
        if (typeof s.teacher_tip === 'string' && s.teacher_tip && s.teacher_tip.split(/\s+/).filter(Boolean).length > 30) issues.push(`slide_${i + 1}_tip_too_long`);
    });
    const comp = String(norm.meta.competency || norm.competency || '');
    if (comp.length > 60) issues.push('competency_bloated');
    if (!/^[A-Z0-9-]{3,20}/.test(comp.trim()) && comp !== 'General Standard') issues.push('competency_not_code');
    const uncited = slides.filter((s) => !/\[S\d+\]/.test(slideLines(s).join(' '))).length;
    if (slides.length > 0 && uncited === slides.length) issues.push('no_citations');
    const allText = slides.map((s) => `${s.title || ''} ${slideLines(s).join(' ')} ${slideTip(s)}`.toLowerCase()).join('\n');
    const has = (terms) => terms.some((w) => w && allText.includes(String(w).toLowerCase().slice(0, 24)));
    // Concept-level match: approach/integration count as applied when the lesson
    // shows their pedagogy, not just their literal label (e.g. inquiry-based
    // methods without the exact phrase "Inquiry-based").
    const CONCEPT_HINTS = {
        'inquiry-based': ['investigat', 'explor', 'hypothes', 'observ', 'discover', 'question', 'wonder'],
        'collaborative': ['group', 'partner', 'pair', 'team', 'share', 'together', 'peer'],
        '5e': ['engage', 'explore', 'explain', 'elaborat', 'evaluat'],
        'problem-based': ['problem', 'solve', 'solution', 'scenario', 'case'],
        'explicit teaching': ['demonstrat', 'model', 'guided', 'step-by-step', 'direct'],
        'values formation': ['value', 'integrity', 'respect', 'honest', 'persever', 'character', 'reflect'],
        'technology': ['project', 'video', 'digital', 'slide', 'multimedia', 'online'],
        'local culture/community': ['local', 'culture', 'community', 'barangay', 'filipino', 'tradition'],
        'other subjects': ['math', 'science', 'history', 'subject', 'connect']
    };
    const hasConcept = (terms) => terms.some((w) => {
        const key = String(w || '').toLowerCase();
        const hints = CONCEPT_HINTS[key] || [];
        return hints.some((h) => allText.includes(h));
    });
    if (Array.isArray(prefs.approach) && prefs.approach.length && !has(prefs.approach) && !hasConcept(prefs.approach)) issues.push('approach_not_applied');
    if (Array.isArray(prefs.integration) && prefs.integration.length && !has(prefs.integration) && !hasConcept(prefs.integration)) issues.push('integration_not_applied');
    // "None" (or empty) means no accommodation language is required.
    const inclusionNeeds = String(prefs.inclusion || '').trim().toLowerCase();
    const inclusionWaived = !inclusionNeeds || inclusionNeeds === 'none' || inclusionNeeds.startsWith('none;') || inclusionNeeds.startsWith('none ');
    if (!inclusionWaived && !/(accommodat|differentiat|support|extra time|large-print|inclusion)/i.test(allText)) issues.push('inclusion_missing');
    if (Array.isArray(prefs.assessment) && prefs.assessment.length && !/(assess|quiz|exit|check|formative|evaluat)/i.test(allText)) issues.push('assessment_missing');
    return { valid: issues.length === 0, issues };
}

function validateQuiz(questions, expectedTotal) {
    const issues = [];
    if (!Array.isArray(questions)) return { valid: false, issues: ['not_array'] };
    if (expectedTotal && questions.length !== expectedTotal) issues.push(`count_${questions.length}_expected_${expectedTotal}`);
    questions.forEach((q, i) => {
        if (!q.question_text || !String(q.question_text).trim()) issues.push(`q${i + 1}_missing_text`);
        if (!['multiple_choice', 'true_false', 'identification'].includes(q.question_type)) issues.push(`q${i + 1}_bad_type`);
        if (q.question_type === 'multiple_choice') {
            const opts = Array.isArray(q.options) ? q.options : [];
            if (opts.length < 2) issues.push(`q${i + 1}_mc_needs_options`);
            if (opts.filter((o) => o.is_correct).length !== 1) issues.push(`q${i + 1}_mc_needs_one_correct`);
        }
    });
    return { valid: issues.length === 0, issues };
}

module.exports = {
    validateLesson,
    validateQuiz,
    normalizeLesson,
    slideLines,
    topicAlignment,
    topicTokens,
    EXPECTED_ORDER
};
