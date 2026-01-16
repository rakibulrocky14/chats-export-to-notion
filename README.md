# OmniExporter AI - Enterprise Edition

> **Enterprise-level bulk export for AI chat platforms**
> Export conversations from Perplexity, ChatGPT, Claude, Gemini, Grok & DeepSeek to Markdown, JSON, HTML, PDF & Notion with advanced features like auto-sync, bulk operations, and comprehensive audit logging.

[![Version](https://img.shields.io/badge/version-5.0.0-blue.svg)](https://github.com/yourusername/chats-export-to-notion)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green.svg)](https://chrome.google.com/webstore)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-6-orange.svg)](#supported-platforms)

---

## Table of Contents

- [Features](#features)
- [Supported Platforms](#supported-platforms)
- [Export Formats](#export-formats)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Dashboard Features](#dashboard-features)
- [Technical Details](#technical-details)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### Core Capabilities

- **Multi-Platform Support**: Export from 6 major AI platforms
- **Multiple Export Formats**: Markdown, JSON, HTML, PDF, and Plain Text
- **Notion Integration**: Direct sync to Notion databases with custom properties
- **Bulk Export**: Select and export multiple conversations at once
- **Auto-Sync**: Automated background synchronization at configurable intervals
- **Smart Filtering**: Filter by date, platform, or space
- **Thread Management**: Browse, search, and manage conversation history

### Advanced Features

- **Enterprise Dashboard**: Comprehensive control panel for managing all exports
- **Activity Logging**: Full audit trail of all export operations
- **Failure Tracking**: Monitor and retry failed exports
- **Export History**: Complete record of all export activities
- **Rate Limiting**: Built-in throttling to respect API limits (30 req/min for Notion)
- **Retry Logic**: Automatic retry with exponential backoff for failed operations
- **Connection Monitoring**: Real-time platform connection status
- **Metadata Preservation**: Maintains timestamps, sources, and conversation context

### Security & Reliability

- **Local Storage**: All credentials stored locally in your browser
- **Input Sanitization**: XSS prevention and secure data handling
- **Timeout Protection**: Prevents hanging requests with automatic timeouts
- **Schema Caching**: Optimized Notion database schema fetching
- **Error Mapping**: Human-readable error messages for troubleshooting

---

## Supported Platforms

| Platform | Status | Features |
|----------|--------|----------|
| **Perplexity** | Active | Full support with sources and citations |
| **ChatGPT** | Active | Complete conversation history |
| **Claude** | Active | Multi-turn conversations with context |
| **Gemini** | Active | 100+ message support, advanced extraction |
| **Grok** | Active | X/Grok integration |
| **DeepSeek** | Active | Latest AI platform support |

---

## Export Formats

### 1. Markdown (.md)
- Clean, readable format with YAML frontmatter
- Preserves formatting, sources, and metadata
- Perfect for documentation and note-taking

### 2. JSON (.json)
- Structured data with complete metadata
- Includes timestamps, platform info, and conversation flow
- Ideal for data processing and archival

### 3. HTML (.html)
- Beautiful, styled HTML with gradient design
- Responsive layout for viewing in browsers
- Includes embedded CSS for standalone viewing

### 4. PDF (Print)
- Opens print dialog for PDF creation
- Based on styled HTML template
- Ready for sharing and archival

### 5. Plain Text (.txt)
- Simple, universal format
- Clean question-answer structure
- Compatible with any text editor

---

## Installation

### From Chrome Web Store
> Coming soon - Link will be added upon publishing

### Manual Installation (Development)

1. **Clone or download this repository**
   ```bash
   git clone https://github.com/yourusername/chats-export-to-notion.git
   cd chats-export-to-notion
   ```

2. **Open Chrome Extensions page**
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)

3. **Load the extension**
   - Click "Load unpacked"
   - Select the repository folder
   - The extension icon should appear in your toolbar

4. **Pin the extension** (Optional but recommended)
   - Click the puzzle piece icon in Chrome toolbar
   - Find "OmniExporter AI" and click the pin icon

---

## Configuration

### Notion Integration Setup

To export to Notion, you need to set up a Notion integration:

#### Step 1: Create a Notion Integration

1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Give it a name (e.g., "OmniExporter AI")
4. Select the workspace
5. Click "Submit"
6. **Copy the "Internal Integration Token"** (starts with `secret_`)

#### Step 2: Create a Notion Database

1. Create a new page in Notion
2. Add a database (full-page or inline)
3. Add these recommended properties:
   - `Title` (Title type) - Required
   - `URL` (URL type) - Optional
   - `Chat Time` (Date type) - Optional
   - `Platform` (Select type) - Optional
   - `Space Name` (Text type) - Optional

#### Step 3: Share Database with Integration

1. Open your database in Notion
2. Click the `•••` menu (top right)
3. Click "Add connections"
4. Find and select your integration
5. Copy the **Database ID** from the URL:
   ```
   https://notion.so/workspace/DATABASE_ID?v=...
                              ^^^^^^^^^^^
   ```

#### Step 4: Configure Extension

1. Click the OmniExporter AI icon in Chrome
2. Click "Open Dashboard"
3. Go to "Settings" tab
4. Enter your **API Key** (Integration Token)
5. Enter your **Database ID**
6. Click "Test Connection" to verify
7. Click "Save All Settings"

---

## Usage

### Quick Export (Single Conversation)

1. Navigate to any supported AI platform
2. Open a conversation
3. Click the OmniExporter AI icon
4. Choose export format:
   - Click "Export" dropdown for Markdown, JSON, HTML, TXT, or PDF
   - Click "Save to Notion" for direct Notion sync

### Bulk Export (Multiple Conversations)

1. Click the OmniExporter AI icon
2. Click "Open Dashboard"
3. The dashboard will automatically detect your current platform
4. Select conversations using checkboxes
5. Choose action:
   - "Save Selected to Notion" - Bulk sync to Notion
   - "Export MD" - Download as Markdown files
   - "Export All" - Export all conversations

### Auto-Sync

1. Open Dashboard → Settings
2. Configure "Auto-Sync Interval" (default: 60 minutes)
3. Enable "Auto-sync to Notion" checkbox
4. Save settings
5. Toggle "Auto-Sync" in the dashboard header
6. Conversations will sync automatically in the background

---

## Dashboard Features

### Thread History Tab

- **Platform Selector**: Switch between AI platforms
- **Search**: Find conversations by keyword
- **Filters**: Date range and space filtering
- **Pagination**: Navigate through conversation pages
- **Load All**: Fetch all available conversations
- **Bulk Actions**: Select multiple threads for batch operations
- **Cache Management**: Clear local cache to refresh data

### Settings Tab

- **Notion Integration**: Configure API credentials
- **Connection Testing**: Verify Notion setup
- **Sync Configuration**: Set auto-sync interval
- **Export Options**:
  - Include metadata
  - Sync images
  - Sync citations
  - Skip already exported threads

### Activity Log Tab

Three sub-sections:

1. **Activity Logs**: Complete audit trail of operations
2. **Failures**: Track and debug failed exports
3. **Export History**: Historical record of all exports

---

## Technical Details

### Architecture

- **Manifest Version**: 3 (latest Chrome extension standard)
- **Content Scripts**: Platform-specific adapters for data extraction
- **Background Service Worker**: Handles auto-sync and alarms
- **Storage**: Chrome local storage for settings and cache
- **Permissions**: Minimal required permissions for security

### Platform Adapters

Each platform has custom adapters to handle:
- Network interception for API data capture
- DOM parsing for conversation extraction
- Platform-specific data structures
- Authentication handling

### Rate Limiting

- **Notion API**: 30 requests per minute with intelligent queuing
- **Exponential Backoff**: 2s, 4s, 8s, 16s retry delays
- **Request Deduplication**: Prevents duplicate API calls
- **Timeout Protection**: 30-second maximum for all requests

### Security Features

- **Input Sanitization**: All user inputs are sanitized
- **UUID Validation**: Regex validation for identifiers
- **XSS Prevention**: HTML escaping for dynamic content
- **Local Storage Only**: No external servers or data collection
- **Content Security Policy**: Strict CSP for extension pages

---

## Development

### Project Structure

```
chats-export-to-notion/
├── manifest.json              # Extension configuration
├── background.js             # Service worker for auto-sync
├── popup.html/js/css        # Extension popup interface
├── options.html/js/css      # Dashboard interface
├── content.js               # Main content script
├── platform-config.js       # Platform configurations
├── export-manager.js        # Multi-format export handler
├── notion-picker.js         # Notion integration logic
├── toast.js/css            # Toast notification system
├── network-interceptor.js  # API interception
├── *-adapter.js            # Platform-specific adapters
│   ├── gemini-adapter.js
│   ├── grok-adapter.js
│   └── deepseek-adapter.js
└── icons/                  # Extension icons
```

### Building

No build process required - this is a vanilla JavaScript extension.

### Testing Locally

1. Make your changes
2. Go to `chrome://extensions/`
3. Click the refresh icon on the OmniExporter AI card
4. Test the changes in the popup or dashboard

### Adding a New Platform

1. Create `[platform]-adapter.js`
2. Implement data extraction logic
3. Add platform to `manifest.json` content_scripts
4. Update `platform-config.js`
5. Add icon to navigation bars

---

## Troubleshooting

### Common Issues

#### "Refresh page first" error
**Solution**: Reload the AI platform page before exporting

#### "Configure Notion in Settings" error
**Solution**: Complete the [Notion setup](#notion-integration-setup)

#### "Database not found" error
**Causes**:
- Incorrect Database ID
- Database not shared with integration
- Integration token expired

**Solution**:
1. Verify Database ID is correct
2. Check integration connection in Notion
3. Re-generate integration token if needed

#### Export fails for some conversations
**Solution**:
- Check Activity Log → Failures tab for details
- Some conversations may have format issues
- Try exporting individually to identify problematic threads

#### Platform not detected
**Solution**:
- Ensure you're on a supported platform URL
- Refresh the page
- Check if content script is blocked by other extensions

### Rate Limiting

If you see "rate_limited" errors:
- The extension has built-in throttling
- Wait a few minutes before retrying
- Reduce bulk export batch sizes
- Increase auto-sync interval

---

## Privacy & Security

- **No External Servers**: All data stays on your device
- **No Tracking**: Zero analytics or telemetry
- **Local Storage**: Credentials stored in browser's local storage
- **Open Source**: Code is available for audit
- **Minimal Permissions**: Only requests necessary Chrome permissions

### Security Notice

Your Notion API key is stored locally in your browser. Never:
- Share your extension data with untrusted parties
- Sync settings across untrusted devices
- Share screenshots containing API keys or Database IDs

---

## Contributing

Contributions are welcome! Here's how you can help:

### Bug Reports

Please include:
- Browser version
- Extension version
- Platform (which AI site)
- Steps to reproduce
- Error messages from console

### Feature Requests

Open an issue with:
- Clear description of the feature
- Use case and benefits
- Any relevant examples

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly
5. Commit with clear messages
6. Push to your fork
7. Open a pull request

---

## Roadmap

- [ ] Firefox extension support
- [ ] Additional export formats (Word, Obsidian)
- [ ] Cloud sync for settings
- [ ] More AI platforms (Poe, Pi, etc.)
- [ ] Advanced search and filtering
- [ ] Export scheduling
- [ ] Team collaboration features
- [ ] API for programmatic access

---

## Credits

### Built With

- Vanilla JavaScript (no frameworks)
- Chrome Extension Manifest V3
- Notion API
- Modern CSS (gradients, flexbox, animations)

### Inspiration

Created to solve the problem of preserving and organizing valuable AI conversations across multiple platforms.

---

## License

MIT License - see [LICENSE](LICENSE) file for details

---

## Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/chats-export-to-notion/issues)
- **Documentation**: [Wiki](https://github.com/yourusername/chats-export-to-notion/wiki)
- **Updates**: [Releases](https://github.com/yourusername/chats-export-to-notion/releases)

---

## Acknowledgments

Special thanks to:
- The Notion API team for excellent documentation
- All AI platforms for their innovative chat interfaces
- Open source community for inspiration and tools

---

<div align="center">

**Made with ❤️ for the AI community**

[⬆ Back to Top](#omniexporter-ai---enterprise-edition)

</div>
