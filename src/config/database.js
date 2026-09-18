const mysql = require('mysql2/promise');
const env = require('./env');

let pool = null;

function getPool() {
    if (!pool) {
        pool = mysql.createPool({
            host: env.DB_HOST,
            port: env.DB_PORT,
            user: env.DB_USER,
            password: env.DB_PASSWORD,
            database: env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 15,
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 10000,
            charset: 'utf8mb4',
            timezone: 'Z',
            dateStrings: true
        });

        // Catch idle connection drops, sleep/wake network resets, and wait_timeout
        pool.on('error', (err) => {
            console.error('⚠️ [EduShare] MySQL pool connection error (handled):', err.message || err);
            if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
                pool = null; // Recreate pool on next query
            }
        });
    }
    return pool;
}

async function query(sql, params = []) {
    const p = getPool();
    const [rows, fields] = await p.execute(sql, params);
    return rows;
}

async function withTransaction(callback) {
    const p = getPool();
    const conn = await p.getConnection();
    try {
        await conn.beginTransaction();
        const result = await callback(conn);
        await conn.commit();
        return result;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = {
    getPool,
    query,
    withTransaction
};
