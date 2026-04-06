# SKT Jira Summarizer - Smart Epic Insights

A Chrome extension that converts Jira epics and sprints into CXO-level executive summaries powered by AI. Navigate to any Jira board, backlog, or roadmap and get instant insights with one click.

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-green)
![License](https://img.shields.io/badge/license-MIT-yellow)

## Features

- **AI-Powered Summaries** - Generate executive-level summaries from Jira board, backlog, and roadmap views using LLMs via OpenRouter
- **RAG Delivery Confidence** - Red/Amber/Green status with data-driven reasoning
- **Team Workload Analysis** - Per-member task distribution, story points, and workload status (Balanced / Overloaded / Underutilized)
- **Velocity Tracking** - Sprint story point metrics with completion rate and burn progress visualization
- **Sprint Health** - Scope stability, team morale indicators, and scope change notes
- **Summary History** - Automatically saves past summaries (up to 50) for quick reference
- **Multiple Export Options** - Copy as plain text, Markdown, PDF export, or email directly
- **Manual Data Input** - Paste Jira export data, CSV, or free-text sprint descriptions when not on a Jira page
- **Dark Mode** - Full dark theme support
- **Debug Diagnostics** - Built-in DOM inspector to troubleshoot scraping issues on different Jira layouts
- **Multi-Model Support** - Choose from Gemini 2.0 Flash, Claude Sonnet 4, GPT-4o Mini, GPT-4o, or Claude Opus 4

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the project folder
5. The extension icon will appear in your toolbar

## Setup

1. Click the extension icon to open the popup
2. Click the **Settings** gear icon
3. Enter your [OpenRouter API key](https://openrouter.ai/) (free tier available)
4. Select your preferred AI model
5. Navigate to any Jira Cloud page (`*.atlassian.net`)

## Usage

### Auto-Scrape from Jira
1. Navigate to a Jira **board**, **backlog**, or **roadmap/timeline** view
2. Click the extension icon
3. Click **Summarize This Page**
4. View the executive summary with delivery confidence, blockers, risks, highlights, and recommendations

### Manual Input
1. Click **Paste Data** in the extension popup
2. Paste your Jira export, CSV data, or describe your sprint status
3. Click **Summarize Pasted Data**

### Tabs
- **Summarize** - Executive summary with RAG status, progress, blockers, risks, and recommendations
- **Team Workload** - Individual team member task breakdown with workload indicators
- **Velocity** - Story point metrics and sprint burn progress

## Supported Jira Views

| View | Data Extracted |
|------|---------------|
| Board | Issues with status (from columns), type, priority, assignee, story points, epic, flags |
| Backlog | Issues with status, type, priority, assignee, story points |
| Roadmap / Timeline | Epics with progress (done/total) |

## Project Structure

```
jira-summarizer-extension/
├── manifest.json      # Chrome extension manifest (v3)
├── background.js      # Service worker - API calls, history management, prompt building
├── content.js         # Content script - Jira page scraping with multiple strategies
├── content.css        # Minimal content styles
├── popup.html         # Extension popup UI
├── popup.js           # Popup logic - tabs, rendering, export, dark mode
├── popup.css          # Popup styles with dark mode support
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## How It Works

1. **Content script** (`content.js`) is injected into Jira Cloud pages and scrapes issue data using multiple DOM selector strategies for compatibility across Jira layouts
2. **Popup** (`popup.js`) triggers the scrape and sends extracted data to the background service worker
3. **Background** (`background.js`) constructs a structured prompt with status breakdowns, assignee workload, story points, and blockers, then sends it to the selected LLM via OpenRouter
4. The AI returns a structured JSON response which is rendered as a rich executive dashboard in the popup

## Privacy

- Your OpenRouter API key is stored locally in Chrome's sync storage
- Summary history is stored locally in Chrome's local storage
- No data is sent anywhere except to OpenRouter's API for AI summarization
- The extension only activates on `*.atlassian.net` domains

## Author

**Sujit Kumar Thakur**

## License

MIT
