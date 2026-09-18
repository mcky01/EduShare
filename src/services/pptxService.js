// EduShare PPTX exporter: deck JSON -> real 16:9 .pptx (PptxGenJS).
// Projection-only bodies (slide_text + task, citations stripped); teacher
// script + Say/Do go to Notes; visual_prompt renders as a suggestion box.

const { query } = require('../config/database');
const validationService = require('./validationService');

const THEME = {
    emerald: '0E7C5B',
    emeraldDeep: '0A5C44',
    amber: 'F59E0B',
    ink: '1F2937',
    muted: '6B7280',
    bg: 'FFFFFF',
    wash: 'ECFDF5'
};

function asLines(v) {
    if (Array.isArray(v)) return v.map((x) => String(x || ''));
    if (typeof v === 'string' && v) return [v];
    return [];
}

function stripRefs(s) {
    return String(s || '').replace(/\s*\[[PS]\d+\]/g, ' ').replace(/\s+/g, ' ').trim();
}

function projectionOf(slide) {
    const text = asLines(slide.slide_text);
    const base = text.length ? text : asLines(slide.bullets);
    const lines = base.length ? base : asLines(slide.content);
    const task = typeof slide.student_task === 'string' ? slide.student_task.trim() : '';
    const out = lines.map(stripRefs).filter(Boolean);
    if (task) out.push(stripRefs(task));
    return out.slice(0, 5);
}

function notesOf(slide) {
    const parts = [];
    if (slide.teacher_script) parts.push(`Script: ${slide.teacher_script}`);
    if (slide.speaker_notes) parts.push(`Say/Do: ${slide.speaker_notes}`);
    if (slide.teacher_tip) parts.push(`Tip: ${slide.teacher_tip}`);
    else if (slide.notes) parts.push(`Tip: ${slide.notes}`);
    return parts.join('\n\n').slice(0, 2000);
}

function safeName(s, fallback = 'lesson-deck') {
    const t = String(s || fallback).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    return t || fallback;
}

async function buildPptxBuffer(lesson, { schoolName = 'Zeferino Arroyo High School', motto = 'Basta Zeferinian, Magaling Yan!' } = {}) {
    let PptxGenJS;
    try {
        PptxGenJS = require('pptxgenjs');
    } catch {
        throw new Error('PPTX exporter unavailable. Install pptxgenjs.');
    }
    const norm = validationService.normalizeLesson(lesson);
    if (!norm || !Array.isArray(norm.slides) || !norm.slides.length) {
        throw new Error('No slides to export.');
    }
    const meta = norm.meta || {};
    const topic = meta.topic || norm.topic || 'Lesson Deck';
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = schoolName;
    pptx.title = topic;
    pptx.subject = `${meta.subject || ''} • ${meta.grade_level || ''}`;

    // Title slide.
    const cover = pptx.addSlide();
    cover.background = { color: THEME.emeraldDeep };
    cover.addText(String(schoolName), { x: 0.5, y: 0.4, w: 12.3, h: 0.5, fontSize: 18, color: 'FFFFFF', align: 'center' });
    cover.addText(String(topic), { x: 0.5, y: 1.2, w: 12.3, h: 1.6, fontSize: 40, bold: true, color: 'FFFFFF', align: 'center' });
    cover.addText(`${meta.subject || ''} • ${meta.grade_level || ''}${meta.competency ? `\n${String(meta.competency).slice(0, 200)}` : ''}`,
        { x: 1.5, y: 3.2, w: 10.3, h: 1.2, fontSize: 18, color: 'E6F4EE', align: 'center' });
    cover.addText(String(motto), { x: 0.5, y: 6.4, w: 12.3, h: 0.5, fontSize: 16, italic: true, color: THEME.amber, align: 'center' });

    // Content slides: title + short projection lines + task; visual suggestion box.
    norm.slides.forEach((s, i) => {
        if (String(s.id || '').toLowerCase() === 'declaration') return;
        const slide = pptx.addSlide();
        slide.background = { color: THEME.bg };
        // Top accent bar + footer.
        slide.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: THEME.emerald } });
        slide.addText(`${schoolName}  •  Slide ${i + 1}`, { x: 0.5, y: 7.0, w: 12.33, h: 0.3, fontSize: 10, color: THEME.muted });
        const role = String(s.id || s.type || '').toLowerCase();
        slide.addText(role.toUpperCase(), { x: 0.6, y: 0.35, w: 12, h: 0.3, fontSize: 12, bold: true, color: THEME.emerald });
        slide.addText(stripRefs(s.title || `Slide ${i + 1}`), { x: 0.6, y: 0.65, w: 12, h: 0.9, fontSize: 30, bold: true, color: THEME.ink });
        const lines = projectionOf(s);
        const body = lines.map((l) => ({ text: l, options: { fontSize: 20, color: THEME.ink, bullet: true, breakLine: true, paraSpaceAfter: 6 } }));
        if (body.length) {
            slide.addText(body, { x: 0.6, y: 1.7, w: 7.6, h: 4.6, valign: 'top' });
        }
        const visual = (s.visual_prompt || '').trim();
        slide.addShape('roundRect', { x: 8.7, y: 1.7, w: 3.9, h: 3.2, fill: { color: THEME.wash }, line: { color: THEME.emerald, width: 1 } });
        slide.addText([{ text: 'SHOW  ', options: { fontSize: 11, bold: true, color: THEME.emerald } },
            { text: visual || 'simple visual related to the slide title', options: { fontSize: 13, italic: true, color: THEME.ink } }],
            { x: 8.9, y: 1.9, w: 3.5, h: 2.8, valign: 'top' });
        const notes = notesOf(s);
        if (notes) slide.addNotes(notes);
    });

    // Declaration closing slide (when present in deck).
    const decl = norm.slides.find((s) => String(s.id || '').toLowerCase() === 'declaration');
    if (decl) {
        const slide = pptx.addSlide();
        slide.background = { color: THEME.bg };
        slide.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: THEME.emerald } });
        slide.addText('Declaration of AI Use', { x: 0.6, y: 1.5, w: 12, h: 0.8, fontSize: 28, bold: true, color: THEME.ink, align: 'center' });
        const line = asLines(decl.slide_text || decl.bullets || decl.content)[0] || 'This deck was AI-translated from the lesson plan and reviewed by the teacher.';
        slide.addText(stripRefs(line), { x: 1.6, y: 2.8, w: 10, h: 2, fontSize: 18, color: THEME.muted, align: 'center' });
    }

    const buf = await pptx.write({ outputType: 'nodebuffer' });
    return { buffer: Buffer.from(buf), filename: `${safeName(topic)}.pptx` };
}

async function loadDeckForExport({ lesson_json, lessonId, itemId, userId }) {
    if (lesson_json) {
        const parsed = typeof lesson_json === 'string' ? JSON.parse(lesson_json) : lesson_json;
        if (parsed && typeof parsed === 'object') return parsed.slides ? parsed : parsed.lesson || parsed;
    }
    if (lessonId) {
        const rows = await query('SELECT content FROM ai_content WHERE id = ? AND user_id = ? AND content_type = ?', [parseInt(lessonId, 10) || 0, userId, 'lesson']);
        if (rows.length) {
            const c = rows[0].content;
            return typeof c === 'string' ? JSON.parse(c) : c;
        }
    }
    if (itemId) {
        const rows = await query('SELECT lesson_content FROM library_items WHERE id = ? AND teacher_id = ?', [parseInt(itemId, 10) || 0, userId]);
        if (rows.length && rows[0].lesson_content) {
            const c = rows[0].lesson_content;
            return typeof c === 'string' ? JSON.parse(c) : c;
        }
    }
    throw new Error('No lesson found to export. Generate or open the deck first.');
}

module.exports = { buildPptxBuffer, loadDeckForExport, projectionOf, notesOf, stripRefs, THEME };
