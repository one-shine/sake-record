# 日本酒の記録アプリ

飲んだ日本酒を記録し、味の傾向を振り返るための個人用 PWA。

**記録は端末内（IndexedDB）にのみ保存される。** サーバへ送信せず、認証もクラウド同期も持たない。
端末をまたぐときは JSON でエクスポート／インポートする。

味の6軸（華やか・芳醇・重厚・穏やか・ドライ・軽快）は自分で入力せず、銘柄に紐づく外部データから取る。
入力するのは評価とメモだけ。

## 構成

Vite + React + TypeScript / Vitest / Tailwind CSS。ドメインロジック（`src/domain/`）は
React 非依存の純 TypeScript で、外部依存なしに単体テストできる。

さけのわの API は CORS ヘッダを返さないためブラウザから直接取得できない。
`npm run fetch:sakenowa` でビルド前に取得して `public/data/sakenowa/` にコミットし、バンドルする。
結果としてオフラインでも銘柄検索が動く。

## コマンド

```bash
npm ci
npm run dev                # 開発サーバ
npm run check              # 型チェック + lint
npm test -- <pattern>      # テスト
npm run build              # ビルド（Service Worker のプリキャッシュ注入まで）
npm run ci                 # 不変条件 + lint + build + クレジット検査 + テスト
npm run fetch:sakenowa     # さけのわデータの取得・更新
npm run ocr:assets         # 端末内 OCR の同梱物（wasm / worker / 学習データ）を作り直す
```

## データの出典とライセンス

**銘柄・蔵元・フレーバーチャートのデータ**
[さけのわデータ](https://muro.sakenowa.com/sakenowa-data/) を利用しています（[さけのわ](https://sakenowa.com)）。

**産地マップの県形状**
[Map of Japan](https://github.com/VictorCazanave/svg-maps) by Victor Cazanave
（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)・本数に応じて着色する改変あり）

いずれもクレジット表示が利用条件であり、`scripts/check-attribution.mjs` がビルド成果物を検査して
欠落していれば CI を落とす。

**端末内 OCR の実行資産**
ラベル写真の文字認識は端末内で動かすため、tesseract.js の wasm・worker・日本語学習データを
`public/ocr/` に同梱している（すべて Apache-2.0）。名前・バージョン・入手元は
`docs/THIRD_PARTY.md`、サイズと出所の整合は `npm run ocr:check` が検査する。
Apache-2.0 は配布物への告知を求めるだけで画面表示は求めないため、フッターのクレジットは増やさない。

---

20歳未満の飲酒は法律で禁止されています。
