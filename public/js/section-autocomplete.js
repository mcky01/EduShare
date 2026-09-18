// EduShare — Section type-to-search autocomplete (shared widget).
// Used by: student self-registration section input + admin Add-Student
// section input. CSP-safe external file, vanilla, no deps.
//
// Behavior (matches what the student asked for):
// - Grade select drives the section input: no grade -> disabled with a
//   "pick your grade first" placeholder; grade chosen -> enabled.
// - The full section list is NEVER dumped. Only when the user types 1+
//   chars do we GET /auth/sections?grade_level=..&q=.. (case-insensitive
//   server-side, capped at 8 plain strings) and render the matches in a
//   small listbox. Typing "rizal" (any casing) shows "Rizal".
// - Picking a suggestion fills the canonical teacher spelling, so casing
//   is correct by construction. Free-typed text is still submittable
//   (soft-match) so students are never blocked by teacher rollout; the
//   server converges to the canonical spelling when one exists.
// - Plain <input>, NOT <datalist>: Chrome's datalist reveals every option
//   on focus, which would defeat the no-dump design.
//
// Wiring: any grade <select> with [data-section-for="<section-input-id>"]
// is bound automatically. Works on the register page AND inside the
// admin Add-Student modal (Bootstrap modal focus is fine: the listbox is
// rendered inline under the input, not portaled to <body>).
(function () {
    'use strict';

    var MIN_CHARS = 1;
    var MAX_RESULTS = 8;
    var DEBOUNCE_MS = 180;

    function getEl(id) {
        return document.getElementById(id);
    }

    function closeListbox(wrap) {
        var list = wrap.wrapper.querySelector('.section-suggest-list');
        if (list && list.parentNode) list.parentNode.removeChild(list);
        wrap.input.setAttribute('aria-expanded', 'false');
        wrap.activeIndex = -1;
    }

    function setStatus(wrap, text) {
        var hintId = wrap.input.getAttribute('aria-describedby');
        var hint = hintId ? getEl(hintId) : null;
        if (!hint) {
            hint = document.createElement('div');
            hint.className = 'form-text section-suggest-status';
            hint.id = wrap.input.id + 'Status';
            wrap.input.setAttribute('aria-describedby', hint.id);
            wrap.wrapper.appendChild(hint);
        }
        hint.textContent = text || '';
    }

    function renderListbox(wrap, items, query) {
        closeListbox(wrap);
        var list = document.createElement('div');
        list.className = 'section-suggest-list';
        list.setAttribute('role', 'listbox');
        list.id = wrap.input.id + 'List';
        wrap.input.setAttribute('aria-controls', list.id);

        if (items.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'section-suggest-empty';
            empty.setAttribute('role', 'option');
            empty.setAttribute('aria-selected', 'false');
            empty.textContent = query
                ? 'No match for this grade — check spelling or ask your adviser. You can still continue.'
                : 'Type to search official sections for this grade.';
            list.appendChild(empty);
            wrap.wrapper.appendChild(list);
            wrap.input.setAttribute('aria-expanded', 'true');
            if (query) setStatus(wrap, 'No official section matches — you can still continue and your adviser will confirm.');
            return;
        }

        setStatus(wrap, items.length + ' matching section' + (items.length === 1 ? '' : 's') + ' — pick yours for the exact spelling.');
        items.slice(0, MAX_RESULTS).forEach(function (name, i) {
            var opt = document.createElement('button');
            opt.type = 'button';
            opt.className = 'section-suggest-item';
            opt.setAttribute('role', 'option');
            opt.setAttribute('aria-selected', 'false');
            opt.setAttribute('data-index', String(i));
            opt.textContent = name;
            // Click (not mousedown): mousedown+preventDefault on a button
            // inside a form can swallow the activation in some browsers, and
            // the blur-close is already delayed 150ms so click lands first.
            opt.addEventListener('click', function (e) {
                e.preventDefault();
                pick(wrap, name);
            });
            list.appendChild(opt);
        });
        wrap.wrapper.appendChild(list);
        wrap.input.setAttribute('aria-expanded', 'true');
    }

    function pick(wrap, name) {
        wrap.input.value = name;
        wrap.input.removeAttribute('aria-invalid');
        closeListbox(wrap);
        setStatus(wrap, 'Section set to the official spelling: ' + name);
        wrap.input.focus();
    }

    function moveActive(wrap, dir) {
        var items = wrap.wrapper.querySelectorAll('.section-suggest-item');
        if (!items.length) return;
        wrap.activeIndex = (wrap.activeIndex + dir + items.length) % items.length;
        items.forEach(function (el, i) {
            var on = i === wrap.activeIndex;
            el.classList.toggle('active', on);
            el.setAttribute('aria-selected', on ? 'true' : 'false');
        });
    }

    function bindPair(gradeSelect, sectionInput) {
        var group = sectionInput.closest('.auth-input-group, .input-group');
        var wrap = {
            grade: gradeSelect,
            input: sectionInput,
            wrapper: group || sectionInput.parentNode,
            activeIndex: -1,
            timer: null,
            lastQuery: ''
        };
        wrap.wrapper.classList.add('section-autocomplete-wrap');

        // Fallback when the grade select renders without a value selected
        // (e.g. a "Select grade…" placeholder option): keep the section
        // input TYPABLE at all times. Suggestions still require a real
        // grade — the server whitelists it and returns [] otherwise — so
        // the no-dump guarantee holds even with the input enabled.
        function syncEnabled() {
            var hasGrade = !!(gradeSelect.value && gradeSelect.value.trim());
            sectionInput.disabled = false;
            sectionInput.removeAttribute('disabled');
            sectionInput.placeholder = hasGrade ? 'Start typing…' : 'Select grade first, then type here';
        }

        function fetchSuggest(q) {
            wrap.lastQuery = q;
            var url = '/auth/sections?grade_level=' + encodeURIComponent(gradeSelect.value) + '&q=' + encodeURIComponent(q);
            fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
                .then(function (res) { return res.ok ? res.json() : { sections: [] }; })
                .then(function (data) {
                    if (sectionInput.value.trim() !== wrap.lastQuery) return; // stale
                    var items = Array.isArray(data.sections) ? data.sections.slice(0, MAX_RESULTS) : [];
                    renderListbox(wrap, items, wrap.lastQuery);
                })
                .catch(function () {
                    // Offline/DB hiccup: leave free text usable, say nothing loud.
                    closeListbox(wrap);
                });
        }

        gradeSelect.addEventListener('change', function () {
            sectionInput.value = '';
            wrap.lastQuery = '';
            closeListbox(wrap);
            setStatus(wrap, '');
            syncEnabled();
        });

        sectionInput.addEventListener('input', function () {
            sectionInput.removeAttribute('aria-invalid');
            clearTimeout(wrap.timer);
            var q = sectionInput.value.trim();
            var grade = gradeSelect.value ? gradeSelect.value.trim() : '';
            if (!grade || q.length < MIN_CHARS) {
                closeListbox(wrap);
                if (grade && q.length === 0) setStatus(wrap, '');
                else if (!grade && q.length >= MIN_CHARS) setStatus(wrap, 'Select your grade level first to see matching sections — you can keep typing meanwhile.');
                return;
            }
            wrap.timer = setTimeout(function () { fetchSuggest(q); }, DEBOUNCE_MS);
        });

        sectionInput.addEventListener('focus', function () {
            var q = sectionInput.value.trim();
            var grade = gradeSelect.value ? gradeSelect.value.trim() : '';
            if (grade && q.length >= MIN_CHARS) fetchSuggest(q);
        });

        sectionInput.addEventListener('keydown', function (e) {
            var items = wrap.wrapper.querySelectorAll('.section-suggest-item');
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                if (!items.length) return;
                e.preventDefault();
                moveActive(wrap, e.key === 'ArrowDown' ? 1 : -1);
            } else if (e.key === 'Enter' && wrap.activeIndex >= 0 && items[wrap.activeIndex]) {
                e.preventDefault();
                pick(wrap, items[wrap.activeIndex].textContent);
            } else if (e.key === 'Escape') {
                closeListbox(wrap);
            }
        });

        sectionInput.addEventListener('blur', function () {
            // Small delay so a suggestion click lands before we close.
            setTimeout(function () { closeListbox(wrap); }, 150);
        });

        document.addEventListener('click', function (e) {
            if (!wrap.wrapper.contains(e.target)) closeListbox(wrap);
        });

        syncEnabled();
    }

    function init() {
        document.querySelectorAll('select[data-section-for]').forEach(function (gradeSelect) {
            var targetId = gradeSelect.getAttribute('data-section-for');
            var sectionInput = targetId ? getEl(targetId) : null;
            if (sectionInput && !sectionInput.dataset.sectionBound) {
                sectionInput.dataset.sectionBound = '1';
                bindPair(gradeSelect, sectionInput);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
