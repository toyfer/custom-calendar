# custom-calendar

Google Calendar より速く・軽く使える **複数アカウント重ね表示** UI。  
**PWA**（ホーム画面追加）· **キャッシュ優先** · 月/週/一覧 · ドラッグ移動 · 副カレンダー作成。

## デモ

`https://toyfer.github.io/custom-calendar/`

## 運用できる？

| やりたいこと | 可否 | 仕組み |
|--------------|------|--------|
| 複数アカウント同時表示・編集 | ✅ | オーバーレイ + アカウント別トークン |
| スマホ最適化 | ✅ | ボトムナビ · FAB · 作成シート · safe-area |
| PWA / Service Worker | ✅ | `manifest.webmanifest` + `sw.js`（静的のみ） |
| API をキャッシュで回す | ✅ | IndexedDB 月単位 · TTL 5分 · 先にキャッシュ表示 |

### PWA の注意（GitHub Pages）

- **HTTPS** 必須 → GitHub Pages でそのまま可
- SW は **アプリの静的ファイルだけ** キャッシュ（HTML/CSS/JS/アイコン）
- **Google API・OAuth トークンは SW に載せない**（セキュリティ上も仕様上も正しい）
- 予定データは **IndexedDB**（`js/cache.js`）でアカウント×月キー
- オフライン時: キャッシュ済み月は表示可 / 未取得月は不可
- トークンは **sessionStorage** のため、完全オフラインでは「再連携」が必要な場合あり

### ホーム画面に追加

- **iOS Safari**: 共有 →「ホーム画面に追加」
- **Android Chrome**: メニュー →「アプリをインストール」/ ホーム画面に追加

## コンセプト

| やりたいこと | 操作 |
|--------------|------|
| 予定を重ねて見る | デフォルト。全アカウントを色分け |
| 一時的に1つ隠す | チップ tap |
| 作成先アカウント / カレンダー | 作成シートのセレクト |
| 月 / 週 / 一覧 | 下ナビ（モバイル）or トグル / `M` `W` `L` |
| 予定追加 | 中央 FAB（モバイル）|
| 予定移動 | 月・週でドラッグ（デスクトップ向け）|
| 強制再取得 | ↻（キャッシュ TTL を無視）|

## キャッシュ戦略

```
表示月を開く
  → IndexedDB から即描画（あれば）
  → 全アカウントの取得が TTL 内ならネットワーク省略
  → 古ければ裏で API → 月キーで保存 → 再描画
オフライン
  → キャッシュのみ（バナー表示）
```

SW: stale-while-revalidate（同一オリジン静的）  
IDB: `events` + `meta`（`fetch:{accountId}:{YYYY-MM}`）

## アーキテクチャ

```
index.html              UI + モバイルシェル
manifest.webmanifest    PWA
sw.js                   静的キャッシュのみ
icons/                  アプリアイコン
js/
  main.js               キャッシュ優先 fetch · SW 登録
  cache.js              IndexedDB 月キー
  google.js             Calendar REST
  ui.js / state.js …
```

## OAuth

1. Calendar API 有効化
2. スコープ: `calendar.events` · `calendar.calendarlist.readonly` · userinfo
3. JS origins: `https://toyfer.github.io` / localhost
4. Testing なら全アカウントを Test users に
5. `config.json` または設定画面

## キーボード

`←` `→` 前/次 · `T` 今日 · `M`/`W`/`L` 表示 · `Esc` 閉じる

## ライセンス

MIT
