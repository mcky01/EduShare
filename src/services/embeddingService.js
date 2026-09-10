const env = require('../config/env');

async function embed(text) {
    const vectors = await embedBatch([text]);
    return vectors[0];
}

async function embedBatch(texts) {
    const clean = (texts || []).map((t) => (t || '').slice(0, 2000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);
    try {
        const res = await fetch(`${env.OLLAMA_BASE_URL}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: env.OLLAMA_EMBED_MODEL, input: clean }),
            signal: controller.signal
        });
        if (!res.ok) throw new Error(`Ollama embed failed: ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data.embeddings) || data.embeddings.length !== clean.length) {
            throw new Error('Ollama embed returned unexpected shape');
        }
        return data.embeddings;
    } finally {
        clearTimeout(timer);
    }
}

function cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = {
    embed,
    embedBatch,
    cosineSimilarity
};
