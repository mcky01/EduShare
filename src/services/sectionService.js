// ============================================================
// sectionService.js — canonical grade/section vocabulary.
// Single source of truth for "which sections exist for a grade".
//
// Problem it solves: sections are free text, so "Rizal" vs "rizal"
// vs "RIZAL" splits rosters. Instead of guessing casing with
// title-case heuristics, students PICK the teacher's canonical
// spelling from a type-to-search lookup, and every server-side
// write path converges free-typed input to the canonical spelling
// when one exists (case-insensitive match). No migration needed —
// `students.grade_level/section`, `classes.grade_level/section`,
// and `teachers.advisory_grade/advisory_section` already exist.
// ============================================================
const { query } = require('../config/database');

// One shared vocabulary for every grade/section surface in the app
// (student + teacher self-registration, admin create/edit, class
// creation, library/quiz/lesson forms, curriculum docs, section lookup).
// EduShare serves Junior + Senior High, so Grades 7-12 everywhere.
const GRADES_7_12 = ['Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'];
// Student-facing vocabulary. Kept as an alias (same list) so callers that
// only care about students read clearly; there is exactly one list.
const STUDENT_GRADES = GRADES_7_12;
// Teacher-facing vocabulary (same list — SHS teachers included).
const TEACHER_GRADES = GRADES_7_12;
const GENDERS = ['Male', 'Female', 'Other'];

// Trim + collapse internal whitespace, cap length. Returns null when blank.
function cleanSection(raw) {
    const v = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 50);
    return v.length > 0 ? v : null;
}

function cleanStudentGrade(raw) {
    const v = String(raw || '').trim();
    return STUDENT_GRADES.includes(v) ? v : null;
}

function cleanGender(raw, fallback = 'Male') {
    const v = String(raw || '').trim();
    return GENDERS.includes(v) ? v : fallback;
}

// ---- Known-section sources (short-TTL cache; sections change rarely) ----
const _knownCache = new Map(); // grade -> { at, entries }
const KNOWN_TTL_MS = 5 * 60 * 1000;

async function knownSections(gradeLevel) {
    const now = Date.now();
    const hit = _knownCache.get(gradeLevel);
    if (hit && now - hit.at < KNOWN_TTL_MS) return hit.entries;

    // Source 1: real active classes for the grade (teacher-owned, and the
    // adviser-approval flow auto-enrolls into a matching class, so staying
    // inside this vocabulary keeps approval -> auto-enroll working).
    const classRows = await query(
        'SELECT section FROM classes WHERE grade_level = ? AND is_active = 1 LIMIT 200',
        [gradeLevel]
    );
    // Source 2: active advisers' declared sections (covers advisers who
    // have not created a class row yet — students must still find them).
    const advRows = await query(
        `SELECT t.advisory_section AS section
         FROM teachers t
         JOIN users u ON t.user_id = u.id
         WHERE t.is_adviser = 1 AND t.advisory_grade = ?
           AND t.advisory_section IS NOT NULL
           AND u.status = 'active' AND u.is_active = 1
         LIMIT 200`,
        [gradeLevel]
    );

    // Dedupe case-insensitively; the most-frequent spelling wins so the
    // canonical form is the one teachers actually use.
    const counts = new Map();
    for (const r of [...classRows, ...advRows]) {
        const s = String(r.section || '').trim().replace(/\s+/g, ' ');
        if (!s) continue;
        const k = s.toLowerCase();
        const cur = counts.get(k);
        if (!cur) counts.set(k, { section: s, n: 1 });
        else cur.n += 1;
    }
    const entries = [...counts.values()].sort(
        (a, b) => b.n - a.n || a.section.localeCompare(b.section)
    );
    _knownCache.set(gradeLevel, { at: now, entries });
    return entries;
}

function clearSectionCache() {
    _knownCache.clear();
}

// Type-to-search: never dumps the whole list (empty q returns []).
// The lookup endpoint enforces q >= 1 char; this also guards direct callers.
async function suggestSections(gradeLevel, q) {
    const needle = String(q || '').trim().toLowerCase();
    if (!STUDENT_GRADES.includes(gradeLevel) || needle.length === 0) return [];
    const all = await knownSections(gradeLevel);
    return all
        .filter((e) => e.section.toLowerCase().includes(needle))
        .slice(0, 8)
        .map((e) => e.section);
}

// Converge free-typed input to the canonical spelling when the grade has
// one (case-insensitive exact match). Falls back to the trimmed input so
// students are never blocked when teachers have not registered yet
// (soft-match: the adviser corrects at approval via the edit modal).
// Never throws — a lookup failure must not block registration.
async function canonicalizeSection(gradeLevel, rawSection) {
    const cleaned = cleanSection(rawSection);
    if (!cleaned || !STUDENT_GRADES.includes(gradeLevel)) return cleaned;
    try {
        const all = await knownSections(gradeLevel);
        const hit = all.find((e) => e.section.toLowerCase() === cleaned.toLowerCase());
        return hit ? hit.section : cleaned;
    } catch {
        return cleaned;
    }
}

module.exports = {
    GRADES_7_12,
    STUDENT_GRADES,
    TEACHER_GRADES,
    GENDERS,
    cleanSection,
    cleanStudentGrade,
    cleanGender,
    knownSections,
    suggestSections,
    canonicalizeSection,
    clearSectionCache
};
