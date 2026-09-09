const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const env = {
    PORT: parseInt(process.env.PORT, 10) || 3000,
    NODE_ENV: process.env.NODE_ENV || 'development',
    IS_DEV: (process.env.NODE_ENV || 'development') === 'development',
    SESSION_SECRET: process.env.SESSION_SECRET || 'edushare2_super_secure_session_secret_zeferino_arroyo_2026',

    // Database
    DB_HOST: process.env.DB_HOST || '127.0.0.1',
    DB_PORT: parseInt(process.env.DB_PORT, 10) || 3306,
    DB_USER: process.env.DB_USER || 'root',
    DB_PASSWORD: process.env.DB_PASSWORD || '',
    DB_NAME: process.env.DB_NAME || 'edushare_db_v2',

    // AI Ollama
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
    AI_TIMEOUT_MS: parseInt(process.env.AI_TIMEOUT_MS, 10) || 120000,

    // School Info
    SCHOOL_NAME: process.env.SCHOOL_NAME || 'Zeferino Arroyo High School',
    SCHOOL_ABBR: process.env.SCHOOL_ABBR || 'ZAHS',
    SCHOOL_MOTTO: process.env.SCHOOL_MOTTO || 'Basta Zeferinian, Magaling Yan!',
    SCHOOL_YEAR: process.env.SCHOOL_YEAR || '2026-2027',
    CURRENT_TERM: process.env.CURRENT_TERM || 'Term 1'
};

module.exports = env;
