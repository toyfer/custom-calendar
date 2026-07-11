# custom-calendar

Google Calendar のデータを使った、**完全自作 UI** の静的カレンダーアプリです。  
サーバー DB 不要・GitHub Pages だけで動きます。**複数 Google アカウント**に対応しています。

## デモ

`https://toyfer.github.io/custom-calendar/`

## 機能

- **複数アカウント**の追加・切替・削除（アカウントピッカー）
- アカウントごとの色分け・凡例
- 「全アカウント表示」トグル（マージ / 単一）
- 月表示 + 選択日の予定リスト
- 予定の作成（作成先アカウント選択）・削除
- 終日予定
- IndexedDB キャッシュ / sessionStorage トークン
- キーボード: `←` `→` 月移動 / `T` 今日
- ダーク調 UI

## セットアップ（OAuth）

### 1. Google Cloud

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクト作成
2. [Calendar API](https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com) を有効化
3. OAuth 同意画面を設定（User type: External / Testing で可）
4. スコープ:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
5. **OAuth クライアント ID（Web）** を作成
6. **Authorized JavaScript origins**:

```
http://localhost:5500
http://127.0.0.1:5500
https://toyfer.github.io
```

7. **API キー**（リファラ制限推奨: `https://toyfer.github.io/*`）

### 2. 認証情報

`config.json` または画面右上「⚙ 設定」:

```json
{
  "CLIENT_ID": "xxxx.apps.googleusercontent.com",
  "API_KEY": "AIza..."
}
```

Client Secret は不要です。

### 3. 複数アカウント（重要）

同意画面が **Testing** のとき:

- 使う **すべての** Google アカウントを **Test users** に追加する
- 1つ目: 「Google で連携」
- 2つ目以降: 「+ アカウント」（毎回アカウント選択 UI が出る）
- チップをクリック → 表示切替 / 再連携 / 外す

トークンは **sessionStorage**（タブを閉じると再連携が必要な場合あり）。  
アカウントの名前・色などのメタは **localStorage** に残ります。

### 4. GitHub Pages

Settings → Pages → Branch `main` / root

## ローカル

```bash
npx serve .
# or: python3 -m http.server 5500
```

## ライセンス

MIT
