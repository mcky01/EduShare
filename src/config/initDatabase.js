const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const env = require('./env');
const enrollmentService = require('../services/enrollmentService');

async function initDatabase() {
    console.log('🔄 [EduShare] Initializing database...');

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
        console.log(`✅ [EduShare] Database '${env.DB_NAME}' ensured.`);
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
                        'ER_MULTIPLE_PRI_KEY',
                        'ER_DUP_FIELDNAME'
                    ];
                    if (!ignorable.includes(err.code)) {
                        console.warn('⚠️ Schema warning:', err.message);
                    }
                }
            }
            console.log('✅ [EduShare] Database schema applied successfully.');
        }

        // 2b. Idempotent column upgrades (MySQL-safe; ALTER ... IF NOT EXISTS is MariaDB-only)
        const [statusCols] = await conn.query(
            `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'status'`,
            [env.DB_NAME]
        );
        if (statusCols[0].cnt === 0) {
            await conn.query(
                `ALTER TABLE \`users\` ADD COLUMN \`status\` ENUM('pending','active','rejected') NOT NULL DEFAULT 'active' AFTER \`is_active\``
            );
            console.log('✅ [EduShare] users.status column added.');
        }

        // 2c1. OTP upgrades: password_reset purpose for the forgot/reset flow.
        // Idempotent information_schema gate — runs every boot, ALTERs only when
        // the value is missing, so fresh installs and migrated DBs stay silent.
        try {
            const [otpCol] = await conn.query(
                `SELECT COLUMN_TYPE AS col_type FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'otp_verifications' AND COLUMN_NAME = 'purpose'`,
                [env.DB_NAME]
            );
            if (otpCol.length > 0 && !String(otpCol[0].col_type).includes('password_reset')) {
                await conn.query(
                    `ALTER TABLE \`otp_verifications\` MODIFY COLUMN \`purpose\` ENUM('teacher_register','student_register','password_reset') NOT NULL`
                );
                console.log('✅ [EduShare] otp_verifications.purpose enum extended with password_reset.');
            }
        } catch (err) {
            console.warn('⚠️ OTP purpose upgrade warning:', err.message);
        }

        // 2c. RAG upgrades: term columns + document_chunks (existing DBs predate Phase 1)
        const ragUpgrades = [
            ['curriculum_documents', 'term', `ADD COLUMN \`term\` ENUM('T1','T2','T3') DEFAULT NULL`],
            ['competencies', 'term', `ADD COLUMN \`term\` ENUM('T1','T2','T3') DEFAULT NULL`],
            ['library_items', 'lesson_content', `ADD COLUMN \`lesson_content\` MEDIUMTEXT DEFAULT NULL`]
        ];
        for (const [tbl, col, ddl] of ragUpgrades) {
            const [cols] = await conn.query(
                `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
                [env.DB_NAME, tbl, col]
            );
            if (cols[0].cnt === 0) {
                await conn.query(`ALTER TABLE \`${tbl}\` ${ddl}`);
                console.log(`✅ [EduShare] ${tbl}.${col} column added.`);
            }
        }

        // 2d. Teacher self-registration upgrades: optional grade_level + section
        // declared at signup (subject/strand deferred until SHS offerings known).
        // information_schema-gated so old DBs migrate on boot.
        // 2e. Enrollment backfill: students created/approved before the
        // auto-enroll fix have users+students rows but no enrollments rows,
        // so they are invisible in every roster/gradebook (which all read
        // via enrollments). Idempotent INSERT IGNORE — re-runs are no-ops.
        // Runs inline here (same connection, post-schema) so it also heals
        // DBs that boot with the server already running.
        // 2f. Section transfer requests table (adviser lifecycle, dual approval).
        // Created via the schema.sql runner above on fresh installs; ensured
        // here explicitly so existing DBs migrate on boot.
        const teacherUpgrades = [
            ['teachers', 'grade_level', 'ADD COLUMN `grade_level` VARCHAR(20) DEFAULT NULL'],
            ['teachers', 'section', 'ADD COLUMN `section` VARCHAR(50) DEFAULT NULL']
        ];
        for (const [tbl, col, ddl] of teacherUpgrades) {
            const [cols] = await conn.query(
                `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
                [env.DB_NAME, tbl, col]
            );
            if (cols[0].cnt === 0) {
                await conn.query(`ALTER TABLE \`${tbl}\` ${ddl}`);
                console.log(`✅ [EduShare] ${tbl}.${col} column added.`);
            }
        }

        // 2e. Enrollment backfill: heal students created/approved before the
        // auto-enroll fix. Lives in enrollmentService so the boot path and the
        // approval paths share one implementation. It is idempotent
        // (INSERT IGNORE), never throws, and logs its own summary. Safe on the
        // pooled connection because everything above this point is
        // auto-committed (this file opens no transaction).
        await enrollmentService.backfillMissingEnrollments();

        // 2f. Section transfer requests table (explicit ensure for existing DBs).
        try {
            const [tTables] = await conn.query(
                `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'section_transfer_requests'`,
                [env.DB_NAME]
            );
            if (tTables[0].cnt === 0) {
                await conn.query(
                    `CREATE TABLE \`section_transfer_requests\` (
                        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
                        \`student_id\` INT NOT NULL,
                        \`from_grade\` VARCHAR(20) NOT NULL,
                        \`from_section\` VARCHAR(50) NOT NULL,
                        \`to_grade\` VARCHAR(20) NOT NULL,
                        \`to_section\` VARCHAR(50) NOT NULL,
                        \`requested_by\` INT NOT NULL,
                        \`reason\` VARCHAR(500) NOT NULL,
                        \`status\` ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
                        \`receiver_decided_by\` INT DEFAULT NULL,
                        \`receiver_decision\` ENUM('approved','rejected') DEFAULT NULL,
                        \`receiver_decided_at\` DATETIME DEFAULT NULL,
                        \`admin_decided_by\` INT DEFAULT NULL,
                        \`admin_decision\` ENUM('approved','rejected') DEFAULT NULL,
                        \`admin_decided_at\` DATETIME DEFAULT NULL,
                        \`decision_reason\` VARCHAR(500) DEFAULT NULL,
                        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        UNIQUE KEY \`unique_pending_student\` (\`student_id\`, \`status\`),
                        INDEX \`idx_transfer_status\` (\`status\`),
                        FOREIGN KEY (\`student_id\`) REFERENCES \`students\` (\`id\`) ON DELETE CASCADE,
                        FOREIGN KEY (\`requested_by\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
                );
                console.log('✅ [EduShare] section_transfer_requests table added.');
            }
        } catch (err) {
            console.warn('⚠️ Transfer table upgrade warning:', err.message);
        }

        // 2g. Student change requests table (unified adviser → admin
        // approval queue for edit/drop/restore/deactivate). Explicit
        // ensure so existing DBs migrate on boot.
        try {
            const [cTables] = await conn.query(
                `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'student_change_requests'`,
                [env.DB_NAME]
            );
            if (cTables[0].cnt === 0) {
                await conn.query(
                    `CREATE TABLE \`student_change_requests\` (
                        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
                        \`student_id\` INT NOT NULL,
                        \`request_type\` ENUM('edit','drop','restore','deactivate') NOT NULL,
                        \`payload\` JSON DEFAULT NULL,
                        \`teacher_note\` VARCHAR(500) NOT NULL,
                        \`requested_by\` INT NOT NULL,
                        \`status\` ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
                        \`decided_by\` INT DEFAULT NULL,
                        \`decision_note\` VARCHAR(500) DEFAULT NULL,
                        \`decided_at\` DATETIME DEFAULT NULL,
                        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        UNIQUE KEY \`unique_pending_change\` (\`student_id\`, \`status\`),
                        INDEX \`idx_change_status\` (\`status\`),
                        INDEX \`idx_change_type\` (\`request_type\`),
                        FOREIGN KEY (\`student_id\`) REFERENCES \`students\` (\`id\`) ON DELETE CASCADE,
                        FOREIGN KEY (\`requested_by\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
                );
                console.log('✅ [EduShare] student_change_requests table added.');
            }
        } catch (err) {
            console.warn('⚠️ Change-request table upgrade warning:', err.message);
        }

        // 2h. Notifications table (student notification center). Fresh installs
        // get it from the schema.sql runner above; this ensures existing DBs
        // migrate on boot. information_schema-gated, runs every start.
        try {
            const [nTables] = await conn.query(
                `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'notifications'`,
                [env.DB_NAME]
            );
            if (nTables[0].cnt === 0) {
                await conn.query(
                    `CREATE TABLE \`notifications\` (
                        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
                        \`student_id\` INT NOT NULL,
                        \`class_id\` INT DEFAULT NULL,
                        \`type\` ENUM('announcement','activity','material','quiz','grade','enrollment','reminder','system') NOT NULL DEFAULT 'announcement',
                        \`title\` VARCHAR(255) NOT NULL,
                        \`message\` VARCHAR(500) DEFAULT NULL,
                        \`link_url\` VARCHAR(500) DEFAULT NULL,
                        \`ref_type\` VARCHAR(50) NOT NULL DEFAULT '',
                        \`ref_id\` INT NOT NULL DEFAULT 0,
                        \`is_read\` TINYINT(1) NOT NULL DEFAULT 0,
                        \`read_at\` DATETIME DEFAULT NULL,
                        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE KEY \`unique_student_ref\` (\`student_id\`, \`ref_type\`, \`ref_id\`, \`class_id\`),
                        INDEX \`idx_notifications_student\` (\`student_id\`, \`is_read\`, \`created_at\`),
                        INDEX \`idx_notifications_class\` (\`class_id\`),
                        FOREIGN KEY (\`student_id\`) REFERENCES \`students\` (\`id\`) ON DELETE CASCADE,
                        FOREIGN KEY (\`class_id\`) REFERENCES \`classes\` (\`id\`) ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
                );
                console.log('✅ [EduShare] notifications table added.');
            }
        } catch (err) {
            console.warn('⚠️ Notifications table upgrade warning:', err.message);
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
        console.log('✅ [EduShare] System settings configured.');

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
            console.log('👑 [EduShare] Default Administrator account ensured.');
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
            console.log('👩‍🏫 [EduShare] Default Teacher account ensured.');
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
                console.log(`🎒 [EduShare] Default Student account ensured: ${s.email}`);
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
            console.log('🏫 [EduShare] Sample Class created: English 7 - Section Rizal (Code: ENG7RZ)');

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
            console.log('📝 [EduShare] Sample Quiz created and linked to Class & Gradebook.');
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
            console.log('📋 [EduShare] Sample Activity created and linked to Class & Gradebook.');
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
            const term = qtr === 'Q3' ? 'T2' : qtr === 'Q4' ? 'T3' : 'T1';
            await conn.query(
                `INSERT INTO competencies (code, description, subject, grade_level, quarter, term, source_version)
                 VALUES (?, ?, ?, ?, ?, ?, 'DepEd MATATAG 2024')
                 ON DUPLICATE KEY UPDATE description = VALUES(description), term = VALUES(term)`,
                [code, desc, subj, gr, qtr, term]
            );
        }
        console.log('📚 [EduShare] DepEd Competencies seeded.');

        console.log('✨ [EduShare] Database initialization fully completed! Ready for deployment.');
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
