// Comprehensive End-to-End Integration Test for EduShare 2.0

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

function parseCookie(res) {
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) return '';
    return setCookie.split(';')[0];
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
        // ==========================================
        // 1. Student Authentication & Navigation
        // ==========================================
        const studentLogin = await fetchRoute('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                role: 'student',
                credential: '109876543210',
                password: 'Student123!'
            })
        });
        assert(studentLogin.status === 302 && studentLogin.headers.get('location') === '/student/dashboard', 'Student authenticates and redirects to dashboard');
        const studentCookie = parseCookie(studentLogin);
        assert(!!studentCookie, 'Student session cookie issued');

        // Student Dashboard
        const studentDash = await fetchRoute('/student/dashboard', {
            headers: { Cookie: studentCookie }
        });
        assert(studentDash.status === 200 && studentDash.text.includes('Jan'), 'Student dashboard renders personalized student name');

        // Student Enrolled Class View
        const studentClass = await fetchRoute('/student/classes/1', {
            headers: { Cookie: studentCookie }
        });
        assert(studentClass.status === 200 && studentClass.text.includes('English 7 - Section Rizal'), 'Student views class hub details');

        // Student Quiz View (or Result if already taken)
        const studentQuizRunner = await fetchRoute('/student/quizzes/1/take', {
            headers: { Cookie: studentCookie }
        });
        assert(studentQuizRunner.status === 200 || studentQuizRunner.status === 302, 'Student accesses quiz interface (runner or past result)');

        // Student Submits Quiz
        const quizSubmitRes = await fetchRoute('/student/quizzes/1/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: studentCookie
            },
            body: JSON.stringify({
                class_id: 1,
                answers: {
                    1: 2, // Plot
                    2: 5  // True
                }
            })
        });
        assert(quizSubmitRes.status === 200, 'Student submits quiz and receives JSON response');
        const quizJson = JSON.parse(quizSubmitRes.text);
        assert(quizJson.success && quizJson.redirectUrl.includes('/student/quizzes/'), 'Quiz submission auto-graded and redirected');

        // Student Submits Activity Text / Note
        const actSubmitRes = await fetchRoute('/student/activities/1/classes/1/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Cookie: studentCookie
            },
            body: new URLSearchParams({
                note: 'Philippine proverbs reflect our cultural identity and moral compass.'
            })
        });
        assert(actSubmitRes.status === 302, 'Student activity response submitted successfully');

        // ==========================================
        // 2. Teacher Authentication & Grading Flows
        // ==========================================
        const teacherLogin = await fetchRoute('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                role: 'teacher',
                credential: 'maria.reyes@zahs.edu.ph',
                password: 'Teacher123!'
            })
        });
        assert(teacherLogin.status === 302 && teacherLogin.headers.get('location') === '/teacher/dashboard', 'Teacher authenticates and redirects to dashboard');
        const teacherCookie = parseCookie(teacherLogin);
        assert(!!teacherCookie, 'Teacher session cookie issued');

        // Teacher Class Detail View
        const teacherClassDetail = await fetchRoute('/teacher/classes/1', {
            headers: { Cookie: teacherCookie }
        });
        assert(teacherClassDetail.status === 200 && teacherClassDetail.text.includes('English 7 - Section Rizal'), 'Teacher views class dashboard with student roster');

        // Teacher Activity Grading Page
        const gradingView = await fetchRoute('/teacher/activities/1/classes/1/grading', {
            headers: { Cookie: teacherCookie }
        });
        assert(gradingView.status === 200 && gradingView.text.includes('Activity 1: My Personal Value Narrative Essay'), 'Teacher accesses activity grading interface');

        // Teacher Grades Student Submission
        const gradeRes = await fetchRoute('/teacher/activities/grade', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Cookie: teacherCookie
            },
            body: new URLSearchParams({
                submission_id: '1',
                activity_id: '1',
                class_id: '1',
                student_id: '1',
                score: '95',
                feedback: 'Exceptional narrative! Expressive and reflective.'
            })
        });
        assert(gradeRes.status === 302, 'Teacher grades submission and updates activity record');

        // Teacher Gradebook E-Class Record (ECR)
        const gradebookView = await fetchRoute('/teacher/gradebook?class_id=1', {
            headers: { Cookie: teacherCookie }
        });
        assert(gradebookView.status === 200 && gradebookView.text.includes('E-Class Record') && gradebookView.text.includes('Transmuted'), 'Gradebook renders full DepEd E-Class Record with transmutation');

        // Live AJAX Gradebook Cell Update
        const cellUpdate = await fetchRoute('/api/gradebook/entry', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: teacherCookie
            },
            body: JSON.stringify({
                column_id: 1,
                student_id: 1,
                score: 48
            })
        });
        assert(cellUpdate.status === 200, 'Teacher modifies quarterly assessment cell dynamically');
        const cellJson = JSON.parse(cellUpdate.text);
        assert(cellJson.success && cellJson.score === 48, `Dynamic cell update saved: Score = ${cellJson.score}`);

        // Gradebook CSV Export
        const csvExport = await fetchRoute('/teacher/gradebook/1/export', {
            headers: { Cookie: teacherCookie }
        });
        assert(csvExport.status === 200 && csvExport.headers.get('content-type').includes('text/csv'), 'Gradebook CSV exported with content-type text/csv');
        assert(csvExport.text.includes('LRN') && csvExport.text.includes('Student Name') && csvExport.text.includes('Transmuted Grade'), 'CSV data aligns with DepEd Order 8 s. 2015 layout');

        // Teacher Saves AI Lesson to Library
        const saveLesson = await fetchRoute('/api/ai/lesson/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: teacherCookie
            },
            body: JSON.stringify({
                title: 'Oral Traditions & Epic Poetry',
                class_ids: [1],
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
            })
        });
        assert(saveLesson.status === 200, 'Teacher saves structured lesson into school teaching library');
        const lessonJson = JSON.parse(saveLesson.text);
        assert(lessonJson.success === true, 'Saved lesson confirmed in library database');

        // Teacher Advisory Class SF1
        const advisoryView = await fetchRoute('/teacher/advisory', {
            headers: { Cookie: teacherCookie }
        });
        assert(advisoryView.status === 200 && advisoryView.text.includes('School Form 1 (SF1)'), 'Teacher advisory view loads SF1 Register');

        // ==========================================
        // 3. Admin Authentication & Management
        // ==========================================
        const adminLogin = await fetchRoute('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                role: 'admin',
                credential: 'admin@edushare.com',
                password: 'Admin123!'
            })
        });
        assert(adminLogin.status === 302 && adminLogin.headers.get('location') === '/admin/dashboard', 'Admin authenticates and redirects to dashboard');
        const adminCookie = parseCookie(adminLogin);
        assert(!!adminCookie, 'Admin session cookie issued');

        // Admin Dashboard
        const adminDash = await fetchRoute('/admin/dashboard', {
            headers: { Cookie: adminCookie }
        });
        assert(adminDash.status === 200 && adminDash.text.includes('Enrolled Students') && adminDash.text.includes('Administrator Dashboard'), 'Admin dashboard displays live metrics and server health');

        // Admin School Settings
        const settingsRes = await fetchRoute('/admin/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Cookie: adminCookie
            },
            body: new URLSearchParams({
                school_name: 'Zeferino Arroyo High School',
                school_id: '302015',
                division: 'Iriga City',
                region: 'Region V - Bicol',
                deped_curriculum: 'MATATAG',
                current_school_year: '2025-2026',
                current_quarter: 'Q1'
            })
        });
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
