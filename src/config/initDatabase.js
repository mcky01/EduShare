const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const env = require('./env');

async function initDatabase() {
    console.log('🔄 [EduShare 2.0] Initializing database...');

    // Connect to MySQL server without selecting database
    const conn = await mysql.createConnection({
        host: env.DB_HOST,
        port: env.DB_PORT,
        user: env.DB_USER,
        password: env.DB_PASSWORD
    });

    try {
        // 1. Ensure database exists
        await conn.query(`CREATE DATABASE IF NOT EXISTS \`${env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        console.log(`✅ [EduShare 2.0] Database '${env.DB_NAME}' ensured.`);
        await conn.query(`USE \`${env.DB_NAME}\``);

        // 2. Read and run schema.sql
        const schemaFile = path.join(__dirname, 'schema.sql');
        if (fs.existsSync(schemaFile)) {
            const schemaSql = fs.readFileSync(schemaFile, 'utf8');
            // Remove full-line comments and split by semicolon
            const statements = schemaSql
                .split('\n')
                .filter(line => !line.trim().startsWith('--'))
                .join('\n')
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0);

            for (const statement of statements) {
                try {
                    await conn.query(statement);
                } catch (err) {
                    // Ignore already exists error codes
                    const ignorable = [
                        'ER_TABLE_EXISTS_ERROR',
                        'ER_DUP_KEYNAME',
                        'ER_MULTIPLE_PRI_KEY'
                    ];
                    if (!ignorable.includes(err.code)) {
                        console.warn('⚠️ Schema warning:', err.message);
                    }
                }
            }
            console.log('✅ [EduShare 2.0] Database schema applied successfully.');
        }

        // 3. Seed Default System Settings
        const defaultSettings = [
            ['school_name', env.SCHOOL_NAME, 'general', 'Official School Name'],
            ['school_abbr', env.SCHOOL_ABBR, 'general', 'School Abbreviation'],
            ['school_motto', env.SCHOOL_MOTTO, 'general', 'School Motto / Tagline'],
            ['school_year', env.SCHOOL_YEAR, 'academic', 'Current School Year'],
            ['current_term', env.CURRENT_TERM, 'academic', 'Current Active Grading Term'],
            ['school_logo', '/images/zahs-logo.png', 'branding', 'Header and Login School Crest'],
            ['session_timeout', '120', 'security', 'Session timeout in minutes'],
            ['allow_student_chat', '1', 'ai', 'Enable AI Study Chatbot for Students'],
            ['allow_ai_lesson', '1', 'ai', 'Enable AI Lesson Plan Generator for Teachers']
        ];

        for (const [key, value, cat, desc] of defaultSettings) {
            await conn.query(
                `INSERT INTO system_settings (setting_key, setting_value, category, description)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [key, value, cat, desc]
            );
        }
        console.log('✅ [EduShare 2.0] System settings configured.');

        // 4. Seed Default Admin User
        const [adminRows] = await conn.query('SELECT id FROM users WHERE email = ?', ['admin@edushare.com']);
        let adminId;
        if (adminRows.length === 0) {
            const adminHash = await bcrypt.hash('Admin123!', 10);
            const [adminResult] = await conn.query(
                `INSERT INTO users (first_name, last_name, email, password_hash, role, is_active, force_password_change)
                 VALUES ('Admin', 'Officer', 'admin@edushare.com', ?, 'admin', 1, 0)`,
                [adminHash]
            );
            adminId = adminResult.insertId;
            console.log('👑 [EduShare 2.0] Default Administrator created: admin@edushare.com / Admin123!');
        } else {
            adminId = adminRows[0].id;
        }

        // 5. Seed Default Teacher (Maria Reyes)
        const [teacherRows] = await conn.query('SELECT id FROM users WHERE email = ?', ['maria.reyes@zahs.edu.ph']);
        let teacherUserId;
        if (teacherRows.length === 0) {
            const teacherHash = await bcrypt.hash('Teacher123!', 10);
            const [tResult] = await conn.query(
                `INSERT INTO users (first_name, last_name, email, password_hash, role, is_active, force_password_change)
                 VALUES ('Maria', 'Reyes', 'maria.reyes@zahs.edu.ph', ?, 'teacher', 1, 0)`,
                [teacherHash]
            );
            teacherUserId = tResult.insertId;
            await conn.query(
                `INSERT INTO teachers (user_id, employee_id, department, specialization, is_adviser, advisory_grade, advisory_section)
                 VALUES (?, 'EMP-2024-001', 'Junior High School', 'English & Literature', 1, 'Grade 7', 'Rizal')`,
                [teacherUserId]
            );
            console.log('👩‍🏫 [EduShare 2.0] Default Teacher created: maria.reyes@zahs.edu.ph / Teacher123!');
        } else {
            teacherUserId = teacherRows[0].id;
        }

        // 6. Seed Default Students
        const studentsSeed = [
            {
                email: 'jan.samaniego@student.edushare.local',
                first_name: 'Jan',
                last_name: 'Samaniego',
                lrn: '109876543210',
                gender: 'Male',
                grade: 'Grade 7',
                section: 'Rizal'
            },
            {
                email: 'alexis.aquilino@student.edushare.local',
                first_name: 'Alexis',
                last_name: 'Aquilino',
                lrn: '109876543211',
                gender: 'Female',
                grade: 'Grade 7',
                section: 'Rizal'
            }
        ];

        const studentProfileIds = [];
        for (const s of studentsSeed) {
            const [sRows] = await conn.query('SELECT id FROM users WHERE email = ?', [s.email]);
            let sUserId;
            if (sRows.length === 0) {
                const sHash = await bcrypt.hash('Student123!', 10);
                const [sRes] = await conn.query(
                    `INSERT INTO users (first_name, last_name, email, password_hash, role, is_active, force_password_change)
                     VALUES (?, ?, ?, ?, 'student', 1, 0)`,
                    [s.first_name, s.last_name, s.email, sHash]
                );
                sUserId = sRes.insertId;
                const [spRes] = await conn.query(
                    `INSERT INTO students (user_id, student_id, grade_level, section, gender)
                     VALUES (?, ?, ?, ?, ?)`,
                    [sUserId, s.lrn, s.grade, s.section, s.gender]
                );
                studentProfileIds.push(spRes.insertId);
                console.log(`🎒 [EduShare 2.0] Default Student created: ${s.email} / Student123! (LRN: ${s.lrn})`);
            } else {
                sUserId = sRows[0].id;
                const [sp] = await conn.query('SELECT id FROM students WHERE user_id = ?', [sUserId]);
                if (sp.length > 0) studentProfileIds.push(sp[0].id);
            }
        }

        // 7. Seed Sample Class
        const [classRows] = await conn.query('SELECT id FROM classes WHERE class_code = ?', ['ENG7RZ']);
        let classId;
        if (classRows.length === 0) {
            const [cRes] = await conn.query(
                `INSERT INTO classes (teacher_id, class_name, subject, grade_level, section, class_code, room, schedule)
                 VALUES (?, 'English 7 - Section Rizal', 'English', 'Grade 7', 'Rizal', 'ENG7RZ', 'Room 204', 'Mon/Wed/Fri 8:00 AM - 9:00 AM')`,
                [teacherUserId]
            );
            classId = cRes.insertId;
            console.log('🏫 [EduShare 2.0] Sample Class created: English 7 - Section Rizal (Code: ENG7RZ)');

            // Enroll students
            for (const spId of studentProfileIds) {
                await conn.query(
                    `INSERT IGNORE INTO enrollments (student_id, class_id, status)
                     VALUES (?, ?, 'active')`,
                    [spId, classId]
                );
            }

            // Seed Gradebook Categories
            await conn.query(
                `INSERT INTO gradebook_categories (class_id, category_name, category_code, weight_percentage, sort_order)
                 VALUES 
                    (?, 'Written Works', 'written_works', 20.00, 1),
                    (?, 'Performance Tasks', 'performance_tasks', 50.00, 2),
                    (?, 'Quarterly Exam', 'quarterly_exam', 30.00, 3)`,
                [classId, classId, classId]
            );
        } else {
            classId = classRows[0].id;
        }

        // 8. Seed Sample Announcement
        const [annRows] = await conn.query('SELECT id FROM announcements WHERE class_id = ?', [classId]);
        if (annRows.length === 0) {
            await conn.query(
                `INSERT INTO announcements (class_id, teacher_id, title, message, category, is_pinned)
                 VALUES (?, ?, 'Welcome to English 7 (SY 2026-2027)', 'Mabuhay Zeferinians! Welcome to our English 7 class. Please review our course syllabus and prepare for our upcoming literature journey. Basta Zeferinian, Magaling Yan!', 'academic', 1)`,
                [classId, teacherUserId]
            );
        }

        // 9. Seed Sample Quiz
        const [quizRows] = await conn.query('SELECT id FROM quizzes WHERE teacher_id = ?', [teacherUserId]);
        if (quizRows.length === 0) {
            const [qRes] = await conn.query(
                `INSERT INTO quizzes (teacher_id, title, description, subject, grade_level, total_questions, time_limit_minutes, passing_score)
                 VALUES (?, 'Quiz 1: Elements of Short Stories & Poetry', 'Assess understanding of characterization, plot elements, and figurative language.', 'English', 'Grade 7', 3, 10, 60)`,
                [teacherUserId]
            );
            const quizId = qRes.insertId;

            // Question 1: Multiple Choice
            const [q1Res] = await conn.query(
                `INSERT INTO quiz_questions (quiz_id, question_text, question_type, points, order_index, explanation)
                 VALUES (?, 'What element of a short story refers to the series of events and actions that relate to the central conflict?', 'multiple_choice', 1, 1, 'Plot represents the sequence of events centered around the conflict.')`,
                [quizId]
            );
            await conn.query(
                `INSERT INTO quiz_options (question_id, option_text, is_correct, order_index)
                 VALUES 
                    (?, 'Theme', 0, 1),
                    (?, 'Plot', 1, 2),
                    (?, 'Setting', 0, 3),
                    (?, 'Protagonist', 0, 4)`,
                [q1Res.insertId, q1Res.insertId, q1Res.insertId, q1Res.insertId]
            );

            // Question 2: True/False
            const [q2Res] = await conn.query(
                `INSERT INTO quiz_questions (quiz_id, question_text, question_type, points, order_index, explanation)
                 VALUES (?, 'A simile directly compares two unlike things using words such as "like" or "as".', 'true_false', 1, 2, 'Similes explicitly use "like" or "as" in comparisons.')`,
                [quizId]
            );
            await conn.query(
                `INSERT INTO quiz_options (question_id, option_text, is_correct, order_index)
                 VALUES 
                    (?, 'True', 1, 1),
                    (?, 'False', 0, 2)`,
                [q2Res.insertId, q2Res.insertId]
            );

            // Question 3: Identification
            const [q3Res] = await conn.query(
                `INSERT INTO quiz_questions (quiz_id, question_text, question_type, points, order_index, explanation)
                 VALUES (?, 'What figure of speech gives human attributes to non-human objects or abstract ideas?', 'identification', 1, 3, 'Personification attributes human qualities to non-human elements.')`,
                [quizId]
            );
            await conn.query(
                `INSERT INTO quiz_options (question_id, option_text, is_correct, order_index)
                 VALUES (?, 'personification', 1, 1)`,
                [q3Res.insertId]
            );

            // Post quiz to Section Rizal
            await conn.query(
                `INSERT INTO section_quizzes (quiz_id, class_id, is_published)
                 VALUES (?, ?, 1)`,
                [quizId, classId]
            );

            // Add as Gradebook Column under Written Works
            const [catRows] = await conn.query(
                'SELECT id FROM gradebook_categories WHERE class_id = ? AND category_code = ?',
                [classId, 'written_works']
            );
            if (catRows.length > 0) {
                await conn.query(
                    `INSERT INTO gradebook_columns (class_id, category_id, column_name, max_score, source_type, quiz_id, sort_order)
                     VALUES (?, ?, 'Quiz 1: Elements of Short Stories', 3, 'quiz', ?, 1)`,
                    [classId, catRows[0].id, quizId]
                );
            }
            console.log('📝 [EduShare 2.0] Sample Quiz created and linked to Class & Gradebook.');
        }

        // 10. Seed Sample Class Activity
        const [actRows] = await conn.query('SELECT id FROM class_activities WHERE teacher_id = ?', [teacherUserId]);
        if (actRows.length === 0) {
            const [actRes] = await conn.query(
                `INSERT INTO class_activities (teacher_id, title, instructions, points, due_date)
                 VALUES (?, 'Activity 1: My Personal Value Narrative Essay', 'Write a 3-paragraph reflective essay about an experience that tested your honesty or resilience. Highlight how your family and community shaped your decision.', 100, DATE_ADD(CURRENT_DATE, INTERVAL 7 DAY))`,
                [teacherUserId]
            );
            const actId = actRes.insertId;
            await conn.query(
                `INSERT INTO activity_posts (activity_id, class_id)
                 VALUES (?, ?)`,
                [actId, classId]
            );

            // Add as Gradebook Column under Performance Tasks
            const [ptCat] = await conn.query(
                'SELECT id FROM gradebook_categories WHERE class_id = ? AND category_code = ?',
                [classId, 'performance_tasks']
            );
            if (ptCat.length > 0) {
                await conn.query(
                    `INSERT INTO gradebook_columns (class_id, category_id, column_name, max_score, source_type, activity_id, sort_order)
                     VALUES (?, ?, 'Activity 1: Value Narrative', 100, 'activity', ?, 1)`,
                    [classId, ptCat[0].id, actId]
                );
            }
            console.log('📋 [EduShare 2.0] Sample Activity created and linked to Class & Gradebook.');
        }

        // 11. Seed DepEd Competencies
        const compSeeds = [
            ['EN7LIT-I-1', 'Analyze literary texts as expressions of individual or communal values within structural contexts.', 'English', 'Grade 7', 'Q1'],
            ['EN7VR-I-2', 'Determine the meaning of words using context clues, affixes, and word analysis.', 'English', 'Grade 7', 'Q1'],
            ['EN7WC-I-3', 'Compose coherent paragraphs demonstrating informative and persuasive structures.', 'English', 'Grade 7', 'Q1'],
            ['EN7SS-I-4', 'Extract and synthesize information from varied print and digital resources.', 'English', 'Grade 7', 'Q2'],
            ['EN7OL-I-5', 'Deliver oral presentations observing effective verbal and non-verbal cues.', 'English', 'Grade 7', 'Q2']
        ];

        for (const [code, desc, subj, gr, qtr] of compSeeds) {
            await conn.query(
                `INSERT INTO competencies (code, description, subject, grade_level, quarter, source_version)
                 VALUES (?, ?, ?, ?, ?, 'DepEd MATATAG 2024')
                 ON DUPLICATE KEY UPDATE description = VALUES(description)`,
                [code, desc, subj, gr, qtr]
            );
        }
        console.log('📚 [EduShare 2.0] DepEd Competencies seeded.');

        console.log('✨ [EduShare 2.0] Database initialization fully completed! Ready for deployment.');
    } finally {
        await conn.end();
    }
}

if (require.main === module) {
    initDatabase()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('❌ Database initialization failed:', err);
            process.exit(1);
        });
}

module.exports = initDatabase;
