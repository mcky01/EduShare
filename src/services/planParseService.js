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
const ROLE_PATTERNS = [
    { role: 'intentions', patterns: [/^\s*intentions?\b/i, /learning\s+competency/i, /content\s+standards?/i, /performance\s+standards?/i, /learning\s+objectives?/i, /^\s*objectives?\b/i] },
    { role: 'experiences', patterns: [/learning\s+experiences?/i, /pre-?lesson/i, /flow\s*:/i, /concept\s+building/i, /active\s+(retrieval|learning)/i, /social\s+learning/i, /checks?\s+for\s+understanding/i, /learning\s+resources?/i, /opportunit\w*\s+for\s+integration/i, /^\s*procedure\b/i, /^\s*lesson\s+proper/i] },
    { role: 'assessment', patterns: [/^\s*assessments?\.?$/i, /assessments?\s+reveal/i, /formative\s+assessment/i, /summative/i, /^\s*evaluation\b/i] },
    { role: 'ways', patterns: [/ways\s+forward/i, /extended\s+learning/i, /^\s*reflections?\s*:/i, /^\s*assignment\b/i, /^\s*remarks?\b/i, /enrichment|remediation/i] }
];

const SESSION_RE = /session\s*(\d)/gi;
const MAX_SESSIONS = 5;

function cleanText(s) {
    return String(s || '')
        .replace(/\r/g, '\n')
        .replace(/[ \t\u00a0]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function detectRole(headerLine) {
    const h = String(headerLine || '').trim();
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
    for (const rows of tables) {
        const colSession = findSessionHeader(rows) || [];
        const hasSessionCols = colSession.some(Boolean);
        rows.forEach((cells, ri) => {
            const label = (cells[0] || '').slice(0, 80);
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
    'assessment', 'assessments', 'ways forward', 'reflections',
    'learning objectives', 'objectives', 'procedure', 'lesson proper',
    'learning competency', 'content standard', 'performance standard',
    'learning resources', 'opportunities for integration', 'extended learning'
];

function splitFlatText(text) {
    const lines = String(text || '').split('\n');
    const blocks = [];
    let cur = { header: 'Plan header', role: 'meta', text: '' };
    const isHeader = (line) => {
        const l = line.trim().toLowerCase().replace(/[:.\s]+$/, '');
        if (l.length > 60) return false;
        return SECTION_HEADERS.some((h) => l === h || l.startsWith(h + ' ') || l.startsWith(h + ':'));
    };
    for (const line of lines) {
        if (isHeader(line) && cur.text.trim().length > 0) {
            blocks.push(cur);
            cur = { header: line.trim().slice(0, 80), role: detectRole(line) || 'other', text: '' };
        } else {
            if (!cur.role || cur.role === 'meta') {
                const r = detectRole(line);
                if (r && line.trim().length < 80) {
                    if (cur.text.trim().length > 0) blocks.push(cur);
                    cur = { header: line.trim().slice(0, 80), role: r, text: '' };
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
    for (const b of blocks) {
        const text = cleanText(b.text);
        if (!text || text.length < 2) continue;
        n += 1;
        sections.push({
            ref: `P${n}`,
            role: b.role || 'other',
            title: (b.header || '').slice(0, 80),
            text: text.slice(0, 6000),
            sessions: b.session ? [b.session] : sessionsInBlock(`${b.header || ''}\n${text}`)
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
// {
//   columns: ['S1','S2',...],
//   shared: [{ key, title, text }],          // header/meta, shown once
//   rows: [{ key, title, role, cells: { S1, S2, ... }, shared: '' }],
//   cellRefs: { rowKey: { S1: 'P12', ... } } // traceability back to sections
// }
function buildEditableGrid(tagged) {
    const sections = (tagged && tagged.sections) || [];
    const columns = [...(tagged.sessions || [])].sort().slice(0, 5);
    // Normalize row keys: strip trailing session markers, collapse whitespace.
    const rowKey = (s) => String(s.title || 'Section').replace(/\s+/g, ' ').trim().slice(0, 80)
        .replace(/\s*[·•|-]\s*S[1-5](\/S[1-5])*$/i, '');
    const groups = new Map();
    const order = [];
    const shared = [];
    for (const s of sections) {
        const sess = s.sessions || [];
        if (sess.length === 0) {
            shared.push({ key: `shared-${shared.length}`, title: s.title, text: s.text, ref: s.ref });
            continue;
        }
        const key = `${s.role || 'other'}::${rowKey(s)}`;
        if (!groups.has(key)) {
            groups.set(key, { key, title: rowKey(s), role: s.role || 'other', cells: {}, refs: {} });
            order.push(key);
        }
        const g = groups.get(key);
        for (const col of sess) {
            if (!columns.includes(col)) continue;
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
        if (String(v || '').trim()) blocks.push({ header: sh.title, role: 'meta', text: String(v), session: null });
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
