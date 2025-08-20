# CDP Observer - MCP CDP Log Observer Server

Chrome DevTools Protocol (CDP) に接続し、ブラウザのConsoleとNetworkイベントを観測・配信するMCPサーバーです。

## 機能

- Chromeブラウザのタブ（Target）ごとにConsole/Networkイベントを観測
- MCPツールによるイベントの取得とフィルタリング
- MCPリソースによるリアルタイム更新通知（subscribe）
- リングバッファによる効率的なイベント管理
- セキュリティ設定（ローカルホスト限定接続）

## 必要要件

- Node.js 18以上
- Chrome/Chromiumブラウザ（デバッグポート有効）
- Claude Code または他のMCPクライアント

## インストール

```bash
npm install
npm run build
```

## 使用方法

### 1. ブラウザをデバッグモードで起動

#### Arc Browser (macOS)

**エイリアス設定（~/.zshrcに追加）:**
```bash
alias arc-debug='/Applications/Arc.app/Contents/MacOS/Arc --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir=/tmp/arc-debug --no-first-run --no-default-browser-check'
```

設定後、`source ~/.zshrc`で反映し、`arc-debug`で起動できます。

**直接実行:**
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

### 2. MCPサーバーを起動

```bash
npm start
```

### 3. Claude Codeに登録

`.mcp.json`ファイルをプロジェクトルートに配置：

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

## MCPツール一覧

CDP Observer MCPサーバーは、以下の11つのツールを提供します：

### 基本ツール

| ツール名 | 説明 | 主な用途 |
|---------|------|----------|
| `cdp_list_targets` | 利用可能なCDPターゲット（ブラウザタブ）を一覧表示 | デバッグ対象のタブを探す |
| `cdp_observe` | 指定ターゲットの観測を開始 | ログとネットワークイベントの記録開始 |
| `cdp_read_events` | バッファからイベントを取得・フィルタリング | エラーやAPIレスポンスの検索 |
| `cdp_clear_events` | イベントバッファをクリア | バッファのリセット |
| `cdp_get_response_body` | ネットワークレスポンスの本文を取得 | API応答の詳細確認 |
| `cdp_set_filters` | 観測フィルターを設定 | 不要なイベントの除外 |
| `cdp_get_filters` | 現在のフィルター設定を取得 | 設定確認 |
| `cdp_stop_observe` | 観測を停止 | リソースの解放 |

### ブラウザ操作ツール（mcp-server.js実装）

| ツール名 | 説明 | 主な用途 |
|---------|------|----------|
| `cdp_reload` | ページをリロード | デバッグ中の再読み込み |
| `cdp_navigate` | 指定URLへナビゲーション | ページ遷移の自動化 |
| `cdp_execute_script` | JavaScriptコードを実行 | ブラウザ内での操作実行 |

### 1. cdp_list_targets

**説明**: 利用可能なCDPターゲット（ブラウザタブ）を一覧表示します。

**パラメータ**:
```typescript
{
  host?: string,              // CDPホスト (default: "127.0.0.1")
  port?: number,              // CDPポート (default: 9222)
  filterUrlIncludes?: string, // URLパターンでフィルタリング
  types?: string[]           // タブタイプでフィルタ ["page", "webview", "iframe", "worker"]
}
```

**レスポンス例**:
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

### 2. cdp_observe

**説明**: 指定したターゲット（タブ）のConsoleとNetworkイベントの観測を開始します。

**パラメータ**:
```typescript
{
  host?: string,            // CDPホスト (default: "127.0.0.1")
  port?: number,            // CDPポート (default: 9222)
  targetId?: string,        // ターゲットID（いずれか必須）
  urlIncludes?: string,     // URLパターン（いずれか必須）
  includeWorkers?: boolean, // Workerイベントも含む (default: true)
  includeIframes?: boolean, // iframeイベントも含む (default: true)
  bufferSize?: number,      // イベントバッファサイズ (default: 10000)
  ttlSec?: number          // セッションTTL秒 (default: 3600)
}
```

**レスポンス例**:
```json
{
  "targetId": "E1234567890ABCDEF",
  "resourceUri": "cdp://events/E1234567890ABCDEF",
  "attached": true
}
```

### 3. cdp_read_events

**説明**: バッファに蓄積されたイベントを取得・フィルタリングします。

**パラメータ**:
```typescript
{
  targetId: string,         // 必須：対象のターゲットID
  offset?: number,          // 読み取り開始位置 (default: 0)
  limit?: number,           // 最大取得件数 (default: 200)
  kinds?: string[],         // イベント種別フィルタ:
                           // "console", "log", "request", "response",
                           // "loadingFinished", "loadingFailed", "websocket", "other"
  urlIncludes?: string,     // URLパターンフィルタ
  method?: string          // HTTPメソッドフィルタ (GET/POST/PUT/DELETE等)
}
```

**レスポンス例**:
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
    },
    {
      "seq": 101,
      "ts": 1700000001000,
      "kind": "request",
      "requestId": "12345.67",
      "url": "https://api.example.com/data",
      "method": "GET"
    }
  ]
}
```

### 4. cdp_clear_events

**説明**: 指定ターゲットのイベントバッファをクリアします。

**パラメータ**:
```typescript
{
  targetId: string         // 必須：対象のターゲットID
}
```

**レスポンス例**:
```json
{
  "cleared": true
}
```

### 5. cdp_get_response_body

**説明**: ネットワークレスポンスの本文を取得します。

**パラメータ**:
```typescript
{
  targetId: string,        // 必須：対象のターゲットID
  requestId: string,       // 必須：リクエストID (cdp_read_eventsで取得)
  base64?: boolean        // Base64エンコードで返す (default: false)
}
```

**レスポンス例**:
```json
{
  "requestId": "12345.67",
  "mimeType": "application/json",
  "encoded": false,
  "body": "{\"status\":\"ok\",\"data\":[...]}"
}
```

### 6. cdp_set_filters

**説明**: イベント観測時のフィルターを設定します。

**パラメータ**:
```typescript
{
  targetId: string,         // 必須：対象のターゲットID
  kinds?: string[],         // 収集するイベント種別 ["console", "log", "network"]
  urlAllowlist?: string[],  // 許可するURLパターンリスト
  urlBlocklist?: string[],  // ブロックするURLパターンリスト
  maxBodyBytes?: number    // レスポンスボディの最大サイズ (default: 64000)
}
```

**レスポンス例**:
```json
{
  "updated": true
}
```

### 7. cdp_get_filters

**説明**: 現在設定されているフィルターを取得します。

**パラメータ**:
```typescript
{
  targetId: string         // 必須：対象のターゲットID
}
```

**レスポンス例**:
```json
{
  "filters": {
    "kinds": ["console", "network"],
    "urlAllowlist": [],
    "urlBlocklist": ["*.google-analytics.com/*"],
    "maxBodyBytes": 64000
  }
}
```

### 8. cdp_stop_observe

**説明**: ターゲットの観測を停止し、リソースを解放します。

**パラメータ**:
```typescript
{
  targetId: string,        // 必須：対象のターゲットID
  dropBuffer?: boolean    // バッファも削除する (default: false)
}
```

**レスポンス例**:
```json
{
  "stopped": true
}
```

### 9. cdp_reload（mcp-server.js実装）

**説明**: 観測中のタブのページをリロードします。

**パラメータ**:
```typescript
{
  targetId: string,        // 必須：対象のターゲットID
  ignoreCache?: boolean   // キャッシュを無視してリロード (default: false)
}
```

**レスポンス例**:
```json
{
  "success": true,
  "targetId": "E1234567890ABCDEF",
  "ignoreCache": true,
  "message": "Page reloaded (cache ignored)"
}
```

### 10. cdp_navigate（mcp-server.js実装）

**説明**: 観測中のタブを指定URLへナビゲートします。

**パラメータ**:
```typescript
{
  targetId: string,        // 必須：対象のターゲットID
  url: string             // 必須：遷移先URL（プロトコル含む）
}
```

**レスポンス例**:
```json
{
  "success": true,
  "targetId": "E1234567890ABCDEF",
  "url": "https://example.com",
  "frameId": "F1234567890ABCDEF",
  "loaderId": "L1234567890ABCDEF"
}
```

### 11. cdp_execute_script（mcp-server.js実装）

**説明**: 観測中のタブでJavaScriptコードを実行します。

**パラメータ**:
```typescript
{
  targetId: string,        // 必須：対象のターゲットID
  expression: string,      // 必須：実行するJavaScriptコード
  awaitPromise?: boolean  // Promiseの解決を待つ (default: false)
}
```

**レスポンス例**:
```json
{
  "success": true,
  "targetId": "E1234567890ABCDEF",
  "result": "Hello World",
  "type": "string"
}
```

## 使用例

### エラーデバッグの例

```javascript
// 1. 対象タブを探す
const targets = await cdp_list_targets({ filterUrlIncludes: "myapp.com" });

// 2. 観測を開始
const { targetId } = await cdp_observe({ urlIncludes: "myapp.com" });

// 3. エラーを検索
const { events } = await cdp_read_events({
  targetId,
  kinds: ["console"],
  limit: 10
});

// 4. エラーの詳細を確認
const errors = events.filter(e => e.type === "error");
console.log(errors);
```

### API監視の例

```javascript
// 1. API通信を観測
const { targetId } = await cdp_observe({ urlIncludes: "api.example.com" });

// 2. APIレスポンスを取得
const { events } = await cdp_read_events({
  targetId,
  kinds: ["response"],
  urlIncludes: "/api/"
});

// 3. エラーレスポンスの本文を取得
const errorResponse = events.find(e => e.status >= 400);
if (errorResponse) {
  const body = await cdp_get_response_body({
    targetId,
    requestId: errorResponse.requestId
  });
  console.log(JSON.parse(body.body));
}
```

### ブラウザ操作の例（mcp-server.js実装）

```javascript
// 1. デバッグ対象ページを開く
const { targetId } = await cdp_observe({ urlIncludes: "localhost:3000" });

// 2. ページをハードリロード
await cdp_reload({ targetId, ignoreCache: true });

// 3. JavaScript実行でボタンクリック
await cdp_execute_script({
  targetId,
  expression: "document.querySelector('#submit-button').click()"
});

// 4. 別ページへ遷移
await cdp_navigate({
  targetId,
  url: "https://localhost:3000/debug"
});

// 5. Promiseベースのコード実行
const result = await cdp_execute_script({
  targetId,
  expression: "fetch('/api/data').then(r => r.json())",
  awaitPromise: true
});
console.log(result.result); // APIレスポンスデータ
```

## MCPリソース

### cdp://events/{targetId}
- GET: 最新200件のイベントを取得
- Subscribe: イベント更新時に通知を受信

## 環境変数

| 変数名 | デフォルト値 | 説明 |
|--------|------------|------|
| CDP_HOST | 127.0.0.1 | CDPホスト |
| CDP_PORT | 9222 | CDPポート |
| CDP_SECURITY_LOCALONLY | true | ローカルホスト限定 |
| LOG_LEVEL | info | ログレベル |
| DEFAULT_BUFFER_SIZE | 10000 | バッファサイズ |
| DEFAULT_TTL_SEC | 3600 | TTL（秒） |

## 正規化イベント構造

すべてのイベントに共通フィールド：
```json
{
  "seq": 123,
  "ts": 1711111111111,
  "targetId": "<id>",
  "sessionId": "<cdp-session-id>",
  "kind": "console|log|request|response|..."
}
```

### Console/Logイベント
```json
{
  "kind": "console",
  "type": "log|warn|error|info|debug",
  "text": "message",
  "args": ["arg1", "arg2"],
  "stack": { "url": "...", "line": 123, "column": 4 }
}
```

### Networkイベント
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

## セキュリティ

- デフォルトでローカルホスト（127.0.0.1）接続のみ許可
- 0.0.0.0への接続はセキュリティポリシーにより拒否
- レスポンスボディは64KBまでに制限（設定可能）

## 開発

```bash
# 開発モード
npm run dev

# ビルド
npm run build

# テスト
npm test
```

## ライセンス

MIT