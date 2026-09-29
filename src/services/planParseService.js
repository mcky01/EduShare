// EduShare plan-input parser.
// Normalizes DLL/DLP/ILAW lesson plans (pasted text, .docx, .pdf, .doc-as-HTML)
// into tagged sections with [P#] refs + session columns, preserving table structure.
//
// Output shape:
// {
//   planText:   tagged linear text for the prompt, e.g. "[P3 Learning Experience · S2] ...",
//   sections:   [{ ref:'P1', role:'intentions'|'experiences'|'assessment'|'ways'|'meta'|'other', title, text, sessions:['S1'..] }],
//   sessions:   ['S1','S2',...] detected (max 5),
//   coverage:   { intentions, experiences, assessment, ways },
//   warnings:   ['no_session_markers', ...]
// }

const MAX_CHARS = 20000;

// Canonical section roles + header patterns (ILAW first, DLL/DLP variants).
// Anchored patterns matter: ILAW writes bare sub-pillar headings ("Flow",
// "Reflections", "Resources") with no colon, so unanchored-only rules miss them.
const ROLE_PATTERNS = [
    { role: 'intentions', patterns: [/^\s*intentions?\b/i, /learning\s+competency/i, /content\s+standards?/i, /performance\s+standards?/i, /learning\s+objectives?/i, /^\s*objectives?\b/i, /learner\s+context/i] },
    { role: 'experiences', patterns: [/learning\s+experiences?/i, /pre-?lesson/i, /post-?lesson/i, /flow\s*:/i, /^\s*flow\b/i, /^\s*lesson\s+development\b/i, /^\s*guided\s+practice\b/i, /^\s*generalization\b/i, /^\s*exit\s+ticket\b/i, /^\s*(individual|group)\s+activity\b/i, /concept\s+building/i, /active\s+(retrieval|learning)/i, /social\s+learning/i, /checks?\s+for\s+understanding/i, /learning\s+resources?/i, /^\s*resources?\b/i, /opportunit\w*\s+for\s+integration/i, /^\s*integration\b/i, /^\s*procedure\b/i, /^\s*lesson\s+proper/i] },
    { role: 'assessment', patterns: [/^\s*assessments?\.?$/i, /^\s*assessments?\b/i, /assessments?\s+reveal/i, /assessing\s+learning/i, /formative\s+assessment/i, /summative/i, /^\s*evaluation\b/i] },
    { role: 'ways', patterns: [/ways\s+forward/i, /extended\s+learning/i, /^\s*reflections?\b/i, /^\s*assignment\b/i, /^\s*remarks?\b/i, /enrichment|remediation/i] }
];

// 'meta' is the plan preamble (Lesson Title, Learning Area, Grade Level, ...).
// It is document-level and always spans the grid, even when its prose happens to
// mention "Session 1". Every other role is scoped by its own session tags.
const ALWAYS_SHARED_ROLES = new Set(['meta']);

const SESSION_RE = /session\s*(\d)/gi;
const MAX_SESSIONS = 5;
const SECTION_TEXT_CAP = 6000;

function cleanText(s) {
    return String(s || '')
        .replace(/\r/g, '\n')
        .replace(/[ \t\u00a0]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// PDF-table extraction leaves line-wrap artifacts in a label cell: mid-word
// breaks ("Opportunitie\ns"), word-boundary wraps ("Extended\nlearning"), and a
// period + captured body sentence ("Intentions.\nMeaningful learning..."). A
// resumed chunk that is only a word fragment (``s``, ``ties``, ``tion``, ...)
// continues the previous word; a real word begins a new one. This mirrors the
// spec's /([a-z])\n([a-z])/ -> join rule but stops fusing word boundaries
// ("Extended learning" must not become "Extendedlearning").
const WORD_FRAGMENT_RE = /^[a-z]{1,2}$|^(?:es|ies|ing|tion|sion|ment|ness|ly|ive|ities|ed|ve|ous|able|ible|ance|ence|ity)$/i;
function cleanSectionTitle(raw) {
    const s = String(raw == null ? '' : raw).replace(/\r/g, '').trim();
    if (!s) return s;
    const joined = s.replace(/([a-z])\n([a-z]+)/gi, (all, before, after) =>
        WORD_FRAGMENT_RE.test(after) ? before + after : before + ' ' + after);
    const spaced = joined.replace(/\n+/g, ' ').replace(/[ \t\u00a0]+/g, ' ').trim();
    // A label followed by a long clause means the column captured body text;
    // keep only the label sentence ("Intentions. Meaningful learning..." ->
    // "Intentions."). Short tails ("I. Overview") are left untouched.
    const sentence = /^([a-zA-Z][^.]*\.)\s{1,}(.{25,})$/.exec(spaced);
    const clean = sentence ? sentence[1] : spaced;
    if (clean.length <= 80) return clean;
    const cut = clean.slice(0, 81).lastIndexOf(' ');
    return cut > 0 ? clean.slice(0, cut) : clean.slice(0, 80);
}

// Shared helper for grouping repeated titles and for row keys.
const sectionTitleKey = (title) => cleanSectionTitle(title).toLowerCase().replace(/[.:\-–—]+$/, '').replace(/\s+/g, ' ').trim();

// Session fallback for repeated titles. A PDF table often has no session-header
// row, so per-session content sections ("Pre-Lesson:", "Flow:", ...) come out
// with sessions: []. When every section sharing a title has empty sessions AND
// their count matches the number of session markers detected elsewhere in the
// plan, assign the plan's sessions in document order. Conservative: mixed groups
// (any already-tagged member) and single members are left alone, so existing
// correct tags (e.g. Learning Objectives already S1-S4) are never overwritten.
function applySessionFallback(sections, planSessions) {
    if (planSessions.length < 2) return;
    const groups = new Map();
    sections.forEach((s, i) => {
        const k = sectionTitleKey(s.title);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(i);
    });
    for (const [key, idxs] of groups) {
        if (idxs.length !== planSessions.length) continue;
        if (idxs.some((i) => (sections[i].sessions || []).length)) continue;
        idxs.forEach((idx, k) => { sections[idx].sessions = [planSessions[k]]; });
    }
}

// ILAW pillar headings are lettered and dash-prefixed: "I – INTENTIONS",
// "L – LEARNING EXPERIENCES", "A – ASSESSING LEARNING", "W – WAYS FORWARD".
// Both heading-detection paths need the enumerator removed first:
//   - isHeader() only matches a line that *starts with* the header text, so
//     "L – LEARNING EXPERIENCES" never matched the "learning experiences" entry.
//   - detectRole()'s anchored patterns (e.g. /^\s*intentions?\b/i) never even
//     reached the heading word behind the "L – " prefix.
// Normalizing once here makes all four pillars match identically. The separator
// is required, so ordinary headings ("Lesson Proper", "Ways Forward",
// "Assessment of Results") are left untouched, keeping DLL/DLP intact.
const stripPillarPrefix = (v) => String(v == null ? '' : v)
    .replace(/[\u2010-\u2015]/g, '-')                               // en/em dash -> hyphen
    .replace(/^[ilaw](?:[ \t]*-[ \t]*|[ \t]+[.:][ \t]*)/i, '')      // "I - ", "L-", "A. "
    .replace(/[ \t]+/g, ' ')
    .trim();

// A PDF page break can split a section mid-sentence. The label cell of the
// continuation row comes back empty, so the extractor emits an extra untitled
// block — a phantom "Header" row in the review grid — whose text is really the
// tail of the preceding titled section. Fold those back into their parent so the
// grid shows one row per real section. A continuation row spanning the session
// columns yields one fragment per cell, so each is routed to the section for its
// own session rather than all of them to the last one.
//
// Runs after applySessionFallback (the fallback tags the empty-title group as one
// of its own title groups, so those bogus sessions die with the fragments) and
// before planText / coverage / buildEditableGrid, so every downstream consumer
// sees merged rows. Idempotent: fragments are consumed on the first pass, and a
// re-parse of the merged output has no untitled section left to fold.
//
// An ILAW pillar heading occupying a whole line means the block is a real
// section that lost its label cell, not a page-break tail, so it is kept
// separate and the heading is restored as its title. stripPillarPrefix first so
// the lettered/dash form ("A - ASSESSING LEARNING") matches like every other
// heading does. Whole-line anchored, so prose merely mentioning "assessment"
// never blocks a merge.
const PILLAR_HEADING_RE = /^(INTENTIONS?|LEARNING\s+EXPERIENCES?|ASSESSMENTS?|ASSESSING\s+LEARNING|WAYS\s+FORWARD)\b\s*\.?$/i;
const CONTINUATION_LABEL = 'Continuation';

function findPillarHeading(text) {
    for (const line of String(text || '').split('\n')) {
        const m = PILLAR_HEADING_RE.exec(stripPillarPrefix(line));
        if (m) return m[1].toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
    }
    return '';
}

// A multi-cell continuation row yields one fragment per session cell, each
// already tagged with its column's session by linearizeTables. Resolve those to
// the matching member of the parent's title group (the per-session sections that
// precede it) instead of dumping them all into the last one. Scans backwards so
// the nearest match wins; returns null when the group carries no matching
// session, which leaves the single-cell behaviour untouched.
function pickSessionTarget(group, sessions) {
    const want = new Set((sessions || []).map(String));
    if (!want.size) return null;
    for (let i = group.length - 1; i >= 0; i--) {
        const got = (group[i].sessions || []).map(String);
        if (got.some((sess) => want.has(sess))) return group[i];
    }
    return null;
}

// Mutates `sections` in place (the reference is kept by the caller) and returns
// it. A fragment merges into the preceding titled section, narrowed to that
// section's session when the fragment carries one. A fragment with no preceding
// titled section — a fragment at the very start of the document — is kept and
// labelled "Continuation". Merging only rewrites `text` on a section that is
// kept, so refs (and therefore grid.rows[].refs / cellRefs) still point at the
// real source section for every cell.
function mergeContinuationFragments(sections) {
    const out = [];
    let parent = null;
    // Contiguous run of sections sharing the parent's title key, in document
    // order — the per-session members a multi-cell continuation can target.
    let group = [];
    for (const s of sections) {
        const title = String(s.title == null ? '' : s.title).trim();
        const text = String(s.text == null ? '' : s.text);
        const isFragment = !title && text.trim().length > 0;
        if (!isFragment) {
            if (parent && sectionTitleKey(parent.title) === sectionTitleKey(s.title)) group.push(s);
            else group = [s];
            out.push(s);
            parent = s;
            continue;
        }
        const pillar = findPillarHeading(text);
        if (pillar || !parent) {
            s.title = pillar || CONTINUATION_LABEL;
            out.push(s);
            parent = s;
            group = [s];
            continue;
        }
        const target = pickSessionTarget(group, s.sessions) || parent;
        // Join on a single space: the break is a page boundary, not a paragraph
        // boundary. Internal newlines of both halves are preserved.
        const a = String(target.text || '').trim();
        const b = text.trim();
        target.text = (a && b ? `${a} ${b}` : (b || a)).slice(0, SECTION_TEXT_CAP);
    }
    sections.length = 0;
    sections.push(...out);
    return sections;
}

function detectRole(headerLine) {
    const h = stripPillarPrefix(headerLine);
    if (!h) return null;
    for (const { role, patterns } of ROLE_PATTERNS) {
        if (patterns.some((re) => re.test(h))) return role;
    }
    return null;
}

function detectSessions(text) {
    const found = new Set();
    let m;
    SESSION_RE.lastIndex = 0;
    const t = String(text || '');
    while ((m = SESSION_RE.exec(t)) !== null) {
        const n = parseInt(m[1], 10);
        if (n >= 1 && n <= MAX_SESSIONS) found.add(`S${n}`);
        if (found.size >= MAX_SESSIONS) break;
    }
    return [...found].sort();
}

// ---- HTML table walking (mammoth output + .doc-as-HTML) ----
function stripTags(html) {
    return String(html || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/[ \t]+/g, ' ')
        .trim();
}

function extractHtmlTables(html) {
    const tables = [];
    const tblRe = /<table[\s>][\s\S]*?<\/table>/gi;
    let tm;
    while ((tm = tblRe.exec(html)) !== null) {
        const rows = [];
        const rowRe = /<tr[\s>][\s\S]*?<\/tr>/gi;
        let rm;
        while ((rm = rowRe.exec(tm[0])) !== null) {
            const cells = [];
            const cellRe = /<(td|th)[\s>][\s\S]*?<\/\1>/gi;
            let cm;
            while ((cm = cellRe.exec(rm[0])) !== null) cells.push(stripTags(cm[0]));
            if (cells.length) rows.push(cells);
        }
        if (rows.length) tables.push(rows);
    }
    return tables;
}

function findSessionHeader(rows) {
    // Session header may sit on any row (multi-page tables repeat it mid-table).
    for (const cells of rows) {
        const hits = cells.filter((c) => /^session\s*\d\s*$/i.test((c || '').trim())).length;
        if (hits >= 2) return cells.map((c) => {
            const m = /session\s*(\d)/i.exec(c || '');
            return m ? `S${m[1]}` : null;
        });
    }
    return null;
}

// Convert row-major tables to tagged text. Session columns are detected from
// any row with 2+ "Session N" cells (multi-page tables repeat it mid-table).
function linearizeTables(tables) {
    const out = [];
    const sessionHints = new Set();
    // Document-level column->session maps, keyed by column count.
    //
    // parsePdfBuffer pushes each page's table as a separate entry, and a table
    // that spans a page break does NOT repeat its "Session 1..4" header on the
    // continuation page. findSessionHeader() is per-table, so a continuation
    // table comes back with no header, hasSessionCols is false, and every one of
    // its cells is emitted as session: null -- which leaves the downstream
    // merge unable to tell which session a cell belongs to and collapses the
    // whole continuation row onto the last session of the group.
    //
    // Carrying the map forward restores the real column index of each cell.
    // That index is load-bearing, not cosmetic: a row may be only partially
    // filled ("Opportunities for integration" is blank in Session 1), so cells
    // arrive at ci=2..4. Distributing positionally would shift each one a
    // session to the left; reading colSession[ci] keeps them on S2..S4.
    //
    // Keyed by column count so an unrelated multi-column table in the same
    // document is never forced onto the ILAW session grid.
    const docColSessions = new Map();
    for (const rows of tables) {
        const width = rows.reduce((w, cells) => Math.max(w, cells.length), 0);
        const own = findSessionHeader(rows);
        if (own && own.some(Boolean)) docColSessions.set(width, own);
        const colSession = (own && own.some(Boolean)) ? own : (docColSessions.get(width) || []);
        const hasSessionCols = colSession.some(Boolean);
        rows.forEach((cells, ri) => {
            const label = cleanSectionTitle(cells[0]);
            const role = detectRole(label) || (ri === 0 ? detectRole(cells.slice(1).join(' ')) : null);
            cells.forEach((cell, ci) => {
                const txt = (cell || '').trim();
                if (!txt || txt.length < 3) return;
                if (ci === 0) {
                    out.push({ header: label, role, text: txt, session: null });
                } else {
                    const sess = hasSessionCols ? colSession[ci] : null;
                    if (sess) sessionHints.add(sess);
                    // Skip repeating the session header cell itself.
                    if (/^session\s*\d\s*$/i.test(txt)) return;
                    out.push({ header: label, role, text: txt, session: sess });
                }
            });
        });
    }
    return { blocks: out, sessionHints: [...sessionHints].sort() };
}

// ---- Section splitting for flat text (pasted or pdf getText) ----
const SECTION_HEADERS = [
    'intentions', 'learning experience', 'learning experiences',
    'assessment', 'assessments', 'assessing learning', 'formative assessment', 'summative assessment',
    'ways forward', 'reflections', 'reflection',
    'learning objectives', 'objectives', 'learning competency', 'learner context',
    'content standard', 'performance standard',
    'procedure', 'lesson proper', 'pre-lesson', 'pre lesson', 'flow',
    'pre-lesson activity', 'post-lesson', 'post-lesson activity',
    'lesson development', 'guided practice', 'generalization', 'exit ticket',
    'individual activity', 'group activity',
    'resources', 'learning resources', 'integration',
    'opportunities for integration', 'extended learning', 'enrichment', 'remediation'
];

function splitFlatText(text) {
    const lines = String(text || '').split('\n');
    const blocks = [];
    let cur = { header: 'Plan header', role: 'meta', text: '' };
    const isHeader = (line) => {
        const l = stripPillarPrefix(line).toLowerCase().replace(/[:.\s]+$/, '');
        if (l.length > 60) return false;
        return SECTION_HEADERS.some((h) => l === h || l.startsWith(h + ' ') || l.startsWith(h + ':'));
    };
    for (const line of lines) {
        if (isHeader(line) && cur.text.trim().length > 0) {
            blocks.push(cur);
            cur = { header: cleanSectionTitle(line), role: detectRole(line) || 'other', text: '' };
        } else {
            if (!cur.role || cur.role === 'meta') {
                const r = detectRole(line);
                if (r && line.trim().length < 80) {
                    if (cur.text.trim().length > 0) blocks.push(cur);
                    cur = { header: cleanSectionTitle(line), role: r, text: '' };
                    continue;
                }
            }
            cur.text += line + '\n';
        }
    }
    if (cur.text.trim()) blocks.push(cur);
    return blocks.map((b) => ({ header: b.header, role: b.role || 'other', text: cleanText(b.text), session: null }));
}

function sessionsInBlock(text) {
    return detectSessions(text);
}

// ---- Main entry points ----

function buildTagged(blocks) {
    const tagged = buildTaggedAll(blocks);
    return tagged;
}

// Full-plan tagging (all sessions). Used by /parse for the coverage preview,
// session picker, and the "view full plan / filtered" toggle.
function buildTaggedAll(blocks) {
    const sections = [];
    const warnings = [];
    let n = 0;
    // Table row labels are emitted as their own block by linearizeTables, so a
    // label-only block whose body is just that label is a pure echo of the row
    // heading. Keeping it would render every ILAW pillar twice in the grid
    // (once empty, once with content) and add a duplicate [P#] to the prompt.
    // Fragment-join the label the same way cleanSectionTitle does (without its
    // body-sentence stripping) so an artifact-wrapped label echoes its cleaned
    // header and is still dropped instead of surfacing as a junk section.
    const normLabel = (v) => String(v || '')
        .replace(/([a-z])\n([a-z]+)/gi, (all, before, after) => WORD_FRAGMENT_RE.test(after) ? before + after : before + ' ' + after)
        .replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.:\-–—]+$/, '');
    for (const b of blocks) {
        const text = cleanText(b.text);
        if (!text || text.length < 2) continue;
        const label = cleanSectionTitle(b.header);
        if (normLabel(text) === normLabel(label) && normLabel(label)) continue;
        n += 1;
        sections.push({
            ref: `P${n}`,
            role: b.role || 'other',
            title: label,
            text: text.slice(0, SECTION_TEXT_CAP),
            sessions: b.session ? [b.session] : sessionsInBlock(`${label}\n${text}`)
        });
    }
    const allText = sections.map((s) => `${s.title}\n${s.text}`).join('\n');
    const sessions = detectSessions(allText);
    // Table-derived session hints: blocks tagged with a single session.
    for (const s of sections) {
        for (const sess of s.sessions) {
            if (!sessions.includes(sess)) sessions.push(sess);
        }
    }
    sessions.sort();
    applySessionFallback(sections, sessions);
    // Page-break tails become whole sections again before anything downstream
    // (planText, coverage, buildEditableGrid) reads the list.
    mergeContinuationFragments(sections);
    if (sessions.length === 0) warnings.push('no_session_markers');
    const coverage = {
        intentions: sections.some((s) => s.role === 'intentions'),
        experiences: sections.some((s) => s.role === 'experiences'),
        assessment: sections.some((s) => s.role === 'assessment'),
        ways: sections.some((s) => s.role === 'ways')
    };
    if (!coverage.intentions) warnings.push('missing_intentions');
    if (!coverage.experiences) warnings.push('missing_experiences');
    if (!coverage.assessment) warnings.push('missing_assessment');
    if (!coverage.ways) warnings.push('missing_ways_forward');
    const planText = sections.map((s) => {
        const sess = s.sessions.length ? ` · ${s.sessions.join('/')}` : '';
        return `[${s.ref} ${s.title}${sess}]\n${s.text}`;
    }).join('\n\n');
    return { planText: planText.slice(0, MAX_CHARS), sections, sessions, coverage, warnings };
}

// Editable grid for the review table: groups tagged sections into
// row-label x session-column cells, mirroring the plan's own table layout.
// Row placement is decided by the section's own session tags, not by its role:
// a section the parser tagged (sessions non-empty) becomes a per-session row, an
// untagged one spans every column. In ILAW that lets every repeated pillar
// (not just Learning Experience) get its own S1..S4 cells, while the plan
// preamble ('meta') and any DLL/DLP section without session markers still span.
// {
//   columns: ['S1','S2',...],
//   shared: [{ key, title, text, role, ref, sessionScoped:false }],   // spans all columns
//   rows: [{ key, title, role, cells: { S1, S2, ... }, refs: {} }],    // per-session
//   cellRefs: { rowKey: { S1: 'P12', ... } } // traceability back to sections
// }
function buildEditableGrid(tagged) {
    const sections = (tagged && tagged.sections) || [];
    const columns = [...(tagged.sessions || [])].sort().slice(0, 5);
    // Session-less plans (most DLL/DLP: "no_session_markers") have no column
    // axis to distribute across, so per-session rows would render with zero
    // visible cells. Keep those sections shared (one full-width row) instead.
    const hasColumns = columns.length > 0;
    // Normalize row keys: strip trailing session markers, collapse whitespace.
    const rowKey = (s) => String(s.title || 'Section').replace(/\s+/g, ' ').trim().slice(0, 80)
        .replace(/\s*[·•|-]\s*S[1-5](\/S[1-5])*$/i, '');
    // Role is NOT authoritative for row shape. A section is per-session whenever
    // the parser tagged it with sessions, and spanning whenever it did not:
    //   - ILAW repeats pillars other than Learning Experience across sessions
    //     (Learning Objectives, Learner Context, Formative Assessment, Extended
    //     Learning, Reflections). Keying off role alone forced those into shared
    //     rows, silently merging the S2/S3/S4 content into a single cell.
    //   - DLL/DLP sections carry no session tags, so they stay shared either way.
    const isSessionScoped = (s) => {
        if (!hasColumns) return false;
        if (ALWAYS_SHARED_ROLES.has(s.role || 'other')) return false;
        return (s.sessions || []).length > 0;
    };
    const groups = new Map();
    const order = [];
    const shared = [];
    for (const s of sections) {
        const sess = (s.sessions || []).filter((c) => columns.includes(c));
        if (!isSessionScoped(s) || sess.length === 0) {
            // Either the section is not session-scoped at all, or it is but its
            // content carries no session marker (e.g. a DLL "Lesson Proper" that
            // never mentions "Session N"). Rows with no reachable column would
            // render blank and their text would vanish on the grid -> tagged
            // round-trip, so keep these as full-width shared rows.
            shared.push({ key: `shared-${shared.length}`, title: s.title, text: s.text, role: s.role || 'meta', ref: s.ref, sessionScoped: false });
            continue;
        }
        const key = `${s.role || 'other'}::${rowKey(s)}`;
        if (!groups.has(key)) {
            groups.set(key, { key, title: rowKey(s), role: s.role || 'other', cells: {}, refs: {}, sessionScoped: true });
            order.push(key);
        }
        const g = groups.get(key);
        for (const col of sess) {
            g.cells[col] = [g.cells[col], s.text].filter(Boolean).join('\n');
            g.refs[col] = g.refs[col] ? `${g.refs[col]},${s.ref}` : s.ref;
        }
    }
    const rows = order.map((k) => groups.get(k));
    const cellRefs = {};
    rows.forEach((r) => { cellRefs[r.key] = r.refs; });
    return { columns, shared, rows, cellRefs };
}

// Rebuild tagged text from edited grid cells (teacher's table edits win).
// `edits` = { rowKey: { S1: 'new text', ... }, shared-<i>: 'new text' }.
function gridToTagged(tagged, edits) {
    const grid = buildEditableGrid(tagged);
    const get = (rowKey, col) => (edits && edits[rowKey] && typeof edits[rowKey][col] === 'string')
        ? edits[rowKey][col] : null;
    const blocks = [];
    grid.shared.forEach((sh) => {
        const v = edits && typeof edits[sh.key] === 'string' ? edits[sh.key] : sh.text;
        // Keep the original role: the ILAW pillars (intentions/assessment/ways)
        // round-trip through shared rows, and collapsing them to 'meta' would
        // drop them out of coverage and the prompt after any grid edit.
        if (String(v || '').trim()) blocks.push({ header: sh.title, role: sh.role || 'meta', text: String(v), session: null });
    });
    grid.rows.forEach((row) => {
        grid.columns.forEach((col) => {
            const cur = row.cells[col] || '';
            const v = get(row.key, col);
            const text = v !== null ? v : cur;
            if (String(text || '').trim()) {
                blocks.push({ header: row.title, role: row.role, text: String(text), session: col });
            }
        });
        // Row cells for sessions outside known columns (rare) are preserved as-is.
    });
    const rebuilt = buildTaggedAll(blocks);
    // Preserve the original session list even if an edit wiped markers.
    if ((!rebuilt.sessions || !rebuilt.sessions.length) && tagged.sessions) {
        rebuilt.sessions = tagged.sessions;
    }
    return rebuilt;
}

function parsePastedText(raw) {
    const text = cleanText(raw);
    if (!text) return { planText: '', sections: [], sessions: [], coverage: {}, warnings: ['empty_plan'] };
    return buildTagged(splitFlatText(text));
}

async function parseDocxBuffer(buf) {
    let mammoth;
    try {
        mammoth = require('mammoth');
    } catch {
        throw new Error('DOCX parser unavailable. Install mammoth or paste the plan text.');
    }
    const { value: html } = await mammoth.convertToHtml({ buffer: buf });
    const tables = extractHtmlTables(html);
    const flat = stripTags(html);
    if (tables.length) {
        const { blocks, sessionHints } = linearizeTables(tables);
        // Attach non-table prose (header meta) as a leading block.
        const tableText = new Set(blocks.map((b) => b.text));
        const prose = flat.split('\n').map((l) => l.trim()).filter((l) => l && ![...tableText].some((t) => t.includes(l.slice(0, 40)))).join('\n');
        const all = [];
        if (prose.trim()) all.push({ header: 'Plan header', role: 'meta', text: prose.slice(0, 3000), session: null });
        all.push(...blocks);
        const tagged = buildTagged(all);
        sessionHints.forEach((s) => { if (!tagged.sessions.includes(s)) tagged.sessions.push(s); });
        tagged.sessions.sort();
        return { ...tagged, source: 'docx', tableCount: tables.length };
    }
    return { ...parsePastedText(flat), source: 'docx', tableCount: 0 };
}

function parseDocHtml(buffer) {
    const html = buffer.toString('utf8');
    const tables = extractHtmlTables(html);
    const flat = stripTags(html);
    if (tables.length) {
        const { blocks, sessionHints } = linearizeTables(tables);
        const tagged = buildTagged(blocks);
        sessionHints.forEach((s) => { if (!tagged.sessions.includes(s)) tagged.sessions.push(s); });
        tagged.sessions.sort();
        return { ...tagged, source: 'doc-html', tableCount: tables.length };
    }
    return { ...parsePastedText(flat), source: 'doc-html', tableCount: 0 };
}

async function parsePdfBuffer(buf) {
    let pdfMod;
    try {
        pdfMod = require('pdf-parse');
    } catch {
        throw new Error('PDF parser unavailable. Install pdf-parse or paste the plan text.');
    }
    if (!pdfMod || typeof pdfMod.PDFParse !== 'function') {
        throw new Error('PDF parser has unsupported API. Paste the plan text instead.');
    }
    const parser = new pdfMod.PDFParse({ data: buf });
    let tagged;
    try {
        let tableBlocks = [];
        let tableCount = 0;
        try {
            const t = await parser.getTable();
            (t.pages || []).forEach((pg) => {
                (pg.tables || []).forEach((tb) => {
                    if (Array.isArray(tb) && tb.length) {
                        tableCount += 1;
                        tableBlocks.push(tb.map((row) => (Array.isArray(row) ? row.map((c) => cleanText(c)) : [])));
                    }
                });
            });
        } catch {
            tableBlocks = [];
        }
        if (tableBlocks.length) {
            const { blocks, sessionHints } = linearizeTables(tableBlocks);
            tagged = buildTagged(blocks);
            sessionHints.forEach((s) => { if (!tagged.sessions.includes(s)) tagged.sessions.push(s); });
            tagged.sessions.sort();
            tagged = { ...tagged, source: 'pdf-tables', tableCount };
        } else {
            const result = await parser.getText();
            const text = cleanText(result.text || result.total || '');
            tagged = { ...parsePastedText(text), source: 'pdf-text', tableCount: 0 };
        }
    } finally {
        if (typeof parser.destroy === 'function') await parser.destroy().catch(() => {});
    }
    return tagged;
}

function detectKind(originalName, mimetype, buffer) {
    const name = String(originalName || '').toLowerCase();
    const mime = String(mimetype || '').toLowerCase();
    if (name.endsWith('.docx') || mime.includes('officedocument.wordprocessingml')) return 'docx';
    if (name.endsWith('.pdf') || mime === 'application/pdf' || (buffer && buffer.slice(0, 5).toString() === '%PDF-')) return 'pdf';
    const head = buffer ? buffer.slice(0, 200).toString('utf8').toLowerCase() : '';
    if (name.endsWith('.doc') || head.includes('<html')) return 'doc-html';
    if (name.endsWith('.txt') || mime.startsWith('text/')) return 'text';
    // Fallback: sniff content.
    if (buffer && buffer.slice(0, 2).toString() === 'PK') return 'docx';
    if (head.includes('<html')) return 'doc-html';
    return 'text';
}

async function parsePlanFile(buffer, { originalName = '', mimetype = '' } = {}) {
    if (!buffer || !buffer.length) throw new Error('Empty file.');
    if (buffer.length > 8 * 1024 * 1024) throw new Error('File too large (max 8MB).');
    const kind = detectKind(originalName, mimetype, buffer);
    if (kind === 'docx') return parseDocxBuffer(buffer);
    if (kind === 'pdf') return parsePdfBuffer(buffer);
    if (kind === 'doc-html') return parseDocHtml(buffer);
    return { ...parsePastedText(buffer.toString('utf8')), source: 'text', tableCount: 0 };
}

function sanitizePlanText(raw, cap = MAX_CHARS) {
    const t = cleanText(raw).slice(0, cap);
    // Strip control chars except newlines/tabs.
    return t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

module.exports = {
    MAX_CHARS,
    parsePastedText,
    parsePlanFile,
    parseDocxBuffer,
    parsePdfBuffer,
    parseDocHtml,
    sanitizePlanText,
    detectSessions,
    splitFlatText,
    linearizeTables,
    extractHtmlTables,
    buildTagged,
    buildTaggedAll,
    buildEditableGrid,
    gridToTagged
};
