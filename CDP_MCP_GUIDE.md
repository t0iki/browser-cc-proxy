# CDP Observer MCP - ブラウザデバッグ自動化ツール

## 概要

CDP Observer MCPは、Chrome DevTools Protocol (CDP) を活用してブラウザのデバッグ情報を自動収集・分析するMCPサーバーです。AIエージェント（Claude等）がブラウザの内部状態を観測し、デバッグ作業を支援できるようにします。

## 背景知識

### Chrome DevTools Protocol (CDP) とは

CDPは、Chromeブラウザの開発者ツール（DevTools）が使用している通信プロトコルです。これにより、外部プログラムからブラウザを制御・監視できます。

#### CDPでできること
- **Console API**: コンソールログ、エラー、警告の取得
- **Network API**: HTTPリクエスト/レスポンスの監視
- **Runtime API**: JavaScript実行、例外キャッチ
- **Page API**: ページナビゲーション、リロード、スクリーンショット
- **DOM API**: DOM要素の操作・検査

#### なぜデバッグポートが必要？
通常のブラウザはセキュリティのため外部からの操作を受け付けません。`--remote-debugging-port`フラグを付けて起動することで、明示的にCDP接続を許可します。

```bash
# CDPを有効にしてブラウザを起動
/Applications/Arc.app/Contents/MacOS/Arc \
  --remote-debugging-address=127.0.0.1 \  # ローカルホストのみ許可
  --remote-debugging-port=9222             # CDPポート
```

### Model Context Protocol (MCP) とは

MCPは、AIモデルが外部ツールやデータソースと対話するための標準プロトコルです。Claude Codeなどのツールから利用できます。

#### MCPの構成要素
- **Tools**: AIが呼び出せる関数（例：ログ取得、ページリロード）
- **Resources**: 購読可能なデータソース（例：リアルタイムイベント）
- **Transport**: 通信方式（stdio、HTTP等）

## システム構成

```
┌─────────────────┐
│   ブラウザ      │
│  (Arc/Chrome)   │
│  Port: 9222     │
└────────┬────────┘
         │ CDP (WebSocket)
         │
┌────────┴────────┐
│  CDP Observer   │
│   MCP Server    │
│  (Node.js)      │
└────────┬────────┘
         │ MCP (stdio)
         │
┌────────┴────────┐
│  Claude Code    │
│  または他の     │
│  MCPクライアント │
└─────────────────┘
```

## 主要機能

### 1. イベント観測

#### Console Events
```javascript
{
  "kind": "console",
  "type": "error",           // log, warn, error, info, debug
  "text": "TypeError: Cannot read property 'foo' of undefined",
  "stack": [{               // スタックトレース
    "functionName": "handleClick",
    "url": "https://example.com/app.js",
    "lineNumber": 42,
    "columnNumber": 15
  }],
  "exceptionDetails": {...}  // 例外の詳細情報
}
```

#### Network Events
```javascript
{
  "kind": "request",         // request, response, loadingFinished, loadingFailed
  "requestId": "12345.67",
  "url": "https://api.example.com/data",
  "method": "GET",
  "headers": {...},
  "status": 200,            // responseの場合
  "mimeType": "application/json"
}
```

### 2. イベントフィルタリング

大量のイベントから必要な情報を効率的に検索：

```javascript
// エラーのみ取得
cdp_read_events({
  targetId: "...",
  types: ["error"],
  reverse: true  // 最新から検索
})

// 特定のテキストを含むログ
cdp_read_events({
  targetId: "...",
  textIncludes: "TypeError"
})

// APIエラーの検索
cdp_read_events({
  targetId: "...",
  kinds: ["response"],
  urlIncludes: "/api/",
  reverse: true
})
```

### 3. ブラウザ操作

デバッグ中にブラウザを操作：

```javascript
// ページリロード
cdp_reload({ targetId: "...", ignoreCache: true })

// JavaScript実行
cdp_execute_script({
  targetId: "...",
  expression: "document.querySelector('button').click()"
})

// ナビゲーション
cdp_navigate({ targetId: "...", url: "https://example.com" })
```

## 使用シナリオ

### シナリオ1: エラーデバッグ

```javascript
// 1. タブを観測開始
cdp_observe({ urlIncludes: "myapp.com" })

// 2. 最新のエラーを確認
cdp_read_events({
  targetId: "...",
  types: ["error"],
  reverse: true,
  limit: 5
})

// 3. エラーの詳細を見てスタックトレースを分析
// → app.js:42 でTypeErrorが発生

// 4. 修正後、リロードして確認
cdp_reload({ targetId: "...", ignoreCache: true })
```

### シナリオ2: API監視

```javascript
// 1. ネットワークイベントを監視
cdp_observe({ urlIncludes: "api.example.com" })

// 2. APIレスポンスを確認
cdp_read_events({
  targetId: "...",
  kinds: ["response"],
  urlIncludes: "/api/users"
})

// 3. エラーレスポンス（4xx, 5xx）を検索
cdp_read_events({
  targetId: "...",
  kinds: ["response"],
  textIncludes: "error"
})

// 4. レスポンスボディを取得
cdp_get_response_body({
  targetId: "...",
  requestId: "12345.67"
})
```

### シナリオ3: 自動テスト

```javascript
// 1. テストページを開く
cdp_navigate({ targetId: "...", url: "https://example.com/test" })

// 2. テストを実行
cdp_execute_script({
  targetId: "...",
  expression: "runTests()"
})

// 3. 結果を収集
cdp_read_events({
  targetId: "...",
  textIncludes: "PASS",
  reverse: true
})
```

## セキュリティ考慮事項

### 1. ローカルホスト限定
```bash
--remote-debugging-address=127.0.0.1  # ローカルのみ
# 危険: --remote-debugging-address=0.0.0.0  # 全IPから接続可能
```

### 2. プロファイル分離
```bash
--user-data-dir=/tmp/debug-profile  # 一時プロファイル使用
```

### 3. 機密情報の扱い
- パスワード、トークンなどがログに含まれる可能性
- レスポンスボディにも機密情報が含まれる場合がある
- 本番環境では使用しない

## トラブルシューティング

### Q: "BROWSER_UNREACHABLE" エラー
A: ブラウザがデバッグポートで起動していません。
```bash
# ポートが開いているか確認
curl http://127.0.0.1:9222/json/version
```

### Q: "TARGET_NOT_FOUND" エラー
A: 指定したURLのタブが見つかりません。
```javascript
// まずタブ一覧を確認
cdp_list_targets({})
```

### Q: イベントが多すぎて見つからない
A: フィルターと`reverse:true`を活用：
```javascript
cdp_read_events({
  targetId: "...",
  types: ["error"],
  textIncludes: "specific error",
  reverse: true,
  limit: 10
})
```

### Q: "ALREADY_OBSERVING" エラー
A: すでに観測中です。一度停止してから再開：
```javascript
cdp_stop_observe({ targetId: "..." })
cdp_observe({ targetId: "..." })
```

## パフォーマンス最適化

### リングバッファ
- 各タブごとに最大10,000イベントを保持
- 古いイベントは自動的に削除
- メモリ使用量を一定に保つ

### フィルタリング戦略
1. **サーバー側フィルタ**: 不要なイベントをバッファに入れない
2. **クエリ時フィルタ**: 必要なイベントのみ返す
3. **reverse検索**: 最新のイベントから効率的に検索

## 実装の特徴

### 1. リアルタイム性
- CDP WebSocket接続により、イベントをリアルタイムで受信
- バッファリングにより、後から過去のイベントも検索可能

### 2. 拡張性
- 新しいCDP APIを簡単に追加可能
- カスタムフィルターの実装が容易

### 3. AIフレンドリー
- 構造化されたJSONレスポンス
- 詳細な説明付きのスキーマ
- 使用例を含むドキュメント

## まとめ

CDP Observer MCPは、ブラウザデバッグの自動化を実現するツールです。従来は人間が手動で行っていたDevToolsでの作業を、AIエージェントが代行できるようになります。

### メリット
- 🚀 デバッグ作業の効率化
- 🔍 大量ログからの自動検索
- 🤖 AIによる問題分析支援
- 📊 ネットワーク監視の自動化
- 🔄 再現テストの自動実行

### 適用例
- Webアプリケーションのデバッグ
- E2Eテストの自動化
- パフォーマンス監視
- エラートラッキング
- API動作確認

このツールにより、開発者はより高レベルな問題解決に集中でき、ルーチンワークはAIに任せることが可能になります。