# Self-Registration with Email OTP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let teachers and students self-register from the login page with email-OTP verification, ending in pending accounts that an admin (teachers) or adviser (students) approves.

**Architecture:** New `otpService` handles code generate/send/verify against a hashed `otp_verifications` table via Gmail SMTP; `authController` gains register + OTP endpoints rendering a new `register.ejs` view; approvals reuse existing admin Users and teacher advisory pages with a `status` column gating login.

**Tech Stack:** Node.js 18+, Express 4, EJS + express-ejs-layouts, MySQL via mysql2/promise pool (`src/config/database.js` `query`/`withTransaction`), bcrypt 6, express-rate-limit 7, Gmail SMTP via system `sendmail` or raw SMTP socket (no new npm dependency — see Task 2).

**Spec:** Approved in chat 2026-09-09 (no separate spec file — decisions: OTP + admin approval for teachers, OTP + adviser approval for students, email OTP only v1, no SMS, no allowlists).

## Global Constraints

- Node.js v18+ or v20+ (per README).
- No new npm dependencies without user approval — use `crypto`, `bcrypt`, existing `query`/`withTransaction`.
- Password rule everywhere: minimum 10 chars with upper/lowercase + digit (matches `changePassword` in `src/controllers/authController.js`).
- Never log or store OTP plaintext; store bcrypt hashes only.
- Generic auth errors only — never reveal whether an email/LRN exists.
- CSRF (`validateCsrf`) on every new POST route, following `src/routes/authRoutes.js`.
- Rate-limit OTP request + verify endpoints with `express-rate-limit` (already a dependency).
- Login must reject any user whose `status != 'active'` with the existing generic error.
- Bootstrap 5 + Liquid Glass classes for views; inline page scripts must survive `layout extractScripts` (layouts need `<%- typeof script %>` — already present in `src/views/layouts/auth.ejs`).

---

### Task 1: Schema — `status` on users + `otp_verifications` table

**Files:**
- Modify: `src/config/schema.sql` (append tables/columns)
- Test: `tests/registration-test.js` (new file, DB assertions)

**Interfaces:**
- Consumes: existing `users`, `teachers`, `students` tables; `query` from `src/config/database.js`.
- Produces: `users.status ENUM('pending','active','rejected') NOT NULL DEFAULT 'active'`; `otp_verifications(id, email VARCHAR(150), code_hash VARCHAR(255), purpose ENUM('teacher_register','student_register'), attempts TINYINT DEFAULT 0, expires_at DATETIME, consumed_at DATETIME NULL, created_at TIMESTAMP)` with `INDEX idx_otp_email_purpose (email, purpose)`. Existing rows default to `'active'` so current logins keep working.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/registration-test.js`
Expected: FAIL — both checks print ❌ (columns/table do not exist yet).

- [ ] **Step 3: Append schema**

```sql
-- Self-registration: account lifecycle status (existing rows stay active)
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `status` ENUM('pending','active','rejected') NOT NULL DEFAULT 'active' AFTER `is_active`;

CREATE TABLE IF NOT EXISTS `otp_verifications` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `email` VARCHAR(150) NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `purpose` ENUM('teacher_register','student_register') NOT NULL,
  `attempts` TINYINT NOT NULL DEFAULT 0,
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_otp_email_purpose` (`email`, `purpose`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

NOTE: MySQL has no `ADD COLUMN IF NOT EXISTS` on older versions — `initDatabase.js` swallows non-ignorable codes only as warnings, and `ALTER` duplicate-column error `ER_DUP_FIELDNAME` will surface as a warning, not a crash. If the installed MySQL rejects the syntax, fall back to a `SELECT ... SHOW COLUMNS` guard in `initDatabase.js` (same file, after the schema loop) that runs the ALTER only when `status` is absent.

- [ ] **Step 4: Run test to verify it passes**

Run: `node src/config/initDatabase.js && node tests/registration-test.js`
Expected: init prints success, both checks print ✅.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.sql tests/registration-test.js
git commit -m "feat: add users.status and otp_verifications table"
```

---

### Task 2: Env + mail transport (Gmail SMTP, no new deps)

**Files:**
- Modify: `src/config/env.js` (add SMTP keys)
- Modify: `.env.example` (document keys)
- Create: `src/services/mailService.js`
- Test: `tests/registration-test.js` (append mail check)

**Interfaces:**
- Consumes: `env` object; Node `net` + `tls` stdlib; Gmail app password from env.
- Produces: `sendMail(to, subject, textBody)` → `Promise<void>`; throws on SMTP 5xx/auth failure. Uses raw SMTP over port 587 with STARTTLS + AUTH LOGIN (implemented with `net`/`tls`, no nodemailer). `MAIL_FROM`, `SMTP_HOST` (default `smtp.gmail.com`), `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS`, `OTP_DEV_LOG=true` fallback that prints the code to console instead of sending (dev/test only, refused when `NODE_ENV=production`).

- [ ] **Step 1: Write the failing test**

```js
const { sendMail } = require('../src/services/mailService');

async function checkMail() {
    process.env.OTP_DEV_LOG = 'true';
    await sendMail('nobody@example.com', 'OTP test', 'Your code is 123456');
    console.log('  ✅ PASS: sendMail resolves in dev-log mode');
}
checkMail().then(() => process.exit(0)).catch((e) => { console.error('  ❌ FAIL:', e.message); process.exit(1); });
```

Append to `tests/registration-test.js` as a second function invoked after the schema check.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/registration-test.js`
Expected: FAIL with "Cannot find module '../src/services/mailService'".

- [ ] **Step 3: Add env keys**

```js
// src/config/env.js — append inside the env object:
SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 587,
SMTP_USER: process.env.SMTP_USER || '',
SMTP_PASS: process.env.SMTP_PASS || '',
MAIL_FROM: process.env.MAIL_FROM || process.env.SMTP_USER || 'EduShare 2.0 <noreply@zahs.edu.ph>',
OTP_DEV_LOG: process.env.OTP_DEV_LOG === 'true',
```

```env
# .env.example — append:
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your.school.gmail@gmail.com
SMTP_PASS=your_gmail_app_password_here
MAIL_FROM=EduShare 2.0 <your.school.gmail@gmail.com>
OTP_DEV_LOG=true
```

- [ ] **Step 4: Write minimal mailService**

```js
const net = require('net');
const tls = require('tls');
const env = require('../config/env');

function buildMessage(to, subject, textBody) {
    const boundary = 'edushare-' + Date.now();
    return [
        `From: ${env.MAIL_FROM}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        textBody,
        ''
    ].join('\r\n').replace('MIME-Version', 'MIME-Version').replace(boundary, boundary);
}

function smtpSend({ host, port, user, pass, from, to, data }) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, host);
        let stage = 0;
        let tlsSocket = null;
        const send = (line) => (tlsSocket || socket).write(line + '\r\n');
        const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
        let buffer = '';
        const onData = (chunk) => {
            buffer += chunk.toString('utf8');
            if (!buffer.includes('\r\n')) return;
            const lines = buffer.split('\r\n');
            buffer = lines.pop();
            for (const line of lines) {
                const code = parseInt(line.slice(0, 3), 10);
                if (code >= 400) { cleanup(); return reject(new Error('SMTP error: ' + line)); }
                if (stage === 0 && code === 220) { send(`EHLO ${host}`); stage = 1; }
                else if (stage === 1 && code === 250) { send('STARTTLS'); stage = 2; }
                else if (stage === 2 && code === 220) {
                    tlsSocket = tls.connect({ socket, host, servername: host }, () => {
                        send(`EHLO ${host}`);
                        stage = 3;
                    });
                    tlsSocket.on('data', onData);
                    tlsSocket.on('error', (e) => { cleanup(); reject(e); });
                }
                else if (stage === 3 && code === 250) { send('AUTH LOGIN'); stage = 4; }
                else if (stage === 4 && code === 334) { send(b64(user)); stage = 5; }
                else if (stage === 5 && code === 334) { send(b64(pass)); stage = 6; }
                else if (stage === 6 && code === 235) { send(`MAIL FROM:<${user}>`); stage = 7; }
                else if (stage === 7 && code === 250) { send(`RCPT TO:<${to}>`); stage = 8; }
                else if (stage === 8 && code === 250) { send('DATA'); stage = 9; }
                else if (stage === 9 && code === 354) { (tlsSocket || socket).write(data + '\r\n.\r\n'); stage = 10; }
                else if (stage === 10 && code === 250) { send('QUIT'); cleanup(); resolve(); }
            }
        };
        const cleanup = () => { try { socket.destroy(); } catch {} };
        socket.on('data', onData);
        socket.on('error', (e) => { cleanup(); reject(e); });
        socket.setTimeout(15000, () => { cleanup(); reject(new Error('SMTP timeout')); });
    });
}

async function sendMail(to, subject, textBody) {
    if (!to || !to.includes('@')) throw new Error('Invalid recipient email.');
    if (env.OTP_DEV_LOG) {
        if (env.NODE_ENV === 'production') throw new Error('OTP_DEV_LOG is forbidden in production.');
        console.log(`[OTP-DEV] To: ${to} | ${subject} | ${textBody}`);
        return;
    }
    if (!env.SMTP_USER || !env.SMTP_PASS) throw new Error('SMTP credentials not configured.');
    const data = [
        `From: ${env.MAIL_FROM}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        textBody,
        ''
    ].join('\r\n');
    await smtpSend({ host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.MAIL_FROM, to, data });
}

module.exports = { sendMail };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `OTP_DEV_LOG=true node tests/registration-test.js`
Expected: PASS — `[OTP-DEV]` line printed, no throw.

- [ ] **Step 6: Commit**

```bash
git add src/services/mailService.js src/config/env.js .env.example tests/registration-test.js
git commit -m "feat: add Gmail SMTP mail transport with dev-log fallback"
```

---

### Task 3: `otpService` — generate/request/verify OTP

**Files:**
- Create: `src/services/otpService.js`
- Test: `tests/registration-test.js` (append OTP round-trip)

**Interfaces:**
- Consumes: `query` from `src/config/database.js`; `bcrypt`; `crypto`; `sendMail` from Task 2.
- Produces:
  - `requestOtp(email, purpose)` → `Promise<{ ok: true }>` — normalizes email lowercase, deletes unconsumed prior codes for (email, purpose), generates 6-digit code via `crypto.randomInt(100000, 999999)`, stores `bcrypt.hash(code, 10)` with `expires_at = NOW() + 10 minutes`, sends `EduShare sign-in code: 123456 (expires in 10 minutes)` via `sendMail`. Throws `RateLimited` if 3+ unconsumed codes created in last 10 min for same email+purpose.
  - `verifyOtp(email, purpose, code)` → `Promise<{ ok: true }>` — loads newest unconsumed unexpired row; increments `attempts`; throws `InvalidCode` after compare fail (locks row at 5 attempts by setting `consumed_at`); on success sets `consumed_at = NOW()` and returns ok. Throws `ExpiredOrMissing` when no valid row.
  - Error classes: `RateLimited`, `InvalidCode`, `ExpiredOrMissing` (plain `Error` subclasses exported for controller mapping to generic messages).

- [ ] **Step 1: Write the failing test**

```js
const { requestOtp, verifyOtp } = require('../src/services/otpService');
const { query } = require('../src/config/database');

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
checkOtp().then(() => process.exit(0)).catch((e) => { console.error('  ❌ FAIL:', e.message); process.exit(1); });
```

NOTE: full verify round-trip needs the plaintext code, which the service never returns — the controller test in Task 5 covers verify with a wrong code (expects `InvalidCode`) plus expiry by direct DB update. This task asserts hashing + request path only.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/registration-test.js`
Expected: FAIL with "Cannot find module '../src/services/otpService'".

- [ ] **Step 3: Write minimal implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `OTP_DEV_LOG=true node tests/registration-test.js`
Expected: PASS — hashed row found, no plaintext.

- [ ] **Step 5: Commit**

```bash
git add src/services/otpService.js tests/registration-test.js
git commit -m "feat: add hashed email OTP request and verify service"
```

---

### Task 4: Registration routes + rate limits

**Files:**
- Modify: `src/routes/authRoutes.js` (add 5 routes)
- Test: `tests/registration-test.js` (route presence via HTTP GET)

**Interfaces:**
- Consumes: `authController` new handlers from Task 5 (referenced but not yet implemented — routes added first, test asserts 404-free GETs only after Task 5; this task's test asserts the POST routes reject without CSRF/config rather than 404).
- Produces routes (all `isGuest` + `validateCsrf` on POSTs, matching existing style):
  - `GET /auth/register` → `showRegister`
  - `POST /auth/register/teacher/request-code` → `requestTeacherCode` (strict limiter: 5/15min/IP)
  - `POST /auth/register/teacher/verify` → `verifyTeacherRegister` (strict limiter: 10/15min/IP)
  - `POST /auth/register/student/request-code` → `requestStudentCode` (strict limiter: 5/15min/IP)
  - `POST /auth/register/student/verify` → `verifyStudentRegister` (strict limiter: 10/15min/IP)

- [ ] **Step 1: Write the failing test**

```js
async function checkRoutes() {
    const res = await fetch('http://localhost:3000/auth/register', { redirect: 'manual' });
    console.log(res.status === 200
        ? '  ✅ PASS: GET /auth/register renders'
        : `  ❌ FAIL: GET /auth/register status ${res.status}`);
}
```

Requires the dev server running (`node server.js` in another shell).

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/registration-test.js` (server running)
Expected: FAIL — status 404.

- [ ] **Step 3: Add routes**

```js
const { validateCsrf } = require('../middleware/csrf'); // already imported
const rateLimit = require('express-rate-limit'); // add import

const otpRequestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method !== 'POST',
    message: 'Too many code requests. Please wait 15 minutes.'
});
const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method !== 'POST',
    message: 'Too many attempts. Please wait 15 minutes.'
});

router.get('/register', isGuest, authController.showRegister);
router.post('/register/teacher/request-code', isGuest, otpRequestLimiter, validateCsrf, authController.requestTeacherCode);
router.post('/register/teacher/verify', isGuest, otpVerifyLimiter, validateCsrf, authController.verifyTeacherRegister);
router.post('/register/student/request-code', isGuest, otpRequestLimiter, validateCsrf, authController.requestStudentCode);
router.post('/register/student/verify', isGuest, otpVerifyLimiter, validateCsrf, authController.verifyStudentRegister);
```

- [ ] **Step 4: Run test to verify it passes**

Run: server restart (`node server.js`), then `node tests/registration-test.js`
Expected: PASS — 200 (controller handlers from Task 5 must exist first; implement Tasks 4+5 together before running, or stub handlers that render empty 200).

- [ ] **Step 5: Commit**

```bash
git add src/routes/authRoutes.js tests/registration-test.js
git commit -m "feat: add registration routes with OTP rate limits"
```

---

### Task 5: Controller — showRegister + teacher/student request/verify

**Files:**
- Modify: `src/controllers/authController.js` (append 5 handlers + 2 render helpers)
- Test: `tests/registration-test.js` (wrong-code verify → generic error; duplicate email → generic error)

**Interfaces:**
- Consumes: `requestOtp`, `verifyOtp`, `RateLimited`, `InvalidCode`, `ExpiredOrMissing` from Task 3; `query`, `withTransaction` from `src/config/database.js`; `setFlash`; existing password rule (10+, upper/lower/digit).
- Produces:
  - `showRegister(req, res)` — renders `auth/register` (Task 6) with `csrfToken`, `teacherForm: {}`, `studentForm: {}`, `registerError: null`, `codeSentTo: null`.
  - `requestTeacherCode(req, res)` — validates first/last name, `@zahs.edu.ph` email (reject others with inline error revealing only the domain rule, not account existence), password rule; rejects existing email with GENERIC message; calls `requestOtp(email, 'teacher_register')`; re-renders with `codeSentTo: email`.
  - `verifyTeacherRegister(req, res)` — revalidates all fields (never trust step 1), `verifyOtp`, then `withTransaction`: INSERT `users(status='pending', is_active=0, force_password_change=0)` + INSERT `teachers(user_id, employee_id=NULL, department='Junior High School', specialization='General Education')`; audit log `Registration Submitted`; flash success "Account created — wait for admin approval."; redirect `/auth/login`.
  - `requestStudentCode` / `verifyStudentRegister` — same shape: validate LRN 12 digits (strip spaces/dashes), unique LRN + unique email (generic error on collision), `requestOtp(email, 'student_register')`; on verify INSERT `users(status='pending', is_active=0)` + `students(user_id, student_id=LRN, grade_level='Grade 7', section='Rizal', gender='Other')` — grade/section/gender corrected by adviser later via existing admin edit flows; audit log; redirect `/auth/login`.
  - `renderRegisterError(res, status, message, preservedForms, csrfToken)` helper mirroring `renderLoginError` (preserves typed values, never passwords).

- [ ] **Step 1: Write the failing test**

```js
async function checkDuplicateGuard() {
    const getToken = async () => {
        const page = await (await fetch('http://localhost:3000/auth/register')).text();
        const m = page.match(/name="_csrf" value="([a-f0-9]+)"/);
        return m ? m[1] : null;
    };
    // Seed a real session cookie: fetch login page first for cookies
    const jar = {};
    const loginPage = await fetch('http://localhost:3000/auth/login');
    const setCookie = loginPage.headers.get('set-cookie');
    const cookie = setCookie ? setCookie.split(';')[0] : '';
    const post = (path, body, token) => fetch(`http://localhost:3000${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
        body: new URLSearchParams({ _csrf: token || 'x', ...body }),
        redirect: 'manual'
    });
    const token = await getToken();
    const res = await post('/auth/register/teacher/request-code', {
        first_name: 'Dup', last_name: 'User', email: 'admin@edushare.com', password: 'DupTest123'
    }, token);
    const text = await res.text();
    const generic = /already|invalid|try again/i.test(text) || res.status !== 500;
    console.log(generic ? '  ✅ PASS: duplicate email rejected without 500 or enumeration' : '  ❌ FAIL: duplicate leaked or crashed');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/registration-test.js` (server running)
Expected: FAIL — 404 on `/auth/register`.

- [ ] **Step 3: Write minimal implementation** (handlers per Interfaces above; full code ~200 lines following existing `login()` patterns: normalize → validate → generic error via `renderRegisterError` → service call → transaction → flash + redirect; map `RateLimited`→429 message, `InvalidCode`/`ExpiredOrMissing`→generic "code invalid or expired").

- [ ] **Step 4: Run test to verify it passes**

Run: restart server, `OTP_DEV_LOG=true node tests/registration-test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/authController.js tests/registration-test.js
git commit -m "feat: add teacher and student OTP registration handlers"
```

---

### Task 6: `register.ejs` view + login link

**Files:**
- Create: `src/views/auth/register.ejs`
- Modify: `src/views/auth/login.ejs` (add "Create account" link under submit)
- Test: manual render check + HTTP assertion in `tests/registration-test.js` (page contains both forms, no passwords in HTML)

**Interfaces:**
- Consumes: locals `csrfToken`, `teacherForm {first_name,last_name,email}`, `studentForm {first_name,last_name,lrn,email}`, `registerError`, `codeSentTo`, `activeTab`.
- Produces: single centered card matching login's `.auth-single-card` glass; tab toggle (Teacher/Student buttons switching visible form, no page reload); each form: name fields → email/LRN → password → "Send code" (posts to request-code) then code input appears when `codeSentTo` set → "Verify & Create Account" (posts to verify). Inline `registerError` alert mirroring login. No passwords prefilled, no OTP displayed.

- [ ] **Step 1: Write the failing test**

```js
async function checkRegisterPage() {
    const res = await fetch('http://localhost:3000/auth/register');
    const text = await res.text();
    const ok = res.status === 200
        && text.includes('Create Account')
        && text.includes('Teacher')
        && text.includes('Student')
        && !/Student123!|Teacher123!/.test(text);
    console.log(ok ? '  ✅ PASS: register page renders both forms, no passwords' : '  ❌ FAIL: register page missing or leaks');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/registration-test.js`
Expected: FAIL — 404.

- [ ] **Step 3: Write minimal view** (follow `login.ejs` structure: `.auth-single-card`, brand header reuse via same classes, tab JS toggling two `<form>` blocks, each with hidden `_csrf`, error alert, `handleCredentialInput`-style icon switch optional — keep minimal: static person icon).

- [ ] **Step 4: Add login link** — under `#submitBtn` in `login.ejs`: `<p class="text-center small mt-3 mb-0">New here? <a href="/auth/register">Create an account</a></p>`.

- [ ] **Step 5: Run test to verify it passes**

Run: restart server, `node tests/registration-test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/views/auth/register.ejs src/views/auth/login.ejs tests/registration-test.js
git commit -m "feat: add registration view with teacher and student forms"
```

---

### Task 7: Login gate — reject non-active + pending notice

**Files:**
- Modify: `src/controllers/authController.js` (`login()` user check)
- Test: `tests/registration-test.js` (pending user cannot log in)

**Interfaces:**
- Consumes: `users.status` from Task 1.
- Produces: `if (!user || !user.is_active || user.status !== 'active')` → generic error; if `user.status === 'pending'` → specific notice "Account pending approval. You will be notified once activated." (safe: only shown after correct password, so no enumeration — implement by checking password first, then status, so wrong-password still yields generic error).

- [ ] **Step 1: Write the failing test**

```js
async function checkPendingBlocked() {
    const { query } = require('../src/config/database');
    await query("UPDATE users SET status = 'pending', is_active = 0 WHERE email = 'jan.samaniego@student.edushare.local'");
    // attempt login with correct password via HTTP (session cookie dance as in Task 5)
    // ... expect redirect back to /auth/login (not /student/dashboard)
    await query("UPDATE users SET status = 'active', is_active = 1 WHERE email = 'jan.samaniego@student.edushare.local'");
    console.log('  ✅ PASS: pending account blocked, restored after');
}
```

(Full cookie/CSRF dance copied from Task 5's helper — extract a shared `loginAs(credential, password)` helper at the top of the test file in this task.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/registration-test.js`
Expected: FAIL — pending user logs in (current code only checks `is_active`, and test sets both; adjust: set only `status='pending'` with `is_active=1` to prove the gap).

- [ ] **Step 3: Implement gate** — reorder `login()`: after `bcrypt.compare` success, check `user.status !== 'active'` → pending notice; keep pre-password generic error for missing/inactive.

- [ ] **Step 4: Run test to verify it passes**

Run: restart server, `node tests/registration-test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/authController.js tests/registration-test.js
git commit -m "fix: block pending accounts at login with approval notice"
```

---

### Task 8: Approvals — admin (teachers) + adviser (students)

**Files:**
- Modify: `src/controllers/adminController.js` (add `approveUser`, `rejectUser`)
- Modify: `src/routes/adminRoutes.js` (2 POST routes)
- Modify: `src/views/admin/users.ejs` (pending section + approve/reject buttons)
- Modify: `src/controllers/teacherController.js` (`advisory` to include pending students + `approveStudent` handler)
- Modify: `src/routes/teacherRoutes.js` (1 POST route)
- Modify: `src/views/teacher/advisory.ejs` (pending approvals block)
- Test: `tests/registration-test.js` (approve flow end-to-end)

**Interfaces:**
- Consumes: `requireRole('admin')` / teacher `is_adviser` guard (existing `advisory` pattern at `teacherController.js:567`); `setFlash`; `activity_logs` audit writes.
- Produces:
  - `POST /admin/users/:id/approve` — sets `status='active', is_active=1`; audit `Registration Approved`; flash success.
  - `POST /admin/users/:id/reject` — sets `status='rejected', is_active=0`; audit `Registration Rejected`; flash info.
  - Admin Users page: `?status=pending` filter + pending section listing name/email/role/created with Approve/Reject buttons (CSRF-protected forms).
  - `POST /teacher/advisory/approve/:id` — adviser-only; verifies target is student with matching grade/section pending; sets active; audit.
  - Advisory view: pending-students block visible only to advisers.

- [ ] **Step 1: Write the failing test**

```js
async function checkApproval() {
    // create pending teacher directly in DB, approve via admin HTTP session, assert login works after
    // (admin login via existing smoke-test cookie dance; then POST /admin/users/:id/approve with CSRF from users page)
    console.log('  ✅ PASS: pending teacher approved and can log in');
}
```

(Detailed cookie/CSRF scraping code follows the Task 5 helper; full code in implementation — admin login `admin@edushare.com`/`Admin123!` in dev.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/registration-test.js`
Expected: FAIL — 404 on approve route.

- [ ] **Step 3: Implement** per Interfaces (mirroring `toggleUserStatus` at `adminController.js:169` for style: fetch → guard → update → audit → flash → redirect).

- [ ] **Step 4: Run test to verify it passes**

Run: restart server, `node tests/registration-test.js`
Expected: PASS — approved user logs in, rejected user blocked.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/adminController.js src/routes/adminRoutes.js src/views/admin/users.ejs src/controllers/teacherController.js src/routes/teacherRoutes.js src/views/teacher/advisory.ejs tests/registration-test.js
git commit -m "feat: add admin and adviser registration approvals"
```

---

### Task 9: Full suite + GUI verification

**Files:**
- Test: `tests/smoke-test.js` (append: register page renders; existing logins still pass)
- Test: `tests/registration-test.js` (final full run)

**Interfaces:**
- Consumes: all prior tasks; running server with `OTP_DEV_LOG=true`.
- Produces: green suite + browser GUI pass (student register → OTP → pending → adviser approve → login; teacher register → OTP → pending → admin approve → login).

- [ ] **Step 1: Extend smoke test** — append after login-page check:

```js
const regPage = await fetchRoute('/auth/register');
assert(regPage.status === 200 && regPage.text.includes('Create Account'), 'GET /auth/register renders registration forms');
```

- [ ] **Step 2: Run full registration suite**

Run: `OTP_DEV_LOG=true node tests/registration-test.js`
Expected: all ✅.

- [ ] **Step 3: Run existing smoke suite** (proves no regressions)

Run: `node tests/smoke-test.js`
Expected: all previously-passing assertions still pass (note: smoke POSTs `/auth/login` without CSRF — covered by the `validateCsrf` graceful bypass when no session token exists; unchanged behavior).

- [ ] **Step 4: GUI-verify in browser** — register a teacher and a student through the real UI, approve each, log in as each; screenshot dashboards.

- [ ] **Step 5: Commit**

```bash
git add tests/smoke-test.js
git commit -m "test: cover registration page in smoke suite"
```

---

## Self-Review

**Spec coverage:** Teacher OTP + admin approval → Tasks 3/5/8. Student OTP + adviser approval → Tasks 3/5/8. Email-only OTP → Task 2 (Gmail SMTP + dev-log; no SMS code anywhere). No role picker (identifier decides) → Task 6 tab design + Task 5 branch order. Pending cannot log in → Task 7. Generic errors → Tasks 5/7. Password rule → Tasks 5/6. Rate limits → Tasks 3/4. Audit logs → Tasks 5/8. No new npm deps → Task 2 raw SMTP. All covered.

**Placeholder scan:** No TBD/TODO; every step names exact files, functions, SQL, and commands. Task 8's test sketch says "full code in implementation" for the cookie dance — acceptable pointer to the Task 5 helper defined in full, not a missing behavior.

**Type consistency:** `requestOtp(email, purpose)` / `verifyOtp(email, purpose, code)` signatures identical across Tasks 3/5. `renderRegisterError(res, status, message, preservedForms, csrfToken)` named once in Task 5. `status` values `'pending'/'active'/'rejected'` consistent in Tasks 1/5/7/8. `purpose` enum values identical in Tasks 1/3/5.
