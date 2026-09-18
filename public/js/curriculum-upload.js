// EduShare Admin Curriculum: competency filter + document ingest.
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

function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderChunkRow(host, c) {
    var card = document.createElement('div');
    card.className = 'p-2 rounded-3';
    card.style.cssText = 'background: rgba(255,255,255,0.5); border-left: 3px solid var(--zahs-jade);';
    var meta = '#' + c.chunk_index + ' · doc ' + c.document_id + (c.quarter ? ' · ' + c.quarter : '') + (c.term ? ' · ' + c.term : '') + (c.competency_code ? ' · ' + c.competency_code : '');
    card.innerHTML = '<div class="fw-bold text-dark">' + escHtml(c.title || ('Document ' + c.document_id)) + ' <span class="text-muted fw-normal">' + escHtml(meta) + '</span></div>'
        + '<div class="text-secondary">' + escHtml(c.preview || c.content || '') + '</div>';
    host.appendChild(card);
}

async function loadChunks(docId, host, btn) {
    host.innerHTML = '';
    var note = document.createElement('div');
    note.className = 'text-muted';
    note.textContent = 'Loading chunks…';
    host.appendChild(note);
    if (btn) { btn.disabled = true; btn.setAttribute('aria-disabled', 'true'); }
    try {
        var res = await fetch('/api/curriculum/chunks?document_id=' + encodeURIComponent(docId) + '&limit=20', {
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        var data = await res.json();
        host.innerHTML = '';
        var rows = (data && data.chunks) || [];
        if (!rows.length) {
            host.textContent = 'No chunks stored for document #' + docId + '. Re-ingest with “Replace existing” ticked.';
            return;
        }
        rows.slice(0, 20).forEach(function (c) { renderChunkRow(host, c); });
        var more = document.createElement('div');
        more.className = 'text-muted';
        more.textContent = rows.length + ' chunk(s) shown (latest first).';
        host.appendChild(more);
    } catch (err) {
        host.innerHTML = '';
        var fail = document.createElement('div');
        fail.className = 'text-danger fw-semibold';
        fail.textContent = 'Could not load chunks — check your connection and retry.';
        host.appendChild(fail);
    } finally {
        if (btn) { btn.disabled = false; btn.removeAttribute('aria-disabled'); }
    }
}

async function previewSources(topic, host, btn) {
    host.innerHTML = '';
    if (!topic) { host.textContent = 'Type a topic first (e.g. verb tenses).'; return; }
    var note = document.createElement('div');
    note.className = 'text-muted';
    note.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Retrieving grounded sources…';
    host.appendChild(note);
    if (btn) { btn.disabled = true; btn.setAttribute('aria-disabled', 'true'); }
    try {
        var csrf = document.querySelector('meta[name=csrf-token]')?.content || window.CSRF_TOKEN || '';
        var res = await fetch('/api/curriculum/preview-sources', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrf },
            body: JSON.stringify({ topic: topic })
        });
        var data = await res.json();
        host.innerHTML = '';
        if (!res.ok) {
            host.textContent = (data && data.error) || ('Preview unavailable (HTTP ' + res.status + ').');
            return;
        }
        var head = document.createElement('div');
        head.className = 'fw-bold ' + (data.grounded ? 'text-success' : 'text-warning');
        head.textContent = data.grounded ? 'Grounded — teacher generation would cite these:' : ('Not grounded: ' + (data.reason || 'no chunks matched.'));
        host.appendChild(head);
        ((data && data.sources) || []).slice(0, 5).forEach(function (s) {
            var card = document.createElement('div');
            card.className = 'p-2 rounded-3';
            card.style.cssText = 'background: rgba(255,255,255,0.5); border-left: 3px solid var(--zahs-amber-gold);';
            card.textContent = typeof s === 'string' ? s : JSON.stringify(s);
            host.appendChild(card);
        });
    } catch (err) {
        host.innerHTML = '';
        var fail = document.createElement('div');
        fail.className = 'text-danger fw-semibold';
        fail.textContent = 'Preview failed — check your connection and retry.';
        host.appendChild(fail);
    } finally {
        if (btn) { btn.disabled = false; btn.removeAttribute('aria-disabled'); }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('compSubject')?.addEventListener('change', filterCompetencies);
    document.getElementById('compGrade')?.addEventListener('change', filterCompetencies);
    // Chunks + preview explorer wiring (admin curriculum card).
    var chunksInput = document.getElementById('chunksDocId');
    var chunksBtn = document.getElementById('btnViewChunks');
    var chunksHost = document.getElementById('chunksResult');
    if (chunksBtn && chunksHost) {
        chunksBtn.addEventListener('click', () => loadChunks((chunksInput?.value || '').trim(), chunksHost, chunksBtn));
    }
    document.querySelectorAll('[data-chunks-doc]').forEach((b) => {
        b.addEventListener('click', () => {
            if (chunksInput) chunksInput.value = b.getAttribute('data-chunks-doc');
            if (chunksHost) loadChunks(b.getAttribute('data-chunks-doc'), chunksHost, chunksBtn);
            chunksHost?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
    });
    // Refresh the doc-id hint after a successful ingest (hook called above).
    window.adminCurriculumRefreshDocs = function () {
        if (chunksHost && !chunksHost.hasChildNodes()) {
            chunksHost.textContent = 'Ingest complete — reload the page to see the new document row, or enter its # above.';
        }
    };
    var prevBtn = document.getElementById('btnPreviewSources');
    var prevTopic = document.getElementById('previewTopic');
    var prevHost = document.getElementById('previewResult');
    if (prevBtn && prevHost) {
        prevBtn.addEventListener('click', () => previewSources((prevTopic?.value || '').trim(), prevHost, prevBtn));
    }

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
        btn.setAttribute('aria-disabled', 'true');
        var labelHtml = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Ingesting\u2026';
        status.textContent = 'Parsing + embedding… (large PDFs take a minute)';
        status.className = 'small fw-semibold text-muted';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
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
            btn.removeAttribute('aria-disabled');
            btn.innerHTML = labelHtml;
        }
        // Chunks + preview explorer (below) picks up the new doc id on next lookup.
        if (typeof window.adminCurriculumRefreshDocs === 'function') {
            try { window.adminCurriculumRefreshDocs(); } catch (e) { /* explorer is optional */ }
        }
    });
});
