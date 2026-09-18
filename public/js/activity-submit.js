// EduShare Student activity submission: validation + upload progress state.
// Wires #activitySubmitForm: checks file type/size (50MB, matches multer
// documentFilter), shows inline error (aria-live), disables the submit button
// while uploading with an indeterminate-then-complete progress bar.
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('activitySubmitForm');
    if (!form) return;
    const fileInput = document.getElementById('submissionFileInput');
    const noteInput = form.querySelector('textarea[name="note"]');
    const btn = document.getElementById('activitySubmitBtn');
    const label = document.getElementById('activitySubmitLabel');
    const errBox = document.getElementById('activitySubmitError');
    const progWrap = document.getElementById('activityUploadProgress');
    const progBar = document.getElementById('activityUploadBar');
    const ALLOWED = ['pdf','docx','pptx','xlsx','txt','jpg','jpeg','png','gif','webp'];
    const MAX = 50 * 1024 * 1024;
    const showError = (msg) => {
        if (!errBox) { alert(msg); return; }
        errBox.textContent = msg;
        errBox.classList.remove('d-none');
        errBox.focus && errBox.focus();
    };
    const clearError = () => { if (errBox) { errBox.textContent = ''; errBox.classList.add('d-none'); } };
    const setProgress = (pct) => {
        if (!progWrap || !progBar) return;
        progWrap.classList.remove('d-none');
        progBar.style.width = pct + '%';
        progBar.textContent = pct + '%';
        progWrap.setAttribute('aria-valuenow', String(pct));
    };
    form.addEventListener('submit', (e) => {
        clearError();
        const file = fileInput && fileInput.files && fileInput.files[0];
        const note = (noteInput && noteInput.value.trim()) || '';
        const hasExisting = fileInput && !fileInput.hasAttribute('required');
        if (!file && !note && !hasExisting) {
            e.preventDefault();
            showError('Attach a file or write a note before submitting.');
            return;
        }
        if (file) {
            const ext = (file.name.split('.').pop() || '').toLowerCase();
            if (!ALLOWED.includes(ext)) {
                e.preventDefault();
                showError(`File type .${ext} is not allowed. Use PDF, DOCX, PPTX, XLSX, TXT, or an image.`);
                return;
            }
            if (file.size > MAX) {
                e.preventDefault();
                showError(`File is ${(file.size/1048576).toFixed(1)} MB — the limit is 50 MB.`);
                return;
            }
        }
        // Disabled-while-uploading state with progress feedback.
        if (btn) {
            btn.disabled = true;
            btn.setAttribute('aria-busy', 'true');
        }
        if (label) label.textContent = 'Uploading…';
        setProgress(15);
        let pct = 15;
        const tick = setInterval(() => {
            pct = Math.min(pct + 9, 90);
            setProgress(pct);
            if (pct >= 90) clearInterval(tick);
        }, 400);
        // Native form submit continues; progress completes on navigation.
    });
});
