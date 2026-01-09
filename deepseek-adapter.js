// OmniExporter AI - DeepSeek Adapter (API + DOM Fallback)
// Support for DeepSeek AI (chat.deepseek.com)
// Uses discovered API endpoints for better extraction

const DeepSeekAdapter = {
    name: "DeepSeek",
    apiBase: "https://chat.deepseek.com/api/v0",

    extractUuid: (url) => {
        // Pattern 1: /a/chat/{uuid} or /chat/{uuid}
        const chatMatch = url.match(/chat\.deepseek\.com(?:\/a)?\/chat\/([a-zA-Z0-9-]+)/);
        if (chatMatch) return chatMatch[1];

        // Pattern 2: session parameter
        const sessionMatch = url.match(/[?&](?:s|session|chat_session_id)=([a-zA-Z0-9-]+)/);
        if (sessionMatch) return sessionMatch[1];

        // Pattern 3: UUID in URL
        const uuidMatch = url.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
        if (uuidMatch) return uuidMatch[1];

        return null;
    },

    // Try to get list of chat sessions
    getThreads: async (page = 0, limit = 20) => {
        const threads = [];

        // Try API endpoints that might list chats
        const listEndpoints = [
            '/chat/list',
            '/chat/sessions',
            '/chat/conversations',
            '/chat_session/list',
            '/user/chats'
        ];

        for (const endpoint of listEndpoints) {
            try {
                const response = await fetch(`${DeepSeekAdapter.apiBase}${endpoint}`, {
                    credentials: 'include',
                    headers: { 'Accept': 'application/json' }
                });

                if (response.ok) {
                    const data = await response.json();
                    // Try to extract chat list from various response formats
                    const chats = data.data?.list || data.data?.chats || data.chats || data.list || data.sessions || [];

                    if (Array.isArray(chats) && chats.length > 0) {
                        chats.slice(0, limit).forEach(chat => {
                            threads.push({
                                uuid: chat.id || chat.chat_session_id || chat.session_id || chat.uuid,
                                title: chat.title || chat.name || 'DeepSeek Chat',
                                platform: 'DeepSeek',
                                last_query_datetime: chat.updated_at || chat.create_time || new Date().toISOString()
                            });
                        });
                        break;
                    }
                }
            } catch (e) {
                // Continue to next endpoint
            }
        }

        // Fallback: return current chat
        if (threads.length === 0) {
            const currentUuid = DeepSeekAdapter.extractUuid(window.location.href);
            if (currentUuid) {
                threads.push({
                    uuid: currentUuid,
                    title: document.title?.replace(' - DeepSeek', '').trim() || 'DeepSeek Chat',
                    platform: 'DeepSeek',
                    last_query_datetime: new Date().toISOString()
                });
            }
        }

        return threads;
    },

    getThreadDetail: async (uuid) => {
        // Try API first using discovered endpoint
        try {
            const response = await fetch(
                `${DeepSeekAdapter.apiBase}/chat/history_messages?chat_session_id=${uuid}`,
                { credentials: 'include', headers: { 'Accept': 'application/json' } }
            );

            if (response.ok) {
                const data = await response.json();
                const messages = data.data?.messages || data.messages || data.data || [];

                if (Array.isArray(messages) && messages.length > 0) {
                    const entries = [];
                    let currentQuery = '';

                    messages.forEach(msg => {
                        const role = msg.role || msg.author || msg.type;
                        const content = msg.content || msg.text || msg.message || '';

                        if (role === 'user' || role === 'human') {
                            currentQuery = content;
                        } else if ((role === 'assistant' || role === 'bot' || role === 'deepseek') && currentQuery) {
                            entries.push({ query: currentQuery, answer: content });
                            currentQuery = '';
                        }
                    });

                    // Get title from API or page
                    const title = data.data?.title || data.title ||
                        document.title?.replace(' - DeepSeek', '').trim() ||
                        'DeepSeek Conversation';

                    return { uuid, title, platform: 'DeepSeek', entries };
                }
            }
        } catch (e) {
            // Fall through to DOM extraction
        }

        // Fallback: DOM extraction
        return DeepSeekAdapter.extractFromDOM(uuid);
    },

    extractFromDOM: (uuid) => {
        const messages = [];

        // Strategy 1: Role-based data attributes
        const userByRole = document.querySelectorAll('[data-role="user"], [data-message-role="user"]');
        const assistantByRole = document.querySelectorAll('[data-role="assistant"], [data-message-role="assistant"]');
        if (userByRole.length > 0 || assistantByRole.length > 0) {
            const maxLen = Math.max(userByRole.length, assistantByRole.length);
            for (let i = 0; i < maxLen; i++) {
                messages.push({
                    query: userByRole[i]?.textContent?.trim() || '',
                    answer: assistantByRole[i]?.textContent?.trim() || ''
                });
            }
        }

        // Strategy 2: Class-based selectors
        if (messages.length === 0) {
            const userSelectors = ['[class*="user-message"]', '[class*="human-message"]', '.chat-message-user'];
            const assistantSelectors = ['[class*="assistant-message"]', '[class*="ai-message"]', '.chat-message-assistant', '[class*="deepseek"]'];
            let userEls = [], assistantEls = [];
            for (const sel of userSelectors) {
                const found = document.querySelectorAll(sel);
                if (found.length > 0) { userEls = Array.from(found); break; }
            }
            for (const sel of assistantSelectors) {
                const found = document.querySelectorAll(sel);
                if (found.length > 0) { assistantEls = Array.from(found); break; }
            }
            const maxLen = Math.max(userEls.length, assistantEls.length);
            for (let i = 0; i < maxLen; i++) {
                messages.push({
                    query: userEls[i]?.textContent?.trim() || '',
                    answer: assistantEls[i]?.textContent?.trim() || ''
                });
            }
        }

        // Strategy 3: Markdown containers
        if (messages.length === 0) {
            const markdownBlocks = document.querySelectorAll('[class*="markdown"], .prose');
            let currentQuery = '';
            markdownBlocks.forEach((block, i) => {
                const text = block.textContent?.trim() || '';
                if (text.length > 5) {
                    if (i % 2 === 0) {
                        currentQuery = text;
                    } else {
                        messages.push({ query: currentQuery, answer: text });
                        currentQuery = '';
                    }
                }
            });
        }

        const title = document.title?.replace(' - DeepSeek', '').trim() || 'DeepSeek Conversation';
        return { uuid, title, platform: 'DeepSeek', entries: messages.filter(m => m.query || m.answer) };
    },

    getSpaces: async () => []
};

window.DeepSeekAdapter = DeepSeekAdapter;
