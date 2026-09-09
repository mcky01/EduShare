// EduShare 2.0 Global Application Script

document.addEventListener('DOMContentLoaded', () => {
    // 1. Mobile Sidebar Toggle
    const sidebarToggleBtn = document.getElementById('sidebarToggle');
    const sidebar = document.querySelector('.liquid-sidebar');
    if (sidebarToggleBtn && sidebar) {
        sidebarToggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('show');
        });
    }

    // 2. Global Omnisearch (Ctrl+K or Cmd+K)
    const searchModalEl = document.getElementById('omniSearchModal');
    const searchInput = document.getElementById('omniSearchInput');
    const searchResults = document.getElementById('omniSearchResults');

    let searchModal = null;
    if (searchModalEl && window.bootstrap) {
        searchModal = new bootstrap.Modal(searchModalEl);
    }

    window.openOmniSearch = () => {
        if (searchModal) {
            searchModal.show();
            setTimeout(() => searchInput && searchInput.focus(), 300);
        }
    };

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
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

            searchResults.innerHTML = '<div class="text-center text-muted p-4"><div class="spinner-border text-success" role="status"></div><div class="mt-2">Searching EduShare...</div></div>';

            debounceTimer = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
                    const data = await res.json();

                    if (!data.results || data.results.length === 0) {
                        searchResults.innerHTML = `<div class="text-center text-muted p-4"><i class="bi bi-emoji-neutral fs-3 d-block mb-2"></i>No matches found for "${query}".</div>`;
                        return;
                    }

                    searchResults.innerHTML = data.results.map(item => `
                        <a href="${item.url}" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center p-3 border-0 mb-2 rounded-3" style="background: rgba(255,255,255,0.7); backdrop-filter: blur(8px);">
                            <div>
                                <div class="fw-bold text-dark">${escapeHtml(item.title)}</div>
                                <div class="small text-muted">${escapeHtml(item.subtitle)}</div>
                            </div>
                            <span class="${item.badge}">${item.type}</span>
                        </a>
                    `).join('');
                } catch (err) {
                    searchResults.innerHTML = '<div class="text-center text-danger p-4">Error loading results.</div>';
                }
            }, 250);
        });
    }

    // Auto-dismiss Flash Toasts after 5 seconds
    const toasts = document.querySelectorAll('.liquid-toast');
    toasts.forEach(t => {
        setTimeout(() => {
            t.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            t.style.opacity = '0';
            t.style.transform = 'translateX(100%)';
            setTimeout(() => t.remove(), 500);
        }, 5000);
    });
});

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = '<i class="bi bi-eye-slash"></i>';
    } else {
        input.type = 'password';
        btn.innerHTML = '<i class="bi bi-eye"></i>';
    }
}
