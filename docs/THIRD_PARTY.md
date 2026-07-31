# 同梱している第三者の成果物

このリポジトリが**自分で配布している**第三者の成果物と、その出所・ライセンスの一覧。
`npm run ocr:check` がこの表と `public/ocr/` の実体・`node_modules` のバージョンを突き合わせるので、
依存を上げたら**同梱物を作り直してこのファイルも更新する**(片方だけ動かすと CI が落ちる)。

一覧・入手元 URL・sha256 の**単一の出所は `scripts/ocr-assets.mjs`**。ここは人が読む告知。

## 銘柄の読み (KANJIDIC)

銘柄名は装飾書体で刷られていて字形からは OCR で読めないが、ラベルのふりがなは読めることがある
(B67 / B68)。かなで打って探す経路も同じデータで開く。さけのわのマスタは読みを持たないので、
**漢字1字ごとの読み**を別の出所から取り、銘柄名を読みに分解して照合する。

| 同梱ファイル | 成果物 | ライセンス | 入手元 |
| --- | --- | --- | --- |
| `public/data/kanji/readings.json` | KANJIDIC の読み（音・訓・名乗り）を**銘柄名に出る1231字に絞り、送り仮名の区切りを落として書き出したもの** | CC-BY-SA 4.0 | 電子辞書研究開発グループ (EDRDG) https://www.edrdg.org/wiki/index.php/KANJIDIC_Project |

- 取り出しは `npm run fetch:readings`（`scripts/fetch-kanji-readings.mjs`）。データは npm の
  `kanji` パッケージ（MPL-2.0、KANJIDIC を同梱）経由で取る。**`kanji` は devDependency にしか
  置かない** — 実行時の依存を増やさず、ビルド時に絞った表だけを配る。
- **CC-BY-SA なので継承する**: 生成した `readings.json` 自体も CC-BY-SA 4.0 として配布する
  （ファイルの `copyright` 欄に `KANJIDIC` を持たせてあり、`attribution:check` が検査する）。
  アプリのコードはこのデータを**利用**するだけで派生物ではない。
- 表示義務（作者・タイトル・ライセンス・改変の明示）は「知る」の出典タブに出す。文言は
  `src/ui/Attribution/Attribution.tsx` の `KanjiDicCredit` の1箇所で、`attribution:check` が
  成果物を、`Attribution.test.tsx` / `Learn.test.tsx` が描画を守る。

## 端末内 OCR (tesseract.js)

写真を端末外に出さないため OCR も端末内で動かす。クラウド OCR を使わない代わりに、実行に必要な
wasm・worker・学習データを同一オリジン(`public/ocr/`)で配信する。第三者 CDN への実行時依存は無い。

| 同梱ファイル | 成果物 | ライセンス | 入手元 |
| --- | --- | --- | --- |
| `public/ocr/tesseract-core-simd-lstm.wasm.js` | `tesseract.js-core@7.0.0`（**改変あり**、下記） | Apache-2.0 | https://github.com/naptha/tesseract.js-core |
| `public/ocr/worker.min.js` | `tesseract.js@7.0.0` | Apache-2.0 | https://github.com/naptha/tesseract.js |
| `public/ocr/worker.min.js.LICENSE.txt` | 同上(worker.min.js が内包する第三者の告知) | MIT / BSD-3-Clause | 同上 |
| `public/ocr/LICENSE-Apache-2.0.txt` | Apache License 2.0 全文 | — | 同上(core も同一文面) |
| `public/ocr/tessdata/jpn.traineddata.gz` | `@tesseract.js-data/jpn@1.0.0` (`4.0.0_best_int`) | Apache-2.0 (下記) | https://cdn.jsdelivr.net/npm/@tesseract.js-data/jpn@1.0.0/4.0.0_best_int/jpn.traineddata.gz |
| `public/ocr/tessdata/jpn_vert.traineddata.gz` | `@tesseract.js-data/jpn_vert@1.0.0` (`4.0.0_best_int`) | Apache-2.0 (下記) | https://cdn.jsdelivr.net/npm/@tesseract.js-data/jpn_vert@1.0.0/4.0.0_best_int/jpn_vert.traineddata.gz |

`tesseract.js` は上表の worker として同梱するほか、**JS ライブラリ本体がアプリのバンドル**
(`dist/assets/*.js`)にも入る。どちらも Apache-2.0 の同じ告知で足りる。

### 学習データのライセンスについて

`@tesseract.js-data/*` は tesseract.js プロジェクトの配布用パッケージ(https://github.com/naptha/tessdata)で、
npm の `license` フィールドは **MIT** を宣言している。中身の `.traineddata` は
tesseract-ocr の学習済みモデル(https://github.com/tesseract-ocr/tessdata_best を int 量子化したもの)で、
上流は **Apache-2.0**。告知としては**厳しい側の Apache-2.0 に合わせて**扱う(MIT の要求は包含される)。

### 告知の形(なぜ UI のフッターに足さないか)

Apache-2.0 が求めるのは**配布物への告知**で、§4(a) ライセンス全文の添付、§4(b) 改変の明示、
§4(c) 著作権・特許・帰属表示の保持、§4(d) **成果物が NOTICE ファイルを含む場合の**その転載。

- `tesseract.js` / `tesseract.js-core` / `@tesseract.js-data/*` の配布物に **NOTICE ファイルは無い**
  (`node_modules/*/LICENSE` のみ)。したがって §4(d) の転載義務は発生しない。
- §4(a) は `public/ocr/LICENSE-Apache-2.0.txt` を同梱物の隣で配信することと、このファイルで満たす。
- §4(b) の変更告知が要るのは**コア1ファイルだけ**。下の「コアへの改変」を参照
  (他の5ファイルはバイト単位の複製)。

### コアへの改変（Apache-2.0 §4(b) の告知）

`public/ocr/tesseract-core-simd-lstm.wasm.js` は上流のファイルの**末尾に小さなラッパーを追記**したもの。
追記部分は `/* 改変あり(同梱時の追記。…) */` というコメントで始まり、内容は
**emscripten の `print` / `printErr` に何もしない関数を差し込む**だけ(上流のコードは1バイトも
書き換えていない)。追記する文字列の実体は `scripts/ocr-assets.mjs` の `CORE_QUIET_SHIM` で、
生成(`npm run ocr:assets`)と検査(`npm run ocr:check`)が同じ定数を通すのでドリフトしない。

理由: tesseract の C++ 側は `Warning: Parameter not found: …` などを stderr に書き、emscripten の
既定はそれを `console.error` に流す。**OCR を1回走らせるだけで console error が20件**出ていた。
`createWorker({ errorHandler })` は tesseract.js の JS 層のハンドラでこの経路を塞げず、worker から
コアへ `printErr` を渡す口も無いので、コア側で受け取る({ printErr } を渡せる)形に合わせた。
認識の失敗は promise の reject 経由で分類しているので、握り潰しているのは警告だけ。

**画面上の表示義務は無い。** さけのわデータ(利用条件としてクレジットとリンクが必須)や
`@svg-maps/japan`(CC-BY-4.0 = 表示義務)とは性質が違い、Apache-2.0 に広告条項に相当する条項は無い。
よって `scripts/check-attribution.mjs` の検査対象(= UI に出ることを強制する対象)にも足さない。

## 既に UI に表示している出典

こちらは**画面表示が利用条件**なので、画面に出したうえで `npm run attribution:check` が
ビルド成果物を検査している(欠けたら CI が落ちる)。詳細は `README.md`。

**表示箇所は条件ごとに違う。フッターに全部を並べているわけではない**(2026-07-26 に整理した)。

| 成果物 | ライセンス / 条件 | 表示箇所 | 入手元 |
| --- | --- | --- | --- |
| さけのわデータ(銘柄・蔵元・フレーバー・味タグ) | クレジット表示と https://sakenowa.com へのリンクが必須 | **全画面のフッター**(5タブすべて。1行 = 文全体がリンク) | https://muro.sakenowa.com/sakenowa-data/ |
| Map of Japan (`@svg-maps/japan`) by Victor Cazanave | CC BY 4.0(作者・タイトル・ライセンス・改変の明示) | **産地タブ**(地図と凡例の直下) ＋ **「知る」タブ**の出典節。**フッターには無い** | https://github.com/VictorCazanave/svg-maps |

- さけのわが全画面なのは、**5タブすべてがさけのわデータを使う**ため(利用条件は「利用している箇所に併記」)。
  同一画面で何箇所使っても表示は1箇所にまとめられるので、1画面あたり1行にしている。
- 地図が使用箇所だけなのは、CC-BY-4.0 §3(a)(2) の「URI やハイパーリンクで必要情報のある場所を示す」枝に
  **このアプリが乗れない**ため(URL ルーティングを持たず、タブは state なので `<a href>` にできない)。
  §3(a)(1) を解釈論なしに満たす形として**地図を描く画面そのものに併記**し、全文は「知る」タブに置いた。
- **文字列の有無を見るのが `check-attribution.mjs`、描画を見るのが単体テスト**という分担
  (`Attribution.test.tsx` / `AreaMap.test.tsx` / `Learn.test.tsx` / `App.test.tsx`)。
  クレジットを増やすときは**両方を同時に足す**(片方だけだと無検査で緑になる → BACKLOG B58)。
