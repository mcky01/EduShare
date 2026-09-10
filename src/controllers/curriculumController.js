const fs = require('fs');
const path = require('path');
const { query, withTransaction } = require('../config/database');
const { chunkText, quarterToTerm } = require('../services/chunkingService');
const { embedBatch } = require('../services/embeddingService');
const { extractPdfText } = require('../services/pdfTextService');

const VALID_DOC_TYPES = ['CG', 'BOW', 'LE', 'LM'];
const VALID_TERMS = ['T1', 'T2', 'T3'];
const VALID_QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

// Split full-year docs into quarter/term sections so each keeps its own Q/T tags.
// Matches CG "QUARTER N" headers and three-term BOW "First/Second/Third Term" headers.
// No headers found -> single section with the form quarter (single-quarter txt uploads).
function splitByQuarter(text, fallbackQuarter) {
    const hits = [];
    let m;
    const qre = /QUARTER\s+([1-4])/gi;
    while ((m = qre.exec(text)) !== null) hits.push({ quarter: `Q${m[1]}`, term: null, index: m.index });
    const tre = /(FIRST|SECOND|THIRD)\s+TERM\b/gi;
    const tmap = { FIRST: 'T1', SECOND: 'T2', THIRD: 'T3' };
    const qmap = { FIRST: 'Q1', SECOND: 'Q3', THIRD: 'Q4' };
    while ((m = tre.exec(text)) !== null) {
        const key = m[1].toUpperCase();
        hits.push({ quarter: qmap[key], term: tmap[key], index: m.index });
    }
    hits.sort((a, b) => a.index - b.index);
    if (!hits.length) return [{ quarter: fallbackQuarter, term: null, text }];
    const sections = [];
    for (let i = 0; i < hits.length; i++) {
        const start = hits[i].index;
        const end = i + 1 < hits.length ? hits[i + 1].index : text.length;
        const slice = text.slice(start, end).trim();
        if (slice) sections.push({ quarter: hits[i].quarter, term: hits[i].term, text: slice });
    }
    return sections.length ? sections : [{ quarter: fallbackQuarter, term: null, text }];
}

async function ingestDocument(req, res) {
    try {
        const { title, doc_type = 'CG', subject, grade_level, quarter, competency_code, force } = req.body;

        if (!title || !subject || !grade_level) {
            if (req.file) fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: 'title, subject, and grade_level are required.' });
        }
        if (!VALID_DOC_TYPES.includes(doc_type)) {
            if (req.file) fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: 'Invalid doc_type. Use CG, BOW, LE, or LM.' });
        }
        if (quarter && !VALID_QUARTERS.includes(quarter)) {
            if (req.file) fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: 'Invalid quarter. Use Q1-Q4.' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'Curriculum file is required (.txt or text-based .pdf, max 15MB).' });
        }

        // Dedup guard: same doc_type + subject + grade already indexed -> block unless force=1.
        // Title ignored: retitled re-uploads of the same CG bypass title checks and double embedding cost.
        const existing = await query(
            `SELECT id, title, doc_type, subject, grade_level,
                    (SELECT COUNT(*) FROM document_chunks WHERE document_id = curriculum_documents.id) AS chunks
             FROM curriculum_documents
             WHERE doc_type = ? AND subject = ? AND grade_level = ?
             ORDER BY id DESC LIMIT 1`,
            [doc_type, subject, grade_level]
        );
        if (existing.length > 0 && force !== '1' && force !== 1 && force !== true) {
            fs.unlink(req.file.path, () => {});
            return res.status(409).json({
                error: `Already indexed: "${existing[0].title}" (${existing[0].doc_type} ${existing[0].subject} ${existing[0].grade_level}, doc #${existing[0].id}, ${existing[0].chunks} chunks). Tick "Replace existing" to re-ingest a corrected revision.`,
                duplicateOf: existing[0].id
            });
        }
        if (existing.length > 0) {
            await query('DELETE FROM curriculum_documents WHERE id = ?', [existing[0].id]);
        }

        const ext = path.extname(req.file.originalname || req.file.filename || '').toLowerCase();
        const head = (await fs.promises.readFile(req.file.path)).slice(0, 5).toString();
        const isPdfBytes = head === '%PDF-';
        const isPdfNamed = ext === '.pdf' || req.file.mimetype === 'application/pdf';
        if (isPdfNamed !== isPdfBytes) {
            fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: 'File content does not match its extension. Rename correctly and retry.' });
        }
        let rawText = '';
        if (isPdfBytes) {
            try {
                rawText = await extractPdfText(req.file.path);
            } catch (parseErr) {
                fs.unlink(req.file.path, () => {});
                return res.status(400).json({ error: `PDF parse failed: ${parseErr.message}` });
            }
            if (!rawText || rawText.length < 50) {
                fs.unlink(req.file.path, () => {});
                return res.status(400).json({ error: 'PDF has no extractable text (likely scanned images). Upload a .txt version or an OCR text export instead.' });
            }
        } else {
            rawText = await fs.promises.readFile(req.file.path, 'utf8');
        }
        const chunks = chunkText(rawText);
        if (!chunks.length) {
            fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: 'No readable text found in file.' });
        }

        const term = quarterToTerm(quarter || null);
        const docMeta = {
            title: title.trim(),
            doc_type,
            subject,
            grade_level,
            quarter: quarter || null,
            term,
            filename: req.file.filename
        };

        const BATCH = 8;
        const chunkRows = [];
        // Auto-split full-year CGs on QUARTER headers; each section keeps its own Q/T tags.
        // Falls back to the form quarter when no headers found (single-quarter txt).
        const sections = splitByQuarter(rawText, quarter || null);
        let globalIndex = 0;
        for (const sec of sections) {
            const secChunks = chunkText(sec.text);
            const batches = [];
            for (let i = 0; i < secChunks.length; i += BATCH) batches.push(secChunks.slice(i, i + BATCH));
            for (const batch of batches) {
                let vectors = [];
                try {
                    vectors = await embedBatch(batch.map((c) => c.content));
                } catch {
                    vectors = batch.map(() => null);
                }
                for (let j = 0; j < batch.length; j++) {
                    chunkRows.push({
                        chunk_index: globalIndex++,
                        content: batch[j].content,
                        content_hash: batch[j].content_hash,
                        quarter: sec.quarter,
                        term: sec.term || quarterToTerm(sec.quarter),
                        embedding: vectors[j] ? JSON.stringify(vectors[j]) : null
                    });
                }
            }
        }

        const { documentId } = await withTransaction(async (conn) => {
            const [docRes] = await conn.query(
                `INSERT INTO curriculum_documents (title, doc_type, subject, grade_level, quarter, term, file_path, pages, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'indexed')`,
                [docMeta.title, docMeta.doc_type, docMeta.subject, docMeta.grade_level, docMeta.quarter, docMeta.term, docMeta.filename, 1]
            );
            const newId = docRes.insertId;
            for (const c of chunkRows) {
                await conn.query(
                    `INSERT INTO document_chunks (document_id, chunk_index, content, content_hash, competency_code, quarter, term, embedding)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE content = VALUES(content), embedding = VALUES(embedding)`,
                    [newId, c.chunk_index, c.content, c.content_hash, competency_code || null, c.quarter, c.term, c.embedding]
                );
            }
            return { documentId: newId };
        });
        const stored = chunkRows.length;
        const termsCovered = [...new Set(chunkRows.map((c) => c.term).filter(Boolean))];

        await query(
            `INSERT INTO activity_logs (user_id, action, description, category)
             VALUES (?, 'curriculum_ingest', ?, 'admin')`,
            [req.session.user.id, `Ingested ${title.trim()} (${doc_type}): ${stored} chunks, terms ${termsCovered.join('/') || term}`]
        );

        res.json({ success: true, documentId, chunks: stored, term, terms: termsCovered });
    } catch (err) {
        console.error('Curriculum ingest error:', err);
        res.status(500).json({ error: 'Ingestion failed.' });
    }
}

async function listChunks(req, res) {
    try {
        const { document_id, term, competency_code, limit = 20 } = req.query;
        const filters = [];
        const params = [];
        if (document_id) { filters.push('c.document_id = ?'); params.push(parseInt(document_id, 10)); }
        if (term && VALID_TERMS.includes(term)) { filters.push('c.term = ?'); params.push(term); }
        if (competency_code) { filters.push('c.competency_code = ?'); params.push(competency_code); }
        const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
        const rows = await query(
            `SELECT c.id, c.document_id, c.chunk_index, LEFT(c.content, 280) AS preview,
                    c.competency_code, c.quarter, c.term, d.title, d.doc_type
             FROM document_chunks c
             JOIN curriculum_documents d ON d.id = c.document_id
             ${where}
             ORDER BY c.id DESC
             LIMIT ${Math.min(100, Math.max(1, parseInt(limit, 10) || 20))}`,
            params
        );
        res.json({ chunks: rows });
    } catch (err) {
        res.status(500).json({ error: 'Failed to list chunks.' });
    }
}

async function previewSources(req, res) {
    try {
        const retrieval = require('../services/retrievalService');
        const { topic, subject, grade_level, term, competency_code } = req.body;
        const result = await retrieval.retrieve({ topic, subject, grade_level, term, competency_code });
        res.json({
            grounded: result.grounded,
            reason: result.reason,
            sources: retrieval.formatCitations(result.chunks)
        });
    } catch (err) {
        res.status(500).json({ error: 'Source preview failed.' });
    }
}

module.exports = {
    ingestDocument,
    listChunks,
    previewSources
};
