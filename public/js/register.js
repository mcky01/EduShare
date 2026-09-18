// EduShare Register page script (CSP-safe external file, vanilla, no deps).
// Replaces the old inline tab-toggle <script> + onclick attributes, which are
// dead under the helmet CSP (script-src 'self', script-src-attr 'none').
(function () {
    'use strict';

    var TABS = ['teacher', 'student'];

    function getEl(id) {
        return document.getElementById(id);
    }

    // Move keyboard focus to the first field of the newly shown pane
    // (autofocus-first-field + Enter-submits stays native). Harmless when
    // the pane is hidden (server-rendered verify step of the other tab).
    function focusFirstField(which) {
        var pane = getEl(which === 'teacher' ? 'teacherPane' : 'studentPane');
        if (!pane || pane.hidden) return;
        var field = pane.querySelector('input:not([type="hidden"]), select');
        if (field && typeof field.focus === 'function') {
            try { field.focus(); } catch (err) { /* noop */ }
        }
    }

    // Tab toggle: switches visible pane without a page reload.
    // Visuals key off aria-selected via .auth-role-tab in liquid-glass.css,
    // so only pane visibility + aria-selected need updating here.
    function showRegisterTab(which, moveFocus) {
        if (TABS.indexOf(which) === -1) which = 'teacher';
        TABS.forEach(function (key) {
            var active = key === which;
            var pane = getEl(key === 'teacher' ? 'teacherPane' : 'studentPane');
            var btn = getEl(key === 'teacher' ? 'tabBtnTeacher' : 'tabBtnStudent');
            if (pane) {
                pane.hidden = !active;
                pane.style.display = active ? '' : 'none';
            }
            if (btn) {
                btn.setAttribute('aria-selected', active ? 'true' : 'false');
            }
        });
        hideClientError();
        // First paint passes moveFocus=false (server autofocus owns it);
        // tab clicks move focus to the new pane's first field.
        if (moveFocus !== false) focusFirstField(which);
    }

    // OTP expiry countdown: every [data-otp-countdown] span ticks mm:ss
    // down from data-ttl minutes (server OTP_TTL_MINUTES = 10). Advisory
    // only — validity is enforced server-side, so a re-render restarting
    // the clock is harmless. The span itself is aria-live off (a per-second
    // live region would be chatty); expiry is announced once via the
    // form's [data-otp-announce] polite live region, if present.
    function initOtpCountdowns() {
        document.querySelectorAll('[data-otp-countdown]').forEach(function (el) {
            if (el.dataset.countdownBound === '1') return;
            el.dataset.countdownBound = '1';
            var ttlMin = parseInt(el.getAttribute('data-ttl') || '10', 10) || 10;
            var end = Date.now() + ttlMin * 60 * 1000;
            var form = el.closest ? el.closest('form') : null;
            var announce = form ? form.querySelector('[data-otp-announce]') : null;
            function tick() {
                var remain = Math.max(0, Math.round((end - Date.now()) / 1000));
                var mm = Math.floor(remain / 60);
                var ss = remain % 60;
                el.textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
                if (remain <= 0) {
                    clearInterval(timer);
                    el.textContent = 'expired';
                    if (announce) announce.textContent = 'Your verification code expired. Press Resend code for a fresh one.';
                }
            }
            var timer = setInterval(tick, 1000);
            tick();
        });
    }

    // Password peek toggle (canonical pattern): swap input type, update aria,
    // restore focus with caret at end, swap bi-eye/bi-eye-slash via className
    // (no innerHTML destruction, so the bound listener survives).
    function togglePasswordVisibility(inputId, btn) {
        var input = getEl(inputId);
        if (!input || !btn) return;
        var icon = btn.querySelector('i');
        var showing = input.type === 'password';
        input.type = showing ? 'text' : 'password';
        btn.setAttribute('aria-pressed', showing ? 'true' : 'false');
        btn.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
        if (icon) icon.className = showing ? 'bi bi-eye-slash' : 'bi bi-eye text-muted';
        input.focus();
        try {
            var len = input.value.length;
            input.setSelectionRange(len, len);
        } catch (err) {
            // setSelectionRange unsupported here: focus restore is enough.
        }
    }

    function showClientError(message) {
        var box = getEl('clientError');
        if (!box) return;
        var text = getEl('clientErrorText');
        if (text) text.textContent = message;
        else box.textContent = message;
        box.hidden = false;
        if (box.classList) box.classList.remove('d-none');
    }

    function hideClientError() {
        var box = getEl('clientError');
        if (!box) return;
        box.hidden = true;
        if (box.classList) box.classList.add('d-none');
    }

    // Submit loading state: swap the button content for a spinner + text
    // and lock it with disabled + aria-disabled. Setting disabled inside
    // the submit handler (after validation) is safe — the submission has
    // already been initiated; only disabling in a click handler *before*
    // submit aborts Chromium. Guarded by data-loading + per-form
    // dataset.submitted so slow OTP POSTs cannot double-submit. There is
    // no global double-submit guard in app.js (only data-confirm/reason),
    // so this auth-scoped guard does not duplicate shared work.
    // label: explicit override; target: the exact clicked submit button
    // (verify forms carry one submit + one resend submit — lock only the
    // one the user pressed so the other stays usable).
    function setSubmitLoading(form, label, target) {
        var btn = target || (form ? form.querySelector('.auth-submit') : null);
        if (!btn || btn.getAttribute('data-loading') === '1') return;
        if (typeof label !== 'string' || !label) {
            var action = form.getAttribute('action') || '';
            label = action.indexOf('request-code') !== -1 ? 'Sending code\u2026'
                : (action.indexOf('verify') !== -1 ? 'Verifying\u2026' : 'Please wait\u2026');
        }
        if (btn.dataset.originalHtml === undefined) btn.dataset.originalHtml = btn.innerHTML;
        btn.setAttribute('data-loading', '1');
        while (btn.firstChild) btn.removeChild(btn.firstChild);
        var sp = document.createElement('span');
        sp.className = 'spinner-border spinner-border-sm me-2';
        sp.setAttribute('role', 'status');
        sp.setAttribute('aria-hidden', 'true');
        btn.appendChild(sp);
        btn.appendChild(document.createTextNode(' ' + label));
        // Lock while pending: disabled stops re-click/Enter resubmits on
        // slow OTP POSTs. Set here in the submit handler (submission
        // already in flight), not in a click handler, so Chromium keeps
        // the in-progress submit.
        try { btn.disabled = true; } catch (err) { /* noop */ }
        btn.classList.add('opacity-75');
        btn.setAttribute('aria-busy', 'true');
        btn.setAttribute('aria-disabled', 'true');
    }

    function resetSubmitUI() {
        // [data-loading] covers resend-code submits (not .auth-submit).
        var btns = document.querySelectorAll('form .auth-submit, .auth-submit, button[data-loading]');
        btns.forEach(function (btn) {
            if (btn.dataset.originalHtml !== undefined) {
                btn.innerHTML = btn.dataset.originalHtml;
                delete btn.dataset.originalHtml;
            }
            btn.removeAttribute('data-loading');
            try { btn.disabled = false; } catch (err) { /* noop */ }
            btn.classList.remove('opacity-75');
            btn.removeAttribute('aria-busy');
            btn.removeAttribute('aria-disabled');
        });
        // Any auth form on pages owned by this script (register, forgot,
        // reset) — the old card-scoped selector missed forgot/reset pages.
        document.querySelectorAll('form').forEach(function (f) {
            try { delete f.dataset.submitted; } catch (err) { /* noop */ }
        });
    }

    function markFieldInvalid(field, on) {
        if (!field) return;
        if (on) field.setAttribute('aria-invalid', 'true');
        else field.removeAttribute('aria-invalid');
        var group = field.closest ? field.closest('.auth-input-group') : null;
        if (group && group.classList) group.classList.toggle('is-invalid', !!on);
    }

    // Empty-submit client validation: block submit, show inline error,
    // flag the first empty field with aria-invalid + .is-invalid and focus it.
    // Forms carrying [data-strength-meter] are owned by password-meter.js
    // (it validates + shows loading there) — skip so the two hooks never
    // double-swap the submit button.
    function getSubmitter(form, e) {
        if (e && e.submitter) return e.submitter;
        var active = document.activeElement;
        if (active && active.form === form && (active.type === 'submit' || active.tagName === 'BUTTON')) return active;
        return null;
    }

    function handleFormSubmit(e) {
        var form = e.target;
        if (form.hasAttribute && form.hasAttribute('data-strength-meter')) return true;
        // Idempotent submit guard: second submit while one is in flight
        // is dropped (auth-scoped; app.js has no global double-submit guard).
        if (form.dataset.submitted === '1') {
            e.preventDefault();
            return false;
        }
        // Resend-code buttons ([data-resend] + formaction) bypass empty-field
        // validation: the server re-validates and rate-limits (styled 429).
        var submitter = getSubmitter(form, e);
        var isResend = !!(submitter && submitter.hasAttribute && submitter.hasAttribute('data-resend'));
        if (isResend) {
            hideClientError();
            form.dataset.submitted = '1';
            setSubmitLoading(form, 'Sending code\u2026', submitter);
            setTimeout(resetSubmitUI, 10000);
            return true;
        }
        var fields = form.querySelectorAll('[required]');
        for (var i = 0; i < fields.length; i++) {
            var field = fields[i];
            var val = field.value == null ? '' : String(field.value);
            if (val.trim() === '') {
                e.preventDefault();
                markFieldInvalid(field, true);
                showClientError('Please fill in all required fields before continuing.');
                try { field.focus(); } catch (err) { /* noop */ }
                return false;
            }
            markFieldInvalid(field, false);
        }
        hideClientError();
        form.dataset.submitted = '1';
        setSubmitLoading(form);
        // Safety reset for bfcache/failed-navigation cases; real submits
        // navigate away. pageshow also resets.
        setTimeout(resetSubmitUI, 10000);
        return true;
    }

    // Floating help panel (? FAB): same toggle behavior as the login page,
    // present on register/forgot/reset pages with page-scoped instructions.
    function helpEl() { return getEl('registerHelpPanel') || getEl('loginHelpPanel'); }
    function helpFab() { return getEl('registerHelpFab') || getEl('loginHelpFab'); }
    function helpClose() { return getEl('registerHelpCloseBtn') || getEl('loginHelpCloseBtn'); }
    function toggleHelpPanel(force) {
        var panel = helpEl();
        var fab = helpFab();
        if (!panel || !fab) return;
        var show = typeof force === 'boolean' ? force : panel.classList.contains('d-none');
        panel.classList.toggle('d-none', !show);
        fab.setAttribute('aria-expanded', show ? 'true' : 'false');
        if (show) {
            var closeBtn = helpClose();
            if (closeBtn && typeof closeBtn.focus === 'function') {
                try { closeBtn.focus(); } catch (e) { /* noop */ }
            }
        } else if (document.activeElement && panel.contains(document.activeElement)) {
            try { fab.focus(); } catch (e) { /* noop */ }
        }
    }

    function init() {
        var card = getEl('registerCard') || document.querySelector('[data-active-tab]');
        var initial = card ? card.getAttribute('data-active-tab') : 'teacher';
        // First paint: no focus steal (server autofocus owns it).
        showRegisterTab(initial, false);
        initOtpCountdowns();

        var teacherBtn = getEl('tabBtnTeacher');
        if (teacherBtn) teacherBtn.addEventListener('click', function () { showRegisterTab('teacher'); });
        var studentBtn = getEl('tabBtnStudent');
        if (studentBtn) studentBtn.addEventListener('click', function () { showRegisterTab('student'); });

        document.querySelectorAll('[data-peek-for]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                togglePasswordVisibility(btn.getAttribute('data-peek-for'), btn);
            });
        });

        // Bind every form on pages owned by this script (register card
        // forms, plus forgot/reset single-card pages where no #registerCard
        // exists) except [data-strength-meter] forms owned by
        // password-meter.js. Guarded against double-binding when both
        // scripts load (reset-password loads both).
        var forms = card ? card.querySelectorAll('form') : document.querySelectorAll('.auth-single-card form, form');
        forms.forEach(function (form) {
            if (form.hasAttribute && form.hasAttribute('data-strength-meter')) return;
            if (form.dataset.regBound === '1') return;
            form.dataset.regBound = '1';
            form.addEventListener('submit', handleFormSubmit);
        });

        // Clear a field's invalid flag as the user fixes it.
        var requiredFields = card ? card.querySelectorAll('[required]') : document.querySelectorAll('[required]');
        requiredFields.forEach(function (field) {
            field.addEventListener('input', function () {
                field.removeAttribute('aria-invalid');
                var group = field.closest ? field.closest('.auth-input-group') : null;
                if (group && group.classList) group.classList.remove('is-invalid');
            });
        });

        // Help FAB toggle + panel close + outside-click/Escape dismiss.
        var fab = helpFab();
        if (fab) fab.addEventListener('click', function () { toggleHelpPanel(); });
        var helpCloseBtn = helpClose();
        if (helpCloseBtn) helpCloseBtn.addEventListener('click', function () { toggleHelpPanel(false); });
        document.addEventListener('click', function (e) {
            var panel = helpEl();
            var fabEl = helpFab();
            if (!panel || panel.classList.contains('d-none')) return;
            if (panel.contains(e.target) || (fabEl && fabEl.contains(e.target))) return;
            toggleHelpPanel(false);
        });
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            var panel = helpEl();
            if (!panel || panel.classList.contains('d-none')) return;
            toggleHelpPanel(false);
        });

        // Reset submit-button loading state on back/forward (bfcache) restores.
        window.addEventListener('pageshow', resetSubmitUI);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Parity export for any non-inline caller (no onclick usage remains).
    window.showRegisterTab = showRegisterTab;
    window.toggleLoginHelp = toggleHelpPanel;
})();
