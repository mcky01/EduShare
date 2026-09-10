const crypto = require('crypto');
const env = require('../config/env');

const CHUNK_SIZE = 600;
const CHUNK_OVERLAP = 100;

function normalize(text) {
    return (text || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function chunkText(text, { size = CHUNK_SIZE, overlap = CHUNK_OVERLAP } = {}) {
    const clean = normalize(text);
    if (!clean) return [];
    const chunks = [];
    let start = 0;
    while (start < clean.length) {
        const end = Math.min(start + size, clean.length);
        const slice = clean.slice(start, end).trim();
        if (slice) {
            chunks.push({
                chunk_index: chunks.length,
                content: slice,
                content_hash: crypto.createHash('sha256').update(slice).digest('hex')
            });
        }
        if (end >= clean.length) break;
        start = end - overlap;
    }
    return chunks;
}

function quarterToTerm(quarter) {
    if (quarter === 'Q3') return 'T2';
    if (quarter === 'Q4') return 'T3';
    return 'T1';
}

module.exports = {
    chunkText,
    quarterToTerm,
    CHUNK_SIZE,
    CHUNK_OVERLAP
};
