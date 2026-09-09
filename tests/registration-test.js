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
checkSchema().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
