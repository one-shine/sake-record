# PHASE 6 — 統計 / フレーバー分布 / 産地マップ

## 目的 / 完了条件

- 目的: 4画面が揃う。A5(表示) / A9 / A10。**統計が唯一の数値受け入れ基準を持つのでこれを先に**。
- 完了条件(満たせば done):

### 統計（A10 — 唯一の数値基準）
  - [x] `stats.test.ts` が `stats.cases.json`(203行) に対して `sake-log.md` のサマリと一致する: 総数 **203** / 年別 **2020:1 / 2021:12 / 2022:65 / 2023:33 / 2024:31 / 2025:33 / 2026:28** / 都道府県 **福島22 / 和歌山20 / 山形17**
    （`npm test -- stats flavor` 3 files / 75 passed。本番ビルドを実 Chrome で駆動して統計画面に 203 / 1,12,65,33,31,33,28 / 福島22・和歌山20・山形17 を観測）
  - [x] **スタイル分布の意味をコードで明示する**: スペック列**のみ**を対象にした**重複あり部分一致**（純米大吟醸43 / 大吟醸45 / 純米吟醸51 / 純米112 / 本醸造0 / 生原酒15 / 無濾過13 / 原酒16 / ひやおろし7 / しぼりたて8 / にごり4）。**合計が203を超えるのは正しい**ので UI に「重複計上」と書く。`にごり` は備考を含めると4にならないので**対象列をコードとテストで固定する**
    （実 Chrome でスタイル11語すべてがログのサマリと一致・**延べ314**（= 43+45+51+112+0+15+13+16+7+8+4）・画面に「重複計上」の明記を観測。対象列の固定は変異 M2「note を集計対象に混入」で `stats` 1赤・seed 有りの `screens` も赤（差分は **にごり 4→5**）として実証）
  - [x] 都道府県集計は **34バケツ・合計198**（空欄5件を除外し `静岡県または京都府` は独自バケツ）。「その他/不明」を別枠で件数表示する
    （実 Chrome で **34区分198本**を観測。産地画面に「塗れなかった6本」（空欄5 + `静岡県または京都府` 1）を別枠表示）

### フレーバー分布（A5 の表示側）
  - [x] **分母が明記される**: 「203本中185本のデータで集計（18本はフレーバー未取得）」。`unlinked`/`unknown` は6軸集計から除外して件数のみ表示（**推定値で埋めない**）
    （実 Chrome で「**203本中185本(91%)**」＋内訳 未紐付12・銘柄不明5・チャート無し1 を観測。除算箇所は全て null/0 ガード済みで、変異 M5（null ガード撤去）で `FlavorMap`「NaN/Infinity を出さず」が5赤。本文・属性ともに NaN 出現0）
  - [x] **紐付け済み(186) ≠ フレーバー取得済み(185)** の区別が実装で保たれている（`ビキニ娘` は紐付くがチャート無し）
    （変異 M3「`linkedWithoutChart` を `unlinked` に寄せる」で6赤（`FlavorMap` の 185→190 を含む）。手動紐付けで分母 185→**190**（reload 後も維持）、解除で 185 に戻るのを実 Chrome で観測）
  - [x] 空白地帯（自分がなぞっていない味の領域）が見える。**レーダー1枚で終わらせない**（SPEC「自分がなぞっている味の領域と空白地帯」）
    （レーダーと散布図の2枚が描画され、散布図の**空白セル 161 / 240** を観測）

### 産地マップ
  - [x] `@svg-maps/japan` の47県が本数で塗り分けられ、**未進出県が空白で分かる**。福島・和歌山・山形が濃い
    （実 Chrome で `path` **47本**・福島/和歌山/山形が **step4**・**未進出14県**を観測）
  - [x] **都道府県の一覧表を併置する** — 実形状を選んだ副作用の緩和。香川・大阪のような小県はタップ標的が数pxしかなく、塗りも見えにくい。未進出県も一覧側で読める
    （一覧に **47県**すべてが出ることを実 Chrome で観測）
  - [x] `prefecture.test.ts` の47対47全単射マップ（Phase 2）に依存し、地図側で県コードを再定義しない
    （`@svg-maps/japan` を import するのは `src/ui/AreaMap/areaRows.ts` の1箇所だけで、romaji→コード→県名の変換は `src/domain/prefecture.ts` の `codeFromRomaji` / `prefectureName` / `PREFECTURE_NAMES` のみを通す。地図側に県コードのリテラル表は無い）
  - [x] **都道府県不明6本（空欄5 + `静岡県または京都府` 1）を地図の外に別表示**（SPEC は触れていないが不確実性規約の当然の帰結）
    （実 Chrome で「塗れなかった6本」を観測）
  - [x] CC-BY-4.0 クレジット（作者 Victor Cazanave / タイトル / ライセンスリンク / 改変の明示）がフッターに出ている（Phase 1 で入れた分の実地確認）
    - ワークフローの検証ステージでは目視の記録が無く一度 `[ ]` にしたが、**オーケストレーターが産地マップ画面を開いた状態で `<footer>` を実測して閉じた**（本番ビルドを `vite preview` + 実 Chrome）。`Map of Japan` / `Victor Cazanave` / `CC BY 4.0` / 「改変」の4項目すべてが在り、`href` は `https://creativecommons.org/licenses/by/4.0/`。さけのわ側の `https://sakenowa.com` も同じフッターに在る。**成果物の grep（`attribution:check`）ではなく、産地マップを表示している状態の DOM で確認した**

### 共通
  - [x] `<img>` を使う箇所は `width`/`height` 属性 + CSS `height:auto`
    （Phase 6 で追加した3画面は `<img>` を使わない（自作 SVG のみ）。既存の `<img>`（`RecordCard` / `RecordDetail` / `PhotoPicker`）は Phase 4 で width/height 属性を付け、`src/index.css:43-47` の `img { max-width:100%; height:auto }` が **`@layer base` の中**にある）
  - [x] 4画面すべてが203本の実データで表示される（**A9**）
    （本番ビルドを `vite preview` + 実 Chrome で駆動。全消し → seed 取込で `main ol > li` = **203**。統計・味・産地・一覧の4画面すべてを203本で観測し、`console` の error / warn は **0**（収集器は探針で発火を実証）。**390px / 1280px の両幅で横あふれ0**）
  - [ ] スクショ 390px / 1280px × 3画面
    → **未達のまま残す**。B24（実データのスクショは (日付, 銘柄, 都道府県) が1画面に写る = 台帳の結合キーで、PNG は `ledger:check` の射程外）の恒久策が未決着のため撮影・追跡をしていない。**両幅での横あふれ0 は実 Chrome で実測した**が PNG の証拠は無い → B33 を継続

## タスク

- [x] `src/domain/stats.ts` + `.test.ts` — **集計の唯一の実装**（スクリプト側に年別ヒストグラム検証を入れない。二重実装の入口）
- [x] `src/domain/flavor.ts` + `.test.ts` — 記録集合 → 6軸の平均/分布/空白地帯。**分母を戻り値に含める**（呼び出し側が数え直さないで済むように）
- [x] `src/ui/Dashboard/Dashboard.tsx`（+ `charts.tsx`）
- [x] `src/ui/FlavorMap/FlavorMap.tsx` / `RadarChart.tsx` / `ScatterPlot.tsx`（自作 SVG。チャートライブラリを入れない）
- [x] `src/ui/AreaMap/AreaMap.tsx` / `PrefectureList.tsx`（+ `areaRows.ts` / `fillSteps.ts`）
- [x] `src/integration/screens.test.tsx` — 実 seed（`data/seed/`）に対して実測値を固定。seed が無い CI では skip

## 検証

```bash
npm test -- stats flavor
npm run dev
```

e2e手順9・10・11 を通す:
- 統計 → 総本数203 / 2022年65本 / 福島県22本 が `sake-log.md` のサマリと一致
- フレーバー分布 → 6軸が描画され、**「203本中185本のデータで集計（18本はフレーバー未取得）」のように分母が明示されている**
- 産地マップ → 福島・和歌山・山形が濃く、未進出県が空白で分かる

**恒真述語の検出**（brain: 全てのルールが実データで最低1回は発火することを保証する）: スタイル分布の各条件が203本で1回以上発火しているかを確認する。`本醸造0` は正しく0だが、他が0なら条件が死んでいる。

## 検証の証拠

### 門（このフェーズの最終実行）

| コマンド | 結果 |
|---|---|
| `npm run ci` | **exit 0**。`data:check` ✓ gzip **84.6KB** ≤ 200KB(6ファイル) / `naming:check` ✓ / `ledger:check` ✓ **166ファイル**走査・結合キーなし / `lint` ✓ / `build` ✓ 70 modules・css **26.41KB**・js **386.72KB**・sw **9件**注入 / `attribution:check` ✓ さけのわ + `@svg-maps/japan` **CC-BY 4項目** + noindex / `test` **36 files / 729 passed \| 3 skipped** |
| `npm run check` | exit 0（`tsc -b && eslint .`）。`eslint-disable` / `as any` / `@ts-ignore` は **0件**（既存の `@ts-expect-error` 2件は `backupSchema.test.ts` のみ） |
| `npm run build` | exit 0（70 modules / css 26.41KB / js 386.72KB / sw 9件注入） |
| `npm test -- src` | **36 files / 729 passed \| 3 skipped**（baseline は Phase 5 の 29 files / 602 passed → **+7 files**） |
| `npm test -- screens` | 6 passed（実 seed あり）。seed を退避して再実行 → **1 file / 6 tests skipped ＋ stderr に SKIP 1行**を実測（seed は復元済み） |
| `npm test -- Dashboard App.test FlavorMap AreaMap` | 5 files / **71 passed** |
| `npm run ledger:check` | ✓ 緑（166ファイル走査・結合キーなし）。検証中に結合キーを合成した行を置くと**赤**になり、削除で緑に戻ることを実演 |

### 赤の実演（変異テスト）

`npm test -- stats flavor` = 3 files / 75 passed を基準に、実装へ1箇所ずつ変異を入れて赤を確認した（全て元に戻し、`git diff --stat` は `M src/App.tsx` のみ）。

| # | 変異 | 結果 |
|---|---|---|
| M1 | スタイル集計を排他バケツにする（`break` を入れる） | `stats` **5赤** / seed 有りの `screens` も赤 |
| M2 | `note`（備考）を集計対象に混入 | `stats` **1赤** / `screens` 赤。差分は **にごり 4→5** で PLAN の実測どおり |
| M3 | `linkedWithoutChart` を `unlinked` に寄せる | **6赤**（`FlavorMap` の 185→190 を含む） |
| M4 | 分母を `records.length` にする | **13赤** |
| M5 | null ガードを撤去 | **5赤**（`FlavorMap`「NaN/Infinity を出さず」） |

`screens.test.tsx` 側でも期待値7箇所を変異（65→64 / 福島22→23 / 純米112→111 / `fukushima` の `data-count` 22→21 / 未進出14→15 / 190→191 / チャート無し1本→2本）→ **5 tests 赤**。戻して 6 passed。

### 実 Chrome での観測（本番ビルドを `vite preview` で配信し CDP で Chrome 150 を駆動）

- 全消し → seed 取込で `main ol > li` = **203**
- 統計: **203** / 年別 **1, 12, 65, 33, 31, 33, 28** / **福島22・和歌山20・山形17** / **34区分198本** / スタイル**11語一致・延べ314**・「重複計上」明記
- 味: **203本中185本(91%)** ＋ 未紐付12・不明5・チャート無し1 / レーダーと散布図が描画 / 散布図の空白 **161 of 240**
- 産地: `path` **47本** / 一覧 **47県** / 福島・和歌山・山形が **step4** / **未進出14県** / 「塗れなかった6本」
- 手動紐付け（寫楽5本 → 宮泉2401）でバッジ **173/13/5/7/5**・フレーバー分母 **190**（reload 後も維持）、解除で **185**（A6 / e2e手順12 / B1(3) をここで画面に固定）
- NaN / Infinity は本文・属性ともに **0**。`console` の error / warn は **0**（収集器は探針で発火を実証）
- **390px / 1280px** で横あふれ **0**

### 本番 CSS に SVG 用ユーティリティが残っていること（jsdom は `css:false` なので別途確認）

`dist` の CSS に `fill-stone-900` / `fill-amber-900` / `700` / `500` / `300` / `stroke-stone-600` / `fill-rose-950` / `stroke-rose-400` / `fill-none` / `stroke-stone-100` が**全て存在**（存在しない `.fill-lime-123` は不一致 = 検査器が動いていることの確認）。

### 依存方向（`command grep`・正例つき）

| 検査 | 結果 | 同じ検査の正例 |
|---|---|---|
| `src/domain` に `from 'react` | **0件** | — |
| `src/domain` に `\b(window\|document\|process)\s*\.` | **0件** | 同じ正規表現が `src/ui` + `src/test` で **37件**当たる |
| `src/domain` → `store/` / `ui/` の import | **0件**（一致するのはコメント6行のみ） | 同形が `src/ui` で **67件** |
| `src/store` → `ui/` の import | **0件** | 同形が `App.tsx` で **12件** |

### 集計の呼び出し箇所（二重実装が無いこと）

本番コードでの呼び出しは `computeStats(` が `src/App.tsx:164` のみ、`computeFlavor(` が `src/ui/FlavorMap/FlavorMap.tsx:70` のみ。

### 恒真テストの是正（B15 と同型を1件踏んだ）

`stats.test.ts` のスタイル分布テストが、入力を `computeStats(STYLE_TERMS.map(term => record({spec: term})))` で作り**期待値を実装と同じ出所から取っていた**（B15 と同型の恒真）。是正:

- `STYLE_TERM_SAMPLE_SPECS: Record<StyleTerm, string>` を新設し、語ごとに手書きの合成スペック（`大吟醸 斗瓶囲い` / `特別純米 山廃` 等）を持たせて**入力をリテラル化**。`Record` 型注釈により語の追加・改名はコンパイルで落ちる（`noStyles` / `EXPECTED_STYLE_COUNTS` と同じ作法）
- テストは「全語 ≥1」の loop に加え、**分布全体をリテラルで固定**（純米大吟醸1 / 大吟醸2 / 純米吟醸1 / 純米3 / 本醸造1 / 生原酒1 / 無濾過1 / 原酒2 / ひやおろし1 / しぼりたて1 / にごり1、`styleTotal` 15 / `matched` 11 / `total` 11）
- 実測値（203 / 186 / 185 / 190 / 65 / 22 / 112 / 314）は**一切変更していない**
- 誤りだったコメントを訂正: `stats.ts:35-48` に検出3経路（いずれもこの配列を出所にしない独立リテラル）と、実台帳件数を実装に固定しているのは `screens.test.tsx` の1箇所のみ・**CI では skip** という事実を明記。`EXPECTED_STYLE_COUNTS` の doc にも「`computeStats` の出力とは比較していない / `spec` 列は射影に無く新 fixture にも書き出せない / CI が守るのは規則まで」を明記

### 統合テスト

`npm test -- integration` … seed 有りで **21 passed**、seed 退避で **19 skip**（`screens` の6件すべてを含む）＋ stderr に SKIP 3行。

### 積み残し（このフェーズで閉じられなかったもの）

1. `EXPECTED_STYLE_COUNTS` を `computeStats` の出力と突き合わせる恒久策が無い。203本のスペック列が必要で、それは射影2ファイルに無く privacy 規則で新 fixture にも書き出せない。現状は doc コメントに明記して据え置き（突合はブラウザ検証で行う） → **B35**
2. 固定実測値（112 / 314 / 185 / 190 等）を実装に対して固定するのは `screens.test.tsx` の1箇所のみで、`data/seed/` が無い CI では skip される（skip は stderr に出るので無音ではない）。この構造は Phase 6 で変えていない → **B35**
3. `npm run ci` に `tsc` が含まれない（`invariants` → `lint` → `build` → `attribution:check` → `test`。`check` は別スクリプト）。今回入れた `Record` 型による検出は `ci` だけでは働かない → **B36**

## フェーズ末レビュー

- レビュー所見(code-reviewer): `/phase-review 6` の code-reviewer subagent は**未実施**。ワークフロー内の検証2本 + 統合1本 + 是正1本の所見を上の「検証の証拠」に転記した
- 対応した点: 恒真だったスタイル分布テストの是正（入力のリテラル化 + `Record` 型による網羅強制）/ 誤りだった `stats.ts` のコメントの訂正
- 積み残し → `docs/BACKLOG.md` に起票した ID: **B35**（実台帳の値を実装に固定する経路が skip されうる CI 構造）**B36**（`npm run ci` に `tsc` が無い）。継続: **B24 / B33**（スクショ）**B16**（1280px の下端タブ）
