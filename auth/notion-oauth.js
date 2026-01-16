/**
 * Notion OAuth2 Authentication Module
 * Provides OAuth2 integration for Notion API access
 * Keeps token-based auth as fallback option
 */

const NotionOAuth = {
    // OAuth2 Configuration
    // NOTE: These should be configured in the Notion integration settings
    config: {
        clientId: null, // Set by user in options
        clientSecret: null, // Stored securely
        redirectUri: null, // https://<extension-id>.chromiumapp.org/notion
        authorizationEndpoint: 'https://api.notion.com/v1/oauth/authorize',
        tokenEndpoint: 'https://api.notion.com/v1/oauth/token',
        scopes: ['read_content', 'insert_content']
    },

    /**
     * Initialize OAuth configuration from storage
     */
    async init() {
        try {
            const stored = await chrome.storage.local.get([
                'notion_oauth_client_id',
                'notion_oauth_client_secret',
                'notion_oauth_access_token',
                'notion_oauth_refresh_token',
                'notion_oauth_token_expires',
                'notion_oauth_state'
            ]);

            this.config.clientId = stored.notion_oauth_client_id;
            this.config.clientSecret = stored.notion_oauth_client_secret;
            this.config.redirectUri = chrome.identity.getRedirectURL('notion');

            console.log('[NotionOAuth] Initialized with redirect:', this.config.redirectUri);
            return true;
        } catch (error) {
            console.error('[NotionOAuth] Init failed:', error);
            return false;
        }
    },

    /**
     * Check if OAuth is properly configured
     */
    isConfigured() {
        return !!(this.config.clientId && this.config.clientSecret);
    },

    /**
     * Start OAuth2 authorization flow
     */
    async authorize() {
        if (!this.isConfigured()) {
            throw new Error('OAuth not configured. Please set Client ID and Client Secret in settings.');
        }

        const state = crypto.randomUUID();
        await chrome.storage.local.set({ notion_oauth_state: state });

        // Build authorization URL
        const authUrl = new URL(this.config.authorizationEndpoint);
        authUrl.searchParams.set('client_id', this.config.clientId);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('redirect_uri', this.config.redirectUri);
        authUrl.searchParams.set('owner', 'user');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('scope', this.config.scopes.join(' '));

        console.log('[NotionOAuth] Starting authorization flow:', authUrl.toString());

        // Open authorization window
        return new Promise((resolve, reject) => {
            chrome.identity.launchWebAuthFlow(
                {
                    url: authUrl.toString(),
                    interactive: true
                },
                async (redirectUrl) => {
                    if (chrome.runtime.lastError) {
                        console.error('[NotionOAuth] Auth flow error:', chrome.runtime.lastError);
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }

                    try {
                        // Extract authorization code from redirect URL
                        const url = new URL(redirectUrl);
                        const code = url.searchParams.get('code');
                        const error = url.searchParams.get('error');
                        const returnedState = url.searchParams.get('state');

                        if (error) {
                            reject(new Error(`OAuth error: ${error}`));
                            return;
                        }

                        if (!code) {
                            reject(new Error('No authorization code received'));
                            return;
                        }

                        const stored = await chrome.storage.local.get(['notion_oauth_state']);
                        if (stored.notion_oauth_state && returnedState !== stored.notion_oauth_state) {
                            reject(new Error('OAuth state mismatch. Please try again.'));
                            return;
                        }

                        console.log('[NotionOAuth] Received authorization code');

                        // Exchange code for access token
                        const tokens = await this.exchangeCodeForToken(code);
                        await chrome.storage.local.remove(['notion_oauth_state']);
                        resolve(tokens);
                    } catch (error) {
                        reject(error);
                    }
                }
            );
        });
    },

    /**
     * Exchange authorization code for access token
     */
    async exchangeCodeForToken(code) {
        console.log('[NotionOAuth] Exchanging code for token...');

        const response = await fetch(this.config.tokenEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa(`${this.config.clientId}:${this.config.clientSecret}`),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: this.config.redirectUri
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Token exchange failed: ${error.error || response.statusText}`);
        }

        const tokens = await response.json();
        console.log('[NotionOAuth] ✓ Token exchange successful');

        // Store tokens securely
        await this.storeTokens(tokens);

        return tokens;
    },

    /**
     * Store OAuth tokens securely
     */
    async storeTokens(tokens) {
        const expiresAt = Date.now() + (tokens.expires_in * 1000);

        await chrome.storage.local.set({
            notion_oauth_access_token: tokens.access_token,
            notion_oauth_refresh_token: tokens.refresh_token,
            notion_oauth_token_expires: expiresAt,
            notion_oauth_workspace_id: tokens.workspace_id,
            notion_oauth_workspace_name: tokens.workspace_name,
            notion_auth_method: 'oauth' // Track which auth method is active
        });

        console.log('[NotionOAuth] Tokens stored successfully');
    },

    /**
     * Get current access token (refreshing if needed)
     */
    async getAccessToken() {
        const stored = await chrome.storage.local.get([
            'notion_oauth_access_token',
            'notion_oauth_refresh_token',
            'notion_oauth_token_expires'
        ]);

        // Check if token exists
        if (!stored.notion_oauth_access_token) {
            throw new Error('No OAuth token found. Please authorize first.');
        }

        // Check if token is expired
        if (stored.notion_oauth_token_expires && Date.now() >= stored.notion_oauth_token_expires) {
            console.log('[NotionOAuth] Token expired, refreshing...');
            return await this.refreshAccessToken(stored.notion_oauth_refresh_token);
        }

        return stored.notion_oauth_access_token;
    },

    /**
     * Refresh expired access token
     */
    async refreshAccessToken(refreshToken) {
        if (!refreshToken) {
            throw new Error('No refresh token available');
        }

        console.log('[NotionOAuth] Refreshing access token...');

        const response = await fetch(this.config.tokenEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa(`${this.config.clientId}:${this.config.clientSecret}`),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            })
        });

        if (!response.ok) {
            throw new Error('Token refresh failed');
        }

        const tokens = await response.json();
        await this.storeTokens(tokens);

        console.log('[NotionOAuth] ✓ Token refreshed successfully');
        return tokens.access_token;
    },

    /**
     * Revoke OAuth access and clear tokens
     */
    async disconnect() {
        await chrome.storage.local.remove([
            'notion_oauth_access_token',
            'notion_oauth_refresh_token',
            'notion_oauth_token_expires',
            'notion_oauth_workspace_id',
            'notion_oauth_workspace_name',
            'notion_auth_method'
        ]);

        console.log('[NotionOAuth] Disconnected');
    },

    /**
     * Get OAuth connection status
     */
    async getStatus() {
        const stored = await chrome.storage.local.get([
            'notion_oauth_access_token',
            'notion_oauth_token_expires',
            'notion_oauth_workspace_name',
            'notion_auth_method'
        ]);

        return {
            connected: !!stored.notion_oauth_access_token,
            method: stored.notion_auth_method || 'token',
            workspace: stored.notion_oauth_workspace_name || null,
            expires: stored.notion_oauth_token_expires ? new Date(stored.notion_oauth_token_expires) : null
        };
    },

    /**
     * Resolve active Notion token (OAuth preferred)
     */
    async getActiveToken() {
        await this.init();
        const status = await this.getStatus();
        if (status.method === 'oauth' && status.connected) {
            return this.getAccessToken();
        }
        const stored = await chrome.storage.local.get(['notionApiKey']);
        if (!stored.notionApiKey) {
            throw new Error('No Notion API key or OAuth token configured');
        }
        return stored.notionApiKey;
    }
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NotionOAuth;
}

// Make available globally
if (typeof globalThis !== 'undefined') {
    globalThis.NotionOAuth = NotionOAuth;
}
