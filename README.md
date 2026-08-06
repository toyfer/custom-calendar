# custom-calendar v2

Google Calendar より速く・軽く使える **複数アカウント重ね表示** UI。  
**表示に徹する** 月ファースト · **触ってから編集** · PWA · キャッシュ優先。

## デモ

https://toyfer.github.io/custom-calendar/

## 思想 (View-First Progressive Disclosure)

| Layer | いつ | 何を見せる |
|-------|------|------------|
| **1 常時** | 起動直後 | 年月 · 月チップ · 42セル月グリッド(ドットのみ) · ボトムナビ |
| **2 選択時** | 日付タップ後 | Day Drawer (予定一覧) · 条件付き FAB |
| **3 要求時** | 編集/追加ボタン | Composer シート |

複数 Google カレンダーの **重ね表示・作成・編集・削除** はそのまま維持。

## できること

| やりたいこと | 操作 |
|--------------|------|
| 予定を重ねて見る | デフォルト。アカウント色でドット/左ボーダー |
| 一時的に1つだけ見る | アカウントシートでダブルタップ or 長押し → Solo |
| 一時的に隠す | シートのトグル |
| 作成先アカウント/カレンダー | Composer のセレクト |
| 月移動 | ‹ › · スワイプ · 月チップ · 年月ラベル |
| 予定追加 | 日を選ぶ → FAB または「タップして追加」 |
| 予定編集/削除 | Drawer 行の編集 / 削除 |
| 強制再取得 | オンライン復帰時自動 / キャッシュ TTL 5分 |

## キャッシュ

```
表示月を開く
  → IndexedDB から即描画（あれば）
  → TTL 内ならネットワーク省略
  → 古ければ裏で API → 再描画
オフライン
  → キャッシュのみ（バナー）
```

- SW: 静的ファイルのみ (HTML/CSS/JS/アイコン)
- IDB: `accountId:YYYY-MM` キー
- トークンは sessionStorage（SW に載せない）

## OAuth

1. Google Cloud で Calendar API 有効化
2. スコープ: `calendar.events` · `calendar.calendarlist.readonly` · userinfo
3. JS origins: `https://toyfer.github.io` / localhost
4. Testing なら **全アカウントを Test users に登録**
5. `config.json` または ⚙ 設定画面

## キーボード

`←` `→` 前/次月 · `T` 今日 · `Esc` シート閉じる · アバター上で `S` Solo

## アーキテクチャ

```
index.html              モバイルシェル (view-first markup)
styles.mobile-month.css Layer1–3 スタイル
js/
  main.mobile.js        配線 · fetch · Solo · Composer
  ui.mobile.js          描画 · setChromeVisibility · FAB/Drawer
  google.js             Calendar REST
  cache.js              IndexedDB
  state.js / dates.js …
manifest + sw.js        PWA (静的のみ)
```

## ライセンス

MIT
