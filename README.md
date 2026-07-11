# custom-calendar

Google Calendar のデータを使った、**完全自作 UI** の静的カレンダーアプリです。  
サーバー DB 不要・GitHub Pages だけで動きます。

## デモ

GitHub Pages 有効化後:

`https://toyfer.github.io/custom-calendar/`

## 機能

- Google アカウント連携（OAuth / GIS トークンモデル）
- 月表示・今日の予定リスト
- 予定の作成・削除
- IndexedDB キャッシュ（再表示を高速化）
- ダーク調の自作 UI

## セットアップ（OAuth）

### 1. Google Cloud

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクト作成
2. [Calendar API](https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com) を有効化
3. OAuth 同意画面を設定（User type: External または Testing）
4. スコープを追加:
   - `https://www.googleapis.com/auth/calendar.events`
5. **OAuth クライアント ID（Web アプリ）** を作成
6. **Authorized JavaScript origins** に追加:

```
http://localhost:5500
http://127.0.0.1:5500
https://toyfer.github.io
```

7. **API キー** を作成（HTTP リファラ制限推奨: `https://toyfer.github.io/*`）

### 2. 認証情報を入れる

`config.json` を編集:

```json
{
  "CLIENT_ID": "xxxx.apps.googleusercontent.com",
  "API_KEY": "AIza..."
}
```

またはページ右上の「設定」から入力し、ブラウザに保存することも可能です。

> Client Secret は不要です（静的サイトでは使わない）。

### 3. GitHub Pages

1. リポジトリ **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / `/ (root)`
4. Save

数分後: https://toyfer.github.io/custom-calendar/

### 4. Testing モードの場合

OAuth 同意画面が Testing なら、自分の Google アカウントを **Test users** に追加してください。

## ローカル確認

```bash
npx serve .
# または python3 -m http.server 5500
```

`http://localhost:5500` を JavaScript origins に入れてあること。

## テクノロジー

- Google Identity Services（トークンモデル）
- Google API Client (`gapi`) + Calendar API v3
- 純粋前端（HTML / CSS / JS）
- IndexedDB（イベントキャッシュ）

## ライセンス

MIT
