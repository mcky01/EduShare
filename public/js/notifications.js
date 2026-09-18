// Student notification bell: polling + dropdown + mark-read.
// CSP-safe (no inline handlers). Polls the same-origin reader API.
(function () {
    const POLL_MS = 60000;
    const DROPDOWN_LIMIT = 8;
    const badge = () => document.getElementById('notifBadge');
    const list = () => document.getElementById('notifList');
    const bellBtn = () => document.getElementById('notifBellBtn');
    if (!bellBtn()) return;
    const csrf = () => { const m = document.querySelector('meta[name=csrf-token]'); return (m && m.content) || window.CSRF_TOKEN || ''; };
    const baseHeaders = () => ({ 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrf() });
    const TYPE_ICON = {
        announcement: 'bi-megaphone text-success',
        activity: 'bi-pencil-square text-primary',
        material: 'bi-folder2-open text-warning',
        quiz: 'bi-card-checklist text-warning',
        grade: 'bi-award text-success',
        enrollment: 'bi-bookmark-check text-success',
        reminder: 'bi-alarm text-danger',
        system: 'bi-info-circle text-secondary'
    };
    function esc(s) {
        return String(s === null || s === undefined ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    }
    function timeAgo(value) {
        const t = new Date(value).getTime();
        if (Number.isNaN(t)) return '';
        const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
        if (s < 60) return 'just now';
        const m = Math.floor(s / 60);
        if (m < 60) return m + 'm ago';
        const h = Math.floor(m / 60);
        if (h < 24) return h + 'h ago';
        const d = Math.floor(h / 24);
        if (d < 30) return d + 'd ago';
        return new Date(value).toLocaleDateString();
    }
    function renderBadge(unread) {
        const b = badge();
        if (!b) return;
        const n = Number(unread) || 0;
        b.textContent = n > 99 ? '99+' : String(n);
        b.hidden = n <= 0;
        b.classList.toggle('bg-danger', n > 0);
        b.classList.toggle('bg-secondary', n <= 0);
        const btn = bellBtn();
        if (btn) btn.setAttribute('aria-label', n > 0 ? ('Notifications, ' + n + ' unread') : 'Notifications');
    }
    function itemEl(n) {
        const a = document.createElement('a');
        a.href = n.link_url || '/student/notifications';
        a.className = 'rounded-3 p-2 text-decoration-none d-block' + (n.is_read ? '' : ' fw-semibold');
        a.style.background = n.is_read ? 'transparent' : 'rgba(16,185,129,0.08)';
        a.style.border = n.is_read ? '1px solid transparent' : '1px solid rgba(16,185,129,0.2)';
        const icon = TYPE_ICON[n.type] || TYPE_ICON.system;
        const cls = n.class_name ? esc(n.class_name) + ' - ' : '';
        const msg = n.message ? '<div class="small text-muted text-truncate">' + esc(n.message) + '</div>' : '';
        const pill = n.is_read ? '' : '<span class="badge rounded-pill bg-success mt-1">New</span>';
        a.innerHTML = '<div class="d-flex gap-2 align-items-start">'
            + '<i class="bi ' + icon + ' mt-1" aria-hidden="true"></i>'
            + '<div class="flex-grow-1 min-w-0">'
            + '<div class="small text-dark">' + esc(n.title) + '</div>'
            + msg
            + '<div class="small text-muted mt-1">' + cls + esc(timeAgo(n.created_at)) + '</div>'
            + '</div>' + pill + '</div>';
        a.addEventListener('click', () => {
            if (n.is_read) return;
            fetch('/api/notifications/' + n.id + '/read', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, baseHeaders()) }).catch(() => {});
        });
        return a;
    }
    async function refreshDropdown() {
        const el = list();
        if (!el) return;
        try {
            const res = await fetch('/api/notifications?limit=' + DROPDOWN_LIMIT, { headers: baseHeaders() });
            if (!res.ok) throw new Error('http ' + res.status);
            const data = await res.json();
            renderBadge(data.unread);
            el.innerHTML = '';
            if (!data.items || data.items.length === 0) {
                el.innerHTML = '<div class="text-center text-muted small p-3">All caught up. No notifications yet.</div>';
                return;
            }
            for (const n of data.items) el.appendChild(itemEl(n));
        } catch (e) {
            el.innerHTML = '<div class="text-center text-muted small p-3">Could not load notifications. <a href="/student/notifications">View all</a></div>';
        }
    }
    async function refreshBadge() {
        try {
            const res = await fetch('/api/notifications/unread-count', { headers: baseHeaders() });
            if (!res.ok) return;
            const data = await res.json();
            const prev = Number(badge() ? badge().textContent : 0) || 0;
            renderBadge(data.unread);
            if (Number(data.unread) > prev) refreshDropdown();
        } catch (e) { /* keep last badge */ }
    }
    bellBtn().addEventListener('click', refreshDropdown);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshBadge(); });
    setInterval(refreshBadge, POLL_MS);
    refreshDropdown();
})();
