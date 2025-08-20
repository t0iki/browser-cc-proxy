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

## MCPツール

### cdp_list_targets
利用可能なCDPターゲット（ブラウザタブ）を一覧表示

```typescript
{
  host?: string,            // default: "127.0.0.1"
  port?: number,            // default: 9222
  filterUrlIncludes?: string,  // URLでフィルタリング
  types?: string[]          // タブタイプでフィルタ e.g., ["page", "webview"]
}
```

### cdp_observe
指定ターゲットの観測を開始

```typescript
{
  host?: string,            // default: "127.0.0.1"
  port?: number,            // default: 9222
  targetId?: string,        // ターゲットID（targetIdかurlIncludesのいずれかが必須）
  urlIncludes?: string,     // URLパターン（targetIdかurlIncludesのいずれかが必須）
  includeWorkers?: boolean, // default: true
  includeIframes?: boolean, // default: true
  bufferSize?: number,      // イベントバッファサイズ
  ttlSec?: number          // セッションTTL（秒）
}
```

### cdp_read_events
バッファからイベントを取得

```typescript
{
  targetId: string,         // 必須：対象のターゲットID
  offset?: number,          // default: 0 - 読み取り開始位置
  limit?: number,           // default: 200 - 最大取得件数
  kinds?: string[],         // イベント種別でフィルタ: "console", "log", "request", "response", "loadingFinished", "loadingFailed", "websocket", "other"
  urlIncludes?: string,     // URLパターンでフィルタ
  method?: string          // HTTPメソッドでフィルタ（GET/POST等）
}
```

### cdp_get_response_body
ネットワークレスポンスの本文を取得

```typescript
{
  targetId: string,         // 必須：対象のターゲットID
  requestId: string,        // 必須：リクエストID
  base64?: boolean         // default: false - Base64エンコードで返すか
}
```

### cdp_set_filters
観測フィルターの設定

```typescript
{
  targetId: string,                    // 必須：対象のターゲットID
  kinds?: string[],                    // イベント種別: "console", "log", "network"
  urlAllowlist?: string[],             // 許可するURLパターン
  urlBlocklist?: string[],             // ブロックするURLパターン
  maxBodyBytes?: number                // レスポンスボディの最大サイズ
}
```

### cdp_get_filters
現在のフィルター設定を取得

```typescript
{
  targetId: string         // 必須：対象のターゲットID
}
```

### cdp_stop_observe
観測の停止

```typescript
{
  targetId: string,        // 必須：対象のターゲットID
  dropBuffer?: boolean     // default: false - バッファを削除するか
}
```

### cdp_clear_events
イベントバッファのクリア

```typescript
{
  targetId: string         // 必須：対象のターゲットID
}
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