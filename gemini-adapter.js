// OmniExporter AI - Gemini Adapter (Enterprise Edition)
// Support for Google Gemini (gemini.google.com)
// VERIFIED API: batchexecute with rpcids MaZiqc (list) and hNvQHb (messages)
// Discovered via Chrome DevTools MCP 2026-01-10

const GeminiAdapter = {
    name: "Gemini",
    apiBase: "https://gemini.google.com/_/BardChatUi/data/batchexecute",

    // Cache for pagination cursors
    _cursorCache: [],
    _allThreadsCache: [],
    _cacheTimestamp: 0,
    _cacheTTL: 60000,

    extractUuid: (url) => {
        // Format: /app/c_78e7183d7fa47176 or /app/uuid
        const appMatch = url.match(/gemini\.google\.com\/app\/([a-zA-Z0-9_-]+)/);
        if (appMatch) return appMatch[1];
        const gemMatch = url.match(/gemini\.google\.com\/gem\/([a-zA-Z0-9_-]+)/);
        if (gemMatch) return gemMatch[1];
        return 'gemini_' + Date.now();
    },

    // ============================================
    // ENTERPRISE: Build batchexecute request
    // ============================================
    _buildBatchRequest: (rpcid, payload) => {
        const reqData = JSON.stringify([[rpcid, JSON.stringify(payload), null, "generic"]]);
        return `f.req=${encodeURIComponent(reqData)}&`;
    },

    // ============================================
    // ENTERPRISE: Make batchexecute API call
    // ============================================
    _batchExecute: async (rpcid, payload) => {
        const body = GeminiAdapter._buildBatchRequest(rpcid, payload);

        const response = await fetch(`${GeminiAdapter.apiBase}?rpcids=${rpcid}&source-path=/app&bl=boq_assistant-bard-web-server`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'Accept': '*/*'
            },
            body
        });

        if (!response.ok) {
            throw new Error(`Gemini API error: ${response.status}`);
        }

        const text = await response.text();
        // Parse Google's weird response format (starts with ")]}'")
        const cleaned = text.replace(/^\)\]\}'/, '').trim();

        try {
            // Find the JSON array in the response
            const lines = cleaned.split('\n');
            for (const line of lines) {
                if (line.startsWith('[')) {
                    return JSON.parse(line);
                }
            }
        } catch (e) {
            console.warn('[GeminiAdapter] Failed to parse batchexecute response');
        }

        return null;
    },

    // ============================================
    // ENTERPRISE: Get thread list via API
    // ============================================
    getThreads: async function (page = 1, limit = 20, cursor = null) {
        // Check NetworkInterceptor first
        if (window.NetworkInterceptor && window.NetworkInterceptor.getChatList().length > 0) {
            const all = window.NetworkInterceptor.getChatList();
            const start = (page - 1) * limit;
            return {
                threads: all.slice(start, start + limit),
                hasMore: start + limit < all.length,
                page
            };
        }

        const threads = [];

        // Try API: rpcid MaZiqc for listing conversations
        try {
            // Payload: [limit, cursor, [0, null, 1]]
            const payload = [limit, cursor, [0, null, 1]];
            const response = await GeminiAdapter._batchExecute('MaZiqc', payload);

            if (response) {
                // Parse the nested response to extract conversations
                // Response is deeply nested, usually at response[0][2] as JSON string
                const dataStr = response[0]?.[2];
                if (dataStr) {
                    const data = JSON.parse(dataStr);
                    const conversations = data[0] || [];

                    conversations.forEach(conv => {
                        // Conv structure: [id, title, timestamp, ...]
                        const uuid = conv[0] || '';
                        const title = conv[1] || conv[2] || 'Gemini Chat';

                        if (uuid) {
                            threads.push({
                                uuid,
                                title: title.slice(0, 100),
                                platform: 'Gemini',
                                last_query_datetime: new Date().toISOString()
                            });
                        }
                    });

                    if (threads.length > 0) {
                        // Get next cursor for pagination
                        const nextCursor = data[1] || null;
                        return {
                            threads,
                            hasMore: !!nextCursor,
                            nextCursor,
                            page
                        };
                    }
                }
            }
        } catch (e) {
            console.warn('[GeminiAdapter] API failed, using DOM fallback:', e.message);
        }

        // DOM Fallback: Parse sidebar chat items
        try {
            const chatItems = document.querySelectorAll(
                'a[href*="/app/"], [class*="conversation"], div.conversation'
            );
            chatItems.forEach((item, i) => {
                if (i >= limit) return;
                const href = item.getAttribute('href') || '';
                const uuidMatch = href.match(/\/app\/([a-zA-Z0-9_-]+)/) ||
                    href.match(/\/gem\/([a-zA-Z0-9_-]+)/);
                if (uuidMatch) {
                    threads.push({
                        uuid: uuidMatch[1],
                        title: item.innerText?.trim()?.slice(0, 100) || 'Gemini Chat',
                        platform: 'Gemini',
                        last_query_datetime: new Date().toISOString()
                    });
                }
            });
        } catch (e) { }

        // Final fallback: current chat
        if (threads.length === 0) {
            const currentUuid = this.extractUuid(window.location.href);
            threads.push({
                uuid: currentUuid,
                title: document.title?.replace(' - Gemini', '').replace('Google Gemini', '').trim() || 'Gemini Chat',
                platform: 'Gemini',
                last_query_datetime: new Date().toISOString()
            });
        }

        return { threads, hasMore: false, page };
    },

    // ============================================
    // ENTERPRISE: Get thread detail via API
    // ============================================
    getThreadDetail: async function (uuid) {
        console.log(`[GeminiAdapter] Fetching thread detail for: ${uuid}`);

        // Try API first: rpcid hNvQHb for message history
        try {
            // Payload: [uuid, 10, null, 1, [0], [4], null, 1]
            const payload = [uuid, 50, null, 1, [0], [4], null, 1];
            const response = await GeminiAdapter._batchExecute('hNvQHb', payload);

            if (response) {
                const dataStr = response[0]?.[2];
                if (dataStr) {
                    const data = JSON.parse(dataStr);
                    const entries = [];

                    // Parse message turns from the nested structure
                    // Typically the messages are in data[0] or similar
                    const turns = data[0] || data[1] || [];

                    if (Array.isArray(turns)) {
                        let currentQuery = '';

                        turns.forEach(turn => {
                            // Each turn may have: [id, [content_parts], role, ...]
                            const content = turn[1]?.[0] || turn[2]?.[0] || '';
                            const role = turn[3] || turn[0] || '';

                            // Detect user vs assistant
                            const isUser = role === 0 || role === 'user' ||
                                (typeof content === 'string' && turn.length < 10);

                            if (isUser) {
                                currentQuery = typeof content === 'string' ? content : JSON.stringify(content);
                            } else if (currentQuery) {
                                const answer = typeof content === 'string' ? content :
                                    (content?.join?.('\n') || JSON.stringify(content));
                                entries.push({ query: currentQuery, answer });
                                currentQuery = '';
                            }
                        });
                    }

                    if (entries.length > 0) {
                        console.log(`[GeminiAdapter] API success: ${entries.length} entries`);
                        const title = data[0]?.[0] || data[1]?.[0] ||
                            document.title?.replace(' - Gemini', '').trim() ||
                            'Gemini Conversation';
                        return { uuid, title, platform: 'Gemini', entries };
                    }
                }
            }
        } catch (e) {
            console.warn('[GeminiAdapter] API failed:', e.message);
        }

        // DOM Fallback
        console.warn('[GeminiAdapter] Using DOM extraction');
        return GeminiAdapter.extractFromDOM(uuid);
    },

    // ============================================
    // DOM Fallback (multiple strategies)
    // ============================================
    extractFromDOM: function (uuid) {
        const messages = [];

        // Strategy 1: Query/Response blocks
        const userQueries = document.querySelectorAll(
            '[data-query-text], [class*="query-text"], [class*="user-input"], ' +
            '[class*="prompt-text"], div[data-message-author-role="user"]'
        );
        const aiResponses = document.querySelectorAll(
            '[data-model-response], [class*="model-response"], [class*="response-text"], ' +
            '[class*="ai-response"], div[data-message-author-role="assistant"], model-response'
        );

        if (userQueries.length > 0 || aiResponses.length > 0) {
            const max = Math.max(userQueries.length, aiResponses.length);
            for (let i = 0; i < max; i++) {
                messages.push({
                    query: userQueries[i]?.innerText?.trim() || '',
                    answer: aiResponses[i]?.innerText?.trim() || ''
                });
            }
        }

        // Strategy 2: Article elements
        if (messages.length === 0) {
            const articles = document.querySelectorAll('article, [role="article"]');
            let currentQuery = '';
            articles.forEach((article, i) => {
                const text = article.innerText?.trim() || '';
                if (text.length > 10) {
                    if (i % 2 === 0) {
                        currentQuery = text;
                    } else {
                        messages.push({ query: currentQuery, answer: text });
                        currentQuery = '';
                    }
                }
            });
        }

        // Strategy 3: Main content scraping
        if (messages.length === 0) {
            const mainContent = document.querySelector('main, [role="main"]');
            if (mainContent) {
                const allDivs = mainContent.querySelectorAll('div');
                const textBlocks = [];
                allDivs.forEach(div => {
                    if (div.children.length === 0 && div.innerText?.trim().length > 20) {
                        textBlocks.push(div.innerText.trim());
                    }
                });
                for (let i = 0; i < textBlocks.length - 1; i += 2) {
                    messages.push({ query: textBlocks[i] || '', answer: textBlocks[i + 1] || '' });
                }
            }
        }

        const filteredMessages = messages.filter(m => m.query || m.answer);
        const title = document.title?.replace(' - Gemini', '')?.replace('Google Gemini', '')?.trim() || 'Gemini Conversation';

        return { uuid, title, platform: 'Gemini', entries: filteredMessages };
    },

    getSpaces: async function () { return []; }
};

window.GeminiAdapter = GeminiAdapter;
