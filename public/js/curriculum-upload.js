// EduShare 2.0 Admin Curriculum: competency filter + document ingest.
// Client-side competency filter (no reload; server data already rendered)
function filterCompetencies() {
    const subject = document.getElementById('compSubject')?.value || '';
    const grade = document.getElementById('compGrade')?.value || '';
    document.querySelectorAll('.glass-table tbody tr[data-subject]').forEach(row => {
        const matchSubject = !subject || row.dataset.subject === subject;
        const matchGrade = !grade || row.dataset.grade === grade;
        row.style.display = (matchSubject && matchGrade) ? '' : 'none';
    });
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('compSubject')?.addEventListener('change', filterCompetencies);
    document.getElementById('compGrade')?.addEventListener('change', filterCompetencies);

    // Curriculum PDF/txt ingest (FormData; session cookie + CSRF header)
    document.getElementById('curriculumUploadForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const status = document.getElementById('uploadStatus');
        const btn = document.getElementById('btnUploadDoc');
        const file = document.getElementById('docFile').files[0];
        if (!file) { status.textContent = 'Pick a .pdf or .txt file first.'; status.className = 'small fw-semibold text-danger'; return; }

        const fd = new FormData();
        fd.append('title', document.getElementById('docTitle').value.trim());
        fd.append('doc_type', document.getElementById('docType').value);
        fd.append('subject', document.getElementById('docSubject').value.trim());
        fd.append('grade_level', document.getElementById('docGrade').value);
        fd.append('quarter', document.getElementById('docQuarter').value);
        fd.append('competency_code', document.getElementById('docCompCode').value.trim());
        fd.append('curriculum_file', file);
        if (document.getElementById('docForce')?.checked) fd.append('force', '1');
        const csrf = document.querySelector('meta[name=csrf-token]')?.content || window.CSRF_TOKEN || '';

        btn.disabled = true;
        status.textContent = 'Parsing + embedding… (large PDFs take a minute)';
        status.className = 'small fw-semibold text-muted';
        try {
            const res = await fetch('/api/curriculum/ingest', {
                method: 'POST',
                headers: { 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrf },
                body: fd
            });
            const data = await res.json();
            if (data.success) {
                const terms = Array.isArray(data.terms) && data.terms.length ? data.terms.join('/') : data.term;
                status.textContent = `Done: ${data.chunks} chunks → Terms ${terms} (doc #${data.documentId})`;
                status.className = 'small fw-semibold text-success';
                e.target.reset();
            } else {
                status.textContent = data.error || 'Ingest failed.';
                status.className = 'small fw-semibold text-danger';
            }
        } catch (err) {
            status.textContent = 'Network error during ingest.';
            status.className = 'small fw-semibold text-danger';
        } finally {
            btn.disabled = false;
        }
    });
});
