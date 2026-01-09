// OmniExporter AI - Gemini Adapter (Production)
// Direct DOM extraction with comprehensive selectors

const GeminiAdapter = {
    name: "Gemini",

    extractUuid: (url) => {
        const appMatch = url.match(/gemini\.google\.com\/app\/([a-zA-Z0-9_-]+)/);
        if (appMatch) return appMatch[1];
        const gemMatch = url.match(/gemini\.google\.com\/gem\/([a-zA-Z0-9_-]+)/);
        if (gemMatch) return gemMatch[1];
        return 'gemini_' + Date.now();
    },

    getThreads: async function (page = 0, limit = 20) {
        const threads = [];
        const currentUuid = this.extractUuid(window.location.href);
        threads.push({
            uuid: currentUuid,
            title: document.title?.replace(' - Gemini', '').replace('Google Gemini', '').trim() || 'Gemini Chat',
            platform: 'Gemini',
            last_query_datetime: new Date().toISOString()
        });
        return threads;
    },

    getThreadDetail: async function (uuid) {
        const messages = [];

        // Strategy 1: Conversation turn containers
        const turnContainers = document.querySelectorAll(
            '[class*="conversation-turn"], [class*="chat-turn"], [data-turn], conversation-turn, .turn-container'
        );

        if (turnContainers.length > 0) {
            turnContainers.forEach((turn, i) => {
                const isUser = turn.hasAttribute('data-is-user') ||
                    turn.classList.contains('user') ||
                    turn.querySelector('[data-role="user"]') ||
                    i % 2 === 0;
                const text = turn.innerText?.trim() || '';
                if (text.length > 5) {
                    if (isUser) {
                        messages.push({ query: text, answer: '' });
                    } else if (messages.length > 0) {
                        messages[messages.length - 1].answer = text;
                    }
                }
            });
        }

        // Strategy 2: Query/Response by data attributes
        if (messages.length === 0) {
            const userQueries = document.querySelectorAll(
                '[data-query-text], [class*="query-text"], [class*="user-input"], [class*="prompt-text"], div[data-message-author-role="user"]'
            );
            const aiResponses = document.querySelectorAll(
                '[data-model-response], [class*="model-response"], [class*="response-text"], [class*="ai-response"], div[data-message-author-role="assistant"], model-response'
            );
            const max = Math.max(userQueries.length, aiResponses.length);
            for (let i = 0; i < max; i++) {
                messages.push({
                    query: userQueries[i]?.innerText?.trim() || '',
                    answer: aiResponses[i]?.innerText?.trim() || ''
                });
            }
        }

        // Strategy 3: Article elements
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

        // Strategy 4: Markdown content blocks
        if (messages.length === 0) {
            const markdownBlocks = document.querySelectorAll('[class*="markdown"], .prose, [class*="response-container"] div, message-content');
            const simpleTextBlocks = document.querySelectorAll('[class*="query"], [class*="user-message"], [class*="input-text"]');
            const max = Math.max(simpleTextBlocks.length, markdownBlocks.length);
            for (let i = 0; i < max; i++) {
                const q = simpleTextBlocks[i]?.innerText?.trim() || '';
                const a = markdownBlocks[i]?.innerText?.trim() || '';
                if (q || a) messages.push({ query: q, answer: a });
            }
        }

        // Strategy 5: Main content area scraping
        if (messages.length === 0) {
            const mainContent = document.querySelector('main, [role="main"], .chat-container, #chat-container');
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

        // Strategy 6: Deep text node extraction
        if (messages.length === 0) {
            const chatElements = document.querySelectorAll('[role="listitem"], [role="row"], li[class*="message"], div[class*="message"], [class*="chat-message"]');
            chatElements.forEach((el, i) => {
                const text = el.innerText?.trim() || '';
                if (text.length > 5) {
                    if (i % 2 === 0) {
                        messages.push({ query: text, answer: '' });
                    } else if (messages.length > 0) {
                        messages[messages.length - 1].answer = text;
                    }
                }
            });
        }

        const filteredMessages = messages.filter(m => m.query || m.answer);
        const title = document.title?.replace(' - Gemini', '')?.replace('Google Gemini', '')?.replace('Gemini', '')?.trim() || 'Gemini Conversation';

        return { uuid, title, platform: 'Gemini', entries: filteredMessages };
    },

    getSpaces: async function () { return []; }
};

window.GeminiAdapter = GeminiAdapter;
