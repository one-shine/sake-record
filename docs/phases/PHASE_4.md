# PHASE 4 — RecordForm / 銘柄サジェスト / 写真リサイズ

## 目的 / 完了条件

- 目的: SPEC の見出し機能（**写真を選んで銘柄を選ぶだけで1本記録できる**）が主画面から使える。A7 / A8 / A11 を閉じる。
- 完了条件(満たせば done) — チェックの根拠は末尾「## 検証の証拠」。**満たしていないものにチェックを入れていない**:
  - [ ] e2e手順13 が通る: 端末の写真を選択 → 銘柄サジェストで「紀土」を選ぶ → 和歌山県・蔵元・フレーバー6軸が自動で埋まる → 評価4・場所「自宅」で保存 → 時系列リストの先頭に出る
    - **1本の通しとしては未観測**。分割された経路はすべて緑: 写真 → サムネイル → 保存 → 一覧に出る は実 Chrome（記録3件、ただし銘柄は空 = `unknown`）/ 候補を選ぶと県・蔵元・6軸が埋まり `manual` で保存されるのは `RecordForm.test.tsx`（合成テーブル）/ `紀土` が 819・和歌山県・チャートありであることは `tables.test.ts`（実データ）。**実 Chrome でサジェストから銘柄を選んだ run が無い**ので、この行はチェックしない → B34
  - [x] サジェストが3264件に対しインクリメンタル検索でき、オフラインでも動作する（**A7**。実機オフラインは Phase 7）
    - オフライン側は「機構が同一オリジンの同梱 JSON だけで完結し、SW のプリキャッシュ9件に7ファイルとも入る」ところまで。**ネットワークを切った実測は Phase 7**（条件本文どおり）
  - [x] **サジェスト行が「銘柄名 + 都道府県 + 蔵元」を出す** — これが無いと4件ある「高砂」(静岡/三重/佐賀/島根) を選び分けられない
  - [x] **IME 対応（必須、任意ではない）**: `compositionstart` / `compositionend` を見て、変換中は「該当なし」を出さない。日本語入力はかな→漢字変換の途中で `input` が飛ぶので、無いと「きど」を打っている間ずっと0件表示になり**見出し機能が壊れて見える**
  - [x] **キーが定義域外のとき全件にフォールバックしない** — 一致0件なら0件を返す（brain: ルックアップが「全件」に落ちてはならない）
  - [x] リサイズ: 長辺400px / JPEG / **品質ラダー** `q ∈ [0.82, 0.7, 0.6, 0.5, 0.4]` で 51200 バイト以下の最初を採用。まだ超えるなら長辺 320 → 256 で再走。最終失敗はエラー表示（**無音で巨大保存しない**）（**A8**）
  - [x] フォームが処理結果を出す（「サムネイル 38KB / 400×533」）。A8 の証拠になり、同時に情報密度としても意味がある
  - [ ] EXIF 回転: `createImageBitmap(file, { imageOrientation: 'from-image' })` を第一経路。**縦持ち iPhone 写真1枚で回転しないことを実ファイルで確認**
    - 第一経路であることは実装 + 変異テスト（`imageOrientation` を削ると赤）で固定。実 Chrome でも **Orientation=6 を持つ JPEG が 300×400 の正立サムネイルになる**ことを四隅マーカーで確認した。**ただしそのファイルは canvas で合成し APP1 を自前で注入したもので、iPhone が撮った写真ではない** → 実機写真は Phase 7（B34）
  - [x] **HEIC を mime で事前拒否しない** — iOS Safari は HEIC をデコードできるので事前拒否は動く環境を壊す。デコード失敗を捕まえてから常体で案内する（「この写真の形式(HEIC)はこのブラウザで読み込めない。iPhone の設定→カメラ→フォーマットを『互換性優先』にするか、JPEG に変換した写真を選ぶ。」）
    - 事前拒否が無いことは実装 + 変異テスト（「HEIC を事前拒否」に変異させると赤）で固定。デコード失敗の案内は実 Chrome で**一般の失敗文**を実測。**実 HEIC ファイルを投入した run は無い**（HEIC 専用文は `PhotoPicker.test.tsx` の単体テストのみ）→ B34
  - [x] 編集フォームが `<RecordForm key={editingId ?? 'new'}>` — 三項で同型コンポーネントを入れ替えると React が Fiber を再利用して**state が持ち越される**（brain の既知事故）
  - [x] 削除に自作の確認ダイアログ。**OS 既定の `confirm()` / `<select>` / `<input type="date">` は使わない**（brain 品質バー）
  - [x] 編集・削除が動く（SPEC スコープ1だが受け入れ基準が無い項目。B6）
    - 検証は jsdom（`App.test.tsx` の「記録の編集と削除」4件 = store は `vi.mock` で呼び出しを assert / 実 IDB 往復は `records.test.ts`）。**実ブラウザで編集・削除をクリックで通した run は無い** → B34
  - [ ] **A11 達成**: 写真付き1件を含む204件を export → サイトデータ削除 → import → **サムネイル込みで**復元
    - 実 Chrome で往復させたのは**写真3件**（export 97,422B → `indexedDB.deleteDatabase` → import で3件すべて `Blob`・size/type/寸法一致・一覧に `blob:` の `img` 3枚）。**203件 + 写真付き1件を1回で往復させた測定は無い**（203件のサムネ無し往復は Phase 3）。サムネイルの往復自体は `backup.test.ts`（`@vitest-environment node`）が合成 Blob で固定 → B34
  - [x] `<img>` に `width`/`height` 属性を付けたら CSS で `height:auto`（brain: 付けないと縦に伸びる）
  - [ ] スクショ 390px / 1280px（フォーム + サジェスト展開状態）
    - **未取得**。フォームと一覧には (日付, 銘柄, 都道府県) が同じ画面に写るので、撮る前に `.gitignore` へ足す必要がある（B24 の恒久策が未決着）→ B33

## タスク

- [x] `src/domain/suggest.ts` + `.test.ts` — 3264件のインクリメンタル検索（正規化して部分一致。0件は0件を返す）
- [x] `src/lib/image/resize.ts` + `.test.ts` — `computeTargetSize` と `qualityLadder` は**純関数として切り出してテストする**（canvas 部分はブラウザで確認）
- [x] `src/ui/RecordForm/RecordForm.tsx` + `PhotoPicker.tsx` / `BrandSuggest.tsx` / `RatingInput.tsx`
  - **置き場の逸脱**: `PhotoPicker` は `src/ui/PhotoPicker/`（+ `thumbnailUrl.ts`）に置いた。写真欄は `RecordForm` 以外（将来の編集経路）からも使う部品で、object URL の生成と revoke を1箇所に閉じたかったため
  - **予定外の追加**: `DateInput.tsx`（OS 既定の `<input type="date">` を使わない規約のため自作）
- [x] `src/ui/common/ConfirmDialog.tsx`（自作） — Phase 3 で先に作ってあったものをそのまま使った（新規作成は無い）

## 検証

```bash
npm test -- suggest resize
npm run dev
```

ブラウザで**実写真3枚**を通す: 縦持ち JPEG（回転確認）/ 12MB級の大きい JPEG（品質ラダーが効くか）/ HEIC（失敗時の案内が出るか）。
export → サイトデータ削除 → import でサムネイルが戻ることを目で確認。
サジェストは「きど」とかな入力して**変換確定前に0件表示にならない**ことを確認する。

## 検証の証拠

実行環境: Node v24.15.0 / vitest 4.1.10 / vite 8.1.5 / 実 Chrome 150.0.7871.182。
ブラウザ側は **Playwright MCP が使えなかったため Node から CDP で実 Chrome を直接駆動**した（スクリプトと生の実測 JSON はリポジトリ外の scratchpad に置いた。`browser-check.mjs` / `report-main.json` / `report-exif.json` / `report-errpath.json` / `report-detail.json`）。配信は `npm run build` の成果物を `vite preview`。

### `npm run ci`（最終の門 — exit 0）

```
> npm run invariants && npm run lint && npm run build && npm run attribution:check && npm run test

✓ データサイズ OK: gzip 84.6KB ≤ 200.0KB (6ファイル)              # 合計 raw 230.7KB
✓ 命名 OK: base は './' / ブランド名は表示文字列のみ
✓ 台帳の結合キーなし: 147ファイルを走査(日付 166種 × 銘柄/県 128種)
eslint .                                                          # 出力なし
tsc -b && vite build
  dist/index.html                   1.30 kB │ gzip:  0.76 kB
  dist/assets/index-*.css          21.44 kB │ gzip:  5.14 kB
  dist/assets/index-*.js          290.86 kB │ gzip: 89.31 kB
✓ sw.js に必須プリキャッシュを注入した: 9件 (assets 2 / さけのわデータ 7)
✓ クレジット OK: さけのわ(リンク+表記) / @svg-maps/japan(CC-BY 4項目) / noindex
vitest run
  Test Files  29 passed (29)
       Tests  602 passed | 3 skipped (605)
```

Phase 3 終了時は 21 files / 397 tests。**29 files / 605 tests**（+8ファイル / +208件）。3 skip は `resize.test.ts` の実 canvas を通す往復3件で、**skip 理由が要約の直前に1行出る**（無音の緑にしない）。

### テストの内訳（各ファイルを単体で実行して転記）

```
src/domain/suggest.ts            suggest.test.ts             31 passed
src/lib/image/resize.ts          resize.test.ts              44 passed | 3 skipped (47)
src/ui/PhotoPicker/              PhotoPicker.test.tsx        25 passed
src/ui/RecordForm/               RecordForm.test.tsx         31 passed
                                 BrandSuggest.test.tsx       16 passed
src/App.tsx（配線）               App.test.tsx                14 passed
```

- サジェストの実測: **索引あり 200回検索 4.2ms 対 毎回 normalize する版 106.1ms（25倍）/ 索引構築 0.9ms**。索引は `getTables()` ごとに1回だけ張る（キーストロークごとに3264件を正規化しない）。検証ステージの別計測で**実データ3264件・2文字入力が 35ms**。
- `高砂` はサジェストでは**5行**返る（同名4件 2359静岡 / 9941三重 / 66006佐賀 / 77752島根 + 前方一致 `高砂金漿` 66007）。件数を4に見せるための dedupe はしていない（B1(5) の「マスタの同名は4件」と矛盾しない）。
- かな入力（`きど` `たかさご`）は**0件**。さけのわのマスタに読みが無いため、IME 対応の責務は「変換中に『該当なし』を出さない」までで、候補が出るのは変換確定後。

### 実 Chrome で測ったサムネイル（A8）

いずれも canvas で合成した画像（全面ノイズ + 四隅マーカーで回転・反転を検出）。`pickerText` はフォームが出した文字列そのまま、`probe` は保存された Blob をデコードして測った値。

```
入力 3000×4000 / 9,271,175B  → 「サムネイル 13KB / 300×400」  probe 300×400 / 12,896B / image/jpeg / 103ms
入力 4000×3000 / 9,269,770B  → 「サムネイル 13KB / 400×300」  probe 400×300 / 12,803B / image/jpeg / 103ms
入力  400×400 / 127,545B(ノイズ)
                             → 「サムネイル 45KB / 400×400」
                               「50KB以下に収めるため JPEG の品質を 0.5 まで落とした。」
                               probe 400×400 / 46,511B / 104ms
四隅マーカー: 上の3枚すべて TL/TR/BL/BR が正位置（回転・鏡像なし）
```

- **長辺は必ず 400px ぴったり**で、元より大きくはしない。12MP の入力でも生成は約100ms。
- **上限に収まらない経路**: `MAX_THUMBNAIL_BYTES` を一時的に 500 にした別ビルド（`dist-tmp/`）で `role="alert"` が出た。「小さくできない / この写真は256×192・品質0.4まで落としても3KBあり、0KB以下にならない。別の写真を選ぶか、あらかじめ縮小した写真を使う。」→ **そのまま保存すると `thumbnail: null` で保存され、巨大な Blob は入らない**。長辺 320 → 256 の再走が効いていることが文言の「256×192」で分かる。確認後 51200 に戻した（`src/lib/image/resize.ts:24` を grep で確認）。
- **画像でないファイル**（`memo.txt`）: 「この写真を画像として読み込めない(形式が違うか壊れている)。別の写真を選ぶ。」= HEIC 専用文とは別の一般文が出る。
- EXIF: **Orientation=6 を自前で注入した JPEG（377,949B / 表示上は 600×800）** → 「サムネイル 43KB / 300×400」/ probe 300×400・44,266B。四隅マーカーの読みが TL←BL, TR←TL … と**1回転ぶんずれており、EXIF の回転が適用された**ことが分かる（無視されていれば読みは素の位置のまま出る）。保存後の Blob も同じ値。

### `<img>` の属性と CSS（実 Chrome で見つけて直した欠陥）

**欠陥**: `src/index.css` の `img { max-width:100%; height:auto }` が**レイヤーの外**に書かれていた。CSS カスケードは「レイヤー無し > 全レイヤー」なので Tailwind の utilities を必ず打ち負かし、`RecordCard` のサムネイルが `h-16 w-16 object-cover` を無視して **64×48（横長写真）/ 64×85（縦長写真）**で描かれ、行の高さが写真の縦横比で変わっていた。`RecordCard.tsx` の「クラスの詳細度が要素セレクタより強い」というコメントは偽（レイヤーが同じときだけ成り立つ）で、これが原因の隠れ蓑になっていた。**jsdom は `css:false` でレイアウトを計算しないので永久に緑**。

修正は `@layer base { img { … } }` に入れるだけ。修正後の実測:

```
Timeline のサムネイル      3件すべて clientW×clientH = 64×64（object-cover でトリミング）
PhotoPicker のプレビュー   width/height 属性 300×400 → 実描画 143×190（比率維持）
RecordDetail の写真        naturalW×H 300×400 → 215×286（比率 0.7517 / max-h-72 で頭打ち）
```

### A11 の往復（サムネイル込み。実 Chrome）

```
1. 写真3件を記録            records 3件 / thumbnail はすべて Blob(image/jpeg)
2. 「書き出す」             97,422B / records 3
                           thumbnail は data:image/jpeg;base64,… で 17,219 / 62,039 / 17,095 文字
3. indexedDB.deleteDatabase indexedDB.databases() が空（サイトデータ削除相当）
4. 書き出した JSON を取り込む 「記録 3件 / エイリアス 0件を取り込んだ。」
5. 復元後の実測              3件すべて Blob / 12,896・46,511・12,803B / image/jpeg / 寸法一致
                           一覧に blob: の img が3枚（64×64）
```

**203件 + 写真付き1件の204件を1回で往復させてはいない**（上の完了条件に理由を書いた）。

### 計測環境の注意（console に出た SW 登録エラー）

サムネイル計測の run の console には `Service Worker の登録に失敗した … ServiceWorker script evaluation failed` が2件出ている。**A8 の上限超え経路を見るために `MAX_THUMBNAIL_BYTES` を 500 にした別ビルドを `dist-tmp/` に作り、`scripts/inject-sw-precache.mjs` を飛ばした**ため `sw.js` のプレースホルダが未置換になったのが原因で、アプリの機能とは無関係（正規の `dist` を配信した Phase 5 の run では console の error / warning が 0）。**プリキャッシュ注入は `npm run build` の一部で、飛ばすと SW が壊れる**ことが分かったのが副産物。

### 赤の実演（変異してテストが落ちることを確認した。各回 `cmp` で復旧を確認）

```
suggest を「0件のとき全件を返す」に変異            → 7赤
suggest を「空クエリで全件」に変異                → 3赤
suggest の索引を毎回 normalize に変異             → perf テストが赤(4.2ms → 106.1ms)
BrandSuggest の onCompositionStart/End を削除     → 3赤
resize の imageOrientation を削除 / 品質ラダー昇順 / 上限5MB / HEIC を事前拒否 …（14変異）→ すべて赤
PhotoPicker の21変異                             → すべて赤（初回2件が緑だったので回帰テストを2本足した）
App.tsx:246 の key={editingId ?? 'new'} を削除     → App.test.tsx が1赤
RecordForm の brandLabel 比較から .trim() を削除    → RecordForm.test.tsx が2赤
```

### 検証ステージの指摘と是正（3件・すべて根本修正）

1. **`key={editingId ?? 'new'}` に回帰テストが無かった**。246行を削除しても `npx vitest run` が 599 全緑（部品に key を渡す/渡さないしか見ていなかった）→ `App.test.tsx` に「編集フォームを開いたまま一覧の別行から編集 → 前の記録の入力（場所）を持ち越さない・保存先も別 id」を1本追加。**実ブラウザでは backdrop が手前にあり今この経路はマウスで踏めない**ことをテストのコメントに明記した（将来詳細に前後移動を足した瞬間に無音の上書きになる）。
2. **「変換中の Enter は押さえる」テストが恒真寄りだった**。入力値が一致6件の語だったため、composition ハンドラを削除しても候補リスト側の `preventDefault` で緑のままだった → 入力値を**かな（一致0件）**に変え、素の Enter が素通しであることの裏取りも足した。
3. **`untouchedLabel = label === record.brandLabel` が trim 済みと生を比較していた**。末尾に空白がある表記（取り込み JSON 由来。`backupSchema.ts` は型検査だけで trim しない）を開くと、銘柄欄に触っていないのに「手動」バッジが出て `manual` で保存され（由来の破壊）、`unlinked` では県が落ちていた → `record.brandLabel.trim()` と比較。

### 依存方向 / 規約（`command grep` で確認。この環境の `grep` は該当があっても exit 1 を返すため）

```
src/domain/ に react|react-dom|window.|document.|process.      → 0件
src/domain/ → store|ui、src/store/ → ui、src/data/ → store|ui   → すべて 0件
src/lib/ からの import                                          → 0件（誰にも依存しない葉）
eslint-disable / as any / @ts-ignore                            → 0件
src/ui/ の confirm( / <select / type="date"                      → 本番コードは0件（コメントとテストのみ）
```

### スクリーンショット（390px / 1280px）

**撮っていない。** フォームと一覧には (日付, 銘柄, 都道府県) が同じ画面に写り、B24（実データのスクショは台帳の結合キーそのもので `ledger:check` の射程外）の恒久策が未決着のため、`.gitignore` の扱いを決める前に撮らない判断にした。**未達の完了条件として残す**。

### プライバシー / 後片付け

- 実データが写ったスナップショット・書き出したバックアップ JSON は `.playwright-mcp/` ごと削除。`dist-tmp/` は削除し、`.gitignore` に追加した（`git add -A` でビルド出力が公開リポジトリに入るのを止める）。
- `git status --short` に `data/seed/` は出ない。ブラウザ検証に使った画像はすべて canvas 合成で、実写真は1枚も持ち込んでいない。
- 変更27ファイルの日付リテラルは `2020-01-01` 等の合成のみで、台帳の日付は0種（`ledger:check` 147ファイル走査で違反なし）。

## フェーズ末レビュー

- レビュー所見（ワークフロー内の検証3本 = テスト / ブラウザ / プライバシー。`/phase-review 4` の code-reviewer subagent は**未実施**）:
  - **実ブラウザでしか見えない欠陥1件**: `src/index.css` の `img` 規則がレイヤー外で Tailwind を打ち負かし、一覧のサムネイルが正方形にトリミングされていなかった（jsdom は永久に緑）→ `@layer base` に移動 + 誤ったコメントを訂正
  - 回帰テストの穴3件（key の回帰テスト無し / IME Enter の恒真 / trim 比較）→ すべてテストを足して根本修正
  - `PhotoPicker` の21変異のうち2件が緑のまま生き残った（追い越された古い失敗の案内 / 親が Blob を差し替えても前の寸法を出し続ける）→ 回帰テスト2本追加
- 対応した点: 上記すべて。`npm run ci` は exit 0（29 files / 602 passed | 3 skipped）。
- 積み残し → `docs/BACKLOG.md` に起票した ID: **B31**（「マスタから消えた」表示が Timeline / RecordDetail に無い。Phase 5 のタスク3）**B32**（object URL 生成の実装が3箇所に写しで残る）**B33**（スクショの証拠が撮れない = B24 の恒久策が未決着で Phase 4/5 のスクショが両方未取得）**B34**（実機・実ファイル・通し観測の積み残し = e2e手順13 / 実 iPhone 写真 / 実 HEIC / A11 の204件 / 編集・削除の実ブラウザ）。継続: B24 / B29 / B30 / B21 / B23 / B16 / B5 / B6 / B1 / B2。
