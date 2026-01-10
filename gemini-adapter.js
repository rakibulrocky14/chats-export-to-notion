// OmniExporter AI - Gemini Adapter (Enterprise Edition)
// Support for Google Gemini (gemini.google.com)
// VERIFIED API: batchexecute with rpcids MaZiqc (list) and hNvQHb (messages)
// Discovered via Chrome DevTools MCP 2026-01-10
// FIXED: XHR interceptor now runs in PAGE context (not content script)

// =============================================
// PAGE CONTEXT SCRIPT INJECTOR
// Content scripts run in isolated world - they CAN'T intercept page XHRs
// Solution: Inject script into page context via web_accessible_resources
// =============================================

(function injectPageInterceptor() {
    // Only run on Gemini pages
    if (!window.location.hostname.includes('gemini.google.com')) return;

    // Prevent duplicate injection
    if (document.getElementById('omni-gemini-interceptor')) return;

    try {
        const script = document.createElement('script');
        script.id = 'omni-gemini-interceptor';
        script.src = chrome.runtime.getURL('gemini-page-interceptor.js');
        script.onload = function () {
            console.log('[GeminiAdapter] Page interceptor injected successfully');
            this.remove(); // Clean up script tag after execution
        };
        script.onerror = function () {
            console.warn('[GeminiAdapter] Failed to inject page interceptor');
        };
        (document.head || document.documentElement).appendChild(script);
    } catch (e) {
        console.warn('[GeminiAdapter] Injection error:', e.message);
    }
})();

// =============================================
// MESSAGE BRIDGE - Connect to gemini-inject.js
// Listens for messages from page context scripts
// =============================================
const GeminiBridge = {
    pendingRequests: new Map(),
    isReady: false,
    interceptorReady: false,

    init() {
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            if (!event.data || event.data.type !== 'OMNIEXPORTER_GEMINI') return;
            if (event.data.direction !== 'to-content') return;

            this.handleMessage(event.data);
        });
        console.log('[GeminiAdapter] Message bridge initialized');
    },

    handleMessage(message) {
        const { action, requestId, success, data, error } = message;

        switch (action) {
            case 'INJECT_READY':
                this.isReady = true;
                console.log('[GeminiAdapter] gemini-inject.js is ready');
                break;
            case 'INTERCEPTOR_READY':
                this.interceptorReady = true;
                console.log('[GeminiAdapter] Page interceptor ready - limit:', data?.limit);
                break;
            case 'RESPONSE':
                const pending = this.pendingRequests.get(requestId);
                if (pending) {
                    this.pendingRequests.delete(requestId);
                    if (success) {
                        pending.resolve(data);
                    } else {
                        pending.reject(new Error(error || 'Unknown error'));
                    }
                }
                break;
        }
    },

    // Send request to page context (gemini-inject.js)
    sendRequest(action, data = {}) {
        return new Promise((resolve, reject) => {
            const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

            this.pendingRequests.set(requestId, { resolve, reject });

            // Timeout after 10 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    reject(new Error('Request timeout'));
                }
            }, 10000);

            window.postMessage({
                type: 'OMNIEXPORTER_GEMINI',
                direction: 'to-page',
                requestId,
                action,
                data
            }, '*');
        });
    },

    // Get auth token from page context
    async getAuthToken() {
        if (!this.isReady) return null;
        try {
            const result = await this.sendRequest('GET_AUTH_TOKEN');
            return result?.token || result?.SNlM0e || null;
        } catch {
            return null;
        }
    },

    // Get global data from page context  
    async getGlobalData() {
        if (!this.isReady) return null;
        try {
            return await this.sendRequest('GET_GLOBAL_DATA');
        } catch {
            return null;
        }
    }
};

// Initialize bridge
GeminiBridge.init();

const GeminiAdapter = {
    name: "Gemini",

    // ============================================
    // ENTERPRISE: Use platformConfig for endpoints
    // ============================================
    get config() {
        return typeof platformConfig !== 'undefined'
            ? platformConfig.getConfig('Gemini')
            : null;
    },

    get apiBase() {
        const config = this.config;
        return config ? config.baseUrl + '/_/BardChatUi/data/batchexecute' : 'https://gemini.google.com/_/BardChatUi/data/batchexecute';
    },

    // Cache for pagination cursors
    _cursorCache: [],
    _allThreadsCache: [],
    _cacheTimestamp: 0,
    _cacheTTL: 60000,

    extractUuid: (url) => {
        // Try platformConfig patterns first
        if (typeof platformConfig !== 'undefined') {
            const uuid = platformConfig.extractUuid('Gemini', url);
            if (uuid) return uuid;
        }

        // Fallback patterns
        const appMatch = url.match(/gemini\.google\.com\/app\/([a-zA-Z0-9_-]+)/);
        if (appMatch) return appMatch[1];
        const gemMatch = url.match(/gemini\.google\.com\/gem\/([a-zA-Z0-9_-]+)/);
        if (gemMatch) return gemMatch[1];
        return 'gemini_' + Date.now();
    },

    // ============================================
    // ENTERPRISE: Anti-bot headers
    // ============================================
    _getHeaders: () => {
        return {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin'
        };
    },

    // ============================================
    // ENTERPRISE: Get ALL threads (Load All feature)
    // ============================================
    getAllThreads: async function (progressCallback = null) {
        try {
            const result = await this.getThreads(1, 100);

            // Update cache
            GeminiAdapter._allThreadsCache = result.threads;
            GeminiAdapter._cacheTimestamp = Date.now();

            if (progressCallback) {
                progressCallback(result.threads.length, false);
            }

            return result.threads;
        } catch (error) {
            console.error('[Gemini] getAllThreads failed:', error);
            throw error;
        }
    },

    // ============================================
    // ENTERPRISE: Offset-based fetching
    // ============================================
    getThreadsWithOffset: async function (offset = 0, limit = 50) {
        // Check cache validity
        const cacheValid = GeminiAdapter._cacheTimestamp > Date.now() - GeminiAdapter._cacheTTL;

        if (!cacheValid || GeminiAdapter._allThreadsCache.length === 0) {
            await GeminiAdapter.getAllThreads();
        }

        const threads = GeminiAdapter._allThreadsCache.slice(offset, offset + limit);
        return {
            threads,
            offset,
            hasMore: offset + limit < GeminiAdapter._allThreadsCache.length,
            total: GeminiAdapter._allThreadsCache.length
        };
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
