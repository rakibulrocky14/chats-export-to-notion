// OmniExporter AI - DeepSeek Adapter (Enterprise Edition)
// Support for DeepSeek AI (chat.deepseek.com)
// Enterprise-level implementation matching Perplexity quality
// VERIFIED API: /api/v0/chat_session/fetch_page (discovered 2026-01-10)

const DeepSeekAdapter = {
    name: "DeepSeek",
    apiBase: "https://chat.deepseek.com/api/v0",

    // Cursor cache for pagination (enables Load All and offset-based fetching)
    _cursorCache: [],
    _allThreadsCache: [],
    _cacheTimestamp: 0,
    _cacheTTL: 60000, // 1 minute cache

    extractUuid: (url) => {
        // Pattern 1: /a/chat/s/{uuid} or /chat/s/{uuid}
        const chatMatch = url.match(/chat\.deepseek\.com(?:\/a)?\/chat\/s?\/([a-zA-Z0-9-]+)/);
        if (chatMatch) return chatMatch[1];

        // Pattern 2: session parameter
        const sessionMatch = url.match(/[?&](?:s|session|chat_session_id)=([a-zA-Z0-9-]+)/);
        if (sessionMatch) return sessionMatch[1];

        // Pattern 3: UUID in URL
        const uuidMatch = url.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
        if (uuidMatch) return uuidMatch[1];

        return null;
    },

    // ============================================
    // ENTERPRISE: Get auth token from localStorage
    // DeepSeek stores token as JSON: {value: "...", ...}
    // ============================================
    _getAuthToken: () => {
        try {
            const tokenData = localStorage.getItem('userToken');
            if (!tokenData) return null;

            // Try parsing as JSON (DeepSeek stores {value: "token", ...})
            try {
                const parsed = JSON.parse(tokenData);
                return parsed.value || parsed.token || tokenData;
            } catch {
                return tokenData; // Plain string token
            }
        } catch {
            return null;
        }
    },

    // ============================================
    // ENTERPRISE: Retry with exponential backoff + Auth
    // ============================================
    _fetchWithRetry: async (url, options = {}, maxRetries = 3) => {
        let lastError;

        // Get auth token
        const token = DeepSeekAdapter._getAuthToken();
        const headers = {
            'Accept': 'application/json',
            ...options.headers
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    credentials: 'include',
                    headers,
                    ...options
                });
                if (response.ok) return response;
                if (response.status === 401 || response.status === 403) {
                    throw new Error('Authentication required - please login to DeepSeek');
                }
                lastError = new Error(`HTTP ${response.status}`);
            } catch (e) {
                lastError = e;
            }
            if (attempt < maxRetries - 1) {
                await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
            }
        }
        throw lastError;
    },

    // ============================================
    // ENTERPRISE: Fetch single page with cursor
    // ============================================
    _fetchPage: async (cursor = null, limit = 50) => {
        let url = `${DeepSeekAdapter.apiBase}/chat_session/fetch_page?lte_cursor.pinned=false`;
        if (cursor) {
            url += `&cursor=${encodeURIComponent(cursor)}`;
        }

        const response = await DeepSeekAdapter._fetchWithRetry(url);
        const data = await response.json();

        // Extract sessions from various response formats
        const bizData = data.data?.biz_data || data.biz_data || data.data || data;
        const sessions = bizData.chat_sessions || bizData.sessions || [];
        const nextCursor = bizData.next_cursor || bizData.cursor || null;
        const hasMore = sessions.length >= limit && nextCursor;

        const threads = sessions.map(chat => ({
            uuid: chat.id || chat.chat_session_id || chat.session_id,
            title: chat.title || chat.name || 'DeepSeek Chat',
            platform: 'DeepSeek',
            last_query_datetime: chat.updated_at || chat.create_time || new Date().toISOString()
        }));

        return { threads, nextCursor, hasMore };
    },

    // ============================================
    // ENTERPRISE: Fetch ALL threads (Load All)
    // ============================================
    getAllThreads: async (progressCallback = null) => {
        const allThreads = [];
        let cursor = null;
        let pageNum = 0;
        const seenIds = new Set();

        try {
            do {
                const { threads, nextCursor, hasMore } = await DeepSeekAdapter._fetchPage(cursor, 50);

                // Dedupe threads
                threads.forEach(t => {
                    if (!seenIds.has(t.uuid)) {
                        seenIds.add(t.uuid);
                        allThreads.push(t);
                    }
                });

                // Store cursor for later offset-based access
                if (cursor) {
                    DeepSeekAdapter._cursorCache.push({ cursor, index: allThreads.length - threads.length });
                }

                cursor = nextCursor;
                pageNum++;

                // Progress callback for UI
                if (progressCallback) {
                    progressCallback(allThreads.length, hasMore);
                }

                // Safety limit
                if (pageNum > 100 || allThreads.length > 5000) break;

                // Rate limiting
                if (hasMore) await new Promise(r => setTimeout(r, 300));

            } while (cursor);

            // Update cache
            DeepSeekAdapter._allThreadsCache = allThreads;
            DeepSeekAdapter._cacheTimestamp = Date.now();

            return allThreads;
        } catch (error) {
            console.error('[DeepSeekAdapter] getAllThreads failed:', error);
            throw error;
        }
    },

    // ============================================
    // ENTERPRISE: Offset-based fetching (for options.js)
    // ============================================
    getThreadsWithOffset: async (offset = 0, limit = 50) => {
        // Check cache validity
        const cacheValid = DeepSeekAdapter._cacheTimestamp > Date.now() - DeepSeekAdapter._cacheTTL;

        if (cacheValid && DeepSeekAdapter._allThreadsCache.length > 0) {
            // Return from cache
            const threads = DeepSeekAdapter._allThreadsCache.slice(offset, offset + limit);
            return {
                threads,
                offset,
                hasMore: offset + limit < DeepSeekAdapter._allThreadsCache.length,
                total: DeepSeekAdapter._allThreadsCache.length
            };
        }

        // First call - fetch first page and cache
        if (offset === 0) {
            const { threads, nextCursor, hasMore } = await DeepSeekAdapter._fetchPage(null, limit);
            DeepSeekAdapter._cursorCache = [{ cursor: null, index: 0 }];
            if (nextCursor) {
                DeepSeekAdapter._cursorCache.push({ cursor: nextCursor, index: limit });
            }
            return { threads, offset: 0, hasMore, total: hasMore ? -1 : threads.length };
        }

        // Find closest cursor for this offset
        let closestCursor = null;
        let closestIndex = 0;
        for (const cached of DeepSeekAdapter._cursorCache) {
            if (cached.index <= offset && cached.index > closestIndex) {
                closestIndex = cached.index;
                closestCursor = cached.cursor;
            }
        }

        // Fetch pages until we reach the offset
        let currentIndex = closestIndex;
        let cursor = closestCursor;
        let resultThreads = [];

        while (currentIndex < offset + limit) {
            const { threads, nextCursor, hasMore } = await DeepSeekAdapter._fetchPage(cursor, 50);

            // Add to cursor cache
            if (nextCursor && !DeepSeekAdapter._cursorCache.find(c => c.cursor === nextCursor)) {
                DeepSeekAdapter._cursorCache.push({ cursor: nextCursor, index: currentIndex + threads.length });
            }

            // Collect threads in range
            threads.forEach((t, i) => {
                const globalIndex = currentIndex + i;
                if (globalIndex >= offset && globalIndex < offset + limit) {
                    resultThreads.push(t);
                }
            });

            currentIndex += threads.length;
            cursor = nextCursor;

            if (!hasMore || !cursor) break;
            await new Promise(r => setTimeout(r, 200));
        }

        return {
            threads: resultThreads,
            offset,
            hasMore: cursor !== null,
            total: -1
        };
    },

    // ============================================
    // Standard getThreads (page-based, backwards compatible)
    // ============================================
    getThreads: async (page = 1, limit = 50, spaceId = null) => {
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

        // Use offset-based internally
        const offset = (page - 1) * limit;
        const result = await DeepSeekAdapter.getThreadsWithOffset(offset, limit);

        return {
            threads: result.threads,
            hasMore: result.hasMore,
            page
        };
    },

    // ============================================
    // Thread Detail (unchanged - already works)
    // ============================================
    getThreadDetail: async (uuid) => {
        try {
            const response = await DeepSeekAdapter._fetchWithRetry(
                `${DeepSeekAdapter.apiBase}/chat/history_messages?chat_session_id=${uuid}`
            );

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

                const title = data.data?.title || data.title ||
                    document.title?.replace(' - DeepSeek', '').trim() ||
                    'DeepSeek Conversation';

                return { uuid, title, platform: 'DeepSeek', entries };
            }
        } catch (e) {
            console.warn('[DeepSeekAdapter] API failed, using DOM fallback');
        }

        return DeepSeekAdapter.extractFromDOM(uuid);
    },

    // ============================================
    // DOM Fallback (unchanged)
    // ============================================
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
            const assistantSelectors = ['[class*="assistant-message"]', '[class*="ai-message"]', '.chat-message-assistant'];
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
