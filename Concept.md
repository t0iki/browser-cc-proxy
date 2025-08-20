# MCP × CDP ログ観測サーバ 仕様書（Claude Code 実装用）

**目的**
- Chrome DevTools Protocol(CDP) に接続し、特定タブ（Target）の **Console** と **Network** イベントを外部プロセスから取得。
- 取得したイベントを **MCP（Model Context Protocol）サーバ** として公開し、コーディングエージェント（Claude Code など）から **tool 呼び出し** と **resource 購読** で利用可能にする。
- 実装は **TypeScript/Node.js** 前提。SDK は `@modelcontextprotocol/sdk` を使用。

---

## 1. 全体像

```
[Browser: Chrome with --remote-debugging-port]
         ↑ WebSocket (CDP)
[cdp-observer (MCP Server / Node)]
  ├─ Tools: list_targets / observe / stop_observe / read_events / clear / get_body / set_filters / get_filters
  ├─ Resources: cdp://events/{targetId} (subscribe 可)
  └─ In-memory ring buffer (per target)
         ↑ stdio (MCP)
[Client: Claude Code / other MCP client]
```

- **観測単位**: CDP Target（通常はブラウザタブ）。OOPIF/Worker を拾うため `Target.setAutoAttach(flatten: true)` を既定で有効化。
- **配送モデル**:
  - **Pull**: tool `read_events` で直近 N 件を取得。
  - **Push**: resource `cdp://events/{targetId}` を **subscribe** すると、更新ごとに通知。クライアントは再取得で差分を読む。

---

## 2. 主要仕様

### 2.1 実装言語・依存
- Node.js 18+
- TypeScript 5+
- 依存パッケージ: `@modelcontextprotocol/sdk`, `chrome-remote-interface`, `zod`, `pino`（任意: ログ）, `yargs`（任意: CLI）, `uuid`（任意）

### 2.2 プロセス起動・接続前提
- ブラウザは **デバッグポート** で起動済みであること（例: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=9222`）。
- MCP サーバは環境変数または tool 入力で **host/port** を指定可能。
- セキュリティ: `--remote-debugging-address=127.0.0.1` を強制推奨。0.0.0.0 は禁止（本実装では接続拒否できる設定を持つ）。

### 2.3 フォルダ構成（提案）
```
/ (repo root)
  ├─ src/
  │   ├─ index.ts                 # MCP サーバ起動
  │   ├─ config.ts                # 設定読取（env/CLI）
  │   ├─ mcp/
  │   │   ├─ tools.ts             # tool 実装登録
  │   │   ├─ resources.ts         # resource 実装登録
  │   │   └─ schemas.ts           # zod/JSON Schema
  │   ├─ cdp/
  │   │   ├─ connect.ts           # CDP 接続と AutoAttach 管理
  │   │   ├─ normalize.ts         # CDP → 正規化イベント
  │   │   └─ types.ts             # CDP 関連型
  │   ├─ store/
  │   │   ├─ ringBuffer.ts        # 固定長リングバッファ
  │   │   └─ sessions.ts          # 観測セッション管理
  │   └─ utils/
  │       └─ time.ts, error.ts, ...
  ├─ package.json
  ├─ tsconfig.json
  ├─ mcp.json                     # Claude Code 用設定例
  └─ README.md
```

---

## 3. MCP: Tools / Resources 仕様

### 3.1 共通
- すべての返却は **UTF-8 JSON テキスト** を基本とする。
- 失敗時は `error.code` と `error.message` を含む標準化レスポンスを返す（後述 7. エラー仕様）。
- host/port の既定値: `127.0.0.1:9222`。tool 入力が未指定の場合は config/env を使用。

### 3.2 Tools 定義

#### 3.2.1 `cdp_list_targets`
- **目的**: 接続先ブラウザの Target 一覧取得。
- **input** (zod):
  ```ts
  {
    host?: string = '127.0.0.1',
    port?: number = 9222,
    filterUrlIncludes?: string,   // 部分一致フィルタ（任意）
    types?: string[]              // 例: ['page','webview'] 指定なければ全件
  }
  ```
- **output**:
  ```json
  {
    "targets": [
      {
        "id": "<targetId>",
        "type": "page",
        "title": "<title>",
        "url": "https://...",
        "attached": false
      }
    ]
  }
  ```

#### 3.2.2 `cdp_observe`
- **目的**: 指定 Target の観測開始（Console/Network を購読し、イベントを内部バッファへ蓄積）。
- **input**:
  ```ts
  {
    host?: string,
    port?: number,
    targetId?: string,           // いずれか必須
    urlIncludes?: string,        // いずれか必須（先勝ち: targetId → urlIncludes の順で解決）

    includeWorkers?: boolean = true,
    includeIframes?: boolean = true,   // flatten=true 相当

    // バッファ設定（未指定は既定使用）
    bufferSize?: number,         // 既定 10000 イベント/Target
    ttlSec?: number              // 既定 3600 秒（最終追加からの期限）
  }
  ```
- **output**:
  ```json
  {
    "targetId": "<resolved targetId>",
    "resourceUri": "cdp://events/<targetId>",
    "attached": true
  }
  ```
- **副作用**: `cdp://events/{targetId}` リソースが有効化される。

#### 3.2.3 `cdp_stop_observe`
- **目的**: 観測停止（CDP セッション切断、バッファは既定で保持継続可）。
- **input**:
  ```ts
  { targetId: string, dropBuffer?: boolean = false }
  ```
- **output**:
  ```json
  { "stopped": true }
  ```

#### 3.2.4 `cdp_read_events`
- **目的**: バッファからイベントを取得（Pull）。
- **input**:
  ```ts
  {
    targetId: string,
    offset?: number = 0,        // 0 起点のシーケンス番号
    limit?: number = 200,       // 上限
    kinds?: ("console"|"log"|"request"|"response"|"loadingFinished"|"loadingFailed"|"websocket"|"other")[],
    urlIncludes?: string,       // 正規化イベントの url に対する部分一致フィルタ
    method?: string             // GET/POST など（Network 系のみ）
  }
  ```
- **output**:
  ```json
  {
    "nextOffset": 1234,
    "events": [ { /* 正規化イベント */ } ]
  }
  ```

#### 3.2.5 `cdp_clear_events`
- **目的**: バッファ削除。
- **input**: `{ targetId: string }`
- **output**: `{ cleared: true }`

#### 3.2.6 `cdp_get_response_body`
- **目的**: Network `requestId` に対応するレスポンス本文を取得。
- **input**:
  ```ts
  { targetId: string, requestId: string, base64?: boolean = false }
  ```
- **output**:
  ```json
  {
    "requestId": "...",
    "mimeType": "application/json",
    "encoded": false,
    "body": "..."  // encoded=true の場合は Base64
  }
  ```
- **備考**: CDP 側制約で取得不可のケースがある（大容量/ストリーム/一部のプロトコル）。その場合は `error.code = "BODY_NOT_AVAILABLE"`。

#### 3.2.7 `cdp_set_filters`
- **目的**: 観測時の **サーバ側フィルタ** を設定（バッファに積む前段での絞り込み）。
- **input**:
  ```ts
  {
    targetId: string,
    kinds?: ("console"|"log"|"network")[],   // 未指定は全許可
    urlAllowlist?: string[],                    // 部分一致 OR パターン（実装は includes の配列）
    urlBlocklist?: string[],
    maxBodyBytes?: number                       // 既定 64_000（超過は切り詰め）
  }
  ```
- **output**: `{ updated: true }`

#### 3.2.8 `cdp_get_filters`
- **目的**: 現在のフィルタ設定取得。
- **input**: `{ targetId: string }`
- **output**: `{
  "filters": { kinds: [...], urlAllowlist: [...], urlBlocklist: [...], maxBodyBytes: 64000 }
}`


### 3.3 Resources 定義

#### 3.3.1 `cdp://events/{targetId}`
- **GET**: 現在の末尾 200 件（デフォルト）を返す。`read_events` と同等形式。
- **Subscribe**: バッファ更新のたびに **updated 通知** を送る。クライアントは GET 相当で再取得して追従。
- **Content**: `mimeType = application/json`、本文は `{"nextOffset": n, "events": [...]}`。

---

## 4. 正規化イベント構造

CDP のイベントを **最小限かつ実用重視**で正規化。すべてに下記共通フィールドを付与。

```json
{
  "seq": 123,                  // バッファ内の単調増加番号（offset 指定に使用）
  "ts": 1711111111111,        // epoch ms（サーバ受領時）
  "targetId": "<id>",
  "sessionId": "<cdp-session-id>",
  "kind": "console" | "log" | "request" | "response" | "loadingFinished" | "loadingFailed" | "websocket" | "other"
}
```

### 4.1 Console/Log
```json
{
  "kind": "console",
  "type": "log|warn|error|info|debug|trace",
  "text": "string",
  "args": ["stringified arg1", "..."],
  "stack": { "url": "...", "line": 123, "column": 4 } | null
}
```

### 4.2 Network（HTTP/S）
- `requestWillBeSent` → `kind: "request"`
- `responseReceived` → `kind: "response"`
- `loadingFinished` → `kind: "loadingFinished"`
- `loadingFailed` → `kind: "loadingFailed"`

```json
{
  "kind": "request",
  "requestId": "<cdp requestId>",
  "url": "https://...",
  "method": "GET",
  "headers": {"k":"v"},
  "postDataPreview": "first N bytes | null",
  "initiator": "parser|script|other"
}
```
```json
{
  "kind": "response",
  "requestId": "...",
  "url": "https://...",
  "status": 200,
  "statusText": "OK",
  "mimeType": "application/json",
  "fromDiskCache": false,
  "fromServiceWorker": false,
  "remoteAddress": "93.184.216.34:443",
  "timing": { "receiveHeadersEnd": 123.45 }
}
```
```json
{
  "kind": "loadingFinished",
  "requestId": "...",
  "encodedDataLength": 12345
}
```
```json
{
  "kind": "loadingFailed",
  "requestId": "...",
  "errorText": "net::ERR_TIMED_OUT",
  "canceled": false
}
```

### 4.3 WebSocket（任意）
- 需要があれば `Network.webSocketCreated/FrameSent/FrameReceived/Closed` も `kind: "websocket"` でまとめ、`direction: "sent|recv"`, `opcode`, `payloadPreview` を格納。

---

## 5. バッファ仕様（Ring Buffer）
- **単位**: Target ごとに 1 インスタンス。
- **容量**: 既定 `bufferSize=10000`。超過時は古い順にドロップ。
- **TTL**: 既定 `ttlSec=3600`。最後の追加から TTL 経過で自動破棄（`sessions` 管理で GC）。
- **オフセット**: `seq` は 0 起点単調増加。`read_events(offset, limit)` で範囲取得。

---

## 6. 観測セッション管理
- `observe` 実行時に **CDP クライアント**を生成し、以下を enable:
  - `Runtime.enable()`, `Log.enable()`, `Network.enable({})`
  - `Target.setAutoAttach({ autoAttach: true, flatten: true, waitForDebuggerOnStart: false })`
- 各 CDP イベントを `normalize.ts` で正規化 → フィルタ適用 → バッファ push。
- `stop_observe` で CDP 接続を安全に close。

---

## 7. エラー仕様
- 返却は以下の標準形を推奨:
```json
{
  "error": {
    "code": "<UPPER_SNAKE>",
    "message": "human readable message",
    "details": { "hint": "...", "cause": "..." }
  }
}
```
- 想定コード:
  - `BROWSER_UNREACHABLE` (host/port 未到達)
  - `TARGET_NOT_FOUND`
  - `ALREADY_OBSERVING` / `NOT_OBSERVING`
  - `BODY_NOT_AVAILABLE`
  - `INVALID_INPUT`
  - `SECURITY_BLOCKED`（0.0.0.0 等を拒否）
  - `INTERNAL_ERROR`

---

## 8. 設定（Config）
- 環境変数:
  - `CDP_HOST` (default `127.0.0.1`)
  - `CDP_PORT` (default `9222`)
  - `CDP_SECURITY_LOCALONLY` (default `true`)  // true の場合、0.0.0.0 宛て接続を拒否
  - `LOG_LEVEL` (default `info`)
  - `DEFAULT_BUFFER_SIZE` (default `10000`)
  - `DEFAULT_TTL_SEC` (default `3600`)
- CLI（任意）:
  - `--host`, `--port`, `--buffer-size`, `--ttl-sec`, `--no-localonly`

---

## 9. Claude Code への登録例（`mcp.json`）
```json
{
  "mcpServers": {
    "cdp-observer": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "CDP_HOST": "127.0.0.1",
        "CDP_PORT": "9222",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

---

## 10. 実装タスク（粒度）
1) **types/schemas**
   - zod で input/output を定義し `jsonSchema()` を公開（MCP ツール登録に使用）。
2) **ringBuffer**
   - O(1) push/pop、`sliceByOffset(offset, limit)`、`size()`、`gc(ttl)` を実装。
3) **CDP 接続**
   - `connect({host,port,target})` で `chrome-remote-interface` を使い、enable 群を実行。
   - `onConsole/Log/Network...` を購読し `normalize()` に流す。
4) **normalize**
   - Console/Log/Network を前述スキーマに変換。巨大 body/args は `maxBodyBytes` で切り詰め。
5) **filters**
   - Allow/Blocklist, kinds, メソッド、URL includes を実装。先に Block → 次に Allow を評価。
6) **sessions**
   - `Map<targetId, Session>` を保持。Session は `client`, `buffer`, `filters`, `lastAt`。
7) **MCP server**
   - tools を登録、resources を `ResourceTemplate('cdp://events/{targetId}')` で定義。
   - subscribe 時に `server.notifyResourceUpdated(uri)`（SDK の実装に合わせた通知）を呼ぶ。
8) **get_response_body**
   - `Network.getResponseBody({requestId})` を呼び、Base64 返却に対応。
9) **logging**
   - pino で info/debug/error。PII/機密は記録しない。
10) **tests**
   - vitest でユニット（normalize/filter/buffer）。
   - e2e: テストページを開き `console.log` と `fetch` を実行 → `read_events` が拾えることを確認。

---

## 11. 開発・ビルド

**package.json（抜粋）**
```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc -p .",
    "start": "node dist/index.js",
    "test": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.1.0",
    "chrome-remote-interface": "^0.32.0",
    "zod": "^3.23.0",
    "pino": "^9.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.7.0",
    "vitest": "^2.0.0"
  }
}
```

---

## 12. 使い方（E2E 手順）

1) **Chrome を起動**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug --no-first-run --no-default-browser-check
```
2) **MCP サーバを起動**
```bash
npm run start
```
3) **Claude Code 側で mcp.json を配置 → IDE 再読込**
4) **ツール呼び出し例**
   - `cdp_list_targets` → `id` を取る
   - `cdp_observe({ targetId: "-abc" })` → `resourceUri` を得る
   - `cdp_read_events({ targetId: "-abc", limit: 100 })`
   - レスポンス本文が欲しい → `cdp_get_response_body({ targetId: "-abc", requestId: "1234.5" })`
   - Push で受けたい → `resources.subscribe("cdp://events/-abc")`

---

## 13. セキュリティ/プライバシ
- デバッグポートは **ローカルホスト限定**。リモート許可は無効（`CDP_SECURITY_LOCALONLY=true` 既定）。
- URL/Body のログに機密が含まれる可能性。**既定で body は切り詰め**、tools で増減可能。
- MCP クライアント側にイベントを無制限送出しない（リングバッファと limit を強制）。

---

## 14. 既知の制約
- `Network.getResponseBody` はすべてのレスポンスで成功しないことがある（大容量/ストリーム）。
- Service Worker 経由の詳細はブラウザ実装に依存。
- 同一 Target の多重 observe は `ALREADY_OBSERVING` で拒否（または参照カウントで 1 件に集約）。

---

## 15. 拡張ポイント（任意）
- **保存先の抽象化**: in-memory → file/SQLite/Redis へ差し替え。
- **メトリクス**: Prometheus 用エンドポイント（MCP と別ポート）
- **リダクション**: 正規表現で URL/Body のマスキング。
- **HAR エクスポート**: バッファから HAR 1.2 へ変換し、resource `cdp://har/{targetId}` で配布。

---

## 16. サンプル I/O

### 16.1 `cdp_list_targets` → OK
```json
{
  "targets": [
    {"id":"-123","type":"page","title":"App","url":"https://app.example.com","attached":false}
  ]
}
```

### 16.2 `cdp_observe` → OK
```json
{
  "targetId": "-123",
  "resourceUri": "cdp://events/-123",
  "attached": true
}
```

### 16.3 `cdp_read_events` → OK（抜粋）
```json
{
  "nextOffset": 42,
  "events": [
    {"seq":0,"ts":171...,"targetId":"-123","kind":"console","type":"log","text":"hello"},
    {"seq":1,"ts":171...,"targetId":"-123","kind":"request","requestId":"1234.1","url":"https://api.example.com/items","method":"GET"},
    {"seq":2,"ts":171...,"targetId":"-123","kind":"response","requestId":"1234.1","status":200,"mimeType":"application/json"}
  ]
}
```

### 16.4 失敗例
```json
{
  "error": {
    "code": "TARGET_NOT_FOUND",
    "message": "No target matches: urlIncludes=...",
    "details": {"host":"127.0.0.1","port":9222}
  }
}
```

---

## 17. 受け入れ条件（Definition of Done）
- `list_targets/observe/read_events/get_response_body/stop_observe/clear/set_filters/get_filters` が仕様どおり動作。
- Claude Code から resource **subscribe** で push 更新が観測できる。
- 公開 API（tool 入力/出力）が zod/JSON Schema と README に記述されている。
- E2E テスト手順で **Console** と **HTTP GET/POST** のイベントが取得可能。
- セキュリティ既定（localhost 強制、body 切り詰め）が有効。

---

## 18. 参考実装メモ（抜粋コード方針）

- `normalize.ts`
```ts
export function normalizeConsole(e: any) { /* type, text, args → truncate */ }
export function normalizeRequest(e: any) { /* url, method, headers, postData preview */ }
export function normalizeResponse(e: any) { /* status, mimeType, cache flags, timing */ }
```

- `resources.ts`
```ts
server.registerResource(
  'cdp-events',
  new ResourceTemplate('cdp://events/{targetId}', { list: undefined }),
  { title: 'CDP events', description: 'Console/Network events as JSON' },
  async (uri, { targetId }) => {
    const s = sessions.get(targetId)
    const { events, nextOffset } = s.buffer.tail(200)
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ nextOffset, events }) }] }
  }
)
```

- `tools.ts`
```ts
server.registerTool('cdp_observe', { /* schema */ }, async (input) => {
  const sess = await sessions.observe(input)
  return { content: [{ type: 'text', text: JSON.stringify({ targetId: sess.id, resourceUri: `cdp://events/${sess.id}`, attached: true }) }] }
})
```
