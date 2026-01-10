// OmniExporter AI - Grok Adapter (API + DOM Fallback)
// Support for xAI Grok (grok.com and x.com/i/grok)
// Uses discovered API endpoints for better extraction

const GrokAdapter = {
    name: "Grok",
    apiBase: "https://grok.com/rest/app-chat",

    extractUuid: (url) => {
        // Pattern 1: UUID in URL path or query
        const uuidMatch = url.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
        if (uuidMatch) return uuidMatch[1];

        // Pattern 2: grok.com/chat/{id}
        const chatMatch = url.match(/grok\.com\/(?:chat|c)\/([a-zA-Z0-9_-]+)/);
        if (chatMatch) return chatMatch[1];

        // Pattern 3: x.com/i/grok/{id}
        const xMatch = url.match(/x\.com\/i\/grok\/([a-zA-Z0-9_-]+)/);
        if (xMatch) return xMatch[1];

        return null;
    },

    // Try to get list of conversations - VERIFIED API (discovered via chrome-devtools-mcp)
    getThreads: async (page = 0, limit = 50) => {
        // Check if NetworkInterceptor captured chat list
        if (window.NetworkInterceptor && window.NetworkInterceptor.getChatList().length > 0) {
            return window.NetworkInterceptor.getChatList().slice(0, limit);
        }

        const threads = [];

        // VERIFIED ENDPOINT: /rest/app-chat/conversations (discovered 2026-01-10)
        try {
            const response = await fetch(`${GrokAdapter.apiBase}/conversations`, {
                credentials: 'include',
                headers: { 'Accept': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                const chats = data.conversations || data.data || data.items || [];

                if (Array.isArray(chats) && chats.length > 0) {
                    chats.slice(0, limit).forEach(chat => {
                        threads.push({
                            uuid: chat.id || chat.conversationId || chat.uuid,
                            title: chat.title || chat.name || 'Grok Chat',
                            platform: 'Grok',
                            last_query_datetime: chat.updatedAt || chat.createdAt || new Date().toISOString()
                        });
                    });
                    return threads;
                }
            }
        } catch (e) {
            console.warn('[GrokAdapter] API fetch failed (may have CAPTCHA), trying DOM fallback');
        }

        // DOM Fallback: Parse sidebar chat items (useful when CAPTCHA blocks API)
        try {
            const chatItems = document.querySelectorAll(
                '[class*="conversation-item"], [class*="chat-item"], a[href*="/conversation/"], [data-testid="conversation"]'
            );
            chatItems.forEach((item, i) => {
                if (i >= limit) return;
                const href = item.getAttribute('href') || '';
                const uuidMatch = href.match(/\/conversation\/([a-zA-Z0-9_-]+)/) ||
                    href.match(/([a-f0-9-]{36})/i);
                if (uuidMatch) {
                    threads.push({
                        uuid: uuidMatch[1],
                        title: item.innerText?.trim()?.slice(0, 100) || 'Grok Chat',
                        platform: 'Grok',
                        last_query_datetime: new Date().toISOString()
                    });
                }
            });
        } catch (e) { }

        // Final fallback: current chat
        if (threads.length === 0) {
            const currentUuid = GrokAdapter.extractUuid(window.location.href);
            if (currentUuid) {
                threads.push({
                    uuid: currentUuid,
                    title: document.title?.replace(' | Grok', '').replace(' - Grok', '').trim() || 'Grok Chat',
                    platform: 'Grok',
                    last_query_datetime: new Date().toISOString()
                });
            }
        }

        return threads;
    },

    getThreadDetail: async (uuid) => {
        // IMPORTANT: For batch export, we MUST use API - DOM only works for current conversation
        const isCurrentConversation = window.location.href.includes(uuid);

        // Common headers to avoid bot detection
        const headers = {
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'X-Requested-With': 'XMLHttpRequest'
        };

        // Try multiple API endpoints (Grok changes their API frequently)
        const endpoints = [
            `${GrokAdapter.apiBase}/conversations_v2/${uuid}?includeWorkspaces=true&includeTaskResult=true`,
            `${GrokAdapter.apiBase}/conversation/${uuid}`,
            `https://grok.com/rest/app-chat/conversation/${uuid}`,
            `https://grok.com/api/conversation/${uuid}`
        ];

        for (const endpoint of endpoints) {
            try {
                console.log('[GrokAdapter] Trying API:', endpoint);
                const response = await fetch(endpoint, { credentials: 'include', headers });

                if (response.ok) {
                    const data = await response.json();
                    console.log('[GrokAdapter] API success for', uuid);

                    // Extract messages from various response formats
                    const messages = data.messages || data.conversation?.messages ||
                        data.data?.messages || data.turns || data.items || [];

                    if (Array.isArray(messages) && messages.length > 0) {
                        const entries = [];
                        let currentQuery = '';

                        messages.forEach(msg => {
                            const role = (msg.role || msg.sender || msg.author || msg.type || '').toLowerCase();
                            const content = msg.content || msg.text || msg.message ||
                                (msg.parts ? msg.parts.join('\n') : '');

                            if (role === 'user' || role === 'human') {
                                currentQuery = content;
                            } else if ((role === 'assistant' || role === 'grok' || role === 'bot' || role === 'ai') && currentQuery) {
                                entries.push({ query: currentQuery, answer: content });
                                currentQuery = '';
                            }
                        });

                        // Handle unpaired last message
                        if (currentQuery && messages.length > 0) {
                            const lastMsg = messages[messages.length - 1];
                            const lastContent = lastMsg.content || lastMsg.text || '';
                            if (lastContent && lastContent !== currentQuery) {
                                entries.push({ query: currentQuery, answer: lastContent });
                            }
                        }

                        const title = data.title || data.conversation?.title ||
                            data.name || 'Grok Conversation';

                        return { uuid, title, platform: 'Grok', entries };
                    }
                } else if (response.status === 403 || response.status === 429) {
                    console.warn('[GrokAdapter] API blocked (403/429) for:', endpoint);
                    continue; // Try next endpoint
                }
            } catch (e) {
                console.warn('[GrokAdapter] API failed for', endpoint, ':', e.message);
                continue; // Try next endpoint
            }
        }

        // If this is the current conversation, we can use DOM
        if (isCurrentConversation) {
            console.log('[GrokAdapter] Falling back to DOM extraction for current conversation');
            return GrokAdapter.extractFromDOM(uuid);
        }

        // For batch export of non-current conversations, we can't use DOM
        console.error('[GrokAdapter] Cannot fetch conversation', uuid, '- API blocked and not current page');
        return {
            uuid,
            title: 'Unable to fetch - API blocked',
            platform: 'Grok',
            entries: [],
            error: 'API access blocked - can only export current conversation'
        };
    },

    extractFromDOM: (uuid) => {
        const messages = [];
        const mainElement = document.querySelector('main, [role="main"]') || document.body;

        // Strategy 1: Message bubbles
        const bubbleSelectors = ['[class*="message"]', '[class*="bubble"]', '[data-message-id]'];
        for (const sel of bubbleSelectors) {
            const bubbles = mainElement.querySelectorAll(sel);
            if (bubbles.length >= 2) {
                let currentQuery = '';
                bubbles.forEach((bubble, i) => {
                    const text = bubble.innerText?.trim() || '';
                    if (text.length > 5) {
                        const isUser = bubble.className?.includes('user') || i % 2 === 0;
                        if (isUser) {
                            currentQuery = text;
                        } else if (currentQuery) {
                            messages.push({ query: currentQuery, answer: text });
                            currentQuery = '';
                        }
                    }
                });
                if (messages.length > 0) break;
            }
        }

        // Strategy 2: Text blocks
        if (messages.length === 0) {
            const allDivs = mainElement.querySelectorAll('div');
            const textBlocks = [];
            allDivs.forEach(div => {
                if (div.children.length === 0 && div.innerText?.trim().length > 30) {
                    const text = div.innerText.trim();
                    if (!textBlocks.includes(text)) textBlocks.push(text);
                }
            });
            for (let i = 0; i < textBlocks.length - 1; i += 2) {
                messages.push({ query: textBlocks[i] || '', answer: textBlocks[i + 1] || '' });
            }
        }

        const title = document.title?.replace(' | Grok', '').replace(' - Grok', '').trim() || 'Grok Conversation';
        return { uuid, title, platform: 'Grok', entries: messages.filter(m => m.query || m.answer) };
    },

    getSpaces: async () => []
};

window.GrokAdapter = GrokAdapter;
