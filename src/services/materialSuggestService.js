// Suggests teacher-posted class materials that match a student's chat question.
// Scope: ONLY items posted to classes the student is actively enrolled in.
const { query } = require('../config/database');

const STOP = new Set((
    'the,and,for,are,was,were,what,when,where,which,who,whom,why,how,does,did,can,could,should,would,' +
    'this,that,these,those,with,about,from,into,between,explain,give,tell,help,please,show,make,example,' +
    'examples,simple,simply,step,steps,guide,me,my,you,your,our,their,have,has,had,not,but,than,then,' +
    'them,they,its,any,some,more,most,very,just,also,like,use,used,using,ano,ang,ng,sa,mga,paano,bakit'
).split(','));

function keywords(text) {
    const words = String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOP.has(w))
        .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)); // crude plural fold
    return [...new Set(words)].slice(0, 8);
}

async function suggestForStudent(studentProfileId, message, subject, limit = 3) {
    const sid = parseInt(studentProfileId, 10);
    if (!Number.isInteger(sid) || sid <= 0) return [];
    const kws = keywords(message);
    if (kws.length === 0) return [];

    const rows = await query(
        `SELECT li.id, li.title, LEFT(li.description, 500) AS description, li.subject,
                li.file_path, li.file_type, li.source,
                c.id AS class_id, c.class_name, cm.posted_at
         FROM class_materials cm
         JOIN library_items li ON cm.library_item_id = li.id
         JOIN classes c ON cm.class_id = c.id
         JOIN enrollments e ON e.class_id = c.id AND e.student_id = ? AND e.status = 'active'
         WHERE c.is_active = 1
         ORDER BY cm.posted_at DESC
         LIMIT 300`,
        [sid]
    );

    const subj = String(subject || '').trim().toLowerCase();
    const best = new Map(); // one entry per library item (it may be posted to several classes)
    for (const r of rows) {
        const title = String(r.title || '').toLowerCase();
        const desc = String(r.description || '').toLowerCase();
        let hits = 0;
        for (const k of kws) {
            if (title.includes(k)) hits += 3;
            else if (desc.includes(k)) hits += 1;
        }
        if (hits === 0) continue; // subject alone never qualifies an item
        if (subj && subj !== 'general' && String(r.subject || '').toLowerCase() === subj) hits += 2;
        const prev = best.get(r.id);
        if (!prev || hits > prev.score) best.set(r.id, { row: r, score: hits });
    }

    return [...best.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ row }) => ({
            id: row.id,
            title: row.title,
            subject: row.subject || 'General',
            class_name: row.class_name,
            file_type: row.file_type || (row.source === 'ai_lesson' ? 'Lesson slides' : 'Document'),
            // Files open directly; slide-only lessons open the class Materials tab.
            url: row.file_path || `/student/classes/${row.class_id}?tab=materials`,
            external: !!row.file_path
        }));
}

module.exports = { suggestForStudent, keywords };