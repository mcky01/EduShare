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

async function checkMail() {
    process.env.OTP_DEV_LOG = 'true';
    await sendMail('nobody@example.com', 'OTP test', 'Your code is 123456');
    console.log('  ✅ PASS: sendMail resolves in dev-log mode');
}
checkSchema().then(() => checkMail()).then(() => process.exit(0)).catch((e) => { console.error('  ❌ FAIL:', e.message); process.exit(1); });
