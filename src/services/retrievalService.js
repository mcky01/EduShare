const env = require('../config/env');
const { query } = require('../config/database');
const { embed, cosineSimilarity } = require('./embeddingService');

async function retrieve({ topic, subject, grade_level, term, competency_code, topK = env.RAG_TOPK } = {}) {
    if (!topic || !String(topic).trim()) return { chunks: [], grounded: false, reason: 'missing_topic' };

    const filters = [];
    const params = [];
    if (subject) { filters.push('d.subject = ?'); params.push(subject); }
    if (grade_level) { filters.push('d.grade_level = ?'); params.push(grade_level); }
    if (term) { filters.push('c.term = ?'); params.push(term); }
    if (competency_code) { filters.push('c.competency_code = ?'); params.push(competency_code); }
    const where = filters.length ? `AND ${filters.join(' AND ')}` : '';

    let rows = [];
    try {
        rows = await query(
            `SELECT c.id, c.document_id, c.chunk_index, c.content, c.content_hash,
                    c.competency_code, c.quarter, c.term, c.page_ref, c.embedding,
                    d.title, d.doc_type, d.subject, d.grade_level,
                    MATCH(c.content) AGAINST(? IN NATURAL LANGUAGE MODE) AS ft_score
             FROM document_chunks c
             JOIN curriculum_documents d ON d.id = c.document_id
             WHERE MATCH(c.content) AGAINST(? IN NATURAL LANGUAGE MODE) ${where}
             ORDER BY ft_score DESC
             LIMIT ${Math.max(1, parseInt(env.RAG_PREFILTER_LIMIT, 10) || 50)}`,
            [topic, topic, ...params]
        );
    } catch {
        rows = [];
    }

    if (!rows.length) return { chunks: [], grounded: false, reason: 'no_match' };

    let queryVec = null;
    try {
        queryVec = await embed(topic);
    } catch {
        queryVec = null;
    }

    const scored = rows.map((r) => {
        let emb = null;
        try {
            emb = typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding;
        } catch {
            emb = null;
        }
        const cos = queryVec && emb ? cosineSimilarity(queryVec, emb) : null;
        const ft = Number(r.ft_score) || 0;
        return {
            id: r.id,
            document_id: r.document_id,
            chunk_index: r.chunk_index,
            content: r.content,
            content_hash: r.content_hash,
            competency_code: r.competency_code,
            quarter: r.quarter,
            term: r.term,
            page_ref: r.page_ref,
            title: r.title,
            doc_type: r.doc_type,
            subject: r.subject,
            grade_level: r.grade_level,
            ft_score: ft,
            has_embedding: Array.isArray(emb) && emb.length > 0,
            score: cos !== null ? cos : ft
        };
    });

    scored.sort((a, b) => b.score - a.score);
    const k = Math.max(1, parseInt(topK, 10) || env.RAG_TOPK);
    const top = scored.slice(0, k).filter((c) => {
        if (!queryVec) return true;
        if (!c.has_embedding) return c.ft_score > 0;
        return c.score >= env.RAG_MIN_SCORE;
    });
    return {
        chunks: top,
        grounded: top.length > 0,
        reason: top.length > 0 ? (queryVec ? 'reranked' : 'keyword_only') : 'below_threshold'
    };
}

function formatCitations(chunks) {
    return (chunks || []).map((c, i) => ({
        ref: `S${i + 1}`,
        chunk_id: c.id,
        document_id: c.document_id,
        title: c.title,
        doc_type: c.doc_type,
        competency_code: c.competency_code,
        quarter: c.quarter,
        term: c.term,
        page_ref: c.page_ref,
        score: Number(c.score.toFixed(4))
    }));
}

function buildContext(chunks) {
    return (chunks || [])
        .map((c, i) => `[S${i + 1}] (${c.doc_type} ${c.quarter}/${c.term}${c.page_ref ? ` ${c.page_ref}` : ''}${c.competency_code ? ` ${c.competency_code}` : ''}) ${c.content}`)
        .join('\n\n');
}

module.exports = {
    retrieve,
    formatCitations,
    buildContext
};
