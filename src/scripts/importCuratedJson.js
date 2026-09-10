// Bulk import curated competency JSON into RAG corpus.
// Usage: node src/scripts/importCuratedJson.js "../Resources/CG English 7.json" CG "English 7 CG (curated)"
// Creates one curriculum_documents row + one tagged document_chunks row per entry.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { query, withTransaction } = require('../config/database');
const { embedBatch } = require('../services/embeddingService');
const { quarterToTerm } = require('../services/chunkingService');

const VALID_QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

async function main() {
    const [jsonPath, docType = 'CG', docTitle] = process.argv.slice(2);
    if (!jsonPath) {
        console.error('Usage: node src/scripts/importCuratedJson.js <json-file> [doc_type] [title]');
        process.exit(1);
    }
    const abs = path.isAbsolute(jsonPath) ? jsonPath : path.join(process.cwd(), jsonPath);
    const entries = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (!Array.isArray(entries) || !entries.length) throw new Error('JSON must be a non-empty array.');

    for (const [i, e] of entries.entries()) {
        if (!e.competency_code || !e.content || !e.subject || !e.grade_level) {
            throw new Error(`Row ${i} missing competency_code/content/subject/grade_level.`);
        }
        if (e.quarter && !VALID_QUARTERS.includes(e.quarter)) {
            throw new Error(`Row ${i} has invalid quarter ${e.quarter}.`);
        }
    }

    const title = docTitle || `${entries[0].subject} curated (${entries.length} competencies)`;
    const subject = entries[0].subject;
    const grade = entries[0].grade_level;

    const BATCH = 8;
    const vectors = new Map();
    for (let i = 0; i < entries.length; i += BATCH) {
        const batch = entries.slice(i, i + BATCH);
        let vecs;
        try {
            vecs = await embedBatch(batch.map((e) => e.content));
        } catch (err) {
            console.warn(`Embed batch ${i} failed, storing NULL embeddings: ${err.message}`);
            vecs = batch.map(() => null);
        }
        batch.forEach((e, j) => vectors.set(e.competency_code, vecs[j] ? JSON.stringify(vecs[j]) : null));
    }

    const { documentId } = await withTransaction(async (conn) => {
        const [docRes] = await conn.query(
            `INSERT INTO curriculum_documents (title, doc_type, subject, grade_level, quarter, term, pages, status)
             VALUES (?, ?, ?, ?, NULL, NULL, 1, 'indexed')`,
            [title, docType, subject, grade]
        );
        const newId = docRes.insertId;
        let idx = 0;
        for (const e of entries) {
            const term = quarterToTerm(e.quarter || null);
            if (e.quarter) {
                await conn.query(
                    `INSERT INTO competencies (code, description, subject, grade_level, quarter, term, source_version)
                     VALUES (?, ?, ?, ?, ?, ?, 'curated import')
                     ON DUPLICATE KEY UPDATE description = VALUES(description), quarter = VALUES(quarter), term = VALUES(term)`,
                    [e.competency_code, e.content.slice(0, 400), e.subject, e.grade_level, e.quarter, term]
                );
            }
            await conn.query(
                `INSERT INTO document_chunks (document_id, chunk_index, content, content_hash, competency_code, quarter, term, page_ref, embedding)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    newId,
                    idx++,
                    e.content,
                    crypto.createHash('sha256').update(e.content).digest('hex'),
                    e.competency_code,
                    e.quarter || null,
                    term,
                    e.source_ref || null,
                    vectors.get(e.competency_code)
                ]
            );
        }
        return { documentId: newId };
    });

    console.log(`Imported ${entries.length} chunks as doc #${documentId} (${title}).`);
}

main().catch((err) => { console.error('Import failed:', err.message); process.exit(1); });
