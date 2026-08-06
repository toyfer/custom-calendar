# Mobile Month-First Prototype

Branch: `ui/mobile-month-first` — 月表示を主役にしたスマホ最適化UI。

## プレビュー
- `index.mobile.html` をスマホで開く
- ローカル: `git checkout ui/mobile-month-first` → `npx serve .` → `http://localhost:3000/index.mobile.html`
- GitHub Pages: `https://toyfer.github.io/custom-calendar/index.mobile.html` (Pagesがmain以外を配信する場合。未配信ならブランチをmainにマージ後に表示)

## 何が新しいか
- 月グリッド 48dp + ドットインジケータ（終日は■）
- Day Drawer (peek/half/full) — 日単位アジェンダ
- 左右スワイプで月移動、長押しで作成、ドラッグで移動
- アバタースタック + 月チップ
- Bottom Barは親指ゾーンに集約

## 実データ接続
- `js/main.mobile.js` が `google.js`/`cache.js`/`state.js` をそのまま利用して IndexedDBキャッシュ優先でfetch
- 未連携時はモックではなく空状態 + 追加ボタン
- 設定は `⚙` から Client ID / API Key を保存 → `config.json` より優先

## 次のTODO
- [ ] `index.html` を新UIにスワップ
- [ ] composerSheetの統合（現行は簡易prompt）
- [ ] haptic微調整とE2E実機テスト
