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

いずれもクレジット表示が利用条件。**画面での表示箇所は条件ごとに違う**:
さけのわは**全画面のフッターに1行**（5タブすべてがさけのわデータを使うため）、
産地マップの県形状は**使用箇所（産地タブ）と「知る」タブ**に置き、フッターには出さない
（このアプリは URL ルーティングを持たず、CC BY 4.0 §3(a)(2) の「URI で必要情報の場所を示す」枝に
乗れないため、§3(a)(1) を使用箇所への併記で満たす）。
`scripts/check-attribution.mjs` がビルド成果物の文字列を検査して欠落していれば CI を落とし、
**画面に描かれること**は単体テストが担う（分担の詳細は `docs/THIRD_PARTY.md`）。

**端末内 OCR の実行資産**
ラベル写真の文字認識は端末内で動かすため、tesseract.js の wasm・worker・日本語学習データを
`public/ocr/` に同梱している（すべて Apache-2.0）。名前・バージョン・入手元は
`docs/THIRD_PARTY.md`、サイズと出所の整合は `npm run ocr:check` が検査する。
Apache-2.0 は配布物への告知を求めるだけで画面表示は求めないため、フッターのクレジットは増やさない。

---

20歳未満の飲酒は法律で禁止されています。

（この一文は **README にだけ**置いている。アプリのフッターにも同じ表記を出していたが、
**表示義務の根拠が文書上どこにも無い自主表記**だったため、フッターを義務のある表示（さけのわのクレジット）
1行に絞る 2026-07-26 の変更で画面からは外した。経緯は BACKLOG の B8 / B55。）
