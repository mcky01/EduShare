const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { query } = require('../config/database');
const { sendMail } = require('./mailService');

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_REQUESTS_PER_WINDOW = 3;

class RateLimited extends Error {}
class InvalidCode extends Error {}
class ExpiredOrMissing extends Error {}

function normalizeEmail(raw) {
    return String(raw || '').trim().toLowerCase();
}

async function requestOtp(emailRaw, purpose) {
    const email = normalizeEmail(emailRaw);
    if (!email.includes('@')) throw new InvalidCode('Invalid email.');
    if (!['teacher_register', 'student_register'].includes(purpose)) throw new Error('Invalid OTP purpose.');
    const recent = await query(
        `SELECT COUNT(*) AS n FROM otp_verifications
         WHERE email = ? AND purpose = ? AND consumed_at IS NULL AND created_at > (NOW() - INTERVAL 10 MINUTE)`,
        [email, purpose]
    );
    if (recent[0].n >= OTP_MAX_REQUESTS_PER_WINDOW) throw new RateLimited('Too many codes requested. Try again later.');
    await query(`DELETE FROM otp_verifications WHERE email = ? AND purpose = ? AND consumed_at IS NULL`, [email, purpose]);
    const code = String(crypto.randomInt(100000, 999999));
    const codeHash = await bcrypt.hash(code, 10);
    await query(
        `INSERT INTO otp_verifications (email, code_hash, purpose, expires_at)
         VALUES (?, ?, ?, NOW() + INTERVAL ${OTP_TTL_MINUTES} MINUTE)`,
        [email, codeHash, purpose]
    );
    await sendMail(email, 'Your EduShare verification code', `Your EduShare verification code is: ${code} (expires in 10 minutes. Do not share it.)`);
    return { ok: true };
}

async function verifyOtp(emailRaw, purpose, codeRaw) {
    const email = normalizeEmail(emailRaw);
    const code = String(codeRaw || '').trim();
    const rows = await query(
        `SELECT * FROM otp_verifications
         WHERE email = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > NOW()
         ORDER BY id DESC LIMIT 1`,
        [email, purpose]
    );
    if (rows.length === 0) throw new ExpiredOrMissing('Code expired or not found.');
    const row = rows[0];
    const match = await bcrypt.compare(code, row.code_hash);
    const attempts = row.attempts + 1;
    if (!match) {
        if (attempts >= OTP_MAX_ATTEMPTS) {
            await query(`UPDATE otp_verifications SET attempts = ?, consumed_at = NOW() WHERE id = ?`, [attempts, row.id]);
        } else {
            await query(`UPDATE otp_verifications SET attempts = ? WHERE id = ?`, [attempts, row.id]);
        }
        throw new InvalidCode('Incorrect code.');
    }
    await query(`UPDATE otp_verifications SET attempts = ?, consumed_at = NOW() WHERE id = ?`, [attempts, row.id]);
    return { ok: true };
}

module.exports = { requestOtp, verifyOtp, RateLimited, InvalidCode, ExpiredOrMissing, OTP_TTL_MINUTES, OTP_MAX_ATTEMPTS };
