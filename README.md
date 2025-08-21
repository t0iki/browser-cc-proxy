# Browser CC Proxy - Chrome DevTools Protocol Observer for MCP

A Model Context Protocol (MCP) server that observes and analyzes browser Console and Network events through Chrome DevTools Protocol (CDP). Perfect for debugging web applications, monitoring API calls, and automating browser interactions.

## Key Features

- 🔍 **Real-time Browser Monitoring**: Capture Console logs and Network events from any Chrome/Chromium tab
- 🛠️ **Rich MCP Tool Suite**: 11 tools for observation, filtering, and browser control
- 🎯 **Smart Filtering**: Advanced event filtering by type, URL pattern, HTTP method
- 🔄 **Browser Automation**: Reload pages, navigate URLs, and execute JavaScript remotely
- 🔒 **Secure by Default**: Localhost-only connections with configurable security settings
- 📊 **Efficient Buffer Management**: Ring buffer architecture for optimal memory usage

## Requirements

- Node.js 18 or higher
- Chrome/Chromium browser with remote debugging enabled
- MCP-compatible client (e.g., Claude Code, Cline)

## Installation

```bash
npm install
npm run build
```

## Quick Start

### 1. Start Browser with Remote Debugging

#### Arc Browser (macOS)

**Add to ~/.zshrc for convenience:**
```bash
alias arc-debug='/Applications/Arc.app/Contents/MacOS/Arc --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir=/tmp/arc-debug --no-first-run --no-default-browser-check'
```

After adding, run `source ~/.zshrc` and use `arc-debug` to start.

**Direct command:**
```bash
/Applications/Arc.app/Contents/MacOS/Arc \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/arc-debug \
  --no-first-run \
  --no-default-browser-check
```

#### Google Chrome
```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug \
  --no-first-run \
  --no-default-browser-check

# Windows
chrome.exe --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222
```

### 2. Configure MCP Client

Add to your MCP client configuration (e.g., `.mcp.json` for Claude Code):

```json
{
  "mcpServers": {
    "cdp-observer": {
      "command": "node",
      "args": ["/path/to/cdp-observer/dist/index.js"],
      "env": {
        "CDP_HOST": "127.0.0.1",
        "CDP_PORT": "9222",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

## Available MCP Tools

### Core Observation Tools

| Tool | Description | Use Case |
|---------|------|----------|
| `cdp_list_targets` | List available browser tabs | Find debug targets |
| `cdp_observe` | Start observing a target | Begin event recording |
| `cdp_read_events` | Read and filter buffered events | Search errors/responses |
| `cdp_clear_events` | Clear event buffer | Reset buffer |
| `cdp_get_response_body` | Get network response body | Inspect API responses |
| `cdp_set_filters` | Configure observation filters | Exclude unwanted events |
| `cdp_get_filters` | Get current filter settings | Check configuration |
| `cdp_stop_observe` | Stop observation | Release resources |

### Browser Control Tools

| Tool | Description | Use Case |
|---------|------|----------|
| `cdp_reload` | Reload the page | Refresh during debugging |
| `cdp_navigate` | Navigate to URL | Automate page transitions |
| `cdp_execute_script` | Execute JavaScript | Run browser operations |

## Tool Documentation

<details>
<summary>📖 Click to expand detailed tool documentation</summary>

### cdp_list_targets
Lists available CDP targets (browser tabs).

### cdp_observe  
Starts observing Console and Network events for a target.

### cdp_read_events
Reads and filters events from the buffer. Supports filtering by:
- Event kinds: `console`, `log`, `request`, `response`, `loadingFinished`, `loadingFailed`
- URL patterns, HTTP methods
- Pagination with offset/limit

### cdp_get_response_body
Retrieves the response body for a specific network request.

### cdp_reload / cdp_navigate / cdp_execute_script
Browser control tools for reloading pages, navigating to URLs, and executing JavaScript.

For full parameter details and examples, see the [API documentation](./docs/api.md).

</details>

## Usage Examples

### 🔍 Debug Console Errors

```javascript
// Start observing your app
const { targetId } = await cdp_observe({ urlIncludes: "myapp.com" });

// Read console errors
const { events } = await cdp_read_events({
  targetId,
  kinds: ["console"],
  types: ["error"]
});
```

### 📡 Monitor API Calls

```javascript
// Observe network traffic
const { targetId } = await cdp_observe({ urlIncludes: "localhost:3000" });

// Filter API responses
const { events } = await cdp_read_events({
  targetId,
  kinds: ["response"],
  urlIncludes: "/api/"
});

// Get response body for failed requests
const failed = events.find(e => e.status >= 400);
if (failed) {
  const body = await cdp_get_response_body({
    targetId,
    requestId: failed.requestId
  });
}
```

### 🤖 Automate Browser Actions

```javascript
// Control the browser
await cdp_reload({ targetId, ignoreCache: true });
await cdp_navigate({ targetId, url: "https://example.com" });
await cdp_execute_script({
  targetId,
  expression: "document.querySelector('button').click()"
});
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CDP_HOST` | 127.0.0.1 | CDP host address |
| `CDP_PORT` | 9222 | CDP port number |
| `CDP_SECURITY_LOCALONLY` | true | Restrict to localhost |
| `LOG_LEVEL` | info | Logging level |

### Security

- ✅ Localhost-only connections by default
- ✅ Response body size limits (configurable)
- ✅ No external network access from the server

## Development

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Development mode with watch
npm run dev

# Run tests
npm test
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT