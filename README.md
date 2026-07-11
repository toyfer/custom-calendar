# custom-calendar

Google Calendar より速く・軽く使える **複数アカウント重ね表示** UI。  
サーバー不要 · GitHub Pages · 月 / 週 / 一覧 · ドラッグ移動 · 副カレンダー作成 · 繰り返し編集。

## デモ

`https://toyfer.github.io/custom-calendar/`

## コンセプト

公式 Google Calendar を開かなくても、複数アカウントの予定を **一画面で重ねて** 扱えること。

| やりたいこと | 操作 |
|--------------|------|
| 予定を重ねて見る | デフォルト。全アカウントを色分け表示 |
| 一時的に1つ隠す | チップをクリック / タップ |
| 作成先アカウント | 右フォーム or チップ ▾ →「作成先にする」 |
| 作成先カレンダー | フォームの「カレンダー」セレクト（副カレンダー可） |
| 月 / 週 / 一覧 | 右上トグル or キー `M` `W` `L` |
| 予定を移動 | 月・週ビューで **ドラッグ＆ドロップ** |
| 予定を編集 | カードの「編集」or 予定クリック |
| 繰り返し | 作成時にプリセット選択 / 編集・削除時に「この回のみ / シリーズ全体」 |
| アカウント追加 | **+ アカウント** |
| 再連携 | ▾ or 長押しメニュー |

## アーキテクチャ

```
index.html          UI シェル（3ビュー + 編集/繰り返しモーダル）
styles.css          ベーステーマ
styles.overlay.css  チップ · 週/一覧 · ドラッグ · モバイル
config.json         OAuth 公開設定
js/
  main.js           エントリ · ユースケース
  state.js          状態 + 永続化
  google.js         GIS + Calendar REST · patch · silent refresh
  ui.js             月/週/一覧描画 · DnD · メニュー
  cache.js          IndexedDB
  dates.js          日付 · 週 · 移動計算
  storage.js        local/session
  constants.js      スコープ · ビュー · RRULE プリセット
```

方針:

- **表示（visible）** と **作成先（createAccountId / createCalendarId）** を分離
- トークンは sessionStorage、メタとビューは localStorage
- Google は REST 集約 · 期限前 silent refresh
- 月移動 fetch はシーケンスでレース排除

## OAuth セットアップ

1. Calendar API 有効化
2. スコープ:
   - `calendar.events`
   - `calendar.calendarlist.readonly`
   - `userinfo.email` / `userinfo.profile`
3. JS origins: `https://toyfer.github.io` / localhost
4. Testing なら使う Google アカウントをすべて Test users に追加
5. `config.json` に Client ID / API Key

## キーボード

| キー | 動作 |
|------|------|
| `←` `→` | 前/次（月 or 週） |
| `T` | 今日 |
| `M` | 月表示 |
| `W` | 週表示 |
| `L` | 一覧 |
| `Esc` | メニュー/モーダル閉じる |

## モバイル

- チップ **長押し** でアカウントメニュー
- ビュートグルはフル幅
- 週ビューは横スクロール対応
- タッチターゲット拡大

## ライセンス

MIT
