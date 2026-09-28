const EXPECTED_ORDER = ['objectives', 'hook', 'explain', 'example', 'discuss', 'activity', 'check', 'wrap', 'declaration'];
const VALID_TYPES = new Set([...EXPECTED_ORDER, 'intro', 'concept', 'analysis', 'practice', 'reflection']);

const STOPWORDS = new Set('a,an,the,and,or,of,in,on,for,to,with,by,from,as,at,is,are,was,were,be,been,being,it,its,this,that,these,those,into,through,between,across,within,without,under,over,about,into,per,via,using,use,used,meaning,purpose,clarity,target,audience,original,various,appropriate,significant,learners,demonstrate,learners,grade'.split(','));

function topicTokens(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

function asLines(v) {
    if (Array.isArray(v)) return v.map((x) => String(x || ''));
    if (typeof v === 'string' && v) return [v];
    return [];
}

// Dual-read: new shape (slide_text/student_task) + legacy (bullets/content).
// Projection = slide_text, then student_task. Legacy bullets/content only as fallback.
// New fields win when present, so normalized slides (which carry both the
// merged `content` and the original fields) never double-count lines.
function slideLines(s) {
    const fromNew = [...asLines(s.slide_text), ...asLines(s.student_task)];
    if (fromNew.length) return fromNew;
    const legacy = [...asLines(s.bullets), ...asLines(s.student_task)];
    if (legacy.length) return legacy;
    return asLines(s.content);
}

function slideScript(s) {
    if (typeof s.teacher_script === 'string' && s.teacher_script) return s.teacher_script;
    return '';
}

function slideSpeech(s) {
    if (typeof s.speaker_notes === 'string' && s.speaker_notes) return s.speaker_notes;
    return '';
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
        slide_text: asLines(s.slide_text),
        visual_prompt: typeof s.visual_prompt === 'string' ? s.visual_prompt : '',
        teacher_script: typeof s.teacher_script === 'string' ? s.teacher_script : '',
        bullets: asLines(s.bullets),
        student_task: typeof s.student_task === 'string' ? s.student_task : '',
        speaker_notes: slideSpeech(s),
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
    // Optional appended declaration slide is metadata, not deck content.
    const declIdx = norm.slides.findIndex((s) => String(s.id || '').toLowerCase() === 'declaration');
    const decl = declIdx >= 0 ? norm.slides[declIdx] : null;
    const slides = declIdx >= 0 ? norm.slides.filter((_, i) => i !== declIdx) : norm.slides;
    if (decl && (!decl.title || !String(decl.title).trim())) issues.push('declaration_missing_title');
    if (slides.length < 8 || slides.length > 12) issues.push(`slide_count_${slides.length}_want_8_to_12`);
    const ids = slides.map((s) => String(s.id || '').toLowerCase());
    const baseRole = (id) => String(id || '').split('_')[0];
    const roles = ids.map(baseRole);
    const hasRole = (r) => roles.includes(r);
    ['objectives', 'hook', 'explain', 'example', 'discuss', 'activity', 'check', 'wrap'].forEach((r) => {
        if (!hasRole(r)) issues.push(`missing_${r}_slide`);
    });
    // Order check: first occurrence of each required role must follow the deck order
    // (declaration excluded — it always closes the deck when present).
    let lastPos = -1;
    let orderOk = true;
    EXPECTED_ORDER.forEach((r) => {
        const pos = roles.indexOf(r);
        if (pos !== -1) {
            if (pos < lastPos) orderOk = false;
            lastPos = Math.max(lastPos, pos);
        }
    });
    if (orderOk === false) issues.push('slide_order_wrong');
    slides.forEach((s, i) => {
        const role = baseRole(s.id);
        if (!VALID_TYPES.has(role) && !/^[a-z]+_\d+$/.test(String(s.id || ''))) issues.push(`slide_${i + 1}_bad_id`);
        if (!s.title || !String(s.title).trim()) issues.push(`slide_${i + 1}_missing_title`);
        const lines = slideLines(s).filter((x) => x.trim());
        if (!lines.length) issues.push(`slide_${i + 1}_missing_content`);
        if (lines.some((x) => x.length > 140)) issues.push(`slide_${i + 1}_line_too_long`);
        if (/teacher says|say to the class|narrat/i.test(lines.join(' ')) && lines.join(' ').length > 400) issues.push(`slide_${i + 1}_script_like`);
        slideLines(s).forEach((line) => {
            if (SCRIPT_LINE_PATTERNS.some((re) => re.test(line))) issues.push(`slide_${i + 1}_script_line`);
        });
        // Visual-first structural checks (slide_text replaces bullets; legacy bullets fall back).
        const hasTextShape = (Array.isArray(s.slide_text) && s.slide_text.length)
            || (Array.isArray(s.bullets) && s.bullets.length);
        const textLines = (Array.isArray(s.slide_text) && s.slide_text.length)
            ? s.slide_text
            : (Array.isArray(s.bullets) && s.bullets.length ? s.bullets : []);
        if (textLines.length) {
            if (textLines.length < 2 || textLines.length > 4) issues.push(`slide_${i + 1}_want_2_to_4_lines`);
            if (textLines.some((x) => String(x).split(/\s+/).filter(Boolean).length > 12)) issues.push(`slide_${i + 1}_text_too_long`);
        }
        // Citations must never appear on projection (slide_text, title, student_task).
        if (/\[P\d+\]|\[S\d+\]/.test([...asLines(s.slide_text), String(s.title || ''), String(s.student_task || '')].join(' '))) issues.push(`slide_${i + 1}_citation_on_projection`);
        if (!s.visual_prompt || !String(s.visual_prompt).trim()) issues.push(`slide_${i + 1}_missing_visual`);
        if (!s.teacher_script || !String(s.teacher_script).trim()) issues.push(`slide_${i + 1}_missing_script`);
        if (typeof s.student_task === 'string' && s.student_task) {
            if (!/^(identify|solve|write|discuss|compare|explain|analyze|create|list|describe|underline|complete|answer|share|present|demonstrate|illustrate|examine|evaluate|design|draw|match|sort|predict|infer|justify|reflect|restate)\b/i.test(s.student_task.trim())) issues.push(`slide_${i + 1}_task_not_verb_led`);
        } else if (hasTextShape) {
            issues.push(`slide_${i + 1}_missing_task`);
        }
        if (typeof s.teacher_tip === 'string' && s.teacher_tip && s.teacher_tip.split(/\s+/).filter(Boolean).length > 30) issues.push(`slide_${i + 1}_tip_too_long`);
        if (typeof s.speaker_notes === 'string' && s.speaker_notes) {
            if (s.speaker_notes.split(/\s+/).filter(Boolean).length > 40) issues.push(`slide_${i + 1}_notes_too_long`);
        } else if (hasTextShape) {
            issues.push(`slide_${i + 1}_missing_notes`);
        }
        // check/wrap slides must not introduce new content.
        if ((role === 'check' || role === 'wrap') && /(new (term|concept|definition|example)|first (introduc|defin|explain))/i.test(slideLines(s).join(' '))) issues.push(`slide_${i + 1}_${role}_adds_new_content`);
    });
    const comp = String(norm.meta.competency || norm.competency || '');
    // Plan-carried competency: descriptive text verbatim is valid. The code
    // format check is advisory-only when no code pattern is present.
    const looksLikeCode = /^[A-Z0-9-]{3,20}/.test(comp.trim());
    if (comp.length > 500) issues.push('competency_bloated');
    if (looksLikeCode && comp.length > 60) issues.push('competency_bloated');
    if (!comp.trim()) issues.push('competency_missing');
    // [P#] plan refs replace [S#] curriculum refs. Old [S#] decks still pass.
    // Citations live in teacher_script (never on projection).
    const planCited = slides.filter((s) => /\[P\d+\]/.test(slideScript(s))).length;
    const legacyCited = slides.filter((s) => /\[S\d+\]/.test(slideScript(s))).length;
    const uncited = slides.length - planCited - legacyCited;
    if (slides.length > 0 && uncited > Math.floor(slides.length / 2)) issues.push('citations_too_sparse');
    // Plan coverage gate: every ILAW/DLL/DLP section represented for the lesson.
    const planRefs = new Set();
    slides.forEach((s) => {
        const m = `${slideScript(s)} ${slideSpeech(s)} ${slideLines(s).join(' ')}`.match(/\[P(\d+)\]/g) || [];
        m.forEach((x) => planRefs.add(x));
    });
    const coverage = prefs.plan_coverage || null;
    if (coverage && typeof coverage === 'object') {
        const need = ['intentions', 'experiences', 'assessment', 'ways'].filter((k) => coverage[k]);
        if (need.length && planRefs.size === 0 && legacyCited === 0) issues.push('plan_coverage_untraced');
    } else if (prefs.require_plan_coverage && planRefs.size === 0 && legacyCited === 0) {
        issues.push('plan_coverage_untraced');
    }
    const objectives = slides.filter((s) => baseRole(s.id) === 'objectives');
    const objText = objectives.map((s) => `${s.title || ''} ${slideLines(s).join(' ')}`.toLowerCase()).join('\n');
    if (objectives.length && !/(by the end|you can|objective)/i.test(objText)) issues.push('objectives_not_measurable');
    const wraps = slides.filter((s) => baseRole(s.id) === 'wrap');
    const wrapText = wraps.map((s) => slideLines(s).join(' ')).join(' ').toLowerCase();
    if (wraps.length && !/(exit ticket|assignment|next)/i.test(wrapText)) issues.push('wrap_missing_exit');
    const allText = slides.map((s) => `${s.title || ''} ${slideLines(s).join(' ')} ${slideTip(s)} ${slideSpeech(s)} ${slideScript(s)}`.toLowerCase()).join('\n');
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

// Split a comma- or pipe-separated list, or accept an array directly.
function splitAliases(value) {
    if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
    if (typeof value === 'string' && value.trim()) {
        return value.split(/[|,]/).map((v) => String(v).trim()).filter(Boolean);
    }
    return [];
}

// Conservative explanation answer extraction. Label-anchored only: the loose
// "X is Y" pattern previously grabbed the wrong fragment and is gone.
const EXPLANATION_ANSWER_PATTERNS = [
    /(?:correct\s+answer|the\s+answer|answer)\s*(?:is|:|=)\s*["'`]?\s*([^,.;\[\]"`]{2,90})/i,
    /standard\s+form\s*(?:is|:|=)?\s*["'`]?\s*([^,.;\[\]"`]{2,90})/i,
    /^(?:it\s+is|this\s+is)\s+["'`]?\s*([^,.;\[\]"`]{2,90})/i
];

function extractAnswerFromExplanation(q) {
    const expl = String((q && q.explanation) || '');
    if (!expl.trim()) return '';
    for (const re of EXPLANATION_ANSWER_PATTERNS) {
        const m = expl.match(re);
        if (m && m[1]) {
            const candidate = m[1].trim().replace(/[.,;:"'`]+$/, '').trim();
            if (candidate.length >= 2) return candidate;
        }
    }
    return '';
}

// Resolve the expected answer(s) for an identification question no matter how
// the model phrased them (accept[]/answer/correct_answer/correct/single option
// / explanation). Returns [] when nothing recoverable exists.
function resolveIdentificationAnswer(q) {
    if (!q || typeof q !== 'object') return [];
    const aliases = splitAliases(q.accept !== undefined ? q.accept : (q.acceptable_answers !== undefined ? q.acceptable_answers : q.answers));
    if (aliases.length) return aliases;
    const single = q.answer ?? q.correct_answer ?? q.correct;
    if (typeof single === 'string' && single.trim()) return [single.trim()];
    if (Array.isArray(q.options) && q.options.length) {
        const isStringArr = typeof q.options[0] === 'string';
        const marked = q.options.filter((o) => !isStringArr && Number(o.is_correct) === 1);
        const markedTexts = marked.map((o) => String(o.option_text != null ? o.option_text : o.text || '').trim()).filter(Boolean);
        if (markedTexts.length) return markedTexts;
        const texts = q.options.map((o) => String(isStringArr ? o : (o.option_text != null ? o.option_text : o.text || '')).trim()).filter(Boolean);
        if (texts.length === 1) return texts;
    }
    const fromExplanation = extractAnswerFromExplanation(q);
    if (fromExplanation) return [fromExplanation];
    return [];
}

function validateQuiz(questions, expectedTotal, opts = {}) {
    const issues = [];
    if (!Array.isArray(questions)) return { valid: false, issues: ['not_array'] };
    if (expectedTotal && questions.length !== expectedTotal) issues.push(`count_${questions.length}_expected_${expectedTotal}`);
    questions.forEach((q, i) => {
        if (!q.question_text || !String(q.question_text).trim()) issues.push(`q${i + 1}_missing_text`);
        if (!['multiple_choice', 'true_false', 'identification'].includes(q.question_type)) issues.push(`q${i + 1}_bad_type`);
        if (q.question_type === 'multiple_choice') {
            const o = Array.isArray(q.options) ? q.options : [];
            if (o.length < 2) issues.push(`q${i + 1}_mc_needs_options`);
            if (o.filter((x) => x.is_correct).length !== 1) issues.push(`q${i + 1}_mc_needs_one_correct`);
        }
        if (q.question_type === 'identification' && resolveIdentificationAnswer(q).length === 0) {
            issues.push(`q${i + 1}_ident_needs_answer`);
        }
    });
    // Dual-grounded quizzes cite [P#] plan sections. Legacy [S#] still passes.
    if (opts.require_plan_refs) {
        const cited = questions.filter((q) => /\[P\d+\]/.test(String(q.explanation || '')) || /\[S\d+\]/.test(String(q.explanation || ''))).length;
        if (questions.length > 0 && cited < Math.ceil(questions.length / 2)) issues.push('quiz_refs_too_sparse');
    }
    // Verify the returned type mix matches what the teacher requested.
    if (opts.expected_mix && typeof opts.expected_mix === 'object') {
        const actual = { multiple_choice: 0, true_false: 0, identification: 0 };
        questions.forEach((q) => { if (q && actual[q.question_type] !== undefined) actual[q.question_type] += 1; });
        Object.keys(actual).forEach((type) => {
            const want = Number(opts.expected_mix[type]) || 0;
            if (actual[type] !== want) issues.push(`mix_${type}_${actual[type]}_want_${want}`);
        });
    }
    return { valid: issues.length === 0, issues };
}

module.exports = {
    validateLesson,
    validateQuiz,
    normalizeLesson,
    slideLines,
    slideSpeech,
    slideScript,
    topicTokens,
    splitAliases,
    resolveIdentificationAnswer,
    extractAnswerFromExplanation,
    EXPECTED_ORDER
};
