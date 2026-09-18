// Usage: node src/scripts/reportBrokenQuizAnswers.js [--fix]
// Finds identification quiz questions with no answer key (zero quiz_options
// rows) and reports them. With --fix, attempts to recover the answer from the
// question's explanation (same helper the AI save path uses) and inserts it as
// an is_correct=1 quiz_option. Unrecoverable questions are listed for manual fix.
require('../config/env');
const { query, withTransaction, getPool } = require('../config/database');
const { resolveIdentificationAnswer } = require('../services/validationService');

async function main() {
    const fix = process.argv.slice(2).includes('--fix');
    const rows = await query(
        `SELECT qq.id, qq.quiz_id, qq.question_text, qq.explanation, q.title AS quiz_title, u.email AS teacher_email
           FROM quiz_questions qq
           JOIN quizzes q ON q.id = qq.quiz_id
           JOIN users u ON u.id = q.teacher_id
          WHERE qq.question_type = 'identification'
            AND NOT EXISTS (
                SELECT 1 FROM quiz_options qo WHERE qo.question_id = qq.id
            )
          ORDER BY qq.quiz_id, qq.order_index`
    );

    if (!rows.length) {
        console.log('No identification questions are missing an answer key.');
        return;
    }

    let fixed = 0;
    const cannotFix = [];
    console.log(`Found ${rows.length} identification question(s) with no answer key:`);
    for (const r of rows) {
        const aliases = resolveIdentificationAnswer({ explanation: r.explanation });
        const status = aliases.length ? aliases.join(' | ') : 'NO RECOVERABLE ANSWER';
        console.log(`- Q${r.id} (quiz #${r.quiz_id} "${r.quiz_title}", teacher ${r.teacher_email})`);
        console.log(`    text: ${String(r.question_text || '').slice(0, 100)}`);
        console.log(`    explanation: ${String(r.explanation || '').slice(0, 120)}`);
        if (aliases.length) {
            if (fix) {
                await withTransaction(async (conn) => {
                    for (const a of aliases) {
                        await conn.query(
                            'INSERT IGNORE INTO quiz_options (question_id, option_text, is_correct, order_index) VALUES (?, ?, 1, 1)',
                            [r.id, a]
                        );
                    }
                });
                fixed += 1;
                console.log(`    -> FIXED with aliases: ${status}`);
            } else {
                console.log(`    -> would insert: ${status}`);
            }
        } else {
            console.log(`    -> ${status} (fix manually via the quiz-maker)`);
            cannotFix.push(r);
        }
    }

    const total = rows.length;
    if (fix) {
        const left = total - fixed;
        console.log(left
            ? `\nFixed ${fixed}/${total}. ${left} question(s) still need a manual answer.`
            : `\nFixed ${fixed}/${total} question(s).`);
    } else {
        console.log(`\nRun with --fix to insert the recoverable answers. (${cannotFix.length} remain unfixable automatically.)`);
    }
}

main().catch((err) => {
    console.error('Report failed:', err.message);
    process.exit(1);
});