// EduShare — Login page script (CSP-safe, vanilla, no deps).
// Replaces the inline <script> formerly in login.ejs. All bindings via addEventListener.
(function () {
    'use strict';

    var submitted = false;

    function purgeLegacyKeys() {
        try {
            localStorage.removeItem('edushare_saved_credential');
            localStorage.removeItem('edushare_saved_role');
        } catch (e) { /* storage unavailable: nothing to purge */ }
    }

    // Credential icon morph: server decides routing, never this icon.
    function handleCredentialInput(input) {
        if (!input) return;
        var v = String(input.value || '').trim().toLowerCase();
        var icon = document.getElementById('credentialIcon');
        if (!icon) return;
        if (/^admin@/.test(v)) {
            icon.className = 'bi bi-shield-lock';
            input.removeAttribute('inputmode');
        } else if (v.indexOf('@zahs.edu.ph') !== -1 || /^emp-[a-z0-9-]+$/.test(v)) {
            icon.className = 'bi bi-briefcase';
            input.removeAttribute('inputmode');
        } else if (/^\d+$/.test(v)) {
            // All-digit input (e.g. partial/complete LRN): numeric keyboard hint.
            icon.className = 'bi bi-person';
            input.setAttribute('inputmode', 'numeric');
        } else {
            icon.className = 'bi bi-person';
            input.removeAttribute('inputmode');
        }
    }

    // Caps-lock detection.
    function updateCapsWarning(event) {
        var warning = document.getElementById('capsWarning');
        if (!warning) return;
        var on = false;
        try {
            on = !!(event && event.getModifierState && event.getModifierState('CapsLock'));
        } catch (e) { on = false; }
        warning.classList.toggle('show', on);
    }

    // Generic peek toggle (login password only on this page; generic by id).
    function togglePasswordVisibility(inputId, btn) {
        var input = typeof inputId === 'string' ? document.getElementById(inputId) : inputId;
        if (!input) return;
        var button = btn || (inputId === 'passwordInput' ? document.getElementById('passwordPeekBtn') : null);
        if (!button) return;
        var icon = button.querySelector('i') || document.getElementById('passwordPeekIcon');
        if (input.type === 'password') {
            input.type = 'text';
            button.setAttribute('aria-pressed', 'true');
            button.setAttribute('aria-label', 'Hide password');
            if (icon) icon.className = 'bi bi-eye-slash';
        } else {
            input.type = 'password';
            button.setAttribute('aria-pressed', 'false');
            button.setAttribute('aria-label', 'Show password');
            if (icon) icon.className = 'bi bi-eye text-muted';
        }
        // Restore focus and move caret to end of value.
        try {
            input.focus();
            var len = (input.value || '').length;
            if (typeof input.setSelectionRange === 'function') {
                try { input.setSelectionRange(len, len); } catch (e) { /* noop */ }
            }
        } catch (e) { /* focus unavailable */ }
    }

    // Floating login guide.
    function toggleLoginHelp(force) {
        var panel = document.getElementById('loginHelpPanel');
        var fab = document.getElementById('loginHelpFab');
        if (!panel || !fab) return;
        var show = typeof force === 'boolean' ? force : panel.classList.contains('d-none');
        panel.classList.toggle('d-none', !show);
        fab.setAttribute('aria-expanded', show ? 'true' : 'false');
        if (show) {
            var closeBtn = document.getElementById('loginHelpCloseBtn');
            if (closeBtn && typeof closeBtn.focus === 'function') {
                try { closeBtn.focus(); } catch (e) { /* noop */ }
            }
        } else if (document.activeElement && panel.contains(document.activeElement)) {
            try { fab.focus(); } catch (e) { /* noop */ }
        }
    }

    function isHelpOpen() {
        var panel = document.getElementById('loginHelpPanel');
        return !!(panel && !panel.classList.contains('d-none'));
    }

    // Trouble-signing-in modal. Bootstrap path returns early; vanilla fallback only in else/catch.
    function openTroubleModal() {
        var modalEl = document.getElementById('troubleModal');
        if (!modalEl) return;
        // Close help panel when opening the modal.
        toggleLoginHelp(false);
        if (window.bootstrap && window.bootstrap.Modal) {
            try {
                var m = window.bootstrap.Modal.getInstance(modalEl) || new window.bootstrap.Modal(modalEl);
                m.show();
                return;
            } catch (e) { /* fall through to vanilla fallback */ }
        }
        // Vanilla JS fallback
        modalEl.classList.add('show');
        modalEl.style.display = 'block';
        modalEl.removeAttribute('aria-hidden');
        document.body.classList.add('modal-open');
        var backdrop = document.getElementById('customModalBackdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'customModalBackdrop';
            backdrop.className = 'modal-backdrop fade show';
            document.body.appendChild(backdrop);
            backdrop.addEventListener('click', closeTroubleModal);
        }
    }

    function closeTroubleModal() {
        var modalEl = document.getElementById('troubleModal');
        if (!modalEl) return;
        if (window.bootstrap && window.bootstrap.Modal) {
            try {
                var m = window.bootstrap.Modal.getInstance(modalEl);
                if (m) {
                    m.hide();
                    return;
                }
            } catch (e) { /* fall through to vanilla fallback */ }
        } else {
            // No bootstrap: vanilla close only.
            vanillaClose(modalEl);
            return;
        }
        // Bootstrap present but no instance (or hide threw): symmetric vanilla cleanup.
        vanillaClose(modalEl);
    }

    function vanillaClose(modalEl) {
        modalEl.classList.remove('show');
        modalEl.style.display = 'none';
        modalEl.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
        var backdrop = document.getElementById('customModalBackdrop');
        if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    // Client-side empty-field inline error (uses .auth-alert-error markup pattern).
    function showClientError(message, focusEl, describedIds) {
        var box = document.getElementById('clientError');
        if (!box) return;
        var msg = box.querySelector('[data-client-error-text]');
        if (msg) msg.textContent = message;
        else box.textContent = message;
        box.classList.remove('d-none');
        if (focusEl) {
            focusEl.setAttribute('aria-invalid', 'true');
            if (describedIds) focusEl.setAttribute('aria-describedby', describedIds);
            try { focusEl.focus(); } catch (e) { /* noop */ }
        }
    }

    function setGroupInvalid(input, on) {
        if (!input) return;
        if (on) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
        var group = input.closest ? input.closest('.auth-input-group') : null;
        if (group && group.classList) group.classList.toggle('is-invalid', !!on);
    }

    function clearClientError() {
        var box = document.getElementById('clientError');
        if (box) box.classList.add('d-none');
        setGroupInvalid(document.getElementById('credentialInput'), false);
        setGroupInvalid(document.getElementById('passwordInput'), false);
    }

    function resetSubmitState() {
        submitted = false;
        var form = document.getElementById('loginForm');
        if (form) { try { delete form.dataset.submitted; } catch (e) { /* noop */ } }
        var submitBtn = document.getElementById('submitBtn');
        var btnText = document.getElementById('btnText');
        var btnSpinner = document.getElementById('btnSpinner');
        if (submitBtn) {
            try { submitBtn.disabled = false; } catch (e) { /* noop */ }
            submitBtn.classList.remove('opacity-75');
            submitBtn.removeAttribute('aria-busy');
            submitBtn.removeAttribute('aria-disabled');
        }
        if (btnText && btnSpinner) {
            btnText.classList.remove('d-none');
            btnSpinner.classList.add('d-none');
        }
    }

    // Form submit guard (auth-scoped idempotent guard; app.js handles
    // only data-confirm/data-require-reason, so no duplication).
    function handleFormSubmit(e) {
        var form = document.getElementById('loginForm');
        if (submitted || (form && form.dataset.submitted === '1')) {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            return false;
        }
        var submitBtn = document.getElementById('submitBtn');
        var btnText = document.getElementById('btnText');
        var btnSpinner = document.getElementById('btnSpinner');
        var credInput = document.getElementById('credentialInput');
        var passInput = document.getElementById('passwordInput');

        clearClientError();

        if (credInput && !credInput.value.trim()) {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            credInput.value = credInput.value.trim();
            setGroupInvalid(credInput, true);
            setGroupInvalid(passInput, false);
            showClientError('Please enter your School ID or email.', credInput, 'clientError');
            return false;
        }
        setGroupInvalid(credInput, false);
        if (passInput && !passInput.value) {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            setGroupInvalid(passInput, true);
            showClientError('Please enter your password.', passInput, 'clientError');
            return false;
        }
        setGroupInvalid(passInput, false);

        // Trim credential before submit; never persist identifiers.
        if (credInput) credInput.value = credInput.value.trim();
        purgeLegacyKeys();

        submitted = true;

        // Visual loading state without disabling the button element (which aborts Chromium submits!).
        if (btnText && btnSpinner) {
            btnText.classList.add('d-none');
            btnSpinner.classList.remove('d-none');
        }
        if (submitBtn) {
            // Lock while pending: disabled stops re-click/Enter resubmits on
            // slow auth POSTs. Set here in the submit handler (submission
            // already in flight), not in a click handler, so Chromium keeps
            // the in-progress submit.
            try { submitBtn.disabled = true; } catch (e) { /* noop */ }
            submitBtn.classList.add('opacity-75');
            submitBtn.setAttribute('aria-busy', 'true');
            submitBtn.setAttribute('aria-disabled', 'true');
        }
        form.dataset.submitted = '1';

        return true;
    }

    function init() {
        purgeLegacyKeys();

        var credInput = document.getElementById('credentialInput');
        var passInput = document.getElementById('passwordInput');
        var form = document.getElementById('loginForm');
        var peekBtn = document.getElementById('passwordPeekBtn');
        var fab = document.getElementById('loginHelpFab');
        var helpCloseBtn = document.getElementById('loginHelpCloseBtn');
        var troubleLink = document.getElementById('troubleLinkBtn');
        var modalCloseBtns = document.querySelectorAll('[data-close-trouble]');

        // Call once for server-repopulated value (e.g. after a failed login).
        if (credInput) {
            handleCredentialInput(credInput);
            credInput.addEventListener('input', function () { handleCredentialInput(credInput); });
        }

        // Caps-lock detect on keydown + keyup + focus + click + paste + input.
        if (passInput) {
            passInput.addEventListener('keydown', updateCapsWarning);
            passInput.addEventListener('keyup', updateCapsWarning);
            passInput.addEventListener('focus', updateCapsWarning);
            passInput.addEventListener('click', updateCapsWarning);
            passInput.addEventListener('paste', updateCapsWarning);
            passInput.addEventListener('input', updateCapsWarning);
        }
        window.addEventListener('blur', function () {
            var warning = document.getElementById('capsWarning');
            if (warning) warning.classList.remove('show');
        });

        // Peek toggle.
        if (peekBtn) {
            peekBtn.addEventListener('click', function () { togglePasswordVisibility('passwordInput', peekBtn); });
        }

        // Help FAB toggle + panel close.
        if (fab) {
            fab.addEventListener('click', function () { toggleLoginHelp(); });
        }
        if (helpCloseBtn) {
            helpCloseBtn.addEventListener('click', function () { toggleLoginHelp(false); });
        }
        if (troubleLink) {
            troubleLink.addEventListener('click', function () { openTroubleModal(); });
        }

        // Trouble modal close buttons.
        for (var i = 0; i < modalCloseBtns.length; i++) {
            modalCloseBtns[i].addEventListener('click', closeTroubleModal);
        }

        // Outside-click closes the help panel.
        document.addEventListener('click', function (e) {
            var panel = document.getElementById('loginHelpPanel');
            var fabEl = document.getElementById('loginHelpFab');
            if (!panel || panel.classList.contains('d-none')) return;
            if (panel.contains(e.target) || (fabEl && fabEl.contains(e.target))) return;
            toggleLoginHelp(false);
        });

        // Escape closes the help panel; don't fight the modal (early-return unless panel open).
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            if (!isHelpOpen()) return;
            var modalEl = document.getElementById('troubleModal');
            if (modalEl && modalEl.classList.contains('show')) return;
            toggleLoginHelp(false);
        });

        // Submit guard.
        if (form) {
            form.addEventListener('submit', handleFormSubmit);
        }

        // Click-path fallback: real browsers always follow a submit-button
        // click with implicit submission, but if a click ever arrives
        // without activation behavior the form would silently do nothing.
        // requestSubmit re-fires the guarded submit above, so the
        // idempotent guard keeps exactly-once semantics when native
        // activation follows (second submit is dropped).
        if (form && document.getElementById('submitBtn')) {
            document.getElementById('submitBtn').addEventListener('click', function () {
                if (submitted || form.dataset.submitted === '1') return;
                if (typeof form.requestSubmit === 'function') {
                    try { form.requestSubmit(document.getElementById('submitBtn')); } catch (e) { /* native activation continues */ }
                }
            });
        }

        // Reset submit state when returning via bfcache (no 4s timer).
        window.addEventListener('pageshow', function () { resetSubmitState(); });

        // Single JS-owned focus: error → password if credential present, else credential.
        var hasError = form && form.getAttribute('data-has-error') === 'true';
        if (hasError && passInput && credInput && credInput.value) {
            try { passInput.focus(); } catch (e) { /* noop */ }
        } else if (credInput && !hasError) {
            // Only autofocus on first visit; error case with empty credential also lands here via credential focus.
            if (!credInput.value) {
                try { credInput.focus(); } catch (e) { /* noop */ }
            }
        } else if (credInput && hasError && !credInput.value) {
            try { credInput.focus(); } catch (e) { /* noop */ }
        }
    }

    // Back-compat globals (other code/tests may reference these names).
    window.toggleLoginHelp = toggleLoginHelp;
    window.openTroubleModal = openTroubleModal;
    window.closeTroubleModal = closeTroubleModal;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
