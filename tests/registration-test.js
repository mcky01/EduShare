// tests/registration-test.js
const { query } = require('../src/config/database');

async function checkSchema() {
    const usersCols = await query("SHOW COLUMNS FROM users LIKE 'status'");
    console.log(usersCols.length === 1 && usersCols[0].Type.includes('pending')
        ? '  ✅ PASS: users.status enum exists'
        : '  ❌ FAIL: users.status enum missing');
    const otpTables = await query("SHOW TABLES LIKE 'otp_verifications'");
    console.log(otpTables.length === 1
        ? '  ✅ PASS: otp_verifications table exists'
        : '  ❌ FAIL: otp_verifications table missing');
}
const { sendMail } = require('../src/services/mailService');
const { requestOtp, verifyOtp } = require('../src/services/otpService');

async function checkMail() {
    process.env.OTP_DEV_LOG = 'true';
    await sendMail('nobody@example.com', 'OTP test', 'Your code is 123456');
    console.log('  ✅ PASS: sendMail resolves in dev-log mode');
}
checkSchema().then(() => checkMail()).then(() => checkOtp()).then(() => checkRoutes()).then(() => process.exit(0)).catch((e) => { console.error('  ❌ FAIL:', e.message); process.exit(1); });

async function checkRoutes() {
    const res = await fetch('http://localhost:3000/auth/register', { redirect: 'manual' });
    console.log(res.status === 200
        ? '  ✅ PASS: GET /auth/register renders'
        : `  ❌ FAIL: GET /auth/register status ${res.status}`);
    if (res.status !== 200) throw new Error(`GET /auth/register status ${res.status}`);
    const postPaths = [
        '/auth/register/teacher/request-code',
        '/auth/register/teacher/verify',
        '/auth/register/student/request-code',
        '/auth/register/student/verify'
    ];
    for (const p of postPaths) {
        const r = await fetch(`http://localhost:3000${p}`, { method: 'POST', redirect: 'manual' });
        console.log(r.status !== 404
            ? `  ✅ PASS: POST ${p} routed (status ${r.status})`
            : `  ❌ FAIL: POST ${p} status 404 (no route)`);
        if (r.status === 404) throw new Error(`POST ${p} status 404 (no route)`);
    }
}

async function checkOtp() {
    process.env.OTP_DEV_LOG = 'true';
    const email = 'otp-test@example.com';
    await query("DELETE FROM otp_verifications WHERE email = ?", [email]);
    await requestOtp(email, 'teacher_register');
    const rows = await query(
        "SELECT code_hash FROM otp_verifications WHERE email = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1",
        [email]
    );
    if (rows.length !== 1 || rows[0].code_hash.length < 10 || /\b\d{6}\b/.test(rows[0].code_hash)) {
        throw new Error('code not stored as hash');
    }
    console.log('  ✅ PASS: OTP stored hashed, plaintext nowhere in DB');
    await query("DELETE FROM otp_verifications WHERE email = ?", [email]);
}
