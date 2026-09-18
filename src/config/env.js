const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const env = {
    PORT: parseInt(process.env.PORT, 10) || 3000,
    NODE_ENV: process.env.NODE_ENV || 'development',
    IS_DEV: (process.env.NODE_ENV || 'development') === 'development',
    SESSION_SECRET: (() => {
        if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
            throw new Error('SESSION_SECRET missing. Set SESSION_SECRET env var in production.');
        }
        if (!process.env.SESSION_SECRET) {
            console.warn('[EduShare] SESSION_SECRET not set. Using dev-only fallback. Do not use in production.');
            return 'dev-only-session-secret-change-me';
        }
        return process.env.SESSION_SECRET;
    })(),

    // Database
    DB_HOST: process.env.DB_HOST || '127.0.0.1',
    DB_PORT: parseInt(process.env.DB_PORT, 10) || 3306,
    DB_USER: process.env.DB_USER || 'root',
    DB_PASSWORD: process.env.DB_PASSWORD || '',
    DB_NAME: process.env.DB_NAME || 'edushare_db_v2',

    // AI Ollama (local fallback chain)
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
    AI_TIMEOUT_MS: parseInt(process.env.AI_TIMEOUT_MS, 10) || 120000,

    // AI 9Router (OpenAI-compatible cloud gateway; primary when configured).
    // Verified 2026-09-13: only oc/nemotron-3-ultra-free answers on this box
    // (muse-spark returns empty content; all nvidia/* models are dead/EOL).
    NINE_ROUTER_BASE_URL: process.env.NINE_ROUTER_BASE_URL || '',
    NINE_ROUTER_API_KEY: process.env.NINE_ROUTER_API_KEY || '',
    NINE_ROUTER_MODEL: process.env.NINE_ROUTER_MODEL || 'oc/nemotron-3-ultra-free',
    NINE_ROUTER_TIMEOUT_MS: parseInt(process.env.NINE_ROUTER_TIMEOUT_MS, 10) || 90000,
    AI_PRIMARY: (process.env.AI_PRIMARY || 'nine_router').toLowerCase(),

    // RAG (zero-cost local: Ollama embeddings + MySQL FULLTEXT + Node cosine rerank)
    OLLAMA_EMBED_MODEL: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
    RAG_TOPK: parseInt(process.env.RAG_TOPK, 10) || 6,
    RAG_PREFILTER_LIMIT: parseInt(process.env.RAG_PREFILTER_LIMIT, 10) || 50,
    RAG_MIN_SCORE: (() => { const v = parseFloat(process.env.RAG_MIN_SCORE); return Number.isNaN(v) ? 0.35 : v; })(),

    // School Info
    SCHOOL_NAME: process.env.SCHOOL_NAME || 'Zeferino Arroyo High School',
    SCHOOL_ABBR: process.env.SCHOOL_ABBR || 'ZAHS',
    SCHOOL_MOTTO: process.env.SCHOOL_MOTTO || 'Basta Zeferinian, Magaling Yan!',
    SCHOOL_YEAR: process.env.SCHOOL_YEAR || '2026-2027',
    CURRENT_TERM: process.env.CURRENT_TERM || 'Term 1',

    // Mail (Gmail SMTP)
    SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
    SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 587,
    SMTP_USER: process.env.SMTP_USER || '',
    SMTP_PASS: process.env.SMTP_PASS || '',
    MAIL_FROM: process.env.MAIL_FROM || process.env.SMTP_USER || 'EduShare <noreply@zahs.edu.ph>',
    OTP_DEV_LOG: process.env.OTP_DEV_LOG === 'true',
};

module.exports = env;
