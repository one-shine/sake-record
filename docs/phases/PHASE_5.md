# PHASE 5 — 手動紐付け / エイリアス永続化

**SPEC が中核と宣言した e2e手順12 をここで閉じる。** 集計画面(Phase 6)より前に置く理由: 手順12（寫楽を紐付け→分母 185→190）は、FlavorMap を作る時点で手動紐付けが既にあって初めて**一続きの観測**になる。逆順だと分母を作ってから再検証に戻ることになる。

## 目的 / 完了条件

- 目的: 紐付かない記録を**本人の判断で**紐付けられ、その判断が永続化して同名表記に自動適用される。A6。
- 完了条件(満たせば done) — チェックの根拠は末尾「## 検証の証拠」。**満たしていないものにチェックを入れていない**:
  - [x] `unlinked` / `unknown` の記録から手動紐付けを開き、**`candidates[]`（都道府県一致を優先）と全件検索の両方**から選べる
  - [x] e2e手順12: 「寫楽」1本を `宮泉`(2401) に紐付けると **他4本にも適用**され、全5件が `manual` になる
  - [x] **「他4本にも適用した」と件数を出す** — 無音で一括変更しない（brain: 破壊的・波及的操作は明示する）
  - [x] リロード後も維持される（IDB `aliases` ストア）。export に aliases が含まれ import で復元される
    - リロード維持は実 Chrome と `manualLink.test.tsx` の両方。**export/import の aliases 往復を固定しているのは `backup.test.ts`（node 環境・合成の別名2件）** で、実 Chrome の run では書き出した JSON の `aliases` 件数を数えていない（IDB 側の別名1件は数えた）
  - [x] **フレーバー分母が 185 → 190 になる**（B1: SPEC は 186→191 と書いているが、`ビキニ娘` id2020 は紐付くがチャート無しなので基底は185、+5 で190）。**確認は「取り込みの内訳」で行う** — 紐付け直後に同じ画面で分母を出す導線はこのフェーズには無い（B29。常設は FlavorMap = Phase 6）
  - [x] **手動紐付けのあと、実データの画面に `manual` バッジと5値目の絞り込みピルが出る**（B28 の回収。Phase 3 の実データでは手動紐付けが未実装で内訳が auto / alias / unlinked / unknown の4種しか無く、`manual` の描画は単体テストしか通っていない）
  - [x] エイリアスの優先順: **runtime(manual) > 組み込み8件**。キーは `(normalize(label), prefecture)` 完全一致 → `(normalize(label), null)` ワイルドカード。記録の都道府県が `null` のときはワイルドカードで書く
  - [x] `linkBrand` が自分でエイリアス表を import しない（`createLinker` に注入）。ドメイン純度と依存方向 domain ← store ← ui を維持
  - [x] `Beau Michelle`(no.58) を手動で `unlinked` のまま残せる/別物として紐付けを拒否できる — SPEC は「本人判断に委ねる」と書いており、**アプリが決めない**
  - [ ] スクショ 390px / 1280px
    - **未取得**。一覧・詳細・紐付けパネルには (日付, 銘柄, 都道府県) が同じ画面に写り、B24 の恒久策（実データのスクショをどこに置くか）が未決着のため撮っていない。Phase 4 と同じ理由で両フェーズとも未達 → B33

## タスク

- [x] `src/store/aliases.ts` + `.test.ts` — IDB `aliases` ストア + 組み込み8件とのマージ（優先順とワイルドカードの解決を含む）
  - **Phase 3 で先に作ってあった**（34件）。Phase 5 で足したのは「画面から書いた別名がこの規則で効く」経路の固定
- [x] `src/ui/LinkBrand/LinkBrandPanel.tsx` + `.test.tsx` / `CandidateList.tsx`
  - **予定外の分割**: `applyManualLink.ts`（別名の保存と記録の更新 = 波及の計算。React 非依存で node 環境のテスト）と `candidateRows.ts`（候補の並べ替え）を切り出した
- [ ] 「マスタから消えた」バッジ — 記録の `sakenowaBrandId` がテーブルに無いときの表示。**id を自動クリアしない**（本人の判断を上流の都合で破棄しない）。表示は非正規化した `brandName` で継続し、フレーバー分母から外す
  - **半分だけ**。id を自動クリアしないこと・`brandName` で表示を継続すること・分母から外れることは満たしている（`RecordForm` は「さけのわのマスタに無い銘柄ID 999999」と名指しする）。**`Timeline` / `RecordDetail` にはバッジが無く**、`RecordDetail` は上流から消えた記録にも「さけのわにこの銘柄のフレーバーデータが無い。紐付け自体は済んでいる。」と言うので、**チャート無しと区別できない** → B31

## 検証

```bash
npm test -- aliases LinkBrand
npm run dev
```

ブラウザで**手順12を通しで観測する**: 寫楽の記録を開く → `unlinked` バッジとフレーバー欄が空 → 手動紐付けで `宮泉` を選ぶ → 「他4本にも適用した」が出る → 他4本も `manual` になる → 一覧に `手動` バッジと5値目の絞り込みピルが出る（B28）→ リロードしても維持されている。

**フレーバー分母 185 → 190 は「取り込みの内訳」で見る。** 紐付けた直後に同じ画面で分母を出す画面はこのフェーズには存在しない（`フレーバー取得済み N` を出すのは `ImportExportPanel` の取り込み結果だけで、`LinkBrandPanel` は波及件数しか出さない。分母の常設は Phase 6 の FlavorMap ← B1 / B29）。手順: 紐付け後に**書き出し → その JSON を取り込む** → 内訳が「紐付け 191 / 未紐付け 7 / 銘柄不明 5 / **フレーバー取得済み 190**」になる。解除して seed を取り込み直すと「紐付け 186 / 未紐付け 12 / 銘柄不明 5 / **フレーバー取得済み 185**」に戻る。**この2つの内訳を見ることが 185 → 190 の観測**であって、Phase 5 に分母の常設表示を足すことは求めない。

## 検証の証拠

実行環境: Node v24.15.0 / vitest 4.1.10 / vite 8.1.5 / 実 Chrome 150.0.7871.182（本番ビルドを `vite preview` で配信）。

### `npm run ci`（最終の門 — exit 0）

Phase 4 と同じ1回の実行。`docs/phases/PHASE_4.md`「検証の証拠」に出力を貼った。要点だけ:

```
Test Files  29 passed (29)
     Tests  602 passed | 3 skipped (605)      # Phase 3 は 21 files / 397 tests
✓ 台帳の結合キーなし: 147ファイルを走査(日付 166種 × 銘柄/県 128種)
```

### テストの内訳（各ファイルを単体で実行して転記）

```
src/store/aliases.test.ts               34 passed   （Phase 3 から。優先順とワイルドカード）
src/ui/LinkBrand/applyManualLink.test.ts 33 passed  （@vitest-environment node。波及と解除の計算）
src/ui/LinkBrand/LinkBrandPanel.test.tsx 12 passed
src/integration/manualLink.test.tsx       4 passed  （実データ203本。seed が無い環境では丸ごと skip）
```

`npm test -- aliases LinkBrand manualLink` = 4 files / 83 passed。

### `manualLink.test.tsx` が固定した実測値（`App` を実物のまま描く。store も紐付けもモックしない）

```
取り込み直後            records 203 / 寫楽 5本すべて unlinked / withFlavor 185 / manual 0
画面から紐付け           行の導線 17件（unlinked 12 + unknown 5）→ 寫楽の行から開く
                        表記一致の候補は0件 →「表記が一致する銘柄は無い」+ 全件検索の導線
                        確定前の確認に「他4本」/ 実行後に「他4本にも適用した」
紐付け後                byStatus = { auto 173, alias 13, manual 5, unlinked 7, unknown 5 }
                        withFlavor 190 / brandId 2401 の寫楽が5本
                        一覧に「手動」バッジ 5件 / 行の導線 17 → 12
                        絞り込みの紐付けピルが 5値（「手動5」を含む）           ← B28
リロード相当             manual 5 / brandId 2401 の別名が1件
詳細から解除             「他4本も戻した」+「別名も消した」
                        byStatus = { auto 173, alias 13, manual 0, unlinked 12, unknown 5 }
                        withFlavor 185 / brandId 2401 の別名は0件
```

分母の数え方は**取り込みパネルと同じ `summarize()`** を呼んでいる（数え方を二重実装しない）。`data/seed/` を退避すると `Test Files 1 skipped` + `[manualLink.test] SKIP: …` の1行が出る（**seed が無い CI では黙って緑にならない**）。

### 実 Chrome で通した手順12（A6 — 自己申告ではない）

`npm run build` → `vite preview` → IndexedDB を全消しして空状態から取り込んだ。

```
1. seed を取り込む       記録 203 / 紐付け 186 / 未紐付け 12 / 銘柄不明 5 / フレーバー取得済み 185
2. 寫楽の記録の詳細       未紐付けバッジ / フレーバー節に数字が1つも無い（推定で埋めない）
3. 手動紐付け → 宮泉      確認ダイアログに「他4本」 → 適用後に「他4本にも適用した」
4. IDB を直接読む         manual 5件 / sakenowaBrandId 2401 / withFlavor 190 / 別名 1件（県つきで保存）
5. 一覧                  「手動」バッジ 5件 / 紐付けピルが5値 / 行の導線 17 → 12
6. リロード               すべて維持されている
7. Beau Michelle          候補に 3141（長野 / 伴野酒造）が出るが**拒否**して未紐付けのまま残せる。別名0件
8. 書き出し → 取り込み     紐付け後の JSON を取り込むと内訳が
                        紐付け 191 / 未紐付け 7 / 銘柄不明 5 / フレーバー取得済み 190
9. 解除                  他4本も戻り別名も消える → 未紐付け 12 / withFlavor 185。
                        seed を取り込み直すと内訳も 186 / 12 / 5 / 185 に戻る
10. console              error 0 / warning 0
```

**185 → 190 は2経路で確認した**: (a) IDB の記録と `flavorCharts.json` の突合（手順4）、(b) 書き出し → その JSON の取り込み内訳（手順8）。**同じ画面で紐付け直後に分母を見る導線は無い**（`SummaryView` は取り込みを実行した直後にしか描かれない）→ B29。恒久策は Phase 6 で FlavorMap に分母を常設すること。

### 解除で見つけて直したバグ（別名だけが残る）

`planUnlink` が**記録の都道府県から `aliasKey` を組み立てていた**。紐付けのときに空の県をさけのわ由来の県で埋めるためキーが変わり、**記録だけ `unlinked` に戻って別名が残る**（= 次の取り込みで紐付けが復活し、原因が画面から見えない）。修正は `listAliases()` の結果を受け取り、「この記録に効いていて `brandId` が一致する行」を選んでその行のキーで消す方式。戻す範囲も別名の県から取る。

### 赤の実演（変異してテストが落ちることを確認した。各回復旧を確認）

```
planUnlink のキー導出を旧実装に戻す        → applyManualLink 3赤 + パネルの解除テスト赤（「別名も消した」が出ない）
applyUnlink の removeAlias を無効化       → 残存別名1件で赤
App の onChanged={loadRecords} を削除     → 実データの「手動」バッジが0件で赤
Timeline への onLink を削除               → 行の導線 17件 → 0件で2赤
LinkBrandPanel の IME composing 分岐を削除 → 赤
candidateRows の県一致ソートを削除         → 赤
```

### 依存方向 / 純度

```
src/domain/ に react|react-dom|window.|document.|process.  → 0件（linkBrand はエイリアス表を import しない）
src/domain/ → store|ui、src/store/ → ui                    → 0件
applyManualLink.test.ts は @vitest-environment node        → jsdom 無しで通る（波及の計算は React 非依存）
バッジ対応表は src/ui/Timeline/linkStatus.ts の1箇所        → `isLinked` もここに集約し applyManualLink が再輸出
```

### プライバシー

- 実データのスクショと書き出したバックアップ JSON（台帳そのもの）は `.playwright-mcp/` ごと削除した。
- `manualLink.test.tsx` は**台帳の日付を1文字も持たない**（銘柄 `寫楽` / `宮泉` と brandId 2401 はさけのわの公開マスタ側の値）。assert は件数だけで、失敗時の差分に記録の配列が出ないよう `.length` を比べている。
- `npm run ledger:check` は 147ファイル走査で違反0。

## フェーズ末レビュー

- レビュー所見（ワークフロー内の検証3本 = テスト / ブラウザ / プライバシー。`/phase-review 5` の code-reviewer subagent は**未実施**）:
  - **解除で別名だけが残るバグ**（上記）。記録は戻るのに次の取り込みで紐付けが復活する = 原因の見えない状態だった
  - **コードが「BACKLOG 送り」と宣言した差分が起票されていなかった**（`auto`/`alias` を解除しても否定の別名を持たないので再取り込みで戻る）→ B30 として起票し、コメントから ID を指すようにした
  - PHASE_5 の「検証」が**実ブラウザで満たせない手順**（紐付け直後に同一画面で分母を見る）を書いていた → 実在する経路（取り込みの内訳）に直し、恒久策を B29 に起票
  - B28 の回収指定が完了条件に書かれていなかった（PHASE_3 側の記述だけ）→ 完了条件に明文化して回収した
- 対応した点: 上記すべて。`npm run ci` は exit 0（29 files / 602 passed | 3 skipped）。
- 積み残し → `docs/BACKLOG.md` に起票した ID: **B29**（紐付け直後に分母を見る導線が無い → Phase 6 で常設）**B30**（紐付け解除の非対称性が仕様として未定。`auto` を否定した判断だけが再取り込みで消える）**B31**（「マスタから消えた」表示が Timeline / RecordDetail に無い）**B33**（実データのスクショが撮れず 390/1280px が両フェーズ未取得 ← B24 の恒久策待ち）。継続: B24 / B21 / B23 / B16 / B5 / B6 / B1 / B2。
