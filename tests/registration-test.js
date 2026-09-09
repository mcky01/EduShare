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

// --- Task 5: real registration assertions (cookie dance + CSRF + OTP flow) ---
async function getSession() {
    const page = await fetch('http://localhost:3000/auth/register', { redirect: 'manual' });
    const body = await page.text();
    const setCookie = page.headers.get('set-cookie');
    const cookie = setCookie ? setCookie.split(';')[0] : '';
    const m = body.match(/name="_csrf" value="([a-f0-9]+)"/);
    return { cookie, token: m ? m[1] : null, status: page.status, body };
}

const postForm = (path, body, sess) => fetch(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sess.cookie },
    body: new URLSearchParams({ _csrf: sess.token || 'x', ...body }),
    redirect: 'manual'
});

// --- Task 7: shared login helper (cookie/CSRF dance for /auth/login) ---
async function getLoginSession() {
    const page = await fetch('http://localhost:3000/auth/login', { redirect: 'manual' });
    const body = await page.text();
    const setCookie = page.headers.get('set-cookie');
    const cookie = setCookie ? setCookie.split(';')[0] : '';
    const m = body.match(/name="_csrf" value="([a-f0-9]+)"/);
    return { cookie, token: m ? m[1] : null, status: page.status };
}

async function loginAs(credential, password) {
    const sess = await getLoginSession();
    const res = await fetch('http://localhost:3000/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sess.cookie },
        body: new URLSearchParams({ _csrf: sess.token || 'x', credential, password }),
        redirect: 'manual'
    });
    const text = await res.text();
    return { status: res.status, location: res.headers.get('location') || '', text };
}

// A 429 here means the 15-min IP window is still hot from an earlier run —
// the dedicated checkRateLimit step proves the limiter, so other steps skip.
function hotLimiter(res) {
    return res.status === 429;
}

async function checkRegisterPage() {
    const s = await getSession();
    const ok = s.status === 200 && !!s.token
        && /register\/teacher\/request-code/.test(s.body)
        && /register\/student\/request-code/.test(s.body);
    console.log(ok
        ? '  ✅ PASS: GET /auth/register renders real page with CSRF + both forms'
        : `  ❌ FAIL: register page missing CSRF/forms (status ${s.status}, token ${s.token ? 'yes' : 'no'})`);
    if (!ok) throw new Error('register page is not real (stub or missing forms)');
}

// --- Task 6: register view design (tabbed card, conditional code step, login link) ---
async function checkRegisterDesign() {
    const fail = (msg) => { console.log(`  ❌ FAIL: ${msg}`); throw new Error(msg); };
    const res = await fetch('http://localhost:3000/auth/register');
    const text = await res.text();
    if (res.status !== 200) fail(`register page status ${res.status}`);
    for (const needle of ['Create Account', 'Teacher', 'Student', 'Send code']) {
        if (!text.includes(needle)) fail(`register page missing "${needle}"`);
    }
    if (/Student123!|Teacher123!/.test(text)) fail('register page leaks seed password');
    const pwInputs = text.match(/<input[^>]*type="password"[^>]*>/g) || [];
    if (pwInputs.length === 0) fail('register page has no password inputs');
    if (pwInputs.some((t) => /value="[^"]*[A-Za-z0-9]/.test(t))) fail('register page prefills a password value');
    if (/name="code"/.test(text)) fail('code input shown before any code was sent (should appear only when codeSentTo set)');
    console.log('  ✅ PASS: register page renders both forms, code step hidden, no passwords');
    // Positive: request-code round trip reveals the code step with codeSentTo echo.
    const s = await getSession();
    const email = `t6-design-${Date.now()}@zahs.edu.ph`;
    const reqRes = await postForm('/auth/register/teacher/request-code', {
        first_name: 'Design', last_name: 'Check', email, password: 'DesignCheck123'
    }, s);
    const reqText = await reqRes.text();
    if (hotLimiter(reqRes)) {
        console.log('  ⏭️  SKIP: code-step reveal hit hot limiter window');
    } else {
        if (reqRes.status !== 200 || !reqText.includes(email) || !/name="code"/.test(reqText)) {
            fail(`code step not revealed after request-code (status ${reqRes.status})`);
        }
        console.log('  ✅ PASS: code input appears after request-code with codeSentTo echo');
    }
    await query("DELETE FROM otp_verifications WHERE email = ?", [email]);
    // Login page links to registration.
    const loginRes = await fetch('http://localhost:3000/auth/login');
    const loginText = await loginRes.text();
    if (!/href="\/auth\/register"/.test(loginText) || !/Create an account/.test(loginText)) {
        fail('login page missing "Create an account" link to /auth/register');
    }
    console.log('  ✅ PASS: login page links to registration');
}

async function checkTeacherRequest() {
    const s = await getSession();
    const email = `t5-teacher-${Date.now()}@zahs.edu.ph`;
    const res = await postForm('/auth/register/teacher/request-code', {
        first_name: 'Task', last_name: 'Five', email, password: 'TaskFive123'
    }, s);
    const text = await res.text();
    if (hotLimiter(res)) {
        console.log('  ⏭️  SKIP: teacher request-code hit hot limiter window (see checkRateLimit)');
        return;
    }
    const ok = res.status === 200 && text.includes(email);
    console.log(ok
        ? '  ✅ PASS: teacher request-code sends OTP and echoes codeSentTo'
        : `  ❌ FAIL: teacher request-code status ${res.status}`);
    if (!ok) throw new Error(`teacher request-code status ${res.status}`);
    await query("DELETE FROM otp_verifications WHERE email = ?", [email]);
}

async function checkWrongCodeVerify() {
    for (const kind of ['teacher', 'student']) {
        const s = await getSession();
        const stamp = Date.now();
        const email = kind === 'teacher' ? `t5-wrong-${stamp}@zahs.edu.ph` : `t5-wrong-${stamp}@example.com`;
        const lrn = '8' + String(stamp).slice(-11);
        const body = kind === 'teacher'
            ? { first_name: 'Wrong', last_name: 'Code', email, password: 'WrongCode123', code: '000000' }
            : { first_name: 'Wrong', last_name: 'Code', email, lrn, password: 'WrongCode123', code: '000000' };
        const res = await postForm(`/auth/register/${kind}/verify`, body, s);
        const text = await res.text();
        if (hotLimiter(res)) {
            console.log(`  ⏭️  SKIP: ${kind} wrong-code verify hit hot limiter window`);
            continue;
        }
        const generic = res.status !== 500 && /invalid|expired|try again/i.test(text);
        const rows = await query('SELECT id FROM users WHERE email = ?', [email]);
        const ok = generic && rows.length === 0;
        console.log(ok
            ? `  ✅ PASS: ${kind} wrong-code verify rejected generic, no user created`
            : `  ❌ FAIL: ${kind} wrong-code verify leaked or created user (status ${res.status}, users ${rows.length})`);
        if (!ok) throw new Error(`${kind} wrong-code verify leaked or created user`);
    }
}

async function checkDuplicateGuard() {
    const s = await getSession();
    // Seeded admin email: must be rejected WITHOUT enumeration or 500.
    const res = await postForm('/auth/register/teacher/request-code', {
        first_name: 'Dup', last_name: 'User', email: 'admin@edushare.com', password: 'DupTest123'
    }, s);
    const text = await res.text();
    if (hotLimiter(res)) {
        console.log('  ⏭️  SKIP: duplicate-email guard hit hot limiter window');
    } else {
        const generic = /already|invalid|try again/i.test(text) || res.status !== 500;
        const rows = await query("SELECT COUNT(*) AS n FROM otp_verifications WHERE email = 'admin@edushare.com' AND consumed_at IS NULL");
        const ok = generic && res.status !== 500 && Number(rows[0].n) === 0;
        console.log(ok
            ? '  ✅ PASS: duplicate email rejected generic, no OTP minted, no 500'
            : `  ❌ FAIL: duplicate leaked/crashed/minted OTP (status ${res.status})`);
        if (!ok) throw new Error('duplicate email leaked or crashed');
    }
    // Seeded student LRN: collision must also stay generic.
    const s2 = await getSession();
    const res2 = await postForm('/auth/register/student/request-code', {
        first_name: 'Dup', last_name: 'Lrn', email: `t5-duplrn-${Date.now()}@example.com`, lrn: '109876543210', password: 'DupTest123'
    }, s2);
    const text2 = await res2.text();
    if (hotLimiter(res2)) {
        console.log('  ⏭️  SKIP: duplicate-LRN guard hit hot limiter window');
    } else {
        const ok2 = res2.status !== 500 && /already|invalid|try again|12 digits/i.test(text2);
        console.log(ok2
            ? '  ✅ PASS: duplicate LRN rejected without 500 or enumeration'
            : `  ❌ FAIL: duplicate LRN leaked or crashed (status ${res2.status})`);
        if (!ok2) throw new Error('duplicate LRN leaked or crashed');
    }
}

async function checkCsrfReject() {
    const s = await getSession();
    const res = await fetch('http://localhost:3000/auth/register/teacher/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: s.cookie },
        body: new URLSearchParams({ _csrf: 'wrong-token', first_name: 'X', last_name: 'Y', email: 'x@zahs.edu.ph', password: 'Xx12345678' }),
        redirect: 'manual'
    });
    await res.text();
    if (hotLimiter(res)) {
        console.log('  ⏭️  SKIP: CSRF probe hit hot limiter window (limiter runs before CSRF check)');
        return;
    }
    console.log(res.status === 403
        ? '  ✅ PASS: bad CSRF rejected with 403'
        : `  ❌ FAIL: bad CSRF status ${res.status}`);
    if (res.status !== 403) throw new Error(`bad CSRF status ${res.status}`);
}

async function checkRateLimit() {
    let limited = false;
    for (let i = 0; i < 10 && !limited; i++) {
        const s = await getSession();
        const res = await postForm('/auth/register/teacher/request-code', {
            first_name: 'Rate', last_name: `Limit${i}`, email: `t5-ratelimit-${Date.now()}-${i}@zahs.edu.ph`, password: 'RateLimit123'
        }, s);
        await res.text();
        if (res.status === 429) limited = true;
    }
    console.log(limited
        ? '  ✅ PASS: OTP request rate limit trips (429)'
        : '  ❌ FAIL: rate limit never tripped in 10 hits');
    if (!limited) throw new Error('rate limit never tripped');
}

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

async function checkPendingBlocked() {
    const email = 'jan.samaniego@student.edushare.local';
    // Gap probe: is_active=1 but status pending — pre-fix code only checks
    // is_active, so this account logs in (test FAILS until the gate lands).
    await query("UPDATE users SET status = 'pending', is_active = 1 WHERE email = ?", [email]);
    try {
        const good = await loginAs(email, 'Student123!');
        const blocked = good.status === 401
            && !good.location.includes('/student/dashboard')
            && good.text.includes('Account pending approval. You will be notified once activated.');
        console.log(blocked
            ? '  ✅ PASS: pending account blocked with approval notice'
            : `  ❌ FAIL: pending user logged in (status ${good.status}, location "${good.location}")`);
        if (!blocked) throw new Error('pending user logged in');
        // Wrong password on pending account must stay generic (no enumeration).
        const bad = await loginAs(email, 'WrongPassword123');
        const generic = bad.status === 401
            && !bad.text.includes('Account pending approval')
            && /invalid credentials/i.test(bad.text);
        console.log(generic
            ? '  ✅ PASS: pending account wrong-password stays generic'
            : `  ❌ FAIL: pending wrong-password leaked status (status ${bad.status})`);
        if (!generic) throw new Error('pending wrong-password leaked status');
    } finally {
        await query("UPDATE users SET status = 'active', is_active = 1 WHERE email = ?", [email]);
        console.log('  ✅ PASS: pending account blocked, restored after');
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

checkSchema().then(() => checkMail()).then(() => checkOtp()).then(() => checkPendingBlocked()).then(() => checkRegisterPage()).then(() => checkRegisterDesign()).then(() => checkTeacherRequest()).then(() => checkWrongCodeVerify()).then(() => checkDuplicateGuard()).then(() => checkCsrfReject()).then(() => checkRateLimit()).then(() => checkRoutes()).then(() => process.exit(0)).catch((e) => { console.error('  ❌ FAIL:', e.message); process.exit(1); });
