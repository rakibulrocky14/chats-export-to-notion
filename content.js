// OmniExporter AI - Enterprise Edition
// content.js - Unified Platform Adapter

console.log("OmniExporter AI Content Script Active");

class ContentScriptManager {
    constructor() {
        this.messageHandler = null;
        this.cleanupFunctions = [];
    }

    initialize() {
        // Remove existing listener if any (safety against multiple injections)
        this.cleanup();

        this.messageHandler = (request, sender, sendResponse) => {
            this.handleMessage(request, sendResponse);
            return true; // Keep message channel open for async response
        };

        chrome.runtime.onMessage.addListener(this.messageHandler);

        // Cleanup on visibility change (optional optimization)
        const visibilityHandler = () => {
            if (document.hidden) {
                // We could pause things here if needed
            }
        };
        document.addEventListener('visibilitychange', visibilityHandler);
        this.cleanupFunctions.push(() => {
            document.removeEventListener('visibilitychange', visibilityHandler);
        });

        // Fix 16: SPA Navigation Handling
        const navigationHandler = () => {
            const adapter = getPlatformAdapter();
            if (adapter) {
                const newUuid = adapter.extractUuid(window.location.href);
                console.log('[OmniExporter] SPA navigation detected, new conversation:', newUuid);
            }
        };

        // Handle browser back/forward
        window.addEventListener('popstate', navigationHandler);
        this.cleanupFunctions.push(() => {
            window.removeEventListener('popstate', navigationHandler);
        });

        // Intercept pushState/replaceState for SPA routing
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function (...args) {
            originalPushState.apply(this, args);
            navigationHandler();
        };

        history.replaceState = function (...args) {
            originalReplaceState.apply(this, args);
            navigationHandler();
        };

        this.cleanupFunctions.push(() => {
            history.pushState = originalPushState;
            history.replaceState = originalReplaceState;
        });

        console.log("OmniExporter AI Content Script Initialized");
    }

    cleanup() {
        if (this.messageHandler) {
            chrome.runtime.onMessage.removeListener(this.messageHandler);
            this.messageHandler = null;
        }
        this.cleanupFunctions.forEach(fn => fn());
        this.cleanupFunctions = [];
        console.log("OmniExporter AI Content Script Cleaned Up");
    }

    async handleMessage(request, sendResponse) {
        // Phase 4: Health check handler
        if (request.type === 'HEALTH_CHECK') {
            sendResponse({ healthy: true, timestamp: Date.now() });
            return;
        }

        const adapter = getPlatformAdapter();
        if (!adapter) {
            sendResponse({ success: false, error: "Unsupported platform." });
            return;
        }

        try {
            if (request.type === "EXTRACT_CONTENT") {
                await handleExtraction(adapter, sendResponse);
            } else if (request.type === "EXTRACT_CONTENT_BY_UUID") {
                await handleExtractionByUuid(adapter, request.payload.uuid, sendResponse);
            } else if (request.type === "GET_THREAD_LIST") {
                await handleGetThreadList(adapter, request.payload, sendResponse);
            } else if (request.type === "GET_THREAD_LIST_OFFSET") {
                await handleGetThreadListOffset(adapter, request.payload, sendResponse);
            } else if (request.type === "GET_SPACES") {
                await handleGetSpaces(adapter, sendResponse);
            } else if (request.type === "GET_PLATFORM_INFO") {
                sendResponse({ success: true, platform: adapter.name });
            }
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    }
}

const manager = new ContentScriptManager();
manager.initialize();

// Ensure cleanup on page unload
window.addEventListener('beforeunload', () => manager.cleanup());


/**
 * Normalize entries from any adapter format to expected blocks format
 * This ensures all platforms return data in the format popup.js expects
 * 
 * Adapters return various formats:
 * - ChatGPT: { entries: [{query_str, blocks}], title }
 * - Perplexity: Similar blocks format
 * - Gemini/Grok/DeepSeek: { detail: { entries: [{query, answer}] } }
 * - Or sometimes: { entries: [{query, answer}] }
 */
function normalizeEntries(detail, platform) {
    // Handle various possible data structures
    let entries = [];

    // Priority 1: Check if detail has entries directly (ChatGPT, Perplexity return this)
    if (detail?.entries && Array.isArray(detail.entries)) {
        entries = detail.entries;
    }
    // Priority 2: Check nested detail.detail.entries (Gemini/Grok/DeepSeek)
    else if (detail?.detail?.entries && Array.isArray(detail.detail.entries)) {
        entries = detail.detail.entries;
    }
    // Priority 3: If detail itself is an array
    else if (Array.isArray(detail)) {
        entries = detail;
    }
    // Priority 4: For adapters returning messages directly
    else if (detail?.messages && Array.isArray(detail.messages)) {
        entries = detail.messages;
    }

    // If no entries found, return empty
    if (!entries || entries.length === 0) {
        return [];
    }

    return entries.map((entry, index) => {
        // If already in expected format with valid blocks, return as-is
        if (entry.blocks && Array.isArray(entry.blocks) && entry.blocks.length > 0) {
            // Verify the blocks have content
            const hasContent = entry.blocks.some(b =>
                b?.markdown_block?.answer || b?.markdown_block?.chunks
            );
            if (hasContent) {
                return entry;
            }
        }

        // Extract query - try multiple possible keys
        const query = entry.query_str || entry.query || entry.question || entry.prompt || '';

        // Extract answer - try multiple possible keys
        let answer = '';

        // Check blocks first (might have empty blocks)
        if (entry.blocks && Array.isArray(entry.blocks)) {
            entry.blocks.forEach(block => {
                if (block?.markdown_block?.answer) {
                    answer += block.markdown_block.answer + '\n\n';
                } else if (block?.markdown_block?.chunks) {
                    answer += block.markdown_block.chunks.join('\n') + '\n\n';
                }
            });
        }

        // Fallback to flat answer fields
        if (!answer.trim()) {
            answer = entry.answer || entry.response || entry.text || entry.content || '';
        }


        // Convert to expected format
        return {
            query_str: query,
            query: query, // Keep for backward compatibility
            blocks: [{
                intended_usage: 'ask_text',
                markdown_block: {
                    answer: answer.trim()
                }
            }],
            // Preserve original fields
            created_datetime: entry.created_datetime || entry.create_time || new Date().toISOString(),
            updated_datetime: entry.updated_datetime || entry.update_time
        };
    });
}

/**
 * Handle Single Extraction (Current Chat)
 */
async function handleExtraction(adapter, sendResponse) {
    try {
        const uuid = adapter.extractUuid(window.location.href);
        if (!uuid) throw new Error(`Open a ${adapter.name} chat first.`);

        const detail = await adapter.getThreadDetail(uuid);

        // Normalize entries to expected format
        const normalizedEntries = normalizeEntries(detail, adapter.name);

        // Get title from various sources
        const title = detail?.title || document.title?.replace(` - ${adapter.name}`, '').trim() || 'Untitled';

        sendResponse({
            success: true,
            data: {
                title: title,
                uuid: uuid,
                detail: { entries: normalizedEntries },
                platform: adapter.name
            }
        });
    } catch (error) {
        console.error(`[OmniExporter] Extraction error:`, error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * Handle Specific Thread Extraction
 */
async function handleExtractionByUuid(adapter, uuid, sendResponse) {
    try {
        const detail = await adapter.getThreadDetail(uuid);

        // Normalize entries to expected format
        const normalizedEntries = normalizeEntries(detail, adapter.name);
        const title = detail?.title || `Thread_${uuid}`;

        sendResponse({
            success: true,
            data: {
                title: title,
                uuid: uuid,
                detail: { entries: normalizedEntries },
                platform: adapter.name
            }
        });
    } catch (error) {
        console.error(`[OmniExporter] ExtractionByUuid error:`, error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * Handle Thread List Fetching
 */
async function handleGetThreadList(adapter, payload, sendResponse) {
    try {
        const response = await adapter.getThreads(payload.page || 1, payload.limit || 20, payload.spaceId);
        sendResponse({ success: true, data: response });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * Handle Thread List Fetching with Direct Offset (for Load All feature)
 */
async function handleGetThreadListOffset(adapter, payload, sendResponse) {
    try {
        const offset = payload.offset || 0;
        const limit = payload.limit || 50;

        // Use Perplexity API directly with offset
        if (adapter.name === 'Perplexity') {
            const url = "https://www.perplexity.ai/rest/thread/list_ask_threads?version=2.18&source=default";
            const body = { limit, offset, ascending: false };

            const response = await fetch(url, {
                method: "POST",
                credentials: "include",
                headers: { "accept": "*/*", "content-type": "application/json" },
                body: JSON.stringify(body)
            });
            const data = await response.json();

            const threads = (Array.isArray(data) ? data : []).map(t => ({
                uuid: t.uuid,
                title: t.title || "Untitled",
                last_query_datetime: t.last_query_datetime
            }));

            sendResponse({ success: true, data: { threads, offset, hasMore: threads.length === limit } });
        } else {
            // Fallback to page-based for other platforms
            const page = Math.floor(offset / limit) + 1;
            const response = await adapter.getThreads(page, limit);
            sendResponse({ success: true, data: response });
        }
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}


async function handleGetSpaces(adapter, sendResponse) {
    try {
        if (!adapter.getSpaces) return sendResponse({ success: true, data: [] });
        const spaces = await adapter.getSpaces();
        sendResponse({ success: true, data: spaces });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// --- Platform Detection & Adapters (Fix #5: Capability Validation) ---

/**
 * Validate adapter has required methods
 */
function validateAdapter(adapter) {
    const required = ['name', 'extractUuid', 'getThreads', 'getThreadDetail'];
    for (const method of required) {
        if (!adapter[method]) {
            console.error(`[OmniExporter] Adapter missing required method: ${method}`);
            return false;
        }
    }
    return true;
}

function getPlatformAdapter() {
    const host = window.location.hostname;
    let adapter = null;

    // Original platforms (with platform-config.js)
    if (host.includes("perplexity.ai")) {
        adapter = PerplexityAdapter;
    }
    else if (host.includes("chatgpt.com") || host.includes("openai.com")) {
        adapter = ChatGPTAdapter;
    }
    else if (host.includes("claude.ai")) {
        adapter = ClaudeAdapter;
    }
    // New platforms (with standalone adapters)
    else if (host.includes("gemini.google.com")) {
        adapter = window.GeminiAdapter || null;
    }
    else if (host.includes("grok.com") || host.includes("x.com")) {
        adapter = window.GrokAdapter || null;
    }
    else if (host.includes("chat.deepseek.com") || host.includes("deepseek.com")) {
        adapter = window.DeepSeekAdapter || null;
    }

    // Validate adapter has required capabilities
    if (adapter && !validateAdapter(adapter)) {
        return null;
    }

    return adapter;
}

// --- Perplexity Implementation (Uses Platform Config) ---
const PerplexityAdapter = {
    name: "Perplexity",

    extractUuid: (url) => {
        // Use config layer with multiple pattern fallbacks
        return platformConfig.extractUuid('Perplexity', url);
    },

    getThreads: async (page, limit, spaceId = null) => {
        try {
            // Build endpoint using config
            const endpoint = platformConfig.buildEndpoint('Perplexity', 'listThreads');
            const baseUrl = platformConfig.getBaseUrl('Perplexity');
            const url = `${baseUrl}${endpoint}`;

            const body = { limit, offset: (page - 1) * limit, ascending: false };
            if (spaceId) body.collection_uuid = spaceId;

            const response = await fetch(url, {
                method: "POST",
                credentials: "include",
                headers: { "accept": "*/*", "content-type": "application/json" },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                // Mark endpoint as failed, will use fallback next time
                platformConfig.markEndpointFailed('Perplexity', 'listThreads');
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            return {
                threads: (Array.isArray(data) ? data : []).map(t => ({
                    uuid: t.uuid,
                    title: DataExtractor.extractTitle(t, 'Perplexity'),
                    last_query_datetime: t.last_query_datetime
                })),
                hasMore: (data.length || 0) === limit,
                page
            };
        } catch (error) {
            console.error('[Perplexity] getThreads error:', error);
            throw error;
        }
    },

    getSpaces: async () => {
        try {
            const endpoint = platformConfig.buildEndpoint('Perplexity', 'spaces');
            const baseUrl = platformConfig.getBaseUrl('Perplexity');
            const response = await fetch(`${baseUrl}${endpoint}`, { credentials: "include" });

            if (!response.ok) {
                platformConfig.markEndpointFailed('Perplexity', 'spaces');
                return [];
            }

            const data = await response.json();
            return (data || []).map(s => ({ uuid: s.uuid, name: s.title }));
        } catch (error) {
            console.error('[Perplexity] getSpaces error:', error);
            return [];
        }
    },

    getThreadDetail: async (uuid) => {
        return await fetchPerplexityDetailResilient(uuid);
    }
};

// --- ChatGPT Implementation (Uses Platform Config) ---
const ChatGPTAdapter = {
    name: "ChatGPT",

    extractUuid: (url) => {
        return platformConfig.extractUuid('ChatGPT', url);
    },

    getThreads: async (page, limit) => {
        try {
            const baseUrl = platformConfig.getBaseUrl('ChatGPT');
            const endpoint = platformConfig.buildEndpoint('ChatGPT', 'conversations');
            const url = `${baseUrl}${endpoint}?offset=${(page - 1) * limit}&limit=${limit}&order=updated`;

            const response = await fetch(url, { credentials: "include" });

            if (!response.ok) {
                platformConfig.markEndpointFailed('ChatGPT', 'conversations');
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            return {
                threads: (data.items || []).map(t => ({
                    uuid: t.id,
                    title: DataExtractor.extractTitle(t, 'ChatGPT'),
                    last_query_datetime: t.update_time
                })),
                hasMore: !!data.has_missing_conversations,
                page
            };
        } catch (error) {
            console.error('[ChatGPT] getThreads error:', error);
            throw error;
        }
    },

    getThreadDetail: async (uuid) => {
        // Try API first
        try {
            const baseUrl = platformConfig.getBaseUrl('ChatGPT');
            const endpoint = platformConfig.buildEndpoint('ChatGPT', 'conversationDetail', { uuid });
            const url = `${baseUrl}${endpoint}`;

            const response = await fetch(url, { credentials: "include" });

            if (response.ok) {
                const data = await response.json();
                const entries = transformChatGPTData(data);
                if (entries.length > 0) {
                    console.log(`[ChatGPT] API success: ${entries.length} entries`);
                    return { entries: entries, title: data.title };
                }
            }

            console.log('[ChatGPT] API failed or empty, trying DOM extraction');
        } catch (error) {
            console.log('[ChatGPT] API error, trying DOM extraction:', error.message);
        }

        // DOM Fallback
        return ChatGPTAdapter.extractFromDOM(uuid);
    },

    extractFromDOM: (uuid) => {
        console.log('[ChatGPT] Starting DOM extraction...');
        const messages = [];

        // Strategy 1: Look for message containers with data attributes
        const messageContainers = document.querySelectorAll(
            '[data-message-author-role], ' +
            '[data-message-id], ' +
            '[class*="message"]'
        );

        if (messageContainers.length > 0) {
            console.log(`[ChatGPT] Strategy 1: Found ${messageContainers.length} message containers`);

            let currentQuery = '';
            messageContainers.forEach(container => {
                const role = container.getAttribute('data-message-author-role') ||
                    (container.className.includes('user') ? 'user' : 'assistant');
                const text = container.innerText?.trim() || '';

                if (text.length > 5) {
                    if (role === 'user') {
                        currentQuery = text;
                    } else if (currentQuery) {
                        messages.push({ query: currentQuery, answer: text });
                        currentQuery = '';
                    }
                }
            });
        }

        // Strategy 2: Article elements (ChatGPT uses article tags)
        if (messages.length === 0) {
            const articles = document.querySelectorAll('article, [data-testid*="conversation-turn"]');
            console.log(`[ChatGPT] Strategy 2: Found ${articles.length} articles`);

            let currentQuery = '';
            articles.forEach((article, i) => {
                const text = article.innerText?.trim() || '';
                if (text.length > 10) {
                    // Even indices are typically user, odd are assistant
                    if (i % 2 === 0) {
                        currentQuery = text;
                    } else {
                        messages.push({ query: currentQuery, answer: text });
                        currentQuery = '';
                    }
                }
            });
        }

        // Strategy 3: Prose/markdown containers
        if (messages.length === 0) {
            console.log('[ChatGPT] Strategy 3: Prose containers');

            const proseBlocks = document.querySelectorAll('.prose, [class*="markdown"], [class*="response"]');
            const userBlocks = document.querySelectorAll('[class*="request"], [class*="user-message"]');

            const max = Math.max(userBlocks.length, proseBlocks.length);
            for (let i = 0; i < max; i++) {
                messages.push({
                    query: userBlocks[i]?.innerText?.trim() || '',
                    answer: proseBlocks[i]?.innerText?.trim() || ''
                });
            }
        }

        // Strategy 4: Main content text extraction
        if (messages.length === 0) {
            console.log('[ChatGPT] Strategy 4: Main content extraction');

            const main = document.querySelector('main, [role="main"]');
            if (main) {
                const allText = [];
                const blocks = main.querySelectorAll('div > div > div');

                blocks.forEach(block => {
                    const text = block.innerText?.trim();
                    if (text && text.length > 30 && !allText.includes(text)) {
                        allText.push(text);
                    }
                });

                for (let i = 0; i < allText.length - 1; i += 2) {
                    messages.push({
                        query: allText[i] || '',
                        answer: allText[i + 1] || ''
                    });
                }
            }
        }

        console.log(`[ChatGPT] DOM extraction complete: ${messages.length} message pairs`);

        const title = document.title?.replace(' | ChatGPT', '').replace(' - ChatGPT', '').trim() ||
            document.querySelector('h1')?.textContent?.trim() ||
            'ChatGPT Conversation';

        return {
            uuid: uuid,
            title: title,
            entries: messages.filter(m => m.query || m.answer)
        };
    }
};

// --- Claude Implementation (Uses Platform Config) ---
const ClaudeAdapter = {
    name: "Claude",
    _cachedOrgId: null,

    extractUuid: (url) => {
        return platformConfig.extractUuid('Claude', url);
    },

    async getOrgId() {
        if (this._cachedOrgId) return this._cachedOrgId;

        try {
            const baseUrl = platformConfig.getBaseUrl('Claude');
            const endpoint = platformConfig.buildEndpoint('Claude', 'organizations');
            const orgsResp = await fetch(`${baseUrl}${endpoint}`, { credentials: "include" });

            if (!orgsResp.ok) {
                platformConfig.markEndpointFailed('Claude', 'organizations');
                throw new Error('Failed to fetch Claude organizations');
            }

            const orgs = await orgsResp.json();
            if (!orgs || orgs.length === 0) {
                throw new Error('No Claude organizations found. Please check your login.');
            }

            this._cachedOrgId = orgs[0].uuid;
            console.log(`[Claude] Org found: ${orgs[0].name || this._cachedOrgId}`);
            return this._cachedOrgId;
        } catch (error) {
            console.error('[Claude] org fetch failed:', error);
            throw error;
        }
    },

    getThreads: async function (page, limit) {
        try {
            const orgId = await this.getOrgId();
            const baseUrl = platformConfig.getBaseUrl('Claude');
            const endpoint = platformConfig.buildEndpoint('Claude', 'conversations', { org: orgId });
            const url = `${baseUrl}${endpoint}`;

            const response = await fetch(url, { credentials: "include" });

            if (!response.ok) {
                platformConfig.markEndpointFailed('Claude', 'conversations');
                throw new Error(`Claude API error: ${response.status}`);
            }

            const data = await response.json();
            return {
                threads: (Array.isArray(data) ? data : []).map(t => ({
                    uuid: t.uuid,
                    title: DataExtractor.extractTitle(t, 'Claude'),
                    last_query_datetime: t.updated_at
                })),
                hasMore: false,
                page
            };
        } catch (error) {
            console.error('[Claude] getThreads error:', error);
            throw error;
        }
    },

    getThreadDetail: async function (uuid) {
        try {
            const orgId = await this.getOrgId();
            const baseUrl = platformConfig.getBaseUrl('Claude');
            const endpoint = platformConfig.buildEndpoint('Claude', 'conversationDetail', { org: orgId, uuid });
            const url = `${baseUrl}${endpoint}`;

            const response = await fetch(url, { credentials: "include" });

            if (!response.ok) {
                platformConfig.markEndpointFailed('Claude', 'conversationDetail');
                throw new Error(`Claude API error: ${response.status}`);
            }

            const data = await response.json();
            return { entries: transformClaudeData(data), title: data.name };
        } catch (error) {
            console.error('[Claude] getThreadDetail error:', error);
            throw error;
        }
    }
};

// --- Helper Functions ---

/**
 * Resilient Perplexity detail fetcher using platform config
 */
async function fetchPerplexityDetailResilient(uuid) {
    console.log('[Perplexity] Fetching thread detail for:', uuid);

    let entries = [];
    let cursor = null;
    let isInitial = true;
    let title = 'Untitled Thread';

    // Get version from config or detector
    const version = platformConfig.activeVersions.get('Perplexity') ||
        PLATFORM_CONFIGS.Perplexity.versions.current;

    try {
        while (true) {
            // Build endpoint using config
            const baseUrl = platformConfig.getBaseUrl('Perplexity');
            const params = new URLSearchParams({
                with_parent_info: "true",
                with_schematized_response: "true",
                version: version,
                source: "default",
                limit: isInitial ? "10" : "100"
            });
            if (cursor) params.append("cursor", cursor);

            const url = `${baseUrl}/rest/thread/${uuid}?${params.toString()}`;
            console.log('[OmniExporter] Fetching:', url);

            const response = await fetch(url, {
                credentials: "include",
                headers: {
                    "x-app-apiversion": "2.18",
                    "accept": "application/json"
                }
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }

            const json = await response.json();
            console.log('[OmniExporter] API Response:', json);

            // Extract entries - filter duplicates
            if (json.entries && Array.isArray(json.entries)) {
                json.entries.forEach(entry => {
                    if (!entries.find(e => e.uuid === entry.uuid)) {
                        entries.push(entry);
                    }
                });
            }

            // Extract title from first entry if available
            if (entries.length > 0 && !title || title === 'Untitled Thread') {
                const firstEntry = entries[0];
                if (firstEntry.query_str) {
                    title = firstEntry.query_str.slice(0, 100);
                }
            }

            // Check for pagination
            if (!json.next_cursor || json.next_cursor === cursor) {
                console.log('[OmniExporter] No more pages, total entries:', entries.length);
                break;
            }

            cursor = json.next_cursor;
            isInitial = false;
        }

        console.log('[OmniExporter] Final result - Title:', title, 'Entries:', entries.length);

        // Debug: Log first entry structure
        if (entries.length > 0) {
            console.log('[OmniExporter] First entry structure:', JSON.stringify(entries[0], null, 2).slice(0, 500));
        }

        return {
            entries: entries,
            title: title,
            uuid: uuid
        };
    } catch (error) {
        console.error('[OmniExporter] Error fetching thread detail:', error);
        throw error;
    }
}


function transformChatGPTData(data) {
    // ChatGPT returns a tree structure with mapping object.
    // We need to traverse from root to leaves to get ordered messages.
    const entries = [];
    const mapping = data.mapping || {};

    try {
        // Find the root node (node with no parent or parent is null)
        let currentNodeId = null;

        // Method 1: Find root node with null parent
        for (const [id, node] of Object.entries(mapping)) {
            if (!node.parent) {
                currentNodeId = id;
                break;
            }
        }

        // Method 2: If no root found, use first node
        if (!currentNodeId && Object.keys(mapping).length > 0) {
            currentNodeId = Object.keys(mapping)[0];
        }

        // Traverse the tree following children links
        const orderedMessages = [];
        const visited = new Set();

        while (currentNodeId && !visited.has(currentNodeId)) {
            visited.add(currentNodeId);
            const node = mapping[currentNodeId];

            if (node?.message) {
                const msg = node.message;
                const role = msg.author?.role;

                // Extract content - ChatGPT uses various content structures
                let content = '';

                if (msg.content?.parts && Array.isArray(msg.content.parts)) {
                    content = msg.content.parts
                        .filter(p => typeof p === 'string')
                        .join('\n');
                } else if (msg.content?.text) {
                    content = msg.content.text;
                } else if (typeof msg.content === 'string') {
                    content = msg.content;
                }

                // Skip system messages and empty content
                if (role && role !== 'system' && content.trim()) {
                    orderedMessages.push({
                        role: role,
                        content: content.trim(),
                        create_time: msg.create_time,
                        id: msg.id
                    });
                }
            }

            // Move to first child (follow the conversation thread)
            if (node?.children && node.children.length > 0) {
                currentNodeId = node.children[0];
            } else {
                break;
            }
        }

        // If tree traversal didn't work, fallback to sorting all messages
        if (orderedMessages.length === 0) {
            Object.values(mapping).forEach(node => {
                const msg = node?.message;
                if (msg && msg.author?.role && msg.author.role !== 'system') {
                    let content = '';
                    if (msg.content?.parts && Array.isArray(msg.content.parts)) {
                        content = msg.content.parts.filter(p => typeof p === 'string').join('\n');
                    } else if (msg.content?.text) {
                        content = msg.content.text;
                    }
                    if (content.trim()) {
                        orderedMessages.push({
                            role: msg.author.role,
                            content: content.trim(),
                            create_time: msg.create_time || 0
                        });
                    }
                }
            });
            // Sort by create_time
            orderedMessages.sort((a, b) => (a.create_time || 0) - (b.create_time || 0));
        }

        // Pair user questions with assistant answers
        let currentEntry = null;
        orderedMessages.forEach(msg => {
            if (msg.role === 'user') {
                // Push previous entry if exists
                if (currentEntry && currentEntry.blocks.length > 0) {
                    entries.push(currentEntry);
                }
                currentEntry = {
                    query_str: msg.content,
                    blocks: []
                };
            } else if ((msg.role === 'assistant' || msg.role === 'tool') && currentEntry) {
                currentEntry.blocks.push({
                    intended_usage: 'ask_text',
                    markdown_block: { answer: msg.content }
                });
            }
        });

        // Push final entry
        if (currentEntry && currentEntry.blocks.length > 0) {
            entries.push(currentEntry);
        }

        console.log(`[ChatGPT] Transformed ${orderedMessages.length} messages into ${entries.length} entries`);
    } catch (e) {
        console.error('[OmniExporter] ChatGPT transform error:', e);
    }

    return entries;
}

function transformClaudeData(data) {
    // Claude returns chat_messages array
    const entries = [];
    const messages = data.chat_messages || [];

    try {
        let currentEntry = null;
        messages.forEach(msg => {
            if (msg.sender === 'human') {
                if (currentEntry) entries.push(currentEntry);
                currentEntry = {
                    query_str: msg.text || '',
                    blocks: []
                };
            } else if (msg.sender === 'assistant' && currentEntry) {
                currentEntry.blocks.push({
                    intended_usage: 'ask_text',
                    markdown_block: { answer: msg.text || '' }
                });
            }
        });
        if (currentEntry && currentEntry.blocks.length > 0) {
            entries.push(currentEntry);
        }
    } catch (e) {
        console.error('[OmniExporter] Claude transform error:', e);
    }

    return entries;
}

// ============================================
// RESILIENT EXTRACTION HELPERS
// ============================================

/**
 * Extract answer using DataExtractor with fallbacks
 */
function extractAnswerResilient(entry, platform) {
    // Try DataExtractor first (uses config-based paths)
    const extracted = DataExtractor.extractAnswer(entry, platform);
    if (extracted) return extracted;

    // Fallback: Try Perplexity block extraction
    if (platform === 'Perplexity' && entry.blocks) {
        const { answer } = DataExtractor.extractFromPerplexityBlocks(entry);
        if (answer) return answer;
    }

    // Final fallback: direct properties
    return entry.answer || entry.text || entry.content || '';
}

/**
 * Extract query using DataExtractor with fallbacks
 */
function extractQueryResilient(entry, platform) {
    const extracted = DataExtractor.extractQuery(entry, platform);
    if (extracted) return extracted;

    // Fallback
    return entry.query || entry.query_str || entry.question || '';
}

// ============================================
// AUTO-VERSION DETECTION ON LOAD
// ============================================
async function initializePlatformAdapters() {
    try {
        const adapter = getPlatformAdapter();
        if (adapter) {
            const detectedVersion = await versionDetector.detect(adapter.name);
            platformConfig.setActiveVersion(adapter.name, detectedVersion);
            console.log(`[OmniExporter] Detected ${adapter.name} version: ${detectedVersion}`);
        }
    } catch (e) {
        console.warn('[OmniExporter] Version detection failed:', e);
    }
}

// Initialize version detection after DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePlatformAdapters);
} else {
    initializePlatformAdapters();
}

// ============================================
// INITIALIZE CONTENT SCRIPT MANAGER
// ============================================
const contentManager = new ContentScriptManager();
contentManager.initialize();

