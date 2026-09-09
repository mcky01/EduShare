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
checkSchema().then(() => checkMail()).then(() => checkOtp()).then(() => process.exit(0)).catch((e) => { console.error('  ❌ FAIL:', e.message); process.exit(1); });

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
