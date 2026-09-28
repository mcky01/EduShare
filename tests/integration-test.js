// Comprehensive End-to-End Integration Test for EduShare 2.0

const { query } = require('../src/config/database');

const BASE_URL = 'http://127.0.0.1:3000';

async function fetchRoute(path, options = {}) {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, {
        redirect: 'manual',
        ...options
    });
    return {
        status: res.status,
        headers: res.headers,
        text: await res.text()
    };
}

// --- Session + CSRF helpers (same shape as tests/smoke-test.js, itself copied
// from tests/registration-test.js:25-67). Do NOT invent a new pattern. ---
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
    const page = await fetch(BASE_URL + pagePath, { redirect: 'manual' });
    const body = await page.text();
    return { cookie: jarFrom(page), token: extractToken(body), status: page.status, body };
}

const postForm = (path, body, sess, extraHeaders) => fetch(BASE_URL + path, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sess.cookie }, extraHeaders || {}),
    body: new URLSearchParams(Object.assign({ _csrf: sess.token || 'x' }, body)),
    redirect: 'manual'
});

const postJson = (path, jsonBody, sess) => fetch(BASE_URL + path, {
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
// page and parse the meta tag.
async function refreshToken(cookie, pagePath) {
    const s = await getSession(pagePath);
    const merged = [cookie, s.cookie].filter(Boolean).join('; ');
    const page = await fetch(BASE_URL + pagePath, {
        headers: { Cookie: merged },
        redirect: 'manual'
    });
    const body = await page.text();
    const extra = jarFrom(page);
    return { cookie: extra ? merged + '; ' + extra : merged, token: extractToken(body) };
}

async function loginAs(credential, password) {
    const sess = await getSession('/auth/login');
    const res = await fetch(BASE_URL + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sess.cookie },
        body: new URLSearchParams({ _csrf: sess.token || 'x', credential, password }),
        redirect: 'manual'
    });
    const text = await res.text();
    return {
        status: res.status,
        headers: res.headers,
        text,
        location: res.headers.get('location') || '',
        cookie: jarFrom(res) || sess.cookie
    };
}

// --- Seed-id resolution: the dev DB is long-lived, so numeric ids are NOT
// assumed. Resolve by stable seed keys (class_code, titles, LRN). ---
async function resolveIds() {
    const ids = { classId: 1, quizId: 1, activityId: 1, studentProfileId: 1 };
    try {
        const cls = await query("SELECT id FROM classes WHERE class_code = 'ENG7RZ' LIMIT 1");
        if (cls.length) ids.classId = cls[0].id;
        const qz = await query("SELECT id FROM quizzes WHERE title LIKE 'Quiz 1:%' LIMIT 1");
        if (qz.length) ids.quizId = qz[0].id;
        const act = await query("SELECT id FROM class_activities WHERE title LIKE 'Activity 1:%' LIMIT 1");
        if (act.length) ids.activityId = act[0].id;
        const st = await query("SELECT id FROM students WHERE student_id = '109876543210' LIMIT 1");
        if (st.length) ids.studentProfileId = st[0].id;
    } catch (e) {
        console.error('  ⚠️ id resolution fell back to 1s:', e.message);
    }
    return ids;
}

// Build correct answers from the real question/option rows (MC/TF by
// is_correct option id, identification by stored answer text).
async function buildQuizAnswers(quizId) {
    const questions = await query('SELECT * FROM quiz_questions WHERE quiz_id = ?', [quizId]);
    const answers = {};
    for (const q of questions) {
        if (q.question_type === 'multiple_choice' || q.question_type === 'true_false') {
            const opts = await query(
                'SELECT id FROM quiz_options WHERE question_id = ? AND is_correct = 1 ORDER BY order_index ASC LIMIT 1',
                [q.id]
            );
            if (opts.length) answers[q.id] = opts[0].id;
        } else {
            const opts = await query(
                'SELECT option_text FROM quiz_options WHERE question_id = ? LIMIT 1',
                [q.id]
            );
            if (opts.length) answers[q.id] = opts[0].option_text;
        }
    }
    return answers;
}

async function runIntegrationTests() {
    console.log('🚀 Running EduShare 2.0 End-to-End Integration Suite...\n');
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
        const ids = await resolveIds();
        // ==========================================
        // 1. Student Authentication & Navigation
        // ==========================================
        const studentLogin = await loginAs('109876543210', 'Student123!');
        assert(studentLogin.status === 302 && studentLogin.location === '/student/dashboard', 'Student authenticates and redirects to dashboard');
        const studentCookie = studentLogin.cookie;
        assert(!!studentCookie, 'Student session cookie issued');

        // Student Dashboard
        const studentDash = await fetchRoute('/student/dashboard', {
            headers: { Cookie: studentCookie }
        });
        assert(studentDash.status === 200 && studentDash.text.includes('Jan'), 'Student dashboard renders personalized student name');

        // Student Enrolled Class View
        const studentClass = await fetchRoute(`/student/classes/${ids.classId}`, {
            headers: { Cookie: studentCookie }
        });
        assert(studentClass.status === 200 && studentClass.text.includes('English 7 - Section Rizal'), 'Student views class hub details');

        // Student Quiz View (or Result if already taken)
        const studentQuizRunner = await fetchRoute(`/student/quizzes/${ids.quizId}/take`, {
            headers: { Cookie: studentCookie }
        });
        assert(studentQuizRunner.status === 200 || studentQuizRunner.status === 302, 'Student accesses quiz interface (runner or past result)');

        // Student Submits Quiz (answers resolved from live question/option rows)
        const quizAnswers = await buildQuizAnswers(ids.quizId);
        const studentQuizSess = await refreshToken(studentCookie, '/student/dashboard');
        const quizSubmitRes = await postJson(`/student/quizzes/${ids.quizId}/submit`, {
            class_id: ids.classId,
            answers: quizAnswers
        }, studentQuizSess);
        const quizSubmitText = await quizSubmitRes.text();
        assert(quizSubmitRes.status === 200, 'Student submits quiz and receives JSON response');
        const quizJson = JSON.parse(quizSubmitText);
        assert(quizJson.success && quizJson.redirectUrl.includes('/student/quizzes/'), 'Quiz submission auto-graded and redirected');

        // Student Submits Activity Text / Note (multipart-aware CSRF: token in form body)
        const studentActSess = await refreshToken(studentCookie, '/student/dashboard');
        const actSubmitRes = await postForm(`/student/activities/${ids.activityId}/classes/${ids.classId}/submit`, {
            note: 'Philippine proverbs reflect our cultural identity and moral compass.'
        }, studentActSess);
        assert(actSubmitRes.status === 302, 'Student activity response submitted successfully');

        // ==========================================
        // 2. Teacher Authentication & Grading Flows
        // ==========================================
        const teacherLogin = await loginAs('maria.reyes@zahs.edu.ph', 'Teacher123!');
        assert(teacherLogin.status === 302 && teacherLogin.location === '/teacher/dashboard', 'Teacher authenticates and redirects to dashboard');
        const teacherCookie = teacherLogin.cookie;
        assert(!!teacherCookie, 'Teacher session cookie issued');

        // Teacher Class Detail View
        const teacherClassDetail = await fetchRoute(`/teacher/classes/${ids.classId}`, {
            headers: { Cookie: teacherCookie }
        });
        assert(teacherClassDetail.status === 200 && teacherClassDetail.text.includes('English 7 - Section Rizal'), 'Teacher views class dashboard with student roster');

        // Teacher Activity Grading Page
        const gradingView = await fetchRoute(`/teacher/activities/${ids.activityId}/classes/${ids.classId}/grading`, {
            headers: { Cookie: teacherCookie }
        });
        assert(gradingView.status === 200 && gradingView.text.includes('Activity 1: My Personal Value Narrative Essay'), 'Teacher accesses activity grading interface');

        // Teacher Grades Student Submission (JSON flavor: success path is 200
        // {success:true}; deny/invalid paths are 403/400, so this is stronger
        // than the old bare-302 assert, which passed on every redirect)
        const subRows = await query(
            'SELECT id FROM activity_submissions WHERE activity_id = ? AND class_id = ? AND student_id = ? LIMIT 1',
            [ids.activityId, ids.classId, ids.studentProfileId]
        );
        const teacherGradeSess = await refreshToken(teacherCookie, '/teacher/dashboard');
        const gradeRes = await postForm('/teacher/activities/grade', {
            submission_id: String(subRows.length ? subRows[0].id : 1),
            activity_id: String(ids.activityId),
            class_id: String(ids.classId),
            student_id: String(ids.studentProfileId),
            score: '95',
            feedback: 'Exceptional narrative! Expressive and reflective.'
        }, teacherGradeSess, { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' });
        const gradeText = await gradeRes.text();
        assert(gradeRes.status === 200 && gradeText.includes('"success":true'), 'Teacher grades submission and updates activity record');

        // Teacher Gradebook E-Class Record (ECR)
        const gradebookView = await fetchRoute(`/teacher/gradebook?classId=${ids.classId}`, {
            headers: { Cookie: teacherCookie }
        });
        assert(gradebookView.status === 200 && gradebookView.text.includes('E-Class Record') && gradebookView.text.includes('Transmuted'), 'Gradebook renders full DepEd E-Class Record with transmutation');

        // Live AJAX Gradebook Cell Update (column/score resolved so the score
        // never exceeds the column max_score, which the API caps with a 400)
        const colRows = await query(
            'SELECT id, max_score FROM gradebook_columns WHERE class_id = ? ORDER BY max_score DESC LIMIT 1',
            [ids.classId]
        );
        const colId = colRows.length ? colRows[0].id : 1;
        const colMax = colRows.length ? parseFloat(colRows[0].max_score) : 100;
        const cellScore = Math.min(48, colMax);
        const teacherCellSess = await refreshToken(teacherCookie, '/teacher/dashboard');
        const cellUpdate = await postJson('/api/gradebook/entry', {
            column_id: colId,
            student_id: ids.studentProfileId,
            score: cellScore
        }, teacherCellSess);
        const cellText = await cellUpdate.text();
        assert(cellUpdate.status === 200, 'Teacher modifies quarterly assessment cell dynamically');
        const cellJson = JSON.parse(cellText);
        assert(cellJson.success && cellJson.score === cellScore, `Dynamic cell update saved: Score = ${cellJson.score}`);

        // Gradebook CSV Export
        const csvExport = await fetchRoute(`/teacher/gradebook/${ids.classId}/export`, {
            headers: { Cookie: teacherCookie }
        });
        assert(csvExport.status === 200 && csvExport.headers.get('content-type').includes('text/csv'), 'Gradebook CSV exported with content-type text/csv');
        assert(csvExport.text.includes('LRN') && csvExport.text.includes('Student Name') && csvExport.text.includes('Transmuted Grade'), 'CSV data aligns with DepEd Order 8 s. 2015 layout');

        // Teacher Saves AI Lesson to Library (confirmed:true mirrors the real
        // lesson-wizard review flow; unconfirmed direct posts are 422 by design)
        const teacherLessonSess = await refreshToken(teacherCookie, '/teacher/dashboard');
        const saveLesson = await postJson('/api/ai/lesson/save', {
                title: 'Oral Traditions & Epic Poetry',
                class_ids: [ids.classId],
                confirmed: true,
                lesson_json: {
                    topic: 'Oral Traditions & Epic Poetry',
                    gradeLevel: 'Grade 7',
                    subject: 'English',
                    competency: 'EN7LIT-I-1',
                    slides: [
                        { slideNumber: 1, title: 'Introduction to Epic Poetry', content: 'Biag ni Lam-ang and Hinilawod.' },
                        { slideNumber: 2, title: 'Heroic Archetypes', content: 'Supernatural traits of epic heroes.' }
                    ]
                }
        }, teacherLessonSess);
        const saveLessonText = await saveLesson.text();
        assert(saveLesson.status === 200, 'Teacher saves structured lesson into school teaching library');
        const lessonJson = JSON.parse(saveLessonText);
        assert(lessonJson.success === true, 'Saved lesson confirmed in library database');

        // Teacher Advisory Class SF1
        const advisoryView = await fetchRoute('/teacher/advisory', {
            headers: { Cookie: teacherCookie }
        });
        assert(advisoryView.status === 200 && advisoryView.text.includes('School Form 1 (SF1)'), 'Teacher advisory view loads SF1 Register');

        // ==========================================
        // 3. Admin Authentication & Management
        // ==========================================
        const adminLogin = await loginAs('admin@edushare.com', 'Admin123!');
        assert(adminLogin.status === 302 && adminLogin.location === '/admin/dashboard', 'Admin authenticates and redirects to dashboard');
        const adminCookie = adminLogin.cookie;
        assert(!!adminCookie, 'Admin session cookie issued');

        // Admin Dashboard
        const adminDash = await fetchRoute('/admin/dashboard', {
            headers: { Cookie: adminCookie }
        });
        assert(adminDash.status === 200 && adminDash.text.includes('Enrolled Students') && adminDash.text.includes('Administrator Dashboard'), 'Admin dashboard displays live metrics and server health');

        // Admin School Settings (multipart route: CSRF checked after multer,
        // so the token rides in the form body)
        const adminSettingsSess = await refreshToken(adminCookie, '/admin/dashboard');
        const settingsRes = await postForm('/admin/settings', {
                school_name: 'Zeferino Arroyo High School',
                school_id: '302015',
                division: 'Iriga City',
                region: 'Region V - Bicol',
                deped_curriculum: 'MATATAG',
                current_school_year: '2025-2026',
                current_quarter: 'Q1'
        }, adminSettingsSess);
        assert(settingsRes.status === 302, 'Admin updates ZAHS institution settings');

        // Omnisearch Endpoint
        const searchRes = await fetchRoute('/api/search?q=English', {
            headers: { Cookie: adminCookie }
        });
        assert(searchRes.status === 200, 'Omnisearch endpoint returns indexed results');
        const searchJson = JSON.parse(searchRes.text);
        assert(Array.isArray(searchJson.results) && searchJson.results.length > 0, 'Omnisearch finds matching classes/subjects');

    } catch (err) {
        console.error('Fatal Integration Test Error:', err);
        failed++;
    }

    console.log(`\n==============================================`);
    console.log(`🏁 Integration Suite Complete: ${passed} Passed, ${failed} Failed`);
    console.log(`==============================================\n`);
    process.exit(failed > 0 ? 1 : 0);
}

runIntegrationTests();
