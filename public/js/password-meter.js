// EduShare — Password strength meter (CSP-safe, vanilla, no deps).
// Progressive enhancement for any form carrying [data-strength-meter]:
// - change-password.ejs (fields: #newPass / #confirmPass)
// - reset-password.ejs  (fields: #rpNewPass / #rpConfirmPass)
// Server-side validation remains authoritative; this only adds live feedback.
(function () {
    'use strict';

    var PAIRS = [
        { form: 'changePassForm', bar: 'passStrengthBar', label: 'passStrength', match: 'passMatch' }
    ];

    function scorePassword(v) {
        var s = 0;
        if (v.length >= 10) s += 1;
        if (v.length >= 14) s += 1;
        if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s += 1;
        if (/\d/.test(v)) s += 1;
        if (/[^A-Za-z0-9]/.test(v)) s += 1;
        return s;
    }

    // Consistent error-state helper: aria-invalid plus the shared
    // .auth-input-group.is-invalid ring (and .glass-input.is-invalid where
    // the change-password glass styling applies — that rule is a CSS-owned
    // addition, reported separately).
    function setInvalid(input, on) {
        if (!input) return;
        if (on) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
        var group = input.closest ? input.closest('.auth-input-group') : null;
        if (group && group.classList) group.classList.toggle('is-invalid', !!on);
        if (input.classList && input.classList.contains('glass-input')) input.classList.toggle('is-invalid', !!on);
    }

    // Pending-state lock for meter-owned forms: spinner + disabled +
    // aria-disabled/aria-busy set inside the submit handler (submission
    // already in flight), plus a per-form dataset.submitted idempotent
    // guard. Auth-scoped; app.js has no global double-submit guard.
    function loadingVerb(form) {
        var action = form.getAttribute ? (form.getAttribute('action') || '') : '';
        if (action.indexOf('request-code') !== -1) return 'Sending code\u2026';
        if (action.indexOf('verify') !== -1) return 'Verifying\u2026';
        return 'Updating password\u2026';
    }

    // verb: explicit label string; target: the exact clicked submit button
    // (verify forms carry one submit + one resend submit — lock only the
    // one the user pressed so the other stays usable).
    function setFormLoading(form, verb, target) {
        var label = (typeof verb === 'string' && verb) ? verb : loadingVerb(form);
        var btn = target || form.querySelector('.auth-submit') || form.querySelector('[type="submit"]');
        if (!btn || btn.getAttribute('data-loading') === '1') return;
        if (btn.dataset.originalHtml === undefined) btn.dataset.originalHtml = btn.innerHTML;
        btn.setAttribute('data-loading', '1');
        while (btn.firstChild) btn.removeChild(btn.firstChild);
        var sp = document.createElement('span');
        sp.className = 'spinner-border spinner-border-sm me-2';
        sp.setAttribute('aria-hidden', 'true');
        btn.appendChild(sp);
        btn.appendChild(document.createTextNode(' ' + label));
        try { btn.disabled = true; } catch (e) { /* noop */ }
        btn.classList.add('opacity-75');
        btn.setAttribute('aria-busy', 'true');
        btn.setAttribute('aria-disabled', 'true');
    }

    function resetFormLoading(form) {
        // [data-loading] covers resend-code submits (not .auth-submit).
        var btns = form.querySelectorAll('.auth-submit, button[data-loading], [type="submit"]');
        btns.forEach(function (btn) {
            if (btn.dataset.originalHtml !== undefined) {
                btn.innerHTML = btn.dataset.originalHtml;
                delete btn.dataset.originalHtml;
            }
            btn.removeAttribute('data-loading');
            try { btn.disabled = false; } catch (e) { /* noop */ }
            btn.classList.remove('opacity-75');
            btn.removeAttribute('aria-busy');
            btn.removeAttribute('aria-disabled');
        });
        try { delete form.dataset.submitted; } catch (e) { /* noop */ }
    }

    // Page-level inline error surface (#clientError on reset/change
    // pages; absent on change-password by design — label text carries it
    // there). Scoped to the wired form's document; harmless if missing.
    function showClientError(message) {
        var box = document.getElementById('clientError');
        if (!box) return;
        var text = document.getElementById('clientErrorText');
        if (text) text.textContent = message;
        else box.textContent = message;
        box.hidden = false;
        if (box.classList) box.classList.remove('d-none');
    }

    function hideClientError() {
        var box = document.getElementById('clientError');
        if (!box) return;
        box.hidden = true;
        if (box.classList) box.classList.add('d-none');
    }

    // opts.liveOnly: render strength + match feedback and invalid-state
    // clearing, but do NOT take over submit (used by register/forgot
    // request-step forms owned by register.js — it validates + shows the
    // pending state there, so the meter must not double-bind submit).
    function wire(scope, opts) {
        var form = scope.tagName === 'FORM' ? scope : scope.querySelector('form');
        if (!form || form.dataset.meterBound === '1') return;
        form.dataset.meterBound = '1';
        var liveOnly = !!(opts && opts.liveOnly);
        // Explicit [data-meter-new]/[data-meter-confirm] win; then the
        // conventional auth field names (register + forgot live forms);
        // legacy global IDs cover change/reset single-form pages.
        var newPass = form.querySelector('[data-meter-new]')
            || form.querySelector('input[name="new_password"]')
            || form.querySelector('input[name="password"]')
            || document.getElementById('newPass') || document.getElementById('rpNewPass');
        var confirmPass = form.querySelector('[data-meter-confirm]')
            || form.querySelector('input[name="confirm_password"]')
            || document.getElementById('confirmPass') || document.getElementById('rpConfirmPass');
        // Scoped first so pages with several password forms (register) each
        // drive their own meter; single-form pages fall back to legacy IDs.
        var bar = form.querySelector('[data-meter-bar]') || document.getElementById('passStrengthBar');
        var label = form.querySelector('[data-meter-label]')
            || form.querySelector('[data-meter-live-label]')
            || document.getElementById('passStrength');
        var match = form.querySelector('[data-meter-match]')
            || form.querySelector('[data-meter-live-match]')
            || document.getElementById('passMatch');
        if (!newPass) return;

        function render() {
            var v = newPass.value || '';
            var s = scorePassword(v);
            var pct = Math.round((s / 5) * 100);
            var names = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'];
            var colors = ['#dc2626', '#ea580c', '#d97706', '#059669', '#059669', '#06381e'];
            if (bar) {
                bar.style.width = pct + '%';
                bar.style.background = colors[s];
                bar.setAttribute('aria-valuenow', String(pct));
            }
            if (label) {
                label.textContent = 'Password strength: ' + (v ? names[s] : '—');
                label.style.color = v ? colors[s] : '';
            }
            if (match && confirmPass) {
                if (!confirmPass.value) {
                    match.textContent = '';
                } else if (newPass.value === confirmPass.value) {
                    match.textContent = 'Passwords match.';
                    match.style.color = '#059669';
                } else {
                    match.textContent = 'Passwords do not match yet.';
                    match.style.color = '#b45309';
                }
            }
        }

        newPass.addEventListener('input', render);
        if (confirmPass) confirmPass.addEventListener('input', render);

        // Live invalid-state clearing as the user fixes the fields.
        newPass.addEventListener('input', function () { setInvalid(newPass, false); });
        if (confirmPass) confirmPass.addEventListener('input', function () { setInvalid(confirmPass, false); });

        if (liveOnly) {
            render();
            return;
        }
        // Resend-code buttons ([data-resend] + formaction) bypass password
        // validation: the server re-validates and rate-limits (styled 429).
        function getSubmitter(e) {
            if (e && e.submitter) return e.submitter;
            var active = document.activeElement;
            if (active && active.form === form && (active.type === 'submit' || active.tagName === 'BUTTON')) return active;
            return null;
        }

        form.addEventListener('submit', function (e) {
            var submitter = getSubmitter(e);
            if (submitter && submitter.hasAttribute && submitter.hasAttribute('data-resend')) {
                form.dataset.submitted = '1';
                setFormLoading(form, 'Sending code\u2026', submitter);
                setTimeout(function () { resetFormLoading(form); }, 10000);
                return true;
            }
            if (form.dataset.submitted === '1') {
                e.preventDefault();
                return false;
            }
            // Required-field sweep first (email + code on reset forms):
            // block on the first empty field with inline error + focus so
            // no control submits silently.
            var reqFields = form.querySelectorAll('[required]');
            var empty = null;
            for (var i = 0; i < reqFields.length; i++) {
                var rf = reqFields[i];
                var rv = rf.value == null ? '' : String(rf.value);
                if (rv.trim() === '') { empty = rf; break; }
                if (rf.type === 'password' || rf === newPass || rf === confirmPass) setInvalid(rf, false);
            }
            if (empty) {
                e.preventDefault();
                setInvalid(empty, true);
                showClientError('Please fill in all required fields before continuing.');
                try { empty.focus(); } catch (err) { /* noop */ }
                return false;
            }
            hideClientError();
            var v = newPass.value || '';
            var hasLower = /[a-z]/.test(v);
            var hasUpper = /[A-Z]/.test(v);
            var hasDigit = /\d/.test(v);
            if (v.length < 10 || !hasLower || !hasUpper || !hasDigit) {
                e.preventDefault();
                setInvalid(newPass, true);
                try { newPass.focus(); } catch (err) { /* noop */ }
                showClientError('Use at least 10 characters with upper/lowercase letters and a number.');
                if (label) {
                    label.textContent = 'Use at least 10 characters with upper/lowercase letters and a number.';
                    label.style.color = '#b45309';
                }
                return false;
            }
            setInvalid(newPass, false);
            if (confirmPass && v !== confirmPass.value) {
                e.preventDefault();
                setInvalid(confirmPass, true);
                try { confirmPass.focus(); } catch (err) { /* noop */ }
                showClientError('New passwords do not match.');
                if (match) {
                    match.textContent = 'Passwords do not match yet.';
                    match.style.color = '#b45309';
                }
                return false;
            }
            setInvalid(confirmPass, false);
            hideClientError();
            form.dataset.submitted = '1';
            setFormLoading(form, loadingVerb(form));
            // Safety reset for bfcache/failed-navigation cases.
            setTimeout(function () { resetFormLoading(form); }, 10000);
            return true;
        });

        window.addEventListener('pageshow', function () { resetFormLoading(form); });

        render();
    }

    // Show/hide peek toggle for [data-meter-peek-for] buttons only.
    // A separate marker from register.js's [data-peek-for] so pages loading
    // both scripts (reset-password) never double-bind one button (which
    // would toggle twice = visible no-op). Same canonical pattern as
    // login.js/register.js: swap input type, update aria, restore focus
    // with caret at end, swap the icon class.
    function togglePeek(btn) {
        var input = document.getElementById(btn.getAttribute('data-meter-peek-for'));
        if (!input) return;
        var icon = btn.querySelector('i');
        var showing = input.type === 'password';
        input.type = showing ? 'text' : 'password';
        btn.setAttribute('aria-pressed', showing ? 'true' : 'false');
        btn.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
        if (icon) icon.className = showing ? 'bi bi-eye-slash' : 'bi bi-eye text-muted';
        try {
            input.focus();
            var len = (input.value || '').length;
            if (typeof input.setSelectionRange === 'function') input.setSelectionRange(len, len);
        } catch (e) { /* focus unavailable */ }
    }

    // Autofocus: force-change sessions render no server autofocus (the
    // new-password field is the only sensible target). The change-password
    // view drops a [data-autofocus-marker] hidden input in that case.
    function initAutofocus() {
        var marker = document.querySelector('[data-autofocus-marker]');
        if (!marker) return;
        var target = document.getElementById(marker.getAttribute('value'));
        if (target && typeof target.focus === 'function') {
            try { target.focus(); } catch (e) { /* noop */ }
        }
    }

    function init() {
        initAutofocus();
        // Only [data-meter-peek-for] buttons are bound here. register.js
        // owns [data-peek-for]; auth views choose one marker per button
        // (see reset-password/change-password/forgot-password notes).
        document.querySelectorAll('[data-meter-peek-for]').forEach(function (btn) {
            if (btn.dataset.peekBound === '1') return;
            btn.dataset.peekBound = '1';
            btn.addEventListener('click', function () { togglePeek(btn); });
        });
        // Live-feedback-only: register + forgot request/verify password
        // fields get a strength + match readout without the meter taking
        // over submit (register.js owns validation + pending state there).
        document.querySelectorAll('form[data-meter-live]').forEach(function (form) {
            if (form.hasAttribute('data-strength-meter')) return;
            wire(form, { liveOnly: true });
        });
        var scopes = document.querySelectorAll('[data-strength-meter]');
        if (scopes.length === 0) {
            // Fallback: wire by known form ids (change-password + reset-password).
            PAIRS.forEach(function (p) {
                var form = document.getElementById(p.form);
                if (form) wire(form);
            });
            var rpForm = document.querySelector('form[action="/auth/forgot-password/verify"]');
            if (rpForm) wire(rpForm);
            return;
        }
        scopes.forEach(function (scope) { wire(scope); });
    }

    // Suppress unused-var lint noise for the declarative PAIRS table.
    void PAIRS;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
