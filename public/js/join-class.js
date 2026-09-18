// EduShare Student join-class: client validation + double-submit guard.
// Server remains the source of truth (flash success/error + redirect);
// this only blocks obviously-bad codes early and prevents double POSTs.
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('joinClassForm');
    if (!form) return;
    const input = document.getElementById('joinClassCode');
    const btn = document.getElementById('joinClassSubmitBtn');
    const err = document.getElementById('joinClassError');
    const show = (msg) => {
        if (!err) return;
        err.textContent = msg;
        err.classList.remove('d-none');
    };
    const clear = () => { if (err) { err.textContent = ''; err.classList.add('d-none'); } };
    if (input) {
        input.addEventListener('input', () => {
            input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
            clear();
        });
    }
    form.addEventListener('submit', (e) => {
        clear();
        const code = (input && input.value.trim()) || '';
        if (!/^[A-Z0-9]{6}$/.test(code)) {
            e.preventDefault();
            show('Enter the 6-character class code (letters and numbers only).');
            if (input) input.focus();
            return;
        }
        if (btn) {
            btn.disabled = true;
            btn.setAttribute('aria-busy', 'true');
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span> Joining…';
        }
    });
});
