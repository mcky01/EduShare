// Teacher class-detail: scroll-only sticky bar (CSP-safe external file).
(function () {
    if (document.documentElement.hasAttribute('data-classdetail-wired')) return;
    document.documentElement.setAttribute('data-classdetail-wired', '1');
    function init() {
        // Scroll-only sticky bar: reveal once the header banner scrolls out of view.
        // display:flex beats .d-none; display:none beats .glass-card's display.
        var SHOW = 'flex';
        var banner = document.getElementById('classHeaderBanner');
        var sticky = document.getElementById('classStickyBar');
        function show() {
            if (!sticky) return;
            sticky.classList.remove('d-none');
            sticky.style.display = SHOW;
        }
        function hide() {
            if (!sticky) return;
            sticky.classList.add('d-none');
            sticky.style.display = 'none';
        }
        if (banner && sticky) {
            hide(); // belt-and-suspenders: never visible at top, even before JS observers run
            if ('IntersectionObserver' in window) {
                new IntersectionObserver(function (entries) {
                    if (!entries.length) return;
                    if (entries[0].isIntersecting) hide();
                    else show();
                }, { threshold: 0 }).observe(banner);
            } else {
                var syncSticky = function () {
                    if (banner.getBoundingClientRect().bottom < 8) show();
                    else hide();
                };
                document.addEventListener('scroll', syncSticky, { passive: true });
                window.addEventListener('resize', syncSticky);
                syncSticky();
            }
        }
        // Roster search is handled globally by /js/local-filter.js (scope: teacher-class-students).
        // Create-class form (on /teacher/classes) shares this file's guard
        // convention; its modal is guarded inline-safe via data-create-class-submit.
        var createForm = document.querySelector('#createClassModal form');
        if (createForm && !createForm.dataset.detailWired) {
            createForm.dataset.detailWired = '1';
            createForm.addEventListener('submit', function () {
                var btn = createForm.querySelector('[data-create-class-submit]');
                if (!btn || btn.disabled) return;
                btn.disabled = true;
                btn.setAttribute('aria-busy', 'true');
                btn.insertAdjacentHTML('afterbegin', '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>');
            });
        }
        // Modal POST forms (announce / activity / post-from-library): disable
        // the submit button on submit to prevent double-posts. Server
        // redirects back with a flash; no XHR needed.
        document.querySelectorAll('#postAnnouncementModal form, #createActivityModal form, #postFromLibraryModal form').forEach(function (form) {
            if (form.dataset.detailWired) return;
            form.dataset.detailWired = '1';
            form.addEventListener('submit', function () {
                var btn = form.querySelector('button[type="submit"]');
                if (!btn || btn.disabled) return;
                btn.disabled = true;
                btn.setAttribute('aria-busy', 'true');
                btn.insertAdjacentHTML('afterbegin', '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>');
            });
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
