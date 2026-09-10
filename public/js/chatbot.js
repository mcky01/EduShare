// EduShare 2.0 AI Study Buddy & Tutor Client

document.addEventListener('DOMContentLoaded', () => {
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const chatMessages = document.getElementById('chatMessages');
    const subjectSelect = document.getElementById('subjectSelect');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const suggestionChips = document.querySelectorAll('.suggestion-chip');

    let isStreaming = false;
    const csrfToken = () => document.querySelector('meta[name=csrf-token]')?.content || window.CSRF_TOKEN || '';

    // Load initial history
    loadChatHistory();

    // Suggestion chips
    suggestionChips.forEach(chip => {
        chip.addEventListener('click', () => {
            if (isStreaming) return;
            const prompt = chip.getAttribute('data-prompt') || chip.textContent.trim();
            chatInput.value = prompt;
            chatForm.dispatchEvent(new Event('submit'));
        });
    });

    // Clear history
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', async () => {
            if (!confirm('Are you sure you want to clear your chat history?')) return;
            try {
                await fetch('/api/ai/chat/history', { method: 'DELETE', headers: { 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrfToken() } });
                chatMessages.innerHTML = `
                    <div class="text-center text-muted p-4">
                        <i class="bi bi-robot fs-1 text-success d-block mb-2"></i>
                        <p class="mb-0 fw-semibold">Chat history cleared. How can I help you study today?</p>
                    </div>
                `;
            } catch (err) {
                console.error('Error clearing history:', err);
            }
        });
    }

    // Submit message
    if (chatForm) {
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const message = chatInput.value.trim();
            if (!message || isStreaming) return;

            const subject = subjectSelect ? subjectSelect.value : 'General';

            // Append user bubble
            appendMessage('user', message);
            chatInput.value = '';
            chatInput.disabled = true;
            isStreaming = true;

            // Prepare AI placeholder bubble
            const aiBubble = appendMessage('assistant', '<div class="spinner-grow spinner-grow-sm text-success" role="status"></div> Thinking...');

            try {
                const response = await fetch('/api/ai/chat/stream', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'x-csrf-token': csrfToken() },
                    body: JSON.stringify({ message, subject })
                });

                if (!response.ok) {
                    aiBubble.innerHTML = 'Sorry, an error occurred while connecting to the tutor.';
                    return;
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let fullText = '';
                aiBubble.innerHTML = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunkStr = decoder.decode(value, { stream: true });
                    const lines = chunkStr.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                if (data.chunk) {
                                    fullText += data.chunk;
                                    aiBubble.innerHTML = formatMarkdown(fullText);
                                    chatMessages.scrollTop = chatMessages.scrollHeight;
                                }
                                if (data.error) {
                                    fullText += `\n\n*(Notice: ${data.error})*`;
                                    aiBubble.innerHTML = formatMarkdown(fullText);
                                }
                            } catch {
                                // Ignore non-json lines
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('Stream error:', err);
                aiBubble.innerHTML = 'Sorry, connection was interrupted. Please try again.';
            } finally {
                chatInput.disabled = false;
                chatInput.focus();
                isStreaming = false;
            }
        });
    }

    function appendMessage(role, content) {
        const isUser = role === 'user';
        const msgDiv = document.createElement('div');
        msgDiv.className = `d-flex mb-3 ${isUser ? 'justify-content-end' : 'justify-content-start'}`;

        const bubble = document.createElement('div');
        bubble.className = isUser
            ? 'p-3 rounded-4 shadow-sm text-white'
            : 'p-3 rounded-4 shadow-sm text-dark';

        bubble.style.maxWidth = '80%';
        bubble.style.borderRadius = '18px';

        if (isUser) {
            bubble.style.background = 'linear-gradient(135deg, #0d522c, #06381e)';
            bubble.style.border = '1px solid rgba(52, 211, 153, 0.3)';
            bubble.innerHTML = escapeHtml(content);
        } else {
            bubble.style.background = 'rgba(255, 255, 255, 0.88)';
            bubble.style.backdropFilter = 'blur(16px)';
            bubble.style.border = '1px solid rgba(255, 255, 255, 0.8)';
            bubble.innerHTML = content;
        }

        msgDiv.appendChild(bubble);
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return bubble;
    }

    async function loadChatHistory() {
        try {
            const res = await fetch('/api/ai/chat/history');
            const data = await res.json();
            if (data.history && data.history.length > 0) {
                chatMessages.innerHTML = '';
                for (const item of data.history) {
                    appendMessage('user', item.user_message);
                    const aiBubble = appendMessage('assistant', '');
                    aiBubble.innerHTML = formatMarkdown(item.ai_response);
                }
            }
        } catch (err) {
            console.warn('History load skipped:', err.message);
        }
    }

    function formatMarkdown(text) {
        if (!text) return '';
        let html = escapeHtml(text);

        // Bold **text**
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        // Italic *text*
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        // Headers ###
        html = html.replace(/^### (.*$)/gim, '<h6 class="fw-bold mt-2 mb-1 text-success">$1</h6>');
        // Bullets
        html = html.replace(/^\* (.*$)/gim, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>)/s, '<ul class="ps-3 mb-2">$1</ul>');
        // Math blocks $$
        html = html.replace(/\$\$(.*?)\$\$/g, '<div class="p-2 bg-light rounded text-center my-1 font-monospace">$1</div>');
        // Inline math $
        html = html.replace(/\$(.*?)\$/g, '<code class="px-1 text-success">$1</code>');
        // Line breaks
        html = html.replace(/\n/g, '<br>');

        return html;
    }
});
