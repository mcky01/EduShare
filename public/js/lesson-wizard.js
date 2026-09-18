// EduShare AI Lesson Generator Wizard (plan-input flow).

document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('btnGenerateLesson');
    const step1 = document.getElementById('lessonStep1');
    const step2 = document.getElementById('lessonStep2');
    const slidesContainer = document.getElementById('slidesPreviewContainer');
    const btnSaveToLibrary = document.getElementById('btnSaveLessonToLibrary');
    const planTextEl = document.getElementById('planText');
    const planFileEl = document.getElementById('planFile');
    const planFormatEl = document.getElementById('planFormat');
    const focusSessionEl = document.getElementById('focusSession');
    const coverageEl = document.getElementById('planCoverage');
    const charCountEl = document.getElementById('planCharCount');
    const prepBox = document.getElementById('lessonPrepBox');
    const coverageLine = document.getElementById('displayPlanCoverage');

    const checklistEl = document.getElementById('planChecklist');
    const parseStatusEl = document.getElementById('planParseStatus');
    const topicHintEl = document.getElementById('topicAutofillHint');
    const attestEl = document.getElementById('planAttest');
    const aiDeclEl = document.getElementById('planAiDecl');
    const viewToggleEl = document.getElementById('planViewToggle');
    const scopeBannerEl = document.getElementById('planScopeBanner');

    const MAX_PLAN = 20000;
    let currentLessonData = null;
    let currentNeedsReview = false;
    let currentValidation = [];
    let currentLessonId = null;
    let currentGrounded = false;
    let currentCoverage = null;
    let currentFocus = '';
    let lastParse = null; // full-plan {planText, coverage, sessions, sectionCounts, suggestions}
    let viewFiltered = false; // textarea shows session-filtered text vs full plan

    // ---- AI lesson generation overlay ----
    let __lessonLoadTimer = null;

    // ============================================================
    // Draft persistence (sessionStorage) — survives refresh + back/forward
    // ============================================================
    const LESSON_DRAFT_KEY = 'edushare_lesson_draft_v1';
    const LESSON_DRAFT_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

    function saveLessonDraft() {
        try {
            // Don't save an empty state — only persist when there's something worth restoring.
            const hasPlan = !!(lastParse?.planText || (planTextEl?.value || '').trim().length >= 200);
            const hasLesson = !!currentLessonData;
            if (!hasPlan && !hasLesson) {
                sessionStorage.removeItem(LESSON_DRAFT_KEY);
                return;
            }

            const draft = {
                savedAt: Date.now(),
                step: (step2 && step2.style.display === 'block') ? 2 : 1,
                // Step 1 inputs
                form: {
                    planText: planTextEl?.value || '',
                    planFormat: planFormatEl?.value || 'ilaw',
                    focusSession: focusSessionEl?.value || '',
                    topic: document.getElementById('lessonTopic')?.value || '',
                    subject: document.getElementById('lessonSubject')?.value || '',
                    gradeLevel: document.getElementById('lessonGrade')?.value || '',
                    instructions: document.getElementById('lessonInstructions')?.value || '',
                    aiDecl: aiDeclEl?.checked === true,
                    attested: attestEl?.checked === true,
                    planTextEdited: planTextEl?.dataset.edited === '1'
                },
                // Parsed plan (for session filtering + grid)
                lastParse: lastParse || null,
                gridModel: gridModel || null,
                gridBaseText: gridBaseText || '',
                viewFiltered: viewFiltered === true,
                // Generated lesson state
                lesson: currentLessonData || null,
                lessonState: {
                    lessonId: currentLessonId,
                    needsReview: currentNeedsReview,
                    validation: currentValidation,
                    grounded: currentGrounded,
                    coverage: currentCoverage,
                    focus: currentFocus
                }
            };
            sessionStorage.setItem(LESSON_DRAFT_KEY, JSON.stringify(draft));
        } catch (err) {
            console.warn('Failed to save lesson draft:', err);
        }
    }

    function loadLessonDraft() {
        try {
            const raw = sessionStorage.getItem(LESSON_DRAFT_KEY);
            if (!raw) return null;
            const draft = JSON.parse(raw);
            if (!draft.savedAt || Date.now() - draft.savedAt > LESSON_DRAFT_MAX_AGE_MS) {
                sessionStorage.removeItem(LESSON_DRAFT_KEY);
                return null;
            }
            return draft;
        } catch {
            return null;
        }
    }

    function clearLessonDraft() {
        try { sessionStorage.removeItem(LESSON_DRAFT_KEY); } catch { /* noop */ }
    }

    function showLessonLoadingOverlay() {
        const overlay = document.getElementById('aiLessonOverlay');
        if (!overlay) return;
        overlay.classList.add('active');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden'; // prevent background scroll

        const startedAt = Date.now();
        const timerEl = document.getElementById('aiLessonTimer');
        if (timerEl) timerEl.textContent = '00:00';

        if (__lessonLoadTimer) clearInterval(__lessonLoadTimer);
        __lessonLoadTimer = setInterval(() => {
            const el = document.getElementById('aiLessonTimer');
            if (!el) return;
            const elapsed = Math.floor((Date.now() - startedAt) / 1000);
            const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const s = String(elapsed % 60).padStart(2, '0');
            el.textContent = `${m}:${s}`;
        }, 500);
    }

    function hideLessonLoadingOverlay() {
        if (__lessonLoadTimer) { clearInterval(__lessonLoadTimer); __lessonLoadTimer = null; }
        const overlay = document.getElementById('aiLessonOverlay');
        if (!overlay) return;
        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }

    // Session filter (client-side mirror of server filterTaggedForSession):
    // keep shared (session-less) blocks + blocks tagged with the focus session.
    function filterPlanTextForSession(taggedText, focus) {
        const f = String(focus || '').toUpperCase();
        if (!/^S[1-5]$/.test(f)) return { text: taggedText, filtered: false };
        const chunks = String(taggedText || '').split(/\n(?=\[P\d+ )/);
        const kept = chunks.filter((ch) => {
            const head = ch.split('\n')[0] || '';
            const m = head.match(/·\s*([S\d/, ]+)/);
            if (!m) return true; // shared header/meta block
            return m[1].split(/[/, ]+/).includes(f);
        });
        if (!kept.length) return { text: taggedText, filtered: false };
        // Renumber refs cleanly.
        let n = 0;
        const out = kept.map((ch) => ch.replace(/^\[P\d+ /, () => `\[P${++n} `)).join('\n');
        return { text: out, filtered: true, kept: kept.length, total: chunks.length };
    }

    function currentFocusValue() { return focusSessionEl?.value || ''; }

    function fillTextareaForFocus() {
        if (!planTextEl || !lastParse?.planText) return;
        const focus = currentFocusValue();
        const edited = planTextEl.dataset.edited === '1';
        // Never clobber teacher edits except on fresh parse / explicit session change.
        if (!focus) {
            // No focus session — show the full plan unless the teacher has already edited the textarea.
            if (viewFiltered || !planTextEl.value.trim() || !edited) {
                planTextEl.value = lastParse.planText;
                planTextEl.dataset.edited = '0';
                viewFiltered = false;
            }
        } else if (!edited || viewFiltered) {
            const { text, filtered, kept, total } = filterPlanTextForSession(lastParse.planText, focus);
            planTextEl.value = text;
            planTextEl.dataset.edited = '0';
            viewFiltered = filtered;
            if (scopeBannerEl) {
                if (filtered) {
                    scopeBannerEl.style.display = '';
                    scopeBannerEl.innerHTML = `<strong>Showing ${escapeHtml(focus)} only</strong> (${kept} of ${total} sections; other sessions hidden). `
                        + `The full plan is still sent as context — the deck is built for ${escapeHtml(focus)}. `
                        + `Review, adjust, or edit below; use “Show full plan” to see everything.`;
                } else {
                    scopeBannerEl.style.display = 'none';
                    scopeBannerEl.innerHTML = '';
                }
            }
        }
        if (viewToggleEl) {
            const canToggle = !!(lastParse?.planText && currentFocusValue() && /^S[1-5]$/.test(currentFocusValue()));
            viewToggleEl.style.display = canToggle ? '' : 'none';
            viewToggleEl.textContent = viewFiltered ? 'Show full plan' : `Show ${currentFocusValue()} only`;
        }
    }
    // (viewFiltered declared above with lastParse)
    const csrfToken = () => document.querySelector('meta[name=csrf-token]')?.content || window.CSRF_TOKEN || '';

    // Local HTML escaper (lesson page loads only this script, not quiz-maker-teacher.js).
    function escapeHtml(str) {
        if (str == null) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Editable section grid: one row per plan section, one column per session.
    // Cell edits are collected into plan_grid JSON on Generate (edits win).
    const gridWrapEl = document.getElementById('planGridWrap');
    const gridHeadEl = document.getElementById('planGridHead');
    const gridBodyEl = document.getElementById('planGridBody');
    let gridModel = null; // {columns, shared, rows} from /parse
    const gridEdits = {}; // rowKey -> { Sn: text } ; shared key -> text
    let gridBaseText = ''; // full tagged text the grid was built from

    function collectGridEdits() {
        if (!gridModel || !gridBodyEl) return null;
        const out = {};
        let touched = false;
        gridBodyEl.querySelectorAll('[data-grid-key]').forEach((td) => {
            const key = td.dataset.gridKey;
            const col = td.dataset.gridCol || '';
            const cur = td.innerText || '';
            const orig = td.dataset.gridOrig || '';
            if (cur.trim() !== orig.trim()) {
                touched = true;
                if (col) {
                    out[key] = out[key] || {};
                    out[key][col] = cur.trim();
                } else {
                    out[key] = cur.trim();
                }
            }
        });
        return touched ? out : null;
    }

    // Effective plan length = grid edits (when grid shown) else textarea.
    function effectivePlanLength() {
        if (gridModel && gridBodyEl && gridWrapEl && gridWrapEl.style.display !== 'none') {
            let len = 0;
            gridBodyEl.querySelectorAll('[data-grid-key]').forEach((td) => { len += (td.innerText || '').length + 20; });
            return len;
        }
        return (planTextEl?.value || '').length;
    }

    function setGenerateState() {
        if (!generateBtn) return;
        const hasText = ((planTextEl?.value || '').trim().length >= 200) || (gridModel && effectivePlanLength() >= 200);
        const over = effectivePlanLength() > MAX_PLAN;
        const ok = hasText && !over && attestEl?.checked === true;
        generateBtn.disabled = !ok;
        generateBtn.classList.toggle('btn-liquid-primary', ok);
        generateBtn.classList.toggle('btn-secondary', !ok);
        generateBtn.title = !hasText ? 'Provide at least 200 characters of plan text first'
            : over ? `Trim ${(planTextEl.value.length - MAX_PLAN).toLocaleString()} characters to continue`
            : !attested() ? 'Tick the CG/BOW confirmation first' : 'Ready to generate';
        function attested() { return attestEl?.checked === true; }
    }

    function renderGrid(grid) {
        gridModel = grid || null;
        if (!gridWrapEl || !gridHeadEl || !gridBodyEl) return;
        if (!gridModel || !gridModel.rows || !gridModel.rows.length) {
            gridWrapEl.style.display = 'none';
            gridHeadEl.innerHTML = '';
            gridBodyEl.innerHTML = '';
            return;
        }
        const cols = gridModel.columns || [];
        gridHeadEl.innerHTML = '<th scope="col" style="min-width:180px;">Section</th>'
            + cols.map((c) => `<th scope="col">${escapeHtml(c.replace('S', 'Session '))}</th>`).join('');
        const roleBadge = (role) => {
            const map = { intentions: 'badge-emerald', experiences: 'badge-jade', assessment: 'badge-amber', ways: 'badge-gray', meta: 'badge-gray', other: 'badge-gray' };
            return `<span class="badge ${map[role] || 'badge-gray'}">${escapeHtml(role || 'other')}</span>`;
        };
        let html = '';
        (gridModel.shared || []).slice(0, 8).forEach((sh) => {
            html += `<tr><td class="fw-bold small">${escapeHtml((sh.title || 'Header').slice(0, 60))} ${roleBadge('meta')}</td>`
                + `<td colspan="${cols.length}" class="small" contenteditable="true" data-grid-key="${escapeHtml(sh.key)}" data-grid-orig="${escapeHtml((sh.preview || '').slice(0, 500))}" style="white-space: pre-wrap;">${escapeHtml(sh.preview || '')}</td></tr>`;
        });
        gridModel.rows.forEach((row) => {
            html += `<tr><td class="fw-bold small">${escapeHtml((row.title || 'Section').slice(0, 60))}<br>${roleBadge(row.role)}<br><span class="text-muted" style="font-weight:400;">${escapeHtml(Object.values(row.refs || {}).join(', '))}</span></td>`;
            cols.forEach((col) => {
                const cell = (row.cells && row.cells[col]) || '';
                const shown = cell.length > 500 ? `${cell.slice(0, 500)}…` : cell;
                html += `<td class="small" contenteditable="true" data-grid-key="${escapeHtml(row.key)}" data-grid-col="${escapeHtml(col)}" data-grid-orig="${escapeHtml(cell.slice(0, 500))}" style="white-space: pre-wrap; min-width: 200px;">${escapeHtml(shown)}</td>`;
            });
            html += '</tr>';
        });
        gridBodyEl.innerHTML = html;
        gridWrapEl.style.display = '';
        gridBodyEl.querySelectorAll('[data-grid-key]').forEach((td) => {
            td.addEventListener('input', () => { setGenerateState(); saveLessonDraft(); });
        });
    }

    // Visual ILAW checklist with counts (server parse wins; client regex is fallback).
    function renderChecklist(cov, counts, sessions) {
        if (!checklistEl) return;
        const names = [
            ['intentions', 'Intentions', 'objectives, competency, standards'],
            ['experiences', 'Learning Experiences', 'activities, discussion, resources'],
            ['assessment', 'Assessment', 'formative tasks, exit checks'],
            ['ways', 'Ways Forward', 'reflection, assignment, enrichment']
        ];
        const anyCov = cov && names.some(([k]) => cov[k]);
        if (!anyCov && !(planTextEl?.value || '').trim()) { checklistEl.style.display = 'none'; checklistEl.innerHTML = ''; return; }
        checklistEl.style.display = '';
        checklistEl.innerHTML = '<div class="d-flex flex-wrap gap-2">'
            + names.map(([k, label, hint]) => {
                const ok = !!(cov && cov[k]);
                const n = counts && counts[k] ? ` <span class="badge ${ok ? 'badge-emerald' : 'badge-gray'}">${counts[k]} found</span>` : '';
                return `<span class="badge ${ok ? 'badge-emerald' : 'badge-gray'}" title="${hint}">${ok ? '✓' : '○'} ${label}</span>${n}`;
            }).join('')
            + (sessions && sessions.length ? `<span class="badge-amber">Sessions: ${sessions.join(', ')}</span>` : '')
            + '</div>';
    }

    // Client-side coverage preview (mirrors server role patterns, advisory only).
    function previewCoverage() {
        const text = (planTextEl?.value || '');
        const t = text.toLowerCase();
        const cov = lastParse?.coverage || {
            intentions: /intentions?|learning competency|content standard|performance standard|learning objectives?/.test(t),
            experiences: /learning experiences?|pre-?lesson|procedure|lesson proper|concept building|active (retrieval|learning)|social learning|learning resources/.test(t),
            assessment: /assessments?\b|formative assessment|evaluation/.test(t),
            ways: /ways forward|extended learning|reflections?\s*:|assignment|remarks|enrichment|remediation/.test(t)
        };
        const sess = lastParse?.sessions?.length
            ? lastParse.sessions
            : [...new Set((text.match(/session\s*[1-5]/gi) || []).map((s) => s.replace(/\s+/g, ' ').toUpperCase()))];
        const len = text.length;
        if (charCountEl) {
            charCountEl.textContent = `${len.toLocaleString()} / ${MAX_PLAN.toLocaleString()}${len > MAX_PLAN ? ` — ${(len - MAX_PLAN).toLocaleString()} over: split by session or trim` : ''}`;
            charCountEl.className = len > MAX_PLAN ? 'small fw-bold text-danger' : 'small text-muted';
        }
        if (coverageEl) {
            const missing = [['intentions', 'Intentions'], ['experiences', 'Experiences'], ['assessment', 'Assessment'], ['ways', 'Ways Forward']].filter(([k]) => !cov[k]).map(([, l]) => l);
            coverageEl.textContent = missing.length ? `Coverage — missing: ${missing.join(', ')}` : 'Coverage — all four ILAW parts found ✓';
            coverageEl.className = missing.length ? 'small fw-semibold text-warning' : 'small fw-semibold text-success';
        }
        renderChecklist(cov, lastParse?.sectionCounts, sess);
        // Auto-offer detected sessions in the picker without overriding a choice.
        if (focusSessionEl && sess.length) {
            const have = new Set(Array.from(focusSessionEl.options).map((o) => o.value));
            sess.map((s) => s.replace('SESSION ', 'S')).forEach((v) => {
                if (v && !have.has(v) && /^S[1-5]$/.test(v)) {
                    const o = document.createElement('option');
                    o.value = v; o.textContent = `Session ${v.slice(1)}`;
                    focusSessionEl.appendChild(o);
                }
            });
            if (!focusSessionEl.value) {
                const first = sess[0].replace('SESSION ', 'S');
                if (/^S[1-5]$/.test(first)) focusSessionEl.value = first;
            }
        }
        setGenerateState();
    }

    function applySuggestions(s) {
        if (!s) return;
        const topicEl = document.getElementById('lessonTopic');
        const subjEl = document.getElementById('lessonSubject');
        const gradeEl = document.getElementById('lessonGrade');
        let filled = [];
        if (topicEl && !topicEl.value.trim() && s.topic) { topicEl.value = s.topic; filled.push('topic'); }
        if (subjEl && (!subjEl.value.trim() || subjEl.value.trim() === 'English') && s.subject) { subjEl.value = s.subject; filled.push('subject'); }
        if (gradeEl && s.grade && /^Grade (7|8|9|10)$/.test(s.grade)) { gradeEl.value = s.grade; filled.push('grade'); }
        if (topicHintEl) {
            topicHintEl.textContent = filled.length ? `(auto-filled from plan: ${filled.join(', ')} — editable)` : '(auto-fills from plan)';
        }
        if (parseStatusEl) {
            parseStatusEl.innerHTML = filled.length
                ? `<span class="text-success">✓ Auto-filled ${filled.join(', ')} from the plan file — review and edit as needed.</span>`
                : '';
        }
    }

    // Auto-parse on file select: POST to /api/ai/lesson/parse, populate textarea.
    async function autoParseFile(file) {
        if (!file) return;
        if (parseStatusEl) parseStatusEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Parsing lesson plan... extracting tables...';
        if (checklistEl) { checklistEl.style.display = ''; checklistEl.innerHTML = '<span class="small text-muted">Parsing lesson plan... extracting tables...</span>'; }
        try {
            const fd = new FormData();
            fd.append('plan_file', file);
            const res = await fetch('/api/ai/lesson/parse', {
                method: 'POST',
                headers: { 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrfToken() },
                body: fd
            });
            // The parse endpoint returns JSON. A non-JSON body means the request
            // never reached it (stale server without the route, or login redirect).
            const raw = await res.text();
            let data;
            try {
                data = JSON.parse(raw);
            } catch {
                if (res.status === 404 || /not found/i.test(raw.slice(0, 200))) {
                    throw new Error('Parse endpoint not found (404). Restart the app server so POST /api/ai/lesson/parse goes live, then re-select the file.');
                }
                if (/login|sign in/i.test(raw.slice(0, 500))) {
                    throw new Error('Session expired. Reload the page and sign in again, then re-select the file.');
                }
                throw new Error(`Parse failed (HTTP ${res.status}). Restart the app server and try again.`);
            }
            if (!res.ok) throw new Error(data.error || 'Parse failed.');
            // Keep the FULL plan for generation context; the textarea shows the
            // session-filtered view when a focus session is selected. The grid
            // is the primary review surface (per-cell editing); textarea stays
            // as fallback/paste surface.
            lastParse = { planText: data.planText, coverage: data.coverage, sessions: data.sessions, sectionCounts: data.sectionCounts };
            gridBaseText = data.planText || '';
            applySuggestions(data.suggestions);
            if (planTextEl) planTextEl.dataset.edited = '0';
            renderGrid(data.grid);
            fillTextareaForFocus();
            saveLessonDraft();
            if (parseStatusEl) {
                const rows = (data.grid && data.grid.rows ? data.grid.rows.length : 0);
                parseStatusEl.innerHTML = `<span class="text-success">✓ Parsed ${escapeHtml(file.name)} — ${data.tableCount || 0} table(s), ${(data.sections || []).length} sections (${escapeHtml(data.source || 'file')}). Review the ${rows}-row table below (click any cell to edit), then generate.</span>`;
            }
        } catch (err) {
            if (parseStatusEl) parseStatusEl.innerHTML = `<span class="text-danger">${escapeHtml(err.message || 'Could not read this file.')}</span>`;
            if (checklistEl) { checklistEl.style.display = 'none'; checklistEl.innerHTML = ''; }
        } finally {
            previewCoverage();
        }
    }

    if (planTextEl) planTextEl.addEventListener('input', () => { planTextEl.dataset.edited = '1'; previewCoverage(); saveLessonDraft(); });
    if (planFileEl) planFileEl.addEventListener('change', () => {
        const f = planFileEl.files?.[0];
        if (f) autoParseFile(f);
        else previewCoverage();
    });
    if (focusSessionEl) focusSessionEl.addEventListener('change', () => {
        // Re-filter the textarea to the newly selected session (unless the
        // teacher already edited the text — then keep edits and just update UI).
        fillTextareaForFocus();
        previewCoverage();
        saveLessonDraft();
    });
    if (viewToggleEl) viewToggleEl.addEventListener('click', () => {
        if (!lastParse?.planText) return;
        if (viewFiltered) {
            planTextEl.value = lastParse.planText;
            planTextEl.dataset.edited = '0';
            viewFiltered = false;
        } else {
            const focus = currentFocusValue();
            if (!focus) return;
            const { text, filtered } = filterPlanTextForSession(lastParse.planText, focus);
            if (filtered) {
                planTextEl.value = text;
                planTextEl.dataset.edited = '0';
                viewFiltered = true;
            }
        }
        fillTextareaForFocus();
        previewCoverage();
    });
    if (attestEl) attestEl.addEventListener('change', setGenerateState);
        ['lessonTopic', 'lessonSubject', 'lessonGrade', 'lessonInstructions', 'planFormat'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', saveLessonDraft);
    });
    if (aiDeclEl) aiDeclEl.addEventListener('change', saveLessonDraft);
    previewCoverage();

    function collectPrefs() {
        const checked = (sel) => Array.from(document.querySelectorAll(sel + ':checked')).map((c) => c.value);
        const other = (cbId, txtId) => {
            const on = document.getElementById(cbId)?.checked;
            const v = document.getElementById(txtId)?.value.trim();
            return on && v ? [v] : [];
        };
        const val = (id) => document.getElementById(id)?.value.trim() || '';
        return {
            approach: [...checked('.approach-cb'), ...other('approachOtherCb', 'approachOther')],
            integration: [...checked('.integration-cb'), ...other('integrationOtherCb', 'integrationOther')],
            resources: [...checked('.resources-cb'), ...other('resourcesOtherCb', 'resourcesOther')],
            language: val('lessonLanguage'),
            assessment: [...checked('.assessment-cb'), ...other('assessmentOtherCb', 'assessmentOther')],
            class_profile: [...checked('.profile-cb'), ...other('profileOtherCb', 'profileOther')].join('; '),
            inclusion: [...checked('.inclusion-cb'), ...other('inclusionOtherCb', 'inclusionOther')].join('; '),
            duration: val('lessonDuration')
        };
    }

    // CSP-safe step-2 actions (no inline onclick): print + back-to-setup.
    document.querySelectorAll('[data-print-lesson]').forEach((btn) => {
        btn.addEventListener('click', () => window.print());
    });
    document.querySelectorAll('[data-back-to-setup]').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.getElementById('lessonStep2').style.display = 'none';
            document.getElementById('lessonStep1').style.display = 'block';
        });
    });

    if (generateBtn) {
        generateBtn.addEventListener('click', async () => {
            const plan_text = (planTextEl?.value || '').trim();
            const plan_file = planFileEl?.files?.[0] || null;
            const plan_format = planFormatEl?.value || 'ilaw';
            const focus_session = focusSessionEl?.value || '';
            const topic = document.getElementById('lessonTopic').value.trim();
            const grade_level = document.getElementById('lessonGrade').value;
            const subject = document.getElementById('lessonSubject').value;
            const instructions = document.getElementById('lessonInstructions').value.trim();
            const includeDecl = aiDeclEl?.checked === true;
            const attested = attestEl?.checked === true;

            if (!plan_text && !plan_file && !gridModel) {
                alert('Paste your lesson plan or attach the plan file first.');
                return;
            }
            const gridTouched = collectGridEdits();
            if (plan_text.length > MAX_PLAN && !gridTouched) {
                alert(`Plan text is ${(plan_text.length - MAX_PLAN).toLocaleString()} characters over the ${MAX_PLAN.toLocaleString()} limit. Trim or split by session.`);
                return;
            }
            if (!attested) {
                alert('Please tick the CG/BOW confirmation before generating.');
                return;
            }

            generateBtn.disabled = true;
            generateBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Translating Plan to Slides...';
            showLessonLoadingOverlay();

            try {
                let res;
                // Always send the FULL plan as context: if the textarea shows the
                // session-filtered view, attach the stored full plan alongside it.
                const fullPlan = lastParse?.planText || '';
                const shownIsFiltered = viewFiltered && fullPlan && plan_text.length < fullPlan.length;
                if (plan_file) {
                    const fd = new FormData();
                    fd.append('plan_text', shownIsFiltered ? fullPlan : plan_text);
                    fd.append('plan_file', plan_file);
                    if (gridTouched) { fd.append('plan_grid', JSON.stringify(gridTouched)); fd.append('plan_grid_base', gridBaseText || fullPlan || plan_text); }
                    fd.append('plan_format', plan_format);
                    fd.append('focus_session', focus_session);
                    fd.append('topic', topic);
                    fd.append('grade_level', grade_level);
                    fd.append('subject', subject);
                    fd.append('instructions', instructions);
                    const prefs = collectPrefs();
                    prefs.include_ai_declaration = includeDecl;
                    Object.entries(prefs).forEach(([k, v]) => fd.append(k, Array.isArray(v) ? JSON.stringify(v) : (typeof v === 'boolean' ? (v ? '1' : '0') : v)));
                    res = await fetch('/api/ai/lesson/generate', {
                        method: 'POST',
                        headers: { 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrfToken() },
                        body: fd
                    });
                } else {
                    res = await fetch('/api/ai/lesson/generate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrfToken() },
                        body: JSON.stringify({
                            plan_text: shownIsFiltered ? fullPlan : plan_text,
                            plan_view: shownIsFiltered ? `filtered_${focus_session}` : 'full',
                            ...(gridTouched ? { plan_grid: JSON.stringify(gridTouched), plan_grid_base: gridBaseText || fullPlan || plan_text } : {}),
                            plan_format,
                            focus_session,
                            topic,
                            grade_level,
                            subject,
                            instructions,
                            include_ai_declaration: includeDecl,
                            ...collectPrefs()
                        })
                    });
                }

                const data = await res.json();
                if (!res.ok) {
                    alert(data.error || 'Lesson generation failed. Please try again.');
                    return;
                }
                if (data.success && data.lesson) {
                    currentLessonData = data.lesson;
                    // Stash the deck for quiz dual-grounding on the quiz page.
                    try {
                        sessionStorage.setItem('edushare_last_deck', JSON.stringify(data.lesson));
                    } catch { /* storage may be unavailable */ }
                    currentNeedsReview = !!data.needsReview;
                    currentValidation = Array.isArray(data.validation) ? data.validation : [];
                    currentLessonId = data.lessonId || null;
                    currentGrounded = !!data.grounded;
                    currentCoverage = data.coverage || null;
                    currentFocus = data.focus_session || focus_session || '';
                    renderSlides(data.lesson);
                    updateGroundBadge(data);
                    updateReviewBox();
                    renderPrep(data.prep);
                    renderCoverageLine();
                    step1.style.display = 'none';
                    step2.style.display = 'block';
                    saveLessonDraft();
                } else {
                    alert('Lesson generation failed. Please try again.');
                }
            } catch (err) {
                console.error('Lesson generate error:', err);
                alert('Error generating lesson.');
            } finally {
                hideLessonLoadingOverlay();
                setGenerateState();
                if (!generateBtn.disabled) generateBtn.innerHTML = '<i class="bi bi-stars me-2"></i> Generate Discussion Deck';
            }
        });
    }

    function updateGroundBadge(data) {
        const badge = document.getElementById('lessonGroundBadge');
        if (!badge) return;
        const n = Array.isArray(data.sources) ? data.sources.length : 0;
        const issues = Array.isArray(data.validation) ? data.validation : [];
        const sessTxt = (data.focus_session || currentFocus) ? ` · Session ${data.focus_session || currentFocus}` : '';
        const cov = data.coverage || currentCoverage || {};
        const covCount = ['intentions', 'experiences', 'assessment', 'ways'].filter((k) => cov[k]).length;
        if (data.grounded && !data.needsReview) {
            badge.textContent = `Plan-grounded: ${n} section${n === 1 ? '' : 's'} · Coverage ${covCount}/4${sessTxt}`;
            badge.className = 'small fw-semibold text-success';
        } else {
            const why = issues.length ? ` — check: ${issues.slice(0, 3).join(', ')}` : '';
            const warn = (data.plan_warnings || []).length ? ` — plan: ${data.plan_warnings.slice(0, 2).join(', ')}` : '';
            badge.textContent = `Teacher review required${why}${warn}${data.saveWarning ? ': draft not saved' : ''}`;
            badge.className = 'small fw-semibold text-danger';
        }
        if (data.saveWarning) alert(data.saveWarning);
    }

    function renderCoverageLine() {
        if (!coverageLine) return;
        if (!currentCoverage) { coverageLine.textContent = ''; return; }
        const parts = [['intentions', 'Intentions'], ['experiences', 'Experiences'], ['assessment', 'Assessment'], ['ways', 'Ways Forward']]
            .map(([k, label]) => `${currentCoverage[k] ? '✓' : '○'} ${label}`).join(' · ');
        coverageLine.textContent = `Plan coverage: ${parts}${currentFocus ? ` · Session ${currentFocus}` : ''}`;
        coverageLine.className = 'small fw-semibold mt-1 text-success';
    }

    function renderPrep(prep) {
        if (!prepBox) return;
        const items = Array.isArray(prep) ? prep.filter(Boolean).slice(0, 12) : [];
        if (!items.length) { prepBox.style.display = 'none'; prepBox.innerHTML = ''; return; }
        prepBox.style.display = 'block';
        prepBox.innerHTML = '<div class="alert alert-info py-2 px-3 mb-0 small">'
            + '<strong><i class="bi bi-clipboard-check me-1"></i>Before class — prep checklist (from your plan, not projected):</strong>'
            + '<ul class="mb-0 mt-1">' + items.map((x) => `<li>${escapeHtml(x)}</li>`).join('') + '</ul></div>';
    }

    function asLines(v) {
        if (Array.isArray(v)) return v.map((x) => String(x || ''));
        if (typeof v === 'string' && v) return [v];
        return [];
    }

    // Dual-read: new shape wins when present, so merged content never double-counts.
    function slideLines(s) {
        // Projection: slide_text first, then verb-led task. Legacy bullets/content
        // only as fallback. Citations are stripped in Projection view (see render).
        const fromNew = [...asLines(s.slide_text), ...asLines(s.student_task)];
        if (fromNew.length) return fromNew;
        const legacy = [...asLines(s.bullets), ...asLines(s.student_task)];
        if (legacy.length) return legacy;
        return asLines(s.content);
    }

    function slideScript(s) {
        if (typeof s.teacher_script === 'string' && s.teacher_script) return s.teacher_script;
        return '';
    }

    function slideVisual(s) {
        if (typeof s.visual_prompt === 'string' && s.visual_prompt) return s.visual_prompt;
        return '';
    }

    // Projection view must never show traceability scaffolding or teacher talk.
    function stripProjection(text) {
        return String(text || '')
            .replace(/\s*\[[PS]\d+\]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    let previewMode = 'projection'; // 'projection' | 'teacher'
    function setPreviewMode(mode) {
        previewMode = mode === 'teacher' ? 'teacher' : 'projection';
        const pb = document.getElementById('viewProjectionBtn');
        const tb = document.getElementById('viewTeacherBtn');
        if (pb) { pb.classList.toggle('active', previewMode === 'projection'); pb.setAttribute('aria-pressed', previewMode === 'projection' ? 'true' : 'false'); }
        if (tb) { tb.classList.toggle('active', previewMode === 'teacher'); tb.setAttribute('aria-pressed', previewMode === 'teacher' ? 'true' : 'false'); }
        const hint = document.getElementById('projectionHint');
        if (hint) hint.textContent = previewMode === 'projection'
            ? 'Projection view hides citations, scripts, and notes — exactly what students would see.'
            : 'Teacher view shows the full script, Say/Do notes, and traceability refs.';
        if (currentLessonData) renderSlides(currentLessonData);
    }
    document.getElementById('viewProjectionBtn')?.addEventListener('click', () => setPreviewMode('projection'));
    document.getElementById('viewTeacherBtn')?.addEventListener('click', () => setPreviewMode('teacher'));

    function slideSpeech(s) {
        if (typeof s.speaker_notes === 'string' && s.speaker_notes) return s.speaker_notes;
        return '';
    }

    function slideNote(s) {
        if (typeof s.teacher_tip === 'string' && s.teacher_tip) return s.teacher_tip;
        return s.notes || '';
    }

    function renderSlides(lesson) {
        if (!slidesContainer) return;
        if (!lesson || !Array.isArray(lesson.slides) || lesson.slides.length === 0) {
            alert('Lesson generation returned empty. Try again.');
            return;
        }
        slidesContainer.innerHTML = '';

        const meta = lesson.meta || {};
        const topicEl = document.getElementById('displayLessonTopic');
        const compEl = document.getElementById('displayLessonComp');
        if (topicEl) topicEl.textContent = meta.topic || lesson.topic || '';
        if (compEl) compEl.textContent = `${meta.subject || lesson.subject || ''} • ${meta.grade_level || lesson.gradeLevel || ''} • ${String(meta.competency || lesson.competency || '').slice(0, 160)}`;

        const isProjection = previewMode === 'projection';

        lesson.slides.forEach((slide, idx) => {
            const slideCol = document.createElement('div');
            slideCol.className = 'col-md-6 mb-4';
            slideCol.dataset.slideIndex = idx;

            const id = String(slide.id || slide.type || '').toLowerCase() || 'concept';

            if (isProjection) {
                // ---- READ-ONLY PROJECTION VIEW ----
                const rawLines = slideLines(slide);
                const lines = rawLines
                    .map((x) => stripProjection(x))
                    .filter((x) => x)
                    .map((x) => `<li>${formatSlideContent(x)}</li>`).join('');
                const overLong = rawLines.some((x) => stripProjection(x).split(/\s+/).filter(Boolean).length > 12);
                const longWarn = overLong ? `<div class="mt-2 small text-warning"><i class="bi bi-exclamation-triangle me-1"></i>Too much text for projection — move detail to the script.</div>` : '';
                const visual = slideVisual(slide);
                const visualHtml = `<div class="mt-2 small text-muted"><i class="bi bi-image me-1"></i><em>Show: ${escapeHtml(visual || 'simple visual related to the slide title')}</em></div>`;

                slideCol.innerHTML = `
                    <div class="glass-card p-4 h-100 position-relative">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <span class="badge-emerald">Slide ${idx + 1}</span>
                            <span class="badge-amber text-capitalize">${escapeHtml(id)}</span>
                        </div>
                        <h5 class="fw-bold mb-3 text-dark">${escapeHtml(stripProjection(slide.title))}</h5>
                        <ul class="small text-secondary ps-3 mb-0" style="line-height: 1.6;">${lines}</ul>
                        ${longWarn}
                        ${visualHtml}
                    </div>
                `;
            } else {
                // ---- EDITABLE TEACHER VIEW ----
                const linesText = slideLines(slide).join('\n');
                const visual = slideVisual(slide);
                const script = slideScript(slide);
                const speech = slideSpeech(slide);
                const tip = slideNote(slide);

                slideCol.innerHTML = `
                    <div class="glass-card p-4 h-100 position-relative" data-editable-slide="true">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <span class="badge-emerald">Slide ${idx + 1}</span>
                            <span class="badge-amber text-capitalize">${escapeHtml(id)}</span>
                        </div>

                        <div class="mb-3">
                            <label class="form-label small fw-bold mb-1">Slide Title</label>
                            <input type="text" class="glass-input" value="${escapeHtml(slide.title || '')}" data-slide-field="title" placeholder="Slide title">
                        </div>

                        <div class="mb-3">
                            <label class="form-label small fw-bold mb-1">
                                Projection Lines
                                <span class="text-muted fw-normal">(one per line — what students see)</span>
                            </label>
                            <textarea class="glass-input" rows="4" data-slide-field="lines" placeholder="One bullet per line...">${escapeHtml(linesText)}</textarea>
                        </div>

                        <div class="mb-3">
                            <label class="form-label small fw-bold mb-1">Visual Prompt <span class="text-muted fw-normal">(what to show)</span></label>
                            <input type="text" class="glass-input" value="${escapeHtml(visual || '')}" data-slide-field="visual" placeholder="e.g. Diagram of the water cycle">
                        </div>

                        <div class="mb-3">
                            <label class="form-label small fw-bold mb-1">Teacher Script</label>
                            <textarea class="glass-input" rows="3" data-slide-field="script" placeholder="What you say/do when this slide is up...">${escapeHtml(script || '')}</textarea>
                        </div>

                        <div class="mb-3">
                            <label class="form-label small fw-bold mb-1">Say / Do <span class="text-muted fw-normal">(speaker notes)</span></label>
                            <textarea class="glass-input" rows="2" data-slide-field="speech" placeholder="Short speaker note...">${escapeHtml(speech || '')}</textarea>
                        </div>

                        <div class="mb-0">
                            <label class="form-label small fw-bold mb-1">Teacher Tip</label>
                            <input type="text" class="glass-input" value="${escapeHtml(tip || '')}" data-slide-field="tip" placeholder="e.g. Ask students to predict the next step">
                        </div>
                    </div>
                `;
            }

            slidesContainer.appendChild(slideCol);
            if (!isProjection) bindSlideCard(slideCol, idx);
        });
    }

    function bindSlideCard(slideCol, idx) {
        const slide = currentLessonData?.slides?.[idx];
        if (!slide) return;

        // Title
        slideCol.querySelector('[data-slide-field="title"]')?.addEventListener('input', (e) => {
            slide.title = e.target.value;
            saveLessonDraft();
        });

        // Projection lines — textarea, one line per entry.
        slideCol.querySelector('[data-slide-field="lines"]')?.addEventListener('input', (e) => {
            const arr = e.target.value
                .split('\n')
                .map((x) => x.trim())
                .filter((x) => x.length > 0);
            slide.slide_text = arr;
            // Keep legacy shapes in sync so dual-read + PPTX export still work.
            slide.bullets = arr.slice();
            slide.content = arr.slice();
            saveLessonDraft();
        });

        // Visual prompt
        slideCol.querySelector('[data-slide-field="visual"]')?.addEventListener('input', (e) => {
            slide.visual_prompt = e.target.value;
            saveLessonDraft();
        });

        // Teacher script
        slideCol.querySelector('[data-slide-field="script"]')?.addEventListener('input', (e) => {
            slide.teacher_script = e.target.value;
            saveLessonDraft();
        });

        // Say / Do (speaker notes)
        slideCol.querySelector('[data-slide-field="speech"]')?.addEventListener('input', (e) => {
            slide.speaker_notes = e.target.value;
            saveLessonDraft();
        });

        // Teacher tip
        slideCol.querySelector('[data-slide-field="tip"]')?.addEventListener('input', (e) => {
            slide.teacher_tip = e.target.value;
            saveLessonDraft();
        });
    }

    function formatSlideContent(content) {
        if (!content) return '';
        let text = escapeHtml(content);
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
        text = text.replace(/^### (.*$)/gim, '<h6 class="fw-bold text-success mt-2 mb-1">$1</h6>');
        return text;
    }

    function updateReviewBox() {
        var box = document.getElementById('lessonReviewBox');
        if (!box) return;
        if (!currentNeedsReview) { box.style.display = 'none'; box.innerHTML = ''; return; }
        var list = currentValidation.slice(0, 5).map(function (v) { return '<li>' + escapeHtml(v) + '</li>'; }).join('');
        box.style.display = 'block';
        box.innerHTML = '<div class="alert alert-warning py-2 px-3 mb-0 small">'
            + '<strong>Teacher review required before saving.</strong>'
            + (list ? '<ul class="mb-1 mt-1">' + list + '</ul>' : '')
            + '<label class="d-flex align-items-center gap-2 mt-1 mb-0">'
            + '<input type="checkbox" id="lessonReviewConfirm" class="form-check-input mt-0"> I reviewed and approve this lesson'
            + '</label></div>';
    }

    // PPTX export: POST deck JSON (pre-save OK) or draft id; download blob.
    document.getElementById('btnExportPptx')?.addEventListener('click', async () => {
        if (!currentLessonData) { alert('Generate the deck first, then export.'); return; }
        const btn = document.getElementById('btnExportPptx');
        btn.disabled = true;
        const orig = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Building .pptx...';
        try {
            const res = await fetch('/api/ai/lesson/export-pptx', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrfToken() },
                body: JSON.stringify({ lesson_json: currentLessonData, lessonId: currentLessonId })
            });
            if (!res.ok) {
                let msg = 'PPTX export failed.';
                try { msg = (await res.json()).error || msg; } catch { /* blob/empty */ }
                alert(msg);
                return;
            }
            const blob = await res.blob();
            const cd = res.headers.get('Content-Disposition') || '';
            const m = cd.match(/filename="?([^"]+)"?/);
            const name = m ? m[1] : 'lesson-deck.pptx';
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch (err) {
            console.error('PPTX export error:', err);
            alert('PPTX export failed. Try again.');
        } finally {
            btn.disabled = false;
            btn.innerHTML = orig;
        }
    });

    if (btnSaveToLibrary) {
        btnSaveToLibrary.addEventListener('click', async () => {
            if (!currentLessonData) return;

            const selectedClassCheckboxes = document.querySelectorAll('.post-class-checkbox:checked');
            const class_ids = Array.from(selectedClassCheckboxes).map(cb => cb.value);
            const confirmed = document.getElementById('lessonReviewConfirm')?.checked === true;
            if (currentNeedsReview && !confirmed) {
                alert('Please review the flagged issues and tick approval before saving.');
                return;
            }

            btnSaveToLibrary.disabled = true;
            btnSaveToLibrary.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Saving...';

            try {
                const res = await fetch('/api/ai/lesson/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrfToken() },
                    body: JSON.stringify({
                        title: currentLessonData.topic,
                        lesson_json: currentLessonData,
                        class_ids,
                        confirmed,
                        lessonId: currentLessonId,
                        grounded: currentGrounded
                    })
                });

                const data = await res.json();
                if (data.success) {
                    clearLessonDraft();
                    const reach = Number.isInteger(data.posted) && data.posted > 0
                        ? ` Posted to ${data.posted} class${data.posted === 1 ? '' : 'es'}.`
                        : '';
                    alert(`Lesson successfully saved to your Material Library!${reach}`);
                    window.location.href = '/teacher/library';
                } else if (res.status === 422) {
                    currentNeedsReview = true;
                    currentValidation = Array.isArray(data.validation) ? data.validation : [];
                    updateReviewBox();
                    alert((data.error || 'Review required.') + (currentValidation.length ? ' Check: ' + currentValidation.slice(0, 3).join(', ') : ''));
                    btnSaveToLibrary.disabled = false;
                } else {
                    alert('Failed to save lesson.');
                    btnSaveToLibrary.disabled = false;
                }
            } catch (err) {
                console.error('Save error:', err);
                alert('An error occurred while saving.');
                btnSaveToLibrary.disabled = false;
            }
        });
    }

    // ============================================================
    // Restore saved draft on page load
    // ============================================================
    (function restoreLessonDraft() {
        const draft = loadLessonDraft();
        if (!draft) return;

        // ---- Restore Step 1 form fields ----
        const f = draft.form || {};
        const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
        setVal('planText', f.planText);
        if (planTextEl && f.planTextEdited) planTextEl.dataset.edited = '1';
        setVal('planFormat', f.planFormat);
        setVal('focusSession', f.focusSession);
        setVal('lessonTopic', f.topic);
        setVal('lessonSubject', f.subject);
        setVal('lessonGrade', f.gradeLevel);
        setVal('lessonInstructions', f.instructions);
        if (aiDeclEl) aiDeclEl.checked = f.aiDecl === true;
        if (attestEl) attestEl.checked = f.attested === true;

        // ---- Restore parsed plan + grid ----
        if (draft.lastParse) lastParse = draft.lastParse;
        gridBaseText = draft.gridBaseText || '';
        viewFiltered = draft.viewFiltered === true;
        if (draft.gridModel) {
            renderGrid(draft.gridModel);
            // After renderGrid, sync viewFiltered back (it reads the DOM anyway)
            viewFiltered = draft.viewFiltered === true;
        }
        if (lastParse?.planText) {
            fillTextareaForFocus();
            previewCoverage();
        }

        // ---- Restore generated lesson (Step 2) if present ----
        if (draft.lesson && draft.lessonState) {
            currentLessonData = draft.lesson;
            currentLessonId = draft.lessonState.lessonId || null;
            currentNeedsReview = !!draft.lessonState.needsReview;
            currentValidation = Array.isArray(draft.lessonState.validation) ? draft.lessonState.validation : [];
            currentGrounded = !!draft.lessonState.grounded;
            currentCoverage = draft.lessonState.coverage || null;
            currentFocus = draft.lessonState.focus || '';

            // Restore Step 2 UI
            renderSlides(currentLessonData);
            updateReviewBox();
            renderCoverageLine();
            // If they were on Step 2 when they left, put them back on Step 2
            if (draft.step === 2) {
                step1.style.display = 'none';
                step2.style.display = 'block';
            }

            // Notify
            if (window.showToast) {
                window.showToast('Restored your in-progress lesson draft.', 'info');
            } else {
                console.log('Restored lesson draft from sessionStorage.');
            }
        } else if (lastParse?.planText) {
            // Only Step 1 state was saved — restore that and tell the teacher
            if (window.showToast) {
                window.showToast('Restored your in-progress plan.', 'info');
            }
        }

        // Set the generate button state (disabled unless everything's ready)
        setGenerateState();
    })();
});