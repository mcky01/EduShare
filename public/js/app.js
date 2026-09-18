// EduShare Global Application Script

document.addEventListener('DOMContentLoaded', () => {
    // 1. Mobile Sidebar Toggle
    const sidebarToggleBtn = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('appSidebar') || document.querySelector('.liquid-sidebar');
    if (sidebarToggleBtn && sidebar) {
        const layout = document.querySelector('.main-layout');
        const setSidebar = (show) => {
            sidebar.classList.toggle('show', show);
            sidebarToggleBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
            if (layout) layout.classList.toggle('sidebar-open', show);
        };
        sidebarToggleBtn.addEventListener('click', () => {
            setSidebar(!sidebar.classList.contains('show'));
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sidebar.classList.contains('show')) {
                setSidebar(false);
                sidebarToggleBtn.focus();
            }
        });
        sidebar.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', () => setSidebar(false));
        });
        // Clicking the dimmed scrim closes the drawer. The scrim is a
        // ::after pseudo-element, so taps never hit .main-layout itself —
        // close when the click lands outside the open sidebar instead.
        if (layout) {
            layout.addEventListener('click', (e) => {
                if (!sidebar.contains(e.target) && sidebar.classList.contains('show')) setSidebar(false);
            });
        }
    }

    // Navbar contrast on scroll (pairs with .navbar-scrolled in CSS).
    const navbar = document.querySelector('.liquid-navbar');
    if (navbar) {
        const syncNavbar = () => navbar.classList.toggle('navbar-scrolled', window.scrollY > 8);
        document.addEventListener('scroll', syncNavbar, { passive: true });
        syncNavbar();
    }

    // 1b. Auto-submit helper: any <select data-auto-submit="<formId>">
    // submits that GET form on change. CSP-safe replacement for inline
    // onchange="location.href=..." navigation (blocked by script-src-attr
    // 'none', which is why the admin Status filter silently did nothing).
    document.querySelectorAll('select[data-auto-submit]').forEach((sel) => {
        sel.addEventListener('change', () => {
            const form = document.getElementById(sel.getAttribute('data-auto-submit'));
            if (form) form.requestSubmit();
        });
    });

    // 1c. CSP-safe toast dismiss (replaces inline onclick handlers).
    document.querySelectorAll('[data-dismiss-toast]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const toast = btn.closest('.liquid-toast');
            if (toast) toast.remove();
        });
    });

    // 1d. Global copy-to-clipboard: any .copy-code-btn with a data-code
    // attribute copies + announces via a nearby live region (explicit
    // data-feedback target, closest .copy-feedback, or the page-level
    // #copyFeedback live region). Covers all roles; idempotent.
    document.querySelectorAll('.copy-code-btn').forEach((btn) => {
        if (btn.dataset.copyWired) return;
        btn.dataset.copyWired = '1';
        btn.addEventListener('click', async () => {
            const code = btn.getAttribute('data-code') || '';
            if (!code) return;
            let ok = false;
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(code);
                    ok = true;
                }
            } catch { ok = false; }
            if (!ok) {
                try {
                    const ta = document.createElement('textarea');
                    ta.value = code;
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    ta.select();
                    ok = document.execCommand('copy');
                    ta.remove();
                } catch { ok = false; }
            }
            // Feedback: prefer an explicit data-feedback target, else the
            // closest .copy-feedback node, else the button title.
            const target = (btn.getAttribute('data-feedback') && document.getElementById(btn.getAttribute('data-feedback')))
                || btn.closest('.glass-card')?.querySelector('.copy-feedback')
                || btn.parentElement?.querySelector('.copy-feedback')
                || document.getElementById('copyFeedback');
            if (target) {
                target.textContent = ok ? 'Copied!' : 'Copy failed — select the text manually.';
                setTimeout(() => { target.textContent = ''; }, 2500);
            } else {
                btn.setAttribute('title', ok ? 'Copied!' : 'Copy failed');
            }
        });
    });

    // 1e. Mobile search entry (CSP-safe replacement for inline onclick).
    // Calls the omnisearch opener lazily (defined in section 2 below).
    const mobileSearchBtn = document.getElementById('mobileSearchBtn');
    if (mobileSearchBtn) {
        mobileSearchBtn.addEventListener('click', () => {
            if (typeof window.openOmniSearch === 'function') window.openOmniSearch();
        });
    }

    // 1f. Avatar fallback (CSP-safe replacement for inline onerror).
    // Capture-phase listener catches img failures (error events do not
    // bubble); plus a sweep for images that already failed before this
    // script ran. Only images carrying data-avatar-fallback are touched.
    document.addEventListener('error', (e) => {
        const t = e.target;
        if (t && t.tagName === 'IMG' && t.hasAttribute && t.hasAttribute('data-avatar-fallback')) {
            t.style.display = 'none';
        }
    }, true);
    document.querySelectorAll('img[data-avatar-fallback]').forEach((img) => {
        if (img.complete && img.naturalWidth === 0) img.style.display = 'none';
    });

    // 1g. Destructive-action confirm (CSP-safe replacement for inline
    // onclick="return confirm(...)" on submit buttons and links).
    // Click-time only; reason checks live in the submit handler (1h), which
    // preserves the original `confirm(...) && reason...` evaluation order.
    document.addEventListener('click', (e) => {
        const el = e.target && e.target.closest ? e.target.closest('[data-confirm]') : null;
        if (!el || el.tagName === 'FORM') return;
        if (el.tagName !== 'BUTTON' && el.tagName !== 'A') return;
        const msg = el.getAttribute('data-confirm');
        if (msg && !window.confirm(msg)) {
            e.preventDefault();
            e.stopPropagation();
        }
    });

    // 1h. Guarded-submit handler (CSP-safe replacement for inline
    // onsubmit="return confirm(...)" / reason-length checks).
    // data-confirm on a form asks first (skipped when the clicked submit
    // button already confirmed at click time via its own data-confirm).
    // data-require-reason blocks submit unless the named reason field
    // (default "reason") is >= 10 chars, alerting otherwise — the exact
    // semantics of the old `this.reason.value.trim().length >= 10 ||
    // (alert(...), false)` guards. data-reason-field names variants
    // (decision_reason / decision_note); data-reason-alert customises text.
    document.addEventListener('submit', (e) => {
        const form = e.target;
        if (!form || !form.hasAttribute) return;
        if (!form.hasAttribute('data-confirm') && !form.hasAttribute('data-require-reason')) return;
        if (form.hasAttribute('data-confirm')) {
            const submitterConfirmed = e.submitter && e.submitter.hasAttribute
                && e.submitter.hasAttribute('data-confirm');
            if (!submitterConfirmed && !window.confirm(form.getAttribute('data-confirm'))) {
                e.preventDefault();
                return;
            }
        }
        if (form.hasAttribute('data-require-reason')) {
            const name = form.getAttribute('data-reason-field') || 'reason';
            const field = form.querySelector('[name="' + name + '"]');
            const val = field ? field.value.trim() : '';
            if (val.length < 10) {
                e.preventDefault();
                alert(form.getAttribute('data-reason-alert') || 'A reason of at least 10 characters is required.');
                if (field) field.focus();
            }
        }
    });

    // 1i. Generic disclosure toggle (CSP-safe replacement for inline
    // onchange="...style.display = this.checked ..."). Any checkbox with
    // data-toggle-target="<elementId>" shows/hides that element.
    document.querySelectorAll('input[data-toggle-target]').forEach((box) => {
        const panel = document.getElementById(box.getAttribute('data-toggle-target'));
        if (!panel) return;
        box.addEventListener('change', () => {
            panel.style.display = box.checked ? 'block' : 'none';
        });
    });

    // 2. Global Omnisearch (Ctrl+K or Cmd+K)
    const searchModalEl = document.getElementById('omniSearchModal');
    const searchInput = document.getElementById('omniSearchInput');
    const searchResults = document.getElementById('omniSearchResults');

    let searchModal = null;
    if (searchModalEl && window.bootstrap) {
        searchModal = new bootstrap.Modal(searchModalEl);
    }

    window.openOmniSearch = () => {
        if (!searchModalEl) return;
        if (searchModal) {
            searchModal.show();
            setTimeout(() => searchInput && searchInput.focus(), 300);
        } else if (searchInput) {
            // Bootstrap JS unavailable: fall back to focusing the inline field.
            searchInput.focus();
        }
    };

    const omniTrigger = document.getElementById('omniSearchTrigger');
    if (omniTrigger) {
        omniTrigger.addEventListener('click', () => window.openOmniSearch());
    }

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            if (!searchModalEl) return;
            e.preventDefault();
            window.openOmniSearch();
        }
    });

    // Omnisearch live fetch with debounce
    let debounceTimer;
    if (searchInput && searchResults) {
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            const query = searchInput.value.trim();

            if (query.length < 2) {
                searchResults.innerHTML = '<div class="text-center text-muted p-4"><i class="bi bi-search fs-3 d-block mb-2"></i>Type at least 2 characters to search classes, materials, quizzes...</div>';
                return;
            }

            searchResults.innerHTML = '<div class="text-center text-muted p-4"><div class="spinner-border text-success" role="status"><span class="visually-hidden">Searching EduShare...</span></div><div class="mt-2">Searching EduShare...</div></div>';

            debounceTimer = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
                    const data = await res.json();

                    if (!data.results || data.results.length === 0) {
                        searchResults.innerHTML = `<div class="text-center text-muted p-4"><i class="bi bi-emoji-neutral fs-3 d-block mb-2"></i>No matches found for "${escapeHtml(query)}".</div>`;
                        return;
                    }

                    searchResults.innerHTML = data.results.map(item => `
                        <a href="${sanitizeSearchUrl(item.url)}" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center p-3 border-0 mb-2 rounded-3" style="background: rgba(255,255,255,0.7); backdrop-filter: blur(8px);">
                            <div>
                                <div class="fw-bold text-dark">${escapeHtml(item.title)}</div>
                                <div class="small text-muted">${escapeHtml(item.subtitle)}</div>
                            </div>
                            <span class="${sanitizeSearchBadge(item.badge)}">${escapeHtml(item.type)}</span>
                        </a>
                    `).join('');
                } catch (err) {
                    console.warn('Omnisearch failed:', err && err.message ? err.message : err);
                    searchResults.innerHTML = '<div class="text-center text-danger p-4">Error loading results. <button type="button" class="btn btn-sm btn-glass mt-2" id="omniSearchRetry">Retry</button></div>';
                    const retry = document.getElementById('omniSearchRetry');
                    if (retry && searchInput) retry.addEventListener('click', () => searchInput.dispatchEvent(new Event('input')));
                }
            }, 250);
        });
    }

    // Auto-dismiss Flash Toasts: success/info after 5s (paused on hover);
    // errors persist until dismissed (Q7).
    const toasts = document.querySelectorAll('.liquid-toast');
    toasts.forEach(t => {
        if (t.getAttribute('role') === 'alert') return;
        let timer = null;
        const dismiss = () => {
            t.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            t.style.opacity = '0';
            t.style.transform = 'translateX(100%)';
            setTimeout(() => t.remove(), 500);
        };
        const arm = () => {
            clearTimeout(timer);
            timer = setTimeout(dismiss, 5000);
        };
        t.addEventListener('mouseenter', () => clearTimeout(timer));
        t.addEventListener('mouseleave', arm);
        t.addEventListener('focusin', () => clearTimeout(timer));
        t.addEventListener('focusout', arm);
        arm();
    });
});

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\//g, '&#x2F;').replace(/=/g, '&#x3D;').replace(/`/g, '&#x60;');
}

function sanitizeSearchUrl(url) {
    if (typeof url !== 'string' || !url.startsWith('/')) return '#';
    const segment = url.split('/')[1] || '';
    const allowed = ['files', 'teacher', 'student', 'admin', 'api', 'auth'];
    return allowed.includes(segment) ? url : '#';
}

function sanitizeSearchBadge(badge) {
    const allowed = ['badge-emerald', 'badge-amber', 'badge-gray', 'badge-jade'];
    return allowed.includes(badge) ? badge : 'badge-gray';
}
