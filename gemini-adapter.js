// OmniExporter AI - Gemini Adapter (Enterprise Edition)
// Support for Google Gemini (gemini.google.com)
// VERIFIED API: batchexecute with rpcids MaZiqc (list) and hNvQHb (messages)
// Discovered via Chrome DevTools MCP 2026-01-10
// FEATURE: XHR interceptor to increase message limit from 20 to 100

// =============================================
// XHR INTERCEPTOR - Increase message fetch limit
// From Reference: faltu5.txt
// =============================================
class GeminiXHRInterceptor {
    constructor() {
        this.originalXHROpen = null;
        this.originalXHRSend = null;
        this.isHooked = false;
        this.targetUrl = "/_/BardChatUi/data/batchexecute";
        this.targetAction = "hNvQHb";
    }

    start() {
        if (this.isHooked) return;
        this.hookXHR();
        this.isHooked = true;
        console.log('[GeminiAdapter] XHR interceptor started - message limit increased to 100');
    }

    stop() {
        if (!this.isHooked) return;
        this.unhookXHR();
        this.isHooked = false;
    }

    isGeminiAPIRequest(url) {
        return url && url.includes(this.targetUrl);
    }

    hasTargetRpcids(url, targetRpcid) {
        try {
            const urlObj = new URL(url, window.location.origin);
            return urlObj.searchParams.get("rpcids") === targetRpcid;
        } catch {
            return false;
        }
    }

    // Modify the f.req field to change message limit from 20 to 100
    modifyFreqField(freqStr) {
        try {
            const parsed = JSON.parse(freqStr);
            let modified = false;

            const result = this.traverseAndModify(parsed, (item) => {
                // Look for hNvQHb action with message limit
                if (Array.isArray(item) && item.length >= 2 &&
                    item[0] === this.targetAction && typeof item[1] === "string") {
                    try {
                        const innerPayload = JSON.parse(item[1]);
                        // innerPayload[1] is the message limit (usually 20)
                        if (Array.isArray(innerPayload) && innerPayload.length > 1 &&
                            typeof innerPayload[1] === "number" && innerPayload[1] <= 20) {
                            innerPayload[1] = 100; // Increase to 100
                            item[1] = JSON.stringify(innerPayload);
                            modified = true;
                            console.log('[GeminiAdapter] Increased message limit to 100');
                        }
                    } catch { }
                }
                return item;
            });

            return modified ? JSON.stringify(result) : freqStr;
        } catch {
            return freqStr;
        }
    }

    traverseAndModify(obj, callback) {
        if (Array.isArray(obj)) {
            return obj.map(item => {
                const modified = callback(item);
                return this.traverseAndModify(modified, callback);
            });
        } else if (typeof obj === "object" && obj !== null) {
            const result = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this.traverseAndModify(value, callback);
            }
            return result;
        }
        return obj;
    }

    modifyRequestBody(body) {
        if (!body || typeof body !== "string" || !body.includes("f.req=")) {
            return body;
        }

        try {
            const params = new URLSearchParams(body);
            const freqValue = params.get("f.req");
            if (freqValue) {
                const modified = this.modifyFreqField(freqValue);
                params.set("f.req", modified);
                return params.toString();
            }
        } catch (e) {
            console.error('[GeminiAdapter] Error modifying request:', e);
        }
        return body;
    }

    hookXHR() {
        this.originalXHROpen = XMLHttpRequest.prototype.open;
        this.originalXHRSend = XMLHttpRequest.prototype.send;
        const interceptor = this;

        XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
            this._interceptor_url = url;
            return interceptor.originalXHROpen.call(this, method, url, async !== false, user || null, password || null);
        };

        XMLHttpRequest.prototype.send = function (body) {
            const url = this._interceptor_url;
            if (url && interceptor.isGeminiAPIRequest(url) &&
                interceptor.hasTargetRpcids(url, interceptor.targetAction)) {
                const modifiedBody = interceptor.modifyRequestBody(body);
                if (modifiedBody !== body) {
                    return interceptor.originalXHRSend.call(this, modifiedBody);
                }
            }
            return interceptor.originalXHRSend.call(this, body);
        };
    }

    unhookXHR() {
        if (this.originalXHROpen) {
            XMLHttpRequest.prototype.open = this.originalXHROpen;
        }
        if (this.originalXHRSend) {
            XMLHttpRequest.prototype.send = this.originalXHRSend;
        }
    }
}

// Initialize interceptor on Gemini pages
const geminiInterceptor = new GeminiXHRInterceptor();
if (window.location.hostname.includes('gemini.google.com')) {
    geminiInterceptor.start();
    window.addEventListener('beforeunload', () => geminiInterceptor.stop());
}

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
