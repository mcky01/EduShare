// EduShare 2.0 Comprehensive Verification & Smoke Test

const http = require('http');

const BASE_URL = 'http://127.0.0.1:3000';

async function fetchRoute(path, options = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
        redirect: 'manual',
        ...options
    });
    return {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        text: await res.text()
    };
}

// --- Session + CSRF helpers (same shape as tests/registration-test.js:25-67) ---
function extractToken(body) {
    const m = body.match(/name="_csrf" value="([a-f0-9]+)"/)
        || body.match(/name="csrf-token" content="([a-f0-9]+)"/)
        || body.match(/window\.CSRF_TOKEN = "([a-f0-9]+)"/);
    return m ? m[1] : null;
}

function jarFrom(res) {
    const arr = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    return arr.map((c) => c.split(';')[0]).join('; ');
}

async function getSession(pagePath) {
    const page = await fetch(`${BASE_URL}${pagePath}`, { redirect: 'manual' });
    const body = await page.text();
    return { cookie: jarFrom(page), token: extractToken(body), status: page.status, body };
}

const postForm = (path, body, sess) => fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sess.cookie },
    body: new URLSearchParams({ _csrf: sess.token || 'x', ...body }),
    redirect: 'manual'
});

const postJson = (path, jsonBody, sess) => fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        Cookie: sess.cookie,
        'x-csrf-token': sess.token || 'x',
        'X-Requested-With': 'XMLHttpRequest'
    },
    body: JSON.stringify(jsonBody),
    redirect: 'manual'
});

// Fresh CSRF token for an already-logged-in session: the login POST calls
// session.regenerate(), so the pre-login token is dead. Re-GET an authed
// page (brandingMiddleware mints a new token) and parse the meta tag.
async function refreshToken(cookie, pagePath) {
    const s = await getSession(pagePath);
    const merged = [cookie, s.cookie].filter(Boolean).join('; ');
    // Re-GET with the login cookie so the token belongs to the live session.
    const page = await fetch(`${BASE_URL}${pagePath}`, {
        headers: { Cookie: merged },
        redirect: 'manual'
    });
    const body = await page.text();
    const extra = jarFrom(page);
    return { cookie: extra ? `${merged}; ${extra}` : merged, token: extractToken(body) };
}

async function loginAs(credential, password) {
    const sess = await getSession('/auth/login');
    const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sess.cookie },
        body: new URLSearchParams({ _csrf: sess.token || 'x', credential, password }),
        redirect: 'manual'
    });
    const text = await res.text();
    const cookie = jarFrom(res) || sess.cookie;
    return {
        status: res.status,
        location: res.headers.get('location') || '',
        cookie,
        text
    };
}

async function runSmokeTests() {
    console.log('🧪 Starting EduShare 2.0 Verification Suite...');
    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`  ✅ PASS: ${message}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${message}`);
            failed++;
        }
    }

    try {
        // 1. Health Check
        const health = await fetchRoute('/api/health');
        assert(health.status === 200 && health.text.includes('healthy'), 'GET /api/health returns 200 healthy');

        // 2. Unauthenticated Root Redirect
        const root = await fetchRoute('/');
        assert(root.status === 302 && root.headers.location === '/auth/login', 'GET / redirects unauthenticated to /auth/login');

        // 3. Login Page Render
        const loginPage = await fetchRoute('/auth/login');
        assert(loginPage.status === 200 && loginPage.text.includes('EduShare'), 'GET /auth/login renders liquid glass login card');

        const regPage = await fetchRoute('/auth/register');
        assert(regPage.status === 200 && regPage.text.includes('Create Account'), 'GET /auth/register renders registration forms');

        // 4. Test Student Login via POST (session cookie + CSRF token)
        const studentLogin = await loginAs('109876543210', 'Student123!');
        const studentCookie = studentLogin.cookie;
        assert(studentLogin.status === 302 && studentLogin.location === '/student/dashboard', 'POST /auth/login succeeds for student');
        assert(!!studentCookie, 'Session cookie issued on login');

        // 5. Test Student Dashboard with Cookie
        const studentDash = await fetchRoute('/student/dashboard', {
            headers: { Cookie: studentCookie }
        });
        assert(studentDash.status === 200 && studentDash.text.includes('Learner Dashboard'), 'GET /student/dashboard renders with student session');

        // 6. Test Teacher Login via POST (session cookie + CSRF token)
        const teacherLogin = await loginAs('maria.reyes@zahs.edu.ph', 'Teacher123!');
        const teacherCookie = teacherLogin.cookie;
        assert(teacherLogin.status === 302 && teacherLogin.location === '/teacher/dashboard', 'POST /auth/login succeeds for teacher');

        // 7. Test Teacher Dashboard with Cookie
        const teacherDash = await fetchRoute('/teacher/dashboard', {
            headers: { Cookie: teacherCookie }
        });
        assert(teacherDash.status === 200 && teacherDash.text.includes('Teacher Dashboard'), 'GET /teacher/dashboard renders with teacher session');

        // 8. Test Teacher Gradebook
        const gradebookPage = await fetchRoute('/teacher/gradebook', {
            headers: { Cookie: teacherCookie }
        });
        assert(gradebookPage.status === 200 && gradebookPage.text.includes('Electronic Class Record'), 'GET /teacher/gradebook renders ECR matrix');

        // 9. Test Admin Login via POST (session cookie + CSRF token)
        const adminLogin = await loginAs('admin@edushare.com', 'Admin123!');
        const adminCookie = adminLogin.cookie;
        assert(adminLogin.status === 302 && adminLogin.location === '/admin/dashboard', 'POST /auth/login succeeds for admin');

        // 10. Test Admin Dashboard with Cookie
        const adminDash = await fetchRoute('/admin/dashboard', {
            headers: { Cookie: adminCookie }
        });
        assert(adminDash.status === 200 && adminDash.text.includes('Administrator Dashboard'), 'GET /admin/dashboard renders with admin session');

        // 11. Test Global Search API
        const searchRes = await fetchRoute('/api/search?q=English', {
            headers: { Cookie: studentCookie }
        });
        assert(searchRes.status === 200 && searchRes.text.includes('English'), 'GET /api/search returns indexed class/quiz results');

        // 12. Test AI Quiz Generator API (teacher session + fresh CSRF token via header)
        const teacherQuizSess = await refreshToken(teacherCookie, '/teacher/dashboard');
        const quizGenRes = await postJson('/api/ai/quiz/generate', {
            topic: 'Figures of Speech',
            grade_level: 'Grade 7',
            subject: 'English',
            mc_count: 2,
            tf_count: 1,
            id_count: 1
        }, teacherQuizSess);
        const quizGenText = await quizGenRes.text();
        assert(quizGenRes.status === 200 && quizGenText.includes('questions'), 'POST /api/ai/quiz/generate produces structured questions');

        // 13. Test AI Lesson Generator API (teacher session + fresh CSRF token via header)
        const teacherLessonSess = await refreshToken(teacherCookie, '/teacher/dashboard');
        const lessonGenRes = await postJson('/api/ai/lesson/generate', {
            topic: 'Short Story Structure',
            grade_level: 'Grade 7',
            subject: 'English',
            competency: 'EN7LIT-I-1'
        }, teacherLessonSess);
        const lessonGenText = await lessonGenRes.text();
        assert(lessonGenRes.status === 200 && lessonGenText.includes('slides'), 'POST /api/ai/lesson/generate produces structured slides');

        console.log('');
        console.log(`🏁 Test Summary: ${passed} Passed, ${failed} Failed`);
        process.exit(failed > 0 ? 1 : 0);

    } catch (err) {
        console.error('Test execution error:', err);
        process.exit(1);
    }
}

runSmokeTests();
