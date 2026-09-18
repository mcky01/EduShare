// Admin settings: instant logo preview + dirty-state badge (CSP-safe external file).
document.addEventListener('DOMContentLoaded', () => {
    function markSettingsDirty() {
        const badge = document.getElementById('dirtyBadge');
        if (badge) badge.classList.remove('d-none');
    }
    const logoInput = document.getElementById('logoUpload');
    if (logoInput) {
        logoInput.addEventListener('change', () => {
            const file = logoInput.files && logoInput.files[0];
            if (!file) return;
            const url = URL.createObjectURL(file);
            const preview = document.querySelector('.glass-card img[alt="School Crest"]');
            if (preview) preview.src = url;
            markSettingsDirty();
        });
    }
    document.querySelector('form[action="/admin/settings"]')?.addEventListener('input', markSettingsDirty);
});
