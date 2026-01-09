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

    // Try to get list of conversations
    getThreads: async (page = 0, limit = 20) => {
        const threads = [];

        // Try API endpoints that might list conversations
        const listEndpoints = [
            '/conversations',
            '/conversations_v2',
            '/chats',
            '/history'
        ];

        for (const endpoint of listEndpoints) {
            try {
                const response = await fetch(`${GrokAdapter.apiBase}${endpoint}`, {
                    credentials: 'include',
                    headers: { 'Accept': 'application/json' }
                });

                if (response.ok) {
                    const data = await response.json();
                    const chats = data.conversations || data.chats || data.data || [];

                    if (Array.isArray(chats) && chats.length > 0) {
                        chats.slice(0, limit).forEach(chat => {
                            threads.push({
                                uuid: chat.id || chat.conversationId || chat.uuid,
                                title: chat.title || chat.name || 'Grok Chat',
                                platform: 'Grok',
                                last_query_datetime: chat.updatedAt || chat.createdAt || new Date().toISOString()
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
        // Try API first using discovered endpoint
        try {
            const response = await fetch(
                `${GrokAdapter.apiBase}/conversations_v2/${uuid}?includeWorkspaces=true&includeTaskResult=true`,
                { credentials: 'include', headers: { 'Accept': 'application/json' } }
            );

            if (response.ok) {
                const data = await response.json();

                // Extract messages from response
                const messages = data.messages || data.conversation?.messages ||
                    data.data?.messages || data.turns || [];

                if (Array.isArray(messages) && messages.length > 0) {
                    const entries = [];
                    let currentQuery = '';

                    messages.forEach(msg => {
                        const role = msg.role || msg.sender || msg.author || msg.type;
                        const content = msg.content || msg.text || msg.message ||
                            (msg.parts ? msg.parts.join('\n') : '');

                        if (role === 'user' || role === 'human') {
                            currentQuery = content;
                        } else if ((role === 'assistant' || role === 'grok' || role === 'bot') && currentQuery) {
                            entries.push({ query: currentQuery, answer: content });
                            currentQuery = '';
                        }
                    });

                    const title = data.title || data.conversation?.title ||
                        document.title?.replace(' | Grok', '').trim() ||
                        'Grok Conversation';

                    return { uuid, title, platform: 'Grok', entries };
                }
            }
        } catch (e) {
            // Fall through to DOM extraction
        }

        // Fallback: DOM extraction
        return GrokAdapter.extractFromDOM(uuid);
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
