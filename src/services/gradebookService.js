const { query, withTransaction } = require('../config/database');

// Official DepEd Transmutation Table (DepEd Order 8, s. 2015)
const TRANSMUTATION_TABLE = [
    { min: 100.00, max: 100.00, grade: 100 },
    { min: 98.40, max: 99.99, grade: 99 },
    { min: 96.80, max: 98.39, grade: 98 },
    { min: 95.20, max: 96.79, grade: 97 },
    { min: 93.60, max: 95.19, grade: 96 },
    { min: 92.00, max: 93.59, grade: 95 },
    { min: 90.40, max: 91.99, grade: 94 },
    { min: 88.80, max: 90.39, grade: 93 },
    { min: 87.20, max: 88.79, grade: 92 },
    { min: 85.60, max: 87.19, grade: 91 },
    { min: 84.00, max: 85.59, grade: 90 },
    { min: 82.40, max: 83.99, grade: 89 },
    { min: 80.80, max: 82.39, grade: 88 },
    { min: 79.20, max: 80.79, grade: 87 },
    { min: 77.60, max: 79.19, grade: 86 },
    { min: 76.00, max: 77.59, grade: 85 },
    { min: 74.40, max: 75.99, grade: 84 },
    { min: 72.80, max: 74.39, grade: 83 },
    { min: 71.20, max: 72.79, grade: 82 },
    { min: 69.60, max: 71.19, grade: 81 },
    { min: 68.00, max: 69.59, grade: 80 },
    { min: 66.40, max: 67.99, grade: 79 },
    { min: 64.80, max: 66.39, grade: 78 },
    { min: 63.20, max: 64.79, grade: 77 },
    { min: 61.60, max: 63.19, grade: 76 },
    { min: 60.00, max: 61.59, grade: 75 }, // Passing threshold
    { min: 56.00, max: 59.99, grade: 74 },
    { min: 52.00, max: 55.99, grade: 73 },
    { min: 48.00, max: 51.99, grade: 72 },
    { min: 44.00, max: 47.99, grade: 71 },
    { min: 40.00, max: 43.99, grade: 70 },
    { min: 36.00, max: 39.99, grade: 69 },
    { min: 32.00, max: 35.99, grade: 68 },
    { min: 28.00, max: 31.99, grade: 67 },
    { min: 24.00, max: 27.99, grade: 66 },
    { min: 20.00, max: 23.99, grade: 65 },
    { min: 16.00, max: 19.99, grade: 64 },
    { min: 12.00, max: 15.99, grade: 63 },
    { min: 8.00, max: 11.99, grade: 62 },
    { min: 4.00, max: 7.99, grade: 61 },
    { min: 0.00, max: 3.99, grade: 60 }
];

function transmute(initialGrade) {
    if (initialGrade == null || isNaN(initialGrade)) return 60;
    const rounded = Math.round(Number(initialGrade) * 100) / 100;
    for (const tier of TRANSMUTATION_TABLE) {
        if (rounded >= tier.min) {
            return tier.grade;
        }
    }
    return 60;
}

function getDescriptor(transmutedGrade) {
    if (transmutedGrade >= 90) return 'Outstanding (O)';
    if (transmutedGrade >= 85) return 'Very Satisfactory (VS)';
    if (transmutedGrade >= 80) return 'Satisfactory (S)';
    if (transmutedGrade >= 75) return 'Fairly Satisfactory (FS)';
    return 'Did Not Meet Expectations (DNME)';
}

// Compute full gradebook data for a class
async function getClassGradebook(classId) {
    // 1. Get Categories
    const categories = await query(
        'SELECT * FROM gradebook_categories WHERE class_id = ? ORDER BY sort_order ASC',
        [classId]
    );

    // 2. Get Columns
    const columns = await query(
        'SELECT * FROM gradebook_columns WHERE class_id = ? ORDER BY category_id ASC, sort_order ASC',
        [classId]
    );

    // 3. Get Enrolled Students
    const students = await query(
        `SELECT s.id, s.student_id AS lrn, s.gender, u.first_name, u.last_name
         FROM enrollments e
         JOIN students s ON e.student_id = s.id
         JOIN users u ON s.user_id = u.id
         WHERE e.class_id = ? AND e.status = 'active'
         ORDER BY s.gender DESC, u.last_name ASC, u.first_name ASC`,
        [classId]
    );

    // 4. Get All Entries
    const entries = await query(
        `SELECT ge.column_id, ge.student_id, ge.score, ge.manual_override
         FROM gradebook_entries ge
         JOIN gradebook_columns gc ON ge.column_id = gc.id
         WHERE gc.class_id = ?`,
        [classId]
    );

    const entriesMap = {};
    for (const entry of entries) {
        if (!entriesMap[entry.student_id]) entriesMap[entry.student_id] = {};
        entriesMap[entry.student_id][entry.column_id] = {
            score: Number(entry.score),
            manual_override: !!entry.manual_override
        };
    }

    // Group columns by category
    const catMap = {};
    for (const cat of categories) {
        catMap[cat.id] = {
            ...cat,
            columns: columns.filter(col => col.category_id === cat.id),
            totalHPS: 0
        };
        catMap[cat.id].totalHPS = catMap[cat.id].columns.reduce((sum, col) => sum + (Number(col.max_score) || 0), 0);
    }

    // Calculate grades per student
    const studentGrades = students.map(student => {
        const studentData = {
            student,
            scores: {},
            categoryTotals: {},
            initialGrade: 0,
            transmutedGrade: 60,
            descriptor: 'Did Not Meet Expectations (DNME)',
            passed: false
        };

        let initialGradeTotal = 0;

        for (const catId of Object.keys(catMap)) {
            const cat = catMap[catId];
            let studentCatTotal = 0;

            for (const col of cat.columns) {
                const entry = entriesMap[student.id]?.[col.id];
                const score = entry !== undefined ? entry.score : 0;
                studentData.scores[col.id] = score;
                studentCatTotal += score;
            }

            const hps = cat.totalHPS || 1;
            const percentageScore = cat.totalHPS > 0 ? (studentCatTotal / hps) * 100 : 0;
            const weightedScore = percentageScore * (Number(cat.weight_percentage) / 100);

            studentData.categoryTotals[catId] = {
                totalScore: studentCatTotal,
                hps: cat.totalHPS,
                percentageScore: Math.round(percentageScore * 100) / 100,
                weightedScore: Math.round(weightedScore * 100) / 100
            };

            initialGradeTotal += weightedScore;
        }

        const roundedInitial = Math.round(initialGradeTotal * 100) / 100;
        const transmuted = transmute(roundedInitial);

        studentData.initialGrade = roundedInitial;
        studentData.transmutedGrade = transmuted;
        studentData.descriptor = getDescriptor(transmuted);
        studentData.passed = transmuted >= 75;

        return studentData;
    });

    return {
        categories: Object.values(catMap),
        columns,
        studentGrades
    };
}

// Automatically sync quiz scores to gradebook
async function syncQuizScore(quizId, classId, studentId, score, maxScore) {
    try {
        const columns = await query(
            `SELECT id, max_score FROM gradebook_columns 
             WHERE class_id = ? AND quiz_id = ? 
             LIMIT 1`,
            [classId, quizId]
        );

        if (columns.length === 0) return; // Not linked to gradebook
        const columnId = columns[0].id;

        // Check if existing manual override
        const existing = await query(
            'SELECT manual_override FROM gradebook_entries WHERE column_id = ? AND student_id = ?',
            [columnId, studentId]
        );

        if (existing.length > 0 && existing[0].manual_override === 1) {
            return; // Preserves teacher override
        }

        await query(
            `INSERT INTO gradebook_entries (column_id, student_id, score, manual_override)
             VALUES (?, ?, ?, 0)
             ON DUPLICATE KEY UPDATE score = VALUES(score)`,
            [columnId, studentId, score]
        );
    } catch (err) {
        console.warn('⚠️ Quiz sync to gradebook skipped:', err.message);
    }
}

module.exports = {
    TRANSMUTATION_TABLE,
    transmute,
    getDescriptor,
    getClassGradebook,
    syncQuizScore
};
