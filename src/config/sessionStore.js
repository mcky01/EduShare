const session = require('express-session');
const { query } = require('./database');

const DEFAULT_MAX_AGE = 24 * 60 * 60 * 1000; // 24h fallback (branding middleware overrides from settings)
const PRUNE_INTERVAL_MS = 15 * 60 * 1000;

// Phase 7: minimal MySQL session store. No new infra — reuses existing mysql2 pool via query().
// Table: sessions (session_id VARCHAR(128) PK, expires BIGINT, data MEDIUMTEXT).
const CREATE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS \`sessions\` (
        \`session_id\` VARCHAR(128) NOT NULL PRIMARY KEY,
        \`expires\` BIGINT NOT NULL,
        \`data\` MEDIUMTEXT,
        INDEX \`idx_sessions_expires\` (\`expires\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

let initPromise = null;
function ensureTable() {
    if (!initPromise) {
        initPromise = query(CREATE_TABLE_SQL).catch((err) => {
            // Retry on next operation; never crash boot on session-table failure.
            initPromise = null;
            console.error('[sessionStore] failed to ensure sessions table:', err.message || err);
        });
    }
    return initPromise;
}

// Create table IF NOT EXISTS on init (fire-and-forget, uses existing query() helper).
ensureTable();
// Periodic prune of expired rows; unref so it never keeps the process alive.
const pruneTimer = setInterval(async () => {
    try {
        await ensureTable();
        await query('DELETE FROM `sessions` WHERE `expires` < ?', [Date.now()]);
    } catch {
        // Best-effort only.
    }
}, PRUNE_INTERVAL_MS);
if (pruneTimer && typeof pruneTimer.unref === 'function') pruneTimer.unref();

function getMaxAge(sess) {
    const maxAge = sess && sess.cookie && Number(sess.cookie.maxAge);
    if (Number.isFinite(maxAge) && maxAge > 0) return Math.floor(maxAge);
    return DEFAULT_MAX_AGE;
}

class MySQLSessionStore extends session.Store {
    get(sid, cb) {
        ensureTable()
            .then(() => query('SELECT `data`, `expires` FROM `sessions` WHERE `session_id` = ? LIMIT 1', [sid]))
            .then((rows) => {
                if (!rows || rows.length === 0) return cb(null, null);
                const row = rows[0];
                if (Number(row.expires) < Date.now()) {
                    // Lazy-expire: remove stale row, report miss.
                    query('DELETE FROM `sessions` WHERE `session_id` = ?', [sid]).catch(() => {});
                    return cb(null, null);
                }
                try {
                    const sess = JSON.parse(row.data);
                    return cb(null, sess);
                } catch (err) {
                    return cb(err);
                }
            })
            .catch((err) => cb(err));
    }

    set(sid, sess, cb) {
        const expires = Date.now() + getMaxAge(sess);
        let data;
        try {
            data = JSON.stringify(sess);
        } catch (err) {
            if (cb) return cb(err);
            return;
        }
        ensureTable()
            .then(() =>
                query(
                    'INSERT INTO `sessions` (`session_id`, `expires`, `data`) VALUES (?, ?, ?) ' +
                        'ON DUPLICATE KEY UPDATE `expires` = VALUES(`expires`), `data` = VALUES(`data`)',
                    [sid, expires, data]
                )
            )
            .then(() => cb && cb(null))
            .catch((err) => cb && cb(err));
    }

    destroy(sid, cb) {
        ensureTable()
            .then(() => query('DELETE FROM `sessions` WHERE `session_id` = ?', [sid]))
            .then(() => cb && cb(null))
            .catch((err) => cb && cb(err));
    }

    touch(sid, sess, cb) {
        const expires = Date.now() + getMaxAge(sess);
        ensureTable()
            .then(() => query('UPDATE `sessions` SET `expires` = ? WHERE `session_id` = ?', [expires, sid]))
            .then(() => cb && cb(null))
            .catch((err) => cb && cb(err));
    }

    // Optional helpers (express-session may call these for admin tooling).
    all(cb) {
        ensureTable()
            .then(() => query('SELECT `data`, `expires` FROM `sessions` WHERE `expires` >= ?', [Date.now()]))
            .then((rows) => {
                const out = [];
                for (const r of rows || []) {
                    try {
                        out.push(JSON.parse(r.data));
                    } catch {
                        // Skip corrupt rows.
                    }
                }
                cb(null, out);
            })
            .catch((err) => cb(err));
    }

    clear(cb) {
        ensureTable()
            .then(() => query('DELETE FROM `sessions`'))
            .then(() => cb && cb(null))
            .catch((err) => cb && cb(err));
    }

    length(cb) {
        ensureTable()
            .then(() => query('SELECT COUNT(*) AS c FROM `sessions` WHERE `expires` >= ?', [Date.now()]))
            .then((rows) => cb(null, rows && rows[0] ? Number(rows[0].c) : 0))
            .catch((err) => cb(err));
    }
}

module.exports = new MySQLSessionStore();
module.exports.MySQLSessionStore = MySQLSessionStore;
module.exports.ensureSessionTable = ensureTable;
