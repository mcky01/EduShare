function generateGradebookCSV(gradebookData, className) {
    const { categories, columns, studentGrades } = gradebookData;
    const lines = [];

    // Header metadata
    lines.push(`"Class: ${className}"`);
    lines.push(`"Generated: ${new Date().toLocaleString()}"`);
    lines.push('');

    // Table Header Row 1: Student info + Column names + Totals
    const headerCols = ['LRN', 'Student Name', 'Gender'];
    for (const cat of categories) {
        for (const col of cat.columns) {
            headerCols.push(`"${col.column_name} (HPS: ${col.max_score})"`);
        }
        headerCols.push(`"${cat.category_name} Total"`);
        headerCols.push(`"${cat.category_name} WS (${cat.weight_percentage}%)"`);
    }
    headerCols.push('"Initial Grade"', '"Transmuted Grade"', '"Remarks"');
    lines.push(headerCols.join(','));

    // Student rows
    for (const sg of studentGrades) {
        const row = [
            `"${sg.student.lrn}"`,
            `"${sg.student.last_name}, ${sg.student.first_name}"`,
            `"${sg.student.gender}"`
        ];

        for (const cat of categories) {
            for (const col of cat.columns) {
                row.push(sg.scores[col.id] != null ? sg.scores[col.id] : 0);
            }
            const catTotal = sg.categoryTotals[cat.id];
            row.push(catTotal ? catTotal.totalScore : 0);
            row.push(catTotal ? catTotal.weightedScore : 0);
        }

        row.push(sg.initialGrade);
        row.push(sg.transmutedGrade);
        row.push(`"${sg.passed ? 'Passed' : 'Failed'}"`);
        lines.push(row.join(','));
    }

    return lines.join('\n');
}

module.exports = {
    generateGradebookCSV
};
