# custom-calendar v2

Google Calendar より速く・軽く使える **複数アカウント重ね表示** UI。  
**表示に徹する** 月ファースト · **触ってから編集** · PWA · キャッシュ優先。

## デモ

https://toyfer.github.io/custom-calendar/

## 思想 (View-First Progressive Disclosure)

| Layer | いつ | 何を見せる |
|-------|------|------------|
| **1 常時** | 起動直後 | 年月 · 月チップ · 42セル(ドット) · ボトムナビ |
| **2 選択時** | 日付タップ後 | Day Drawer · 条件付き FAB |
| **3 要求時** | 編集/追加 | Composer シート |

複数 Google カレンダーの **重ね表示・作成・編集・削除** を維持。

## できること

| やりたいこと | 操作 |
|--------------|------|
| 予定を重ねて見る | デフォルト。アカウント色のドット |
| Solo 表示 | アカウントシートでダブルタップ / 長押し |
| 一時的に隠す | シートのトグル |
| 作成先 | Composer のアカウント / カレンダー |
| 月移動 | ‹ › · スワイプ · 月チップ · 年月ラベル |
| 予定追加 | 日を選ぶ → FAB または空欄の「追加」 |
| 予定編集/削除 | Drawer 行 |

## テーマ / アイコン / PWA

- `prefers-color-scheme` でライト / ダーク自動切替
- `theme-color` メタを light/dark 両方指定 ([PWA theme-color dark](https://github.com/weroperking/pwa_docs))
- SVG アイコン: `any` + `maskable` + light 用 ([W3C Manifest icons](https://github.com/w3c/manifest))
- SW: モバイル用アセットのみキャッシュ (`cc-v2-mobile-*`)、Google API は非キャッシュ

## キャッシュ

```
表示月 → IndexedDB 即描画 → TTL 5分内ならネット省略
オフライン → キャッシュのみ
```

## OAuth

1. Calendar API 有効化
2. スコープ: events · calendarlist.readonly · userinfo
3. JS origins: `https://toyfer.github.io` / localhost
4. Testing なら **全アカウントを Test users に**
5. `config.json` または ⚙ 設定

## キーボード

`←` `→` 月 · `T` 今日 · `Esc` 閉じる

## 構成

```
index.html                 シェル + SW 登録 + theme meta
styles.mobile-month.css    Layer1–3 + color-scheme
sw.js                      静的キャッシュ v2
manifest.webmanifest       PWA (SVG icons any/maskable)
icons/                     icon.svg · icon-light.svg · icon-maskable.svg
js/main.mobile.js          配線 · fetch · Solo
js/ui.mobile.js            描画 · FAB/Drawer chrome
js/google.js · cache.js …
```

## ライセンス

MIT
