// EduShare 2.0 Comprehensive Verification & Smoke Test

const http = require('http');

const BASE_URL = 'http://localhost:3000';

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

        // 4. Test Student Login via POST
        const studentLoginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                role: 'student',
                credential: '109876543210',
                password: 'Student123!'
            }),
            redirect: 'manual'
        });
        const studentCookie = studentLoginRes.headers.get('set-cookie');
        assert(studentLoginRes.status === 302 && studentLoginRes.headers.get('location') === '/student/dashboard', 'POST /auth/login succeeds for student');
        assert(!!studentCookie, 'Session cookie issued on login');

        // 5. Test Student Dashboard with Cookie
        const studentDash = await fetchRoute('/student/dashboard', {
            headers: { Cookie: studentCookie }
        });
        assert(studentDash.status === 200 && studentDash.text.includes('Learner Dashboard'), 'GET /student/dashboard renders with student session');

        // 6. Test Teacher Login via POST
        const teacherLoginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                role: 'teacher',
                credential: 'maria.reyes@zahs.edu.ph',
                password: 'Teacher123!'
            }),
            redirect: 'manual'
        });
        const teacherCookie = teacherLoginRes.headers.get('set-cookie');
        assert(teacherLoginRes.status === 302 && teacherLoginRes.headers.get('location') === '/teacher/dashboard', 'POST /auth/login succeeds for teacher');

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

        // 9. Test Admin Login via POST
        const adminLoginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                role: 'admin',
                credential: 'admin@edushare.com',
                password: 'Admin123!'
            }),
            redirect: 'manual'
        });
        const adminCookie = adminLoginRes.headers.get('set-cookie');
        assert(adminLoginRes.status === 302 && adminLoginRes.headers.get('location') === '/admin/dashboard', 'POST /auth/login succeeds for admin');

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

        // 12. Test AI Quiz Generator API
        const quizGenRes = await fetchRoute('/api/ai/quiz/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: teacherCookie
            },
            body: JSON.stringify({
                topic: 'Figures of Speech',
                grade_level: 'Grade 7',
                subject: 'English',
                mc_count: 2,
                tf_count: 1,
                id_count: 1
            })
        });
        assert(quizGenRes.status === 200 && quizGenRes.text.includes('questions'), 'POST /api/ai/quiz/generate produces structured questions');

        // 13. Test AI Lesson Generator API
        const lessonGenRes = await fetchRoute('/api/ai/lesson/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: teacherCookie
            },
            body: JSON.stringify({
                topic: 'Short Story Structure',
                grade_level: 'Grade 7',
                subject: 'English',
                competency: 'EN7LIT-I-1'
            })
        });
        assert(lessonGenRes.status === 200 && lessonGenRes.text.includes('slides'), 'POST /api/ai/lesson/generate produces structured slides');

        console.log('');
        console.log(`🏁 Test Summary: ${passed} Passed, ${failed} Failed`);
        process.exit(failed > 0 ? 1 : 0);

    } catch (err) {
        console.error('Test execution error:', err);
        process.exit(1);
    }
}

runSmokeTests();
