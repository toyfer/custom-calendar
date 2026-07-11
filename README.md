# custom-calendar

Google Calendar のデータを **複数アカウント重ね表示（オーバーレイ）** する自作 UI。  
サーバー不要 · GitHub Pages · どちらのアカウントにも予定を作成可能。

## デモ

`https://toyfer.github.io/custom-calendar/`

## コンセプト

| やりたいこと | 操作 |
|--------------|------|
| 予定を重ねて見る | デフォルト。全アカウントの予定を同月グリッドに色分け表示 |
| 一時的に1つ隠す | チップをクリック → その層の表示 ON/OFF |
| 予定を作るアカウントを選ぶ | 右フォームの「作成先アカウント」セレクト（どちらでも可） |
| 作成先を素早く切替 | チップの ▾ →「作成先にする」 |
| アカウント追加 | **+ アカウント**（毎回 Google のアカウント選択） |
| 再連携 | ▾ → 再連携 |
| Google Calendar で開く | 予定カードの「開く」 |

「どちらか一方だけ表示」への切替は不要。**常にオーバーレイ**が基本です。

## アーキテクチャ（保守用）

```
index.html          UI シェル
styles.css          ベーステーマ
styles.overlay.css  重ね表示チップ + イベントカード拡張
config.json         OAuth 公開設定
js/
  main.js           エントリ・配線・ユースケース
  state.js          状態 + 永続化（accounts / tokens / createAccountId / view）
  google.js         GIS + Calendar REST API + silent refresh
  ui.js             描画
  cache.js          IndexedDB
  dates.js          日付ユーティリティ（midnight edge / sort）
  storage.js        local/session helpers
  constants.js      スコープ・キー・パレット
```

手戻りを減らす方針:

- **表示（visible）** と **作成先（createAccountId）** を分離
- トークンは sessionStorage、メタは localStorage
- Google 呼び出しは `google.js` に集約（REST + 期限前 silent refresh）
- 描画は `ui.js`、状態遷移は `main.js`
- 月移動の fetch はシーケンス番号でレース排除

## OAuth セットアップ

1. Calendar API 有効化
2. スコープ:
   - `calendar.events`
   - `calendar.calendarlist.readonly`
   - `userinfo.email`
   - `userinfo.profile`
3. JS origins: `https://toyfer.github.io` / localhost
4. **Testing なら使う Google アカウントをすべて Test users に追加**
5. `config.json` に Client ID / API Key

## キーボード

- `←` `→` 月移動
- `T` 今日
- `Esc` メニュー/モーダル閉じる

## ライセンス

MIT
