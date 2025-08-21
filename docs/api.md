# Browser CC Proxy API Documentation

## Tool Reference

### cdp_list_targets

Lists available CDP targets (browser tabs).

**Parameters:**
```typescript
{
  host?: string              // CDP host (default: "127.0.0.1")
  port?: number              // CDP port (default: 9222)
  filterUrlIncludes?: string // Filter by URL pattern
  types?: string[]           // Filter by tab type ["page", "webview", "iframe", "worker"]
}
```

**Response:**
```json
{
  "targets": [
    {
      "id": "E1234567890ABCDEF",
      "type": "page",
      "title": "Example Page",
      "url": "https://example.com",
      "attached": false
    }
  ]
}
```

### cdp_observe

Starts observing Console and Network events for a target.

**Parameters:**
```typescript
{
  host?: string            // CDP host (default: "127.0.0.1")
  port?: number            // CDP port (default: 9222)
  targetId?: string        // Target ID (one required)
  urlIncludes?: string     // URL pattern (one required)
  includeWorkers?: boolean // Include Worker events (default: true)
  includeIframes?: boolean // Include iframe events (default: true)
  bufferSize?: number      // Event buffer size (default: 10000)
  ttlSec?: number          // Session TTL seconds (default: 3600)
}
```

**Response:**
```json
{
  "targetId": "E1234567890ABCDEF",
  "resourceUri": "cdp://events/E1234567890ABCDEF",
  "attached": true
}
```

### cdp_read_events

Reads and filters events from the buffer.

**Parameters:**
```typescript
{
  targetId: string         // Required: Target ID
  offset?: number          // Start position (default: 0)
  limit?: number           // Max results (default: 200)
  kinds?: string[]         // Event types: "console", "log", "request", "response",
                          // "loadingFinished", "loadingFailed", "websocket", "other"
  urlIncludes?: string     // URL pattern filter
  method?: string          // HTTP method filter (GET/POST/PUT/DELETE)
  types?: string[]         // Console types: "error", "warn", "log", "info", "debug"
  textIncludes?: string    // Search in event text
  reverse?: boolean        // Latest events first (default: false)
}
```

**Response:**
```json
{
  "nextOffset": 150,
  "events": [
    {
      "seq": 100,
      "ts": 1700000000000,
      "targetId": "E1234567890ABCDEF",
      "kind": "console",
      "type": "error",
      "text": "TypeError: Cannot read property 'foo' of undefined",
      "stack": {...}
    }
  ]
}
```

### cdp_get_response_body

Retrieves the response body for a network request.

**Parameters:**
```typescript
{
  targetId: string        // Required: Target ID
  requestId: string       // Required: Request ID from cdp_read_events
  base64?: boolean        // Return as Base64 (default: false)
}
```

**Response:**
```json
{
  "requestId": "12345.67",
  "mimeType": "application/json",
  "encoded": false,
  "body": "{\"status\":\"ok\",\"data\":[...]}"
}
```

### cdp_reload

Reloads the page in the observed tab.

**Parameters:**
```typescript
{
  targetId: string        // Required: Target ID
  ignoreCache?: boolean   // Hard reload (default: false)
}
```

### cdp_navigate

Navigates the tab to a new URL.

**Parameters:**
```typescript
{
  targetId: string        // Required: Target ID
  url: string             // Required: Full URL with protocol
}
```

### cdp_execute_script

Executes JavaScript in the observed tab.

**Parameters:**
```typescript
{
  targetId: string        // Required: Target ID
  expression: string      // Required: JavaScript code
  awaitPromise?: boolean  // Wait for Promise (default: false)
}
```

## Event Structure

### Common Fields

All events include:
```json
{
  "seq": 123,
  "ts": 1711111111111,
  "targetId": "<id>",
  "sessionId": "<cdp-session-id>",
  "kind": "console|log|request|response|..."
}
```

### Console Events
```json
{
  "kind": "console",
  "type": "log|warn|error|info|debug",
  "text": "message",
  "args": ["arg1", "arg2"],
  "stack": { "url": "...", "line": 123, "column": 4 }
}
```

### Network Events
```json
{
  "kind": "request",
  "requestId": "<id>",
  "url": "https://...",
  "method": "GET",
  "headers": {...},
  "postDataPreview": "...",
  "initiator": "parser|script|other"
}
```

## MCP Resources

### cdp://events/{targetId}

- **GET**: Returns the latest 200 events
- **Subscribe**: Receive notifications on event updates