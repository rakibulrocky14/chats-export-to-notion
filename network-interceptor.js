// OmniExporter AI - Network Interceptor
// Auto-discovers API endpoints for chat lists

const NetworkInterceptor = {
    capturedEndpoints: {},
    chatListData: null,

    init() {
        this.interceptXHR();
        this.interceptFetch();
    },

    // Intercept XMLHttpRequest
    interceptXHR() {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        const self = this;

        XMLHttpRequest.prototype.open = function (method, url) {
            this._interceptedUrl = url;
            this._interceptedMethod = method;
            return originalOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function () {
            this.addEventListener('load', function () {
                self.processResponse(this._interceptedUrl, this.responseText, this._interceptedMethod);
            });
            return originalSend.apply(this, arguments);
        };
    },

    // Intercept Fetch API
    interceptFetch() {
        const originalFetch = window.fetch;
        const self = this;

        window.fetch = async function (url, options = {}) {
            const response = await originalFetch.apply(this, arguments);

            // Clone response to read it
            const clone = response.clone();
            try {
                const text = await clone.text();
                self.processResponse(url.toString(), text, options.method || 'GET');
            } catch (e) { }

            return response;
        };
    },

    // Process and identify chat list responses
    processResponse(url, responseText, method) {
        try {
            const data = JSON.parse(responseText);

            // Pattern detection for chat lists
            if (this.isChatListResponse(data, url)) {
                const platform = this.detectPlatform(url);
                this.capturedEndpoints[platform] = {
                    url: url,
                    method: method,
                    timestamp: Date.now()
                };
                this.chatListData = this.extractChatList(data);

                // Store for popup access
                window.__omniChatList = this.chatListData;
                window.__omniEndpoints = this.capturedEndpoints;
            }
        } catch (e) { }
    },

    // Detect if response contains chat list
    isChatListResponse(data, url) {
        // Check URL patterns
        const listPatterns = [
            /chat.*list/i, /conversations/i, /threads/i,
            /history/i, /sessions/i, /chats/i
        ];
        const urlMatches = listPatterns.some(p => p.test(url));

        // Check data structure (array of objects with uuid/id and title)
        const isArray = Array.isArray(data);
        const hasData = data?.data && Array.isArray(data.data);
        const hasList = data?.list && Array.isArray(data.list);

        const items = isArray ? data : (data?.data || data?.list || data?.conversations || data?.threads || []);

        if (items.length > 0) {
            const hasIds = items.some(i => i.uuid || i.id || i.session_id || i.chat_session_id);
            const hasTitles = items.some(i => i.title || i.name);
            return hasIds && (urlMatches || hasTitles);
        }

        return false;
    },

    detectPlatform(url) {
        if (url.includes('deepseek')) return 'DeepSeek';
        if (url.includes('grok') || url.includes('x.com')) return 'Grok';
        if (url.includes('gemini')) return 'Gemini';
        if (url.includes('perplexity')) return 'Perplexity';
        if (url.includes('chatgpt') || url.includes('openai')) return 'ChatGPT';
        if (url.includes('claude')) return 'Claude';
        return 'Unknown';
    },

    extractChatList(data) {
        const items = Array.isArray(data) ? data :
            (data?.data || data?.list || data?.conversations || data?.threads || data?.chats || []);

        return items.map(item => ({
            uuid: item.uuid || item.id || item.session_id || item.chat_session_id || item.conversationId,
            title: item.title || item.name || 'Untitled',
            last_query_datetime: item.last_query_datetime || item.updated_at || item.updatedAt ||
                item.create_time || item.createdAt || new Date().toISOString()
        })).filter(i => i.uuid);
    },

    // Get captured chat list
    getChatList() {
        return window.__omniChatList || [];
    },

    // Get discovered endpoints
    getEndpoints() {
        return window.__omniEndpoints || {};
    }
};

// Initialize interceptor
NetworkInterceptor.init();

// Expose for adapter use
window.NetworkInterceptor = NetworkInterceptor;
