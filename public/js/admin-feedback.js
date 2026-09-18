// EduShare — Admin submit feedback (CSP-safe, vanilla, no deps).
// Scope: admin pages ONLY (included per-view, never global). Handles what
// Agent A's global app.js deliberately does not: submit-button feedback.
//
// - Confirm + reason gating stay in app.js (data-confirm /
//   data-require-reason). This file adds NO confirm/reason logic.
// - Runs on document bubble AFTER app.js (app.js is loaded first via the
//   layout), and bails when e.defaultPrevented is set — so a form blocked
//   by app.js validation never shows a spinner.
// - POST forms only: disables the submitter + swaps in a spinner label to
//   prevent double-submit; GET/filter forms are untouched (navigation
//   unloads the page anyway). CSV export forms are skipped (the download
//   must stay re-clickable; the browser download shelf is the feedback).
//   Fetch-driven forms (curriculum ingest) own their own button state and
//   are opted out via data-no-feedback.
(function () {
    "use strict";
    function init() {
        document.addEventListener("submit", function (e) {
            if (e.defaultPrevented) return;
            var form = e.target;
            if (!form || !form.hasAttribute || form.hasAttribute("data-no-feedback")) return;
            if ((form.method || "get").toLowerCase() !== "post") return;
            if ((form.getAttribute("action") || "").indexOf("/export") !== -1) return;
            var btn = e.submitter && e.submitter.tagName === "BUTTON" ? e.submitter : form.querySelector('[type="submit"]');
            if (!btn || btn.disabled || btn.dataset.feedbackDone) return;
            btn.dataset.feedbackDone = "1";
            if (!btn.dataset.labelSaved) {
                btn.dataset.labelSaved = "1";
                btn.dataset.labelHtml = btn.innerHTML;
            }
            btn.disabled = true;
            btn.setAttribute("aria-disabled", "true");
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Saving\u2026';
        });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
