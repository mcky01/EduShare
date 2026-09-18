// EduShare AI Study Buddy & Tutor client.
// Features: multi-turn streaming chat, stop/retry/copy per answer,
// markdown rendering, subject-aware history, export, live status.

document.addEventListener('DOMContentLoaded', () => {
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const chatMessages = document.getElementById('chatMessages');
    const chatEmpty = document.getElementById('chatEmptyState');
    const subjectSelect = document.getElementById('subjectSelect');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const exportChatBtn = document.getElementById('exportChatBtn');
    const stopStreamBtn = document.getElementById('stopStreamBtn');
    const typingBar = document.getElementById('chatTypingBar');
    const typingText = document.getElementById('chatTypingText');
    const sendBtn = document.getElementById('sendBtn');
    const charCount = document.getElementById('chatCharCount');
    const statusPill = document.getElementById('chatStatusPill');
    const statusText = document.getElementById('chatStatusText');
    const liveRegion = document.getElementById('chatLiveRegion');
    const suggestionChips = document.querySelectorAll('.suggestion-chip');

    if (!chatForm || !chatInput || !chatMessages) return;

    let isStreaming = false;
    let streamAborter = null;
    let streamTimer = null;
    let streamStartedAt = 0;
    let streamFirstChunkAt = 0;
    const savedSubject = (() => { try { return localStorage.getItem('chatSubject'); } catch { return null; } })();
    let currentSubject = (subjectSelect && savedSubject && Array.from(subjectSelect.options).some((o) => o.value === savedSubject))
        ? savedSubject
        : (subjectSelect ? subjectSelect.value : 'General');
    if (subjectSelect && subjectSelect.value !== currentSubject) subjectSelect.value = currentSubject;
    let lastUserMessage = '';
    const csrfToken = () => document.querySelector('meta[name=csrf-token]')?.content || window.CSRF_TOKEN || '';

    // ---------- helpers ----------
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function setStatus(mode, label) {
        if (!statusPill || !statusText) return;
        statusPill.classList.remove('badge-gray', 'badge-emerald', 'badge-amber', 'badge-red');
        statusPill.classList.add(mode === 'online' ? 'badge-emerald' : mode === 'offline' ? 'badge-amber' : mode === 'error' ? 'badge-red' : 'badge-gray');
        statusText.textContent = label;
    }

    function announce(text) {
        if (liveRegion) liveRegion.textContent = text;
    }

    function autoGrow() {
        if (chatInput && chatInput.tagName === 'TEXTAREA') {
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 240) + 'px';
        }
        if (charCount) {
            charCount.textContent = `${chatInput.value.length} / 2000`;
            charCount.classList.toggle('chat-char-warn', chatInput.value.length >= 1800);
        }
    }

    function isNearBottom() {
        if (!chatMessages) return true;
        return chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 80;
    }

    function scrollBottom(force) {
        if (!chatMessages) return;
        if (!force && !isNearBottom()) return;
        const prev = chatMessages.style.scrollBehavior;
        chatMessages.style.scrollBehavior = 'auto';
        chatMessages.scrollTop = chatMessages.scrollHeight;
        chatMessages.style.scrollBehavior = prev || '';
    }

    // Mobile: keep the chat panel sized to the visible viewport so the
    // composer never slides under the Android URL bar. Measures the slim
    // header + suggestions toggle above the panel as --chat-chrome.
    function syncChatChrome() {
        const panel = document.querySelector('.chat-panel');
        if (!panel || window.innerWidth > 768) {
            document.documentElement.style.removeProperty('--chat-chrome');
            return;
        }
        const top = document.querySelector('.chat-top');
        const sugg = document.querySelector('.chat-suggest');
        const chrome = (top ? top.offsetHeight : 0)
            + (sugg ? sugg.offsetHeight : 0) + 32;
        document.documentElement.style.setProperty('--chat-chrome', `${Math.round(chrome)}px`);
    }
    syncChatChrome();
    window.addEventListener('resize', syncChatChrome);
    window.addEventListener('orientationchange', () => setTimeout(syncChatChrome, 120));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', syncChatChrome);

    function hideEmpty() {
        if (chatEmpty) chatEmpty.style.display = 'none';
    }

    // ---------- markdown (safe: escape first, then allowlist our own tags) ----------
    // Models emit LaTeX (\frac, \sqrt, \(...\), \[...\]) but the portal ships
    // no math renderer, so math segments are converted to readable Unicode
    // text (×, ±, √, ², …) instead of leaking raw backslash commands.
    function cleanLatex(tex) {
        let out = String(tex);
        for (let i = 0; i < 5; i++) {
            // One nesting level allowed so \frac{-b \pm \sqrt{b^2-4ac}}{2a} matches.
            const inner = '(?:[^{}]|\\{[^{}]*\\})*';
            const next = out.replace(new RegExp('\\\\d?frac\\{(' + inner + ')\\}\\{(' + inner + ')\\}', 'g'), '($1)/($2)');
            if (next === out) break;
            out = next;
        }
        out = out
            .replace(/\\sqrt\{([^{}]*)\}/g, '\u221A($1)')
            .replace(/\\sqrt\b/g, '\u221A')
            .replace(/\\pm/g, '\u00B1').replace(/\\times/g, '\u00D7').replace(/\\div/g, '\u00F7')
            .replace(/\\cdot/g, '\u00B7').replace(/\\leq/g, '\u2264').replace(/\\geq/g, '\u2265')
            .replace(/\\neq/g, '\u2260').replace(/\\approx/g, '\u2248').replace(/\\infty/g, '\u221E')
            .replace(/\\pi/g, '\u03C0').replace(/\\theta/g, '\u03B8').replace(/\\alpha/g, '\u03B1')
            .replace(/\\beta/g, '\u03B2').replace(/\\gamma/g, '\u03B3').replace(/\\Delta/g, '\u0394')
            .replace(/\\delta/g, '\u03B4').replace(/\\mu/g, '\u03BC').replace(/\\sigma/g, '\u03C3')
            .replace(/\\sum/g, '\u03A3').replace(/\\prod/g, '\u03A0')
            .replace(/\\left\s*\(/g, '(').replace(/\\right\s*\)/g, ')')
            .replace(/\\left\s*\[/g, '[').replace(/\\right\s*\]/g, ']')
            .replace(/\\left\s*\{/g, '{').replace(/\\right\s*\}/g, '}')
            .replace(/\\([{}])/g, '$1')
            .replace(/\^{\s*2\s*}/g, '\u00B2').replace(/\^2/g, '\u00B2')
            .replace(/\^{\s*3\s*}/g, '\u00B3').replace(/\^3/g, '\u00B3')
            .replace(/_\{([^{}]*)\}/g, '_$1')
            .replace(/\\([a-zA-Z]+)/g, '$1')
            .replace(/[{}]/g, '');
        return out.replace(/\s+/g, ' ').trim();
    }

    function formatMarkdown(text) {
        if (!text) return '';
        // Pull math out BEFORE escaping so LaTeX backslashes survive intact.
        const mathSpans = [];
        let source = String(text);
        source = source.replace(/\\\[([\s\S]+?)\\\]/g, (m, inner) => {
            mathSpans.push({ display: true, tex: inner });
            return `\u0000MATH${mathSpans.length - 1}\u0000`;
        });
        source = source.replace(/\\\((.+?)\\\)/g, (m, inner) => {
            mathSpans.push({ display: false, tex: inner });
            return `\u0000MATH${mathSpans.length - 1}\u0000`;
        });
        source = source.replace(/\$\$([\s\S]+?)\$\$/g, (m, inner) => {
            mathSpans.push({ display: true, tex: inner });
            return `\u0000MATH${mathSpans.length - 1}\u0000`;
        });
        source = source.replace(/(^|[\s(])\$([^$\n]+)\$/g, (m, pre, inner) => {
            mathSpans.push({ display: false, tex: inner });
            return `${pre}\u0000MATH${mathSpans.length - 1}\u0000`;
        });
        // Protect code spans/blocks before inline formatting.
        const codeBlocks = [];
        let html = escapeHtml(source);
        html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
            codeBlocks.push(`<pre class="chat-codeblock"><code>${code.replace(/<br\s*\/?>/g, '\n')}</code></pre>`);
            return `\u0000CODE${codeBlocks.length - 1}\u0000`;
        });
        const inlineCodes = [];
        html = html.replace(/`([^`\n]+)`/g, (m, code) => {
            inlineCodes.push(`<code class="chat-inline-code">${code}</code>`);
            return `\u0000INLINE${inlineCodes.length - 1}\u0000`;
        });

        html = html
            .replace(/^######\s?(.*)$/gim, '<h6 class="chat-md-h">$1</h6>')
            .replace(/^#####\s?(.*)$/gim, '<h6 class="chat-md-h">$1</h6>')
            .replace(/^####\s?(.*)$/gim, '<h6 class="chat-md-h">$1</h6>')
            .replace(/^###\s?(.*)$/gim, '<h6 class="chat-md-h">$1</h6>')
            .replace(/^##\s?(.*)$/gim, '<h6 class="chat-md-h chat-md-h2">$1</h6>')
            .replace(/^#\s?(.*)$/gim, '<h6 class="chat-md-h chat-md-h2">$1</h6>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[\s(>])\*([^*\n]+)\*/g, '$1<em>$2</em>')
            .replace(/~~([^~]+)~~/g, '<del>$1</del>');

        // Block structure: split on blank lines; classify each block as an
        // ordered list, unordered list, heading/code/math passthrough, or a
        // paragraph with <br/> breaks. List regexes run per-block so inline
        // <code>/<strong> tags inside items survive untouched.
        const blocks = html.split(/\n{2,}/);
        html = blocks.map((block) => {
            const trimmed = block.trim();
            if (!trimmed) return '';
            if (/^<(h6|pre|div)[\s>]/.test(trimmed)) return trimmed;
            const lines = trimmed.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
            const olItems = lines.map((l) => l.match(/^\s*\d+[.)]\s+(.*)$/)?.[1]).filter(Boolean);
            if (olItems.length && olItems.length === lines.length) {
                return `<ol class="chat-md-list">${olItems.map((t) => `<li>${t}</li>`).join('')}</ol>`;
            }
            // Unordered items: '-' or '*' bullets, or '*' continuation lines
            // (fallback answers use "* **Label**:" fragments splitting one item).
            const ulItems = lines.map((l) => l.match(/^\s*[-*]\s+(.*)$/)?.[1]).filter(Boolean);
            if (ulItems.length && ulItems.length === lines.length) {
                return `<ul class="chat-md-list">${ulItems.map((t) => `<li>${t}</li>`).join('')}</ul>`;
            }
            if (ulItems.length && ulItems.length >= Math.ceil(lines.length / 2)) {
                const merged = [];
                let current = null;
                for (const l of lines) {
                    const m = l.match(/^\s*[-*]\s+(.*)$/);
                    if (m) { current = m[1]; merged.push(current); }
                    else if (current !== null) merged[merged.length - 1] += `<br>${l}`;
                    else merged.push(l);
                }
                return `<ul class="chat-md-list">${merged.map((t) => `<li>${t}</li>`).join('')}</ul>`;
            }
            return `<p class="chat-md-p">${lines.join('<br>')}</p>`;
        }).join('');

        // Links run AFTER lists so list text is final. Math placeholders are
        // restored as cleaned readable text (never raw LaTeX).
        html = html
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
            .replace(/(?<!href=")(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

        html = html.replace(/\u0000INLINE(\d+)\u0000/g, (m, i) => inlineCodes[Number(i)] || '')
            .replace(/\u0000CODE(\d+)\u0000/g, (m, i) => codeBlocks[Number(i)] || '')
            .replace(/\u0000MATH(\d+)\u0000/g, (m, i) => {
                const span = mathSpans[Number(i)];
                if (!span) return '';
                const cleaned = escapeHtml(cleanLatex(span.tex));
                return span.display
                    ? `<div class="chat-math">${cleaned}</div>`
                    : `<code class="chat-inline-code">${cleaned}</code>`;
            });
        return html;
    }

    // ---------- message bubbles ----------
    function buildAvatar(role) {
        const av = document.createElement('div');
        av.className = `chat-avatar ${role === 'user' ? 'chat-avatar-user' : 'chat-avatar-ai'}`;
        av.setAttribute('aria-hidden', 'true');
        av.innerHTML = role === 'user' ? '<i class="bi bi-person-fill"></i>' : '<i class="bi bi-robot"></i>';
        return av;
    }

    function appendUserMessage(content) {
        const wrap = document.createElement('div');
        wrap.className = 'chat-row chat-row-user';
        wrap.dataset.prompt = content;
        const body = document.createElement('div');
        body.className = 'chat-body';
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble chat-bubble-user';
        bubble.textContent = content;
        const time = document.createElement('div');
        time.className = 'chat-time';
        time.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        body.appendChild(bubble);
        body.appendChild(time);
        wrap.appendChild(body);
        wrap.appendChild(buildAvatar('user'));
        chatMessages.appendChild(wrap);
        scrollBottom(true);
        return wrap;
    }

    function appendAssistantShell() {
        const wrap = document.createElement('div');
        wrap.className = 'chat-row chat-row-ai';
        wrap.appendChild(buildAvatar('assistant'));
        const body = document.createElement('div');
        body.className = 'chat-body';
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble chat-bubble-ai';
        bubble.innerHTML = '<span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span> <span class="text-muted small">Thinking…</span>';
        const actions = document.createElement('div');
        actions.className = 'chat-actions d-none';
        actions.innerHTML = `
            <button type="button" class="btn btn-sm btn-glass chat-copy-btn" title="Copy answer"><i class="bi bi-clipboard" aria-hidden="true"></i><span>Copy</span></button>
            <button type="button" class="btn btn-sm btn-glass chat-retry-btn" title="Ask again"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i><span>Retry</span></button>`;
        const time = document.createElement('div');
        time.className = 'chat-time';
        body.appendChild(bubble);
        body.appendChild(actions);
        body.appendChild(time);
        wrap.appendChild(body);
        chatMessages.appendChild(wrap);
        scrollBottom();

        const copyBtn = actions.querySelector('.chat-copy-btn');
        const retryBtn = actions.querySelector('.chat-retry-btn');
        copyBtn.addEventListener('click', () => copyAnswer(wrap, copyBtn));
        retryBtn.addEventListener('click', () => {
            if (isStreaming) return;
            const mine = wrap.previousElementSibling && wrap.previousElementSibling.classList.contains('chat-row-user')
                ? (wrap.previousElementSibling.dataset.prompt || '')
                : '';
            chatInput.value = mine || lastUserMessage;
            autoGrow();
            chatForm.dispatchEvent(new Event('submit'));
        });
        return { wrap, bubble, actions, time, retryBtn };
    }

    // Inline Retry buttons rendered inside error bubbles re-send the last message.
    function wireInlineRetry(scope) {
        scope.querySelectorAll('.chat-inline-retry').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (isStreaming || !lastUserMessage) return;
                chatInput.value = lastUserMessage;
                autoGrow();
                chatForm.dispatchEvent(new Event('submit'));
            });
        });
    }

    async function copyAnswer(wrap, btn) {
        const bubble = wrap.querySelector('.chat-bubble');
        const text = bubble?.innerText || '';
        let ok = false;
        try {
            if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); ok = true; }
        } catch { ok = false; }
        if (!ok) {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select();
                ok = document.execCommand('copy'); ta.remove();
            } catch { ok = false; }
        }
        if (!ok && bubble) {
            // Leave the text selected so manual copy is one keystroke.
            try {
                const range = document.createRange();
                range.selectNodeContents(bubble);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            } catch { /* selection is best-effort */ }
        }
        if (btn) {
            const label = btn.querySelector('span');
            if (label) label.textContent = ok ? 'Copied!' : 'Copy failed';
            setTimeout(() => { if (label) label.textContent = 'Copy'; }, 2000);
        }
        announce(ok ? 'Answer copied to clipboard.' : 'Copy failed. Select the text manually.');
    }

    // ---------- streaming ----------
    function stopStreamTimer() {
        if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
    }

    function startStreamTimer(labelBase) {
        stopStreamTimer();
        streamStartedAt = Date.now();
        streamFirstChunkAt = 0;
        const tick = () => {
            const firstChunk = streamFirstChunkAt > 0;
            const secs = firstChunk
                ? Math.floor((Date.now() - streamFirstChunkAt) / 1000)
                : Math.floor((Date.now() - streamStartedAt) / 1000);
            if (!typingText) return;
            if (!firstChunk && secs >= 30) {
                typingText.textContent = `Still working on it… (${secs}s) — you can Stop and retry if it takes too long.`;
            } else if (firstChunk) {
                typingText.textContent = `${labelBase} (${secs}s of reply…)`;
            } else {
                typingText.textContent = `${labelBase} (${secs}s)`;
            }
        };
        tick();
        // 500ms cadence (not 1s) so throttled tabs still advance the label;
        // seconds are derived from wall-clock, never from tick counts.
        streamTimer = setInterval(tick, 500);
    }

    function setStreaming(on, label) {
        isStreaming = on;
        chatInput.disabled = on && false; // keep editable; Enter is guarded by isStreaming
        if (sendBtn) {
            sendBtn.disabled = on;
            // Pill send button is icon-only: spinner mid-send, arrow when idle.
            sendBtn.setAttribute('aria-label', on ? 'Sending…' : 'Send message');
            sendBtn.innerHTML = on
                ? '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>'
                : '<i class="bi bi-arrow-up" aria-hidden="true"></i>';
        }
        if (typingBar) typingBar.classList.toggle('d-none', !on);
        if (on && label && typingText) typingText.textContent = label;
    }

    async function sendMessage(message, subject) {
        hideEmpty();
        lastUserMessage = message;
        const userWrap = appendUserMessage(message);
        chatInput.value = '';
        autoGrow();

        const shell = appendAssistantShell();
        const { bubble, actions, time } = shell;
        shell.wrap.dataset.prompt = message;
        setStreaming(true, `Tutor is thinking (${subject})…`);
        startStreamTimer(`Tutor is thinking (${subject})`);
        announce('Tutor is thinking.');

        streamAborter = new AbortController();
        if (stopStreamBtn) {
            stopStreamBtn.onclick = () => { try { streamAborter.abort(); } catch { /* noop */ } };
        }

        let fullText = '';
        let provider = '';
        let stopped = false;
        try {
            const response = await fetch('/api/ai/chat/stream', {
                method: 'POST',
                signal: streamAborter.signal,
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrfToken() },
                body: JSON.stringify({ message, subject })
            });
            if (!response.ok || !response.body) {
                bubble.innerHTML = `<div class="chat-error" role="alert"><i class="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>Sorry, I could not reach the tutor (error ${response.status}). <button type="button" class="btn btn-sm btn-glass ms-2 chat-inline-retry">Retry</button></div>`;
                wireInlineRetry(bubble);
                announce('Tutor request failed. A retry button is available.');
                return;
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let firstChunk = true;
            let paintQueued = false;
            const paint = () => {
                paintQueued = false;
                bubble.innerHTML = formatMarkdown(fullText);
                scrollBottom();
                // Keep the elapsed-time label fresh even when the 1s
                // interval is throttled (background tabs).
                if (typingText && streamFirstChunkAt > 0) {
                    const secs = Math.floor((Date.now() - streamFirstChunkAt) / 1000);
                    typingText.textContent = `Tutor is replying… (${secs}s of reply…)`;
                }
            };
            const queuePaint = () => {
                if (paintQueued) return;
                paintQueued = true;
                // rAF batches rapid chunks; the timeout guarantees a paint
                // in background tabs where rAF may never fire. Whichever
                // runs first wins (guarded by paintQueued).
                try { requestAnimationFrame(paint); } catch { /* fall through */ }
                setTimeout(paint, 150);
            };

            const flushLine = (line) => {
                if (!line.startsWith('data: ')) return;
                let data;
                try { data = JSON.parse(line.slice(6)); } catch { return; }
                if (data.chunk) {
                    fullText += data.chunk;
                    if (firstChunk) { firstChunk = false; streamFirstChunkAt = Date.now(); bubble.innerHTML = ''; }
                    queuePaint();
                }
                if (data.provider) provider = data.provider;
                if (data.error) {
                    fullText += `\n\n*(Notice: ${data.error})*`;
                    bubble.innerHTML = formatMarkdown(fullText);
                }
                if (data.done) {
                    if (!fullText.trim()) bubble.innerHTML = '<span class="text-muted">I did not produce an answer. Please try again.</span>';
                    if (provider && time) time.textContent = `${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${provider}`;
                    else if (time) time.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                    actions.classList.remove('d-none');
                    announce('Tutor replied.');
                    refreshStatus();
                }
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) flushLine(line);
            }
            if (buffer.trim()) flushLine(buffer.trim());
            if (!fullText.trim() && !stopped) {
                bubble.innerHTML = '<span class="text-muted">The tutor returned an empty answer. Please try again.</span>';
            }
        } catch (err) {
            stopped = err && err.name === 'AbortError';
            if (stopped) {
                bubble.innerHTML = (fullText ? formatMarkdown(fullText) : '') + '<div class="chat-stopped"><i class="bi bi-stop-circle me-1" aria-hidden="true"></i>Stopped. The partial answer above is kept.</div>';
                if (fullText.trim()) actions.classList.remove('d-none');
                announce('Streaming stopped. Partial answer kept.');
            } else {
                console.error('Stream error:', err);
                bubble.innerHTML = '<div class="chat-error" role="alert"><i class="bi bi-wifi-off me-1" aria-hidden="true"></i>Connection was interrupted. Check your internet and try again. <button type="button" class="btn btn-sm btn-glass ms-2 chat-inline-retry">Retry</button></div>';
                wireInlineRetry(bubble);
                announce('Connection interrupted. A retry button is available.');
            }
        } finally {
            stopStreamTimer();
            if (paintQueued) { paintQueued = false; if (fullText) { bubble.innerHTML = formatMarkdown(fullText); } scrollBottom(); }
            setStreaming(false);
            // Stay keyboard-friendly on desktop without popping the
            // on-screen keyboard on touch devices.
            const hadFocus = document.activeElement === chatInput;
            if (hadFocus || (window.matchMedia && window.matchMedia('(pointer: fine)').matches)) {
                chatInput.focus();
            }
        }
    }

    // ---------- events ----------
    if (chatForm) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const message = chatInput.value.trim();
            if (!message || isStreaming) return;
            if (message.length < 2) {
                announce('Please type a longer question.');
                chatInput.focus();
                return;
            }
            sendMessage(message, currentSubject);
        });
    }

    if (chatInput) {
        chatInput.addEventListener('input', autoGrow);
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                chatForm.dispatchEvent(new Event('submit'));
            }
        });
        autoGrow();
    }

    if (subjectSelect) {
        subjectSelect.addEventListener('change', () => {
            currentSubject = subjectSelect.value;
            try { localStorage.setItem('chatSubject', currentSubject); } catch { /* private mode */ }
            const nameEl = document.getElementById('clearSubjectName');
            if (nameEl) nameEl.textContent = currentSubject;
            announce(`Subject set to ${currentSubject}.`);
            loadChatHistory();
        });
    }
    if (subjectSelect) {
        const nameEl = document.getElementById('clearSubjectName');
        if (nameEl) nameEl.textContent = currentSubject;
    }

    // Suggestions toggle: open row on desktop, collapsed on mobile.
    const suggestBox = document.querySelector('.chat-suggest');
    const suggestToggle = document.getElementById('suggestToggle');
    const suggestRow = document.getElementById('suggestRow');
    function setSuggest(open) {
        if (!suggestBox || !suggestToggle) return;
        suggestBox.classList.toggle('open', open);
        suggestToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        syncChatChrome();
    }
    if (suggestToggle) {
        setSuggest(window.innerWidth > 768);
        suggestToggle.addEventListener('click', () => {
            setSuggest(!suggestBox.classList.contains('open'));
        });
        let lastNarrow = window.innerWidth <= 768;
        window.addEventListener('resize', () => {
            // Follow breakpoint transitions both ways so a desktop-open row
            // collapses when the viewport shrinks to a phone.
            const narrow = window.innerWidth <= 768;
            if (narrow !== lastNarrow) {
                lastNarrow = narrow;
                setSuggest(!narrow);
            } else {
                syncChatChrome();
            }
        });
    } else if (suggestRow) {
        suggestRow.style.display = 'flex';
    }

    // Suggestion chips: click fills the input and sends.
    if (suggestionChips && suggestionChips.length) {
        suggestionChips.forEach((chip) => {
            chip.addEventListener('click', () => {
                if (isStreaming) return;
                const chipSubject = chip.getAttribute('data-subject');
                if (chipSubject && subjectSelect) {
                    subjectSelect.value = chipSubject;
                    currentSubject = chipSubject;
                }
                chatInput.value = chip.getAttribute('data-prompt') || chip.textContent.trim();
                if (chatInput.tagName === 'TEXTAREA') autoGrow();
                chatForm.dispatchEvent(new Event('submit'));
            });
        });
    }

    async function doClearHistory(scope) {
        const url = scope === 'subject'
            ? `/api/ai/chat/history?subject=${encodeURIComponent(currentSubject)}`
            : '/api/ai/chat/history';
        const res = await fetch(url, {
            method: 'DELETE',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrfToken() }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        chatMessages.querySelectorAll('.chat-row').forEach((n) => n.remove());
        if (chatEmpty) chatEmpty.style.display = '';
        announce(scope === 'subject' ? `Saved ${currentSubject} chats cleared.` : 'Chat history cleared.');
    }

    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', () => {
            if (isStreaming) { announce('Stop the current answer before clearing history.'); return; }
            const modalEl = document.getElementById('clearHistoryModal');
            if (modalEl && window.bootstrap?.Modal) {
                window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (!confirm('Clear your saved chat history? This cannot be undone.')) {
                return;
            } else {
                doClearHistory('all').catch((err) => {
                    console.error('Error clearing history:', err);
                    announce('Could not clear history. Please try again.');
                });
            }
        });
        const subjectBtn = document.getElementById('clearSubjectBtn');
        const allBtn = document.getElementById('clearAllBtn');
        const hideModal = () => {
            const modalEl = document.getElementById('clearHistoryModal');
            if (modalEl && window.bootstrap?.Modal) {
                window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
            }
        };
        if (subjectBtn) {
            subjectBtn.addEventListener('click', async () => {
                try {
                    await doClearHistory('subject');
                } catch (err) {
                    console.error('Error clearing history:', err);
                    announce('Could not clear history. Please try again.');
                }
                hideModal();
            });
        }
        if (allBtn) {
            allBtn.addEventListener('click', async () => {
                try {
                    await doClearHistory('all');
                } catch (err) {
                    console.error('Error clearing history:', err);
                    announce('Could not clear history. Please try again.');
                }
                hideModal();
            });
        }
    }

    if (exportChatBtn) {
        exportChatBtn.addEventListener('click', () => {
            const rows = chatMessages.querySelectorAll('.chat-row');
            if (!rows.length) { announce('Nothing to export yet. Ask a question first.'); return; }
            const grade = document.querySelector('.chat-panel')?.dataset.grade || '';
            const pairs = rows.length - (rows.length % 2 === 0 ? 0 : 1);
            let md = `# AI Study Tutor — ${currentSubject}\n\n_Exported ${new Date().toLocaleString()}${grade ? ` · ${grade}` : ''} · ${pairs / 2} exchange(s)_\n\n---\n\n`;
            rows.forEach((row) => {
                const isUser = row.classList.contains('chat-row-user');
                const text = row.querySelector('.chat-bubble')?.innerText?.trim() || '';
                md += isUser ? `**You:** ${text}\n\n` : `**Tutor:** ${text}\n\n---\n\n`;
            });
            const blob = new Blob([md], { type: 'text/markdown' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `study-tutor-${currentSubject.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.md`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
            announce('Conversation exported as a study note.');
        });
    }

    // ---------- history + status ----------
    // JSON accept headers force JSON error/handler responses (never HTML
    // login/404 pages) if the session ever lapses mid-chat.
    const JSON_HEADERS = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    function subjectTag(subject) {
        const tag = document.createElement('div');
        tag.className = 'chat-subject-tag';
        tag.textContent = subject || currentSubject;
        return tag;
    }
    async function loadChatHistory() {
        try {
            const res = await fetch(`/api/ai/chat/history?subject=${encodeURIComponent(currentSubject)}&limit=30`, { headers: JSON_HEADERS });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data) return;
            chatMessages.querySelectorAll('.chat-row').forEach((n) => n.remove());
            if (data.history && data.history.length > 0) {
                hideEmpty();
                for (const item of data.history) {
                    const userWrap = appendUserMessage(item.user_message);
                    userWrap.prepend(subjectTag(item.subject));
                    const shell = appendAssistantShell();
                    shell.wrap.dataset.prompt = item.user_message;
                    shell.bubble.innerHTML = formatMarkdown(item.ai_response);
                    const when = item.created_at ? new Date(item.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
                    shell.time.textContent = [when, item.provider_used].filter(Boolean).join(' · ');
                    shell.actions.classList.remove('d-none');
                }
            } else if (chatEmpty) {
                chatEmpty.style.display = '';
            }
        } catch (err) {
            console.warn('History load skipped:', err.message);
        }
    }

    async function refreshStatus() {
        try {
            const res = await fetch('/api/ai/chat/status', { headers: JSON_HEADERS });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data) throw new Error(`HTTP ${res.status}`);
            if (data.online) {
                setStatus('online', 'Online');
                if (statusPill) statusPill.title = 'Tutor online';
            } else {
                setStatus('offline', 'Offline');
                if (statusPill) statusPill.title = 'Connection lost — study-guide mode';
            }
        } catch {
            setStatus('offline', 'Offline');
            if (statusPill) statusPill.title = 'Tutor status unknown';
        }
    }

    setStatus('gray', 'Connecting…');
    refreshStatus();
    loadChatHistory();
});
