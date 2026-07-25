# PHASE 3 — 永続化 / バックアップ / Timeline + インポート

**←ここで初めて実データが画面に出る。** 以降スクショが評価対象になる。

## 目的 / 完了条件

- 目的: 203本が時系列リストに並び、JSON の往復で失われないこと。
- 完了条件(満たせば done) — チェックの根拠は末尾「## 検証の証拠」:
  - [x] `data/seed/sake-log-rows.json` をインポート画面から読み込むと **203件**が時系列リストに並ぶ（新しい順。同日は `createdAt` 降順 = ログの `No.` 逆順）（**A9** の1画面）
  - [x] **DOM 行数 = 203 のテスト**。React `key` は必ず `record.id`。`drankOn + brandLabel` を key にすると**同日・同銘柄の2件**（表/裏ラベルとして2本に数えている組。どの日付・銘柄かは docs に書かない = 台帳の復元キーにしない）が衝突して**ストアの件数と画面の行数が静かに食い違う**。この事故をテストで固定する（衝突した行が**絞り込みで落ちる**操作でないと行数はずれない。全件に一致する検索語では検出が dev ビルドの警告文に依存する）
  - [x] `linkStatus` バッジが `auto` / `alias` / `manual` / `unlinked` / `unknown` の5種で出る。**バッジ対応表は1箇所**（brain: 単一の真実源から引く。迷ったら格下げ）
    - **ただし実データで出るのは4種**（`manual` は0件 = 手動紐付けが Phase 5 なので、実画面では出ない）。5種目は `Timeline.test.tsx` の描画テストで固定してある。**実データでの `manual` バッジ確認は PHASE_5 で回収する**
  - [x] ラベル折り返しを**対で**修正した: コンテナに `flex-wrap` + `gap-y-*`、短い原子ラベル（バッジ/ピル）に `whitespace-nowrap`（brain: 日本語ラベルは語中で折れる。片方だけでは直らない）
  - [x] 検索（銘柄/メモ/場所の部分一致）と絞り込み（年 / 都道府県 / linkStatus）が動く（SPEC スコープ4だが受け入れ基準が無い項目。B6）
  - [x] エクスポート → IDB 全消し → インポートで 203件が復元（**A11** のサムネイル無し版。サムネ込みは Phase 4）
  - [x] `backup.test.ts` が `fake-indexeddb` + 合成 Blob で往復し、`thumbnail.size` と `type` が保存されることを assert
  - [x] **export payload に `aliases` が含まれる** — A11 は records しか言っていないが、含めないと `manual` の根拠が往復で失われて A6 の「永続化」が壊れる
  - [x] 空状態が価値を売る（「まだ0本。JSONを取り込むか、写真から1本目を記録する」+ 主要導線2つ）。プレースホルダ文言の残骸なし（brain 品質バー）
  - [x] スクショ 390px / 1280px
    - **実データが写った2枚は gitignore した**（`docs/evidence/phase3-390.png` / `phase3-1280.png`）。一覧は (日付, 銘柄, 都道府県) が同じ行に写り、B18 で問題にした結合キーそのものになる。**PNG は画素なので `ledger:check` では検出できない** → B24 に起票。**追跡するのは台帳が写らない `phase3-390-empty.png`（空状態）だけ**

## タスク

- [x] `src/store/db.ts` + `.test.ts` — 自作 IndexedDB ラッパ。**3ストア: `records` / `aliases` / `meta`**（SPEC は「1ストア+索引」と書いているが3つ必要）。`aliases` は `BrandAlias.prefecture` が `null` を取るので out-of-line キー（`aliasKey(label, prefecture)`）
- [x] `src/store/records.ts` + `.test.ts` — CRUD + `drankOn` 索引。**表示順の確定は records.ts 側**（索引の昇順に頼らない）
- [x] `src/store/backup.ts` + `.test.ts` — export / import。`{app, schemaVersion, exportedAt, records, aliases}`。未来バージョンを拒否し、部分インポートを許容し `{ok, errors, applied}` を返す
- [x] `src/domain/backupSchema.ts` — wire 型。`ExportedRecord = Omit<SakeRecord,'thumbnail'> & { thumbnail: string | null }` を**別型として定義**し、ドメイン型と配線型が別物であることを型で強制する
- [x] `src/store/linking.ts` — テーブルと aliases を束ねて `createLinker` を供給
- [x] `src/data/tables.ts` + `.test.ts` — `public/data/sakenowa/*.json` を fetch → タプル復号 → Map
- [x] `src/ui/Timeline/` — `Timeline.tsx` + `.test.tsx` / `RecordCard.tsx` / `LinkStatusBadge.tsx` / `EmptyState.tsx` / **`linkStatus.ts`（バッジ対応表の唯一の出所）**
- [x] `src/ui/RecordDetail/RecordDetail.tsx`
- [x] `src/ui/ImportExport/ImportExportPanel.tsx`（+ `detectImportFile.ts` / `importActions.ts`）
- [x] `src/ui/common/Overlay.tsx` + `ConfirmDialog.tsx`（**予定外**: 戻るボタン対応と自作 confirm。OS 既定の `confirm()` を使わない規約）

### Blob と JSON の往復

- IDB には `Blob` をそのまま入れる（structured clone で通る。SPEC 通り、`idb` パッケージは使わない）
- エンコードは `FileReader.readAsDataURL` を1件ずつ。**`btoa(String.fromCharCode(...new Uint8Array(buf)))` は大配列でスタックが飛ぶので使わない**
- デコードは `await (await fetch(dataUrl)).blob()` の1行（`data:` URL はオフラインでも解決される）
- **巨大文字列を1本作らない** — export は `new Blob([...parts])` に部品配列で組む。50KB×203 = 10.2MB → base64 で 13.6MB になるが、現状203件はサムネ0なので実サイズは数百KB。増加は年 ~1.5MB
- **オーバーレイの戻るボタン対応**: `RecordDetail` / `ImportExportPanel` を開くときだけ `history.pushState(null,'',location.href)` し `popstate` で閉じる。URL は変わらないので相対 `base` は無傷

## 検証

```bash
npm test -- store backup Timeline
npm test -- seedImport            # 実データ203本の統合テスト(data/seed/ が無い環境では skip)
npm run dev                       # インポート画面から data/seed/sake-log-rows.json を実際に読む
```

- 時系列に203本が並ぶ。**行数を DevTools で数える**（ストア件数の自己申告では A9 の証拠にならない）
- export → Application → Clear site data → 再読込で0件 → import で203件

## 検証の証拠

実行環境: Node v24.15.0 / vitest 4.1.10 / vite 8.1.5 / 実 Chrome(Playwright)。以下はすべて実行した出力から転記した。

### `npm run ci`（最終の門 — exit 0）

```
> npm run invariants && npm run lint && npm run build && npm run attribution:check && npm run test

✓ データサイズ OK: gzip 84.6KB ≤ 200.0KB (6ファイル)          # 合計 raw 230.7KB
✓ 命名 OK: base は './' / ブランド名は表示文字列のみ           # index.html 1 / config/app.ts 2 / manifest.json 2
✓ 台帳の結合キーなし: 126ファイルを走査(日付 166種 × 銘柄/県 128種)   # ← Phase 3 で追加(B22)
eslint .                                                      # 出力なし
tsc -b && vite build
  dist/index.html                   1.30 kB │ gzip:  0.76 kB
  dist/assets/index-*.css          19.08 kB │ gzip:  4.76 kB
  dist/assets/index-*.js          249.27 kB │ gzip: 78.29 kB
✓ sw.js に必須プリキャッシュを注入した: 9件 (assets 2 / さけのわデータ 7)
✓ クレジット OK: さけのわ(リンク+表記) / @svg-maps/japan(CC-BY 4項目) / noindex
vitest run
  Test Files  21 passed (21)
       Tests  397 passed (397)
```

Phase 2 終了時は 6 files / 116 tests。Phase 3 で **21 files / 397 tests**。層別内訳（各パターンを実行して合算した）: `-- domain` 5 files/123 ・ `-- store` 5/156 ・ `-- ui` 8/87 ・ `-- integration` 1/11 ・ `-- data App` 2/20 = 21 files / 397。

**CI 相当（`data/seed/` を退避して実行 → 復帰）**: `388 passed | 9 skipped (397)`。実データを要するテストは **skip として要約に出る**（台帳が無い環境で黙って緑にならない）。

### 実 Chrome で数えた行数（A9 — 自己申告ではない）

`npm run dev` → Playwright で操作し、`document.querySelectorAll` で数えた。**開始前に `indexedDB.deleteDatabase('sake-record')` で全消しし、空状態から取り込んだ**。

```
1. 全消し直後                     main ol > li = 0     「まだ1本も記録が無い」+ 導線2つ
2. ファイル選択(seed JSON)         プレビュー「… を記録の元データとして読んだ。203行。」
3. 「取り込む」                    「記録 203件を取り込んだ。」
                                  内訳: 紐付け 186 / 未紐付け 12 / 銘柄不明 5 / フレーバー取得済み 185
                                  「反映: records 203件」
4. パネルを閉じる                  main ol > li = 203    見出し「全 203本」
5. バッジの実数(DOM 全走査)         自動 173 / 別名 13 / 手動 0 / 未紐付け 12 / 銘柄不明 5  (= 203)
6. リロード後(永続化)              main ol > li = 203
7. 日付の並び                      203行が単調非増加(新しい順) / 異なる日付は 166種
8. console                        error 0 / warning 0（key 重複の React 警告なし）
9. 390px                          documentElement.scrollWidth == innerWidth == 390（横あふれなし）
10. 1280px                        main の max-width = 768px で中央寄せ、行数は 203 のまま
```

**紐付け186 ≠ フレーバー取得済み185** がパネルの内訳としてそのまま出る（`ビキニ娘` は紐付くがチャート無し。B1(2)）。Phase 2 の実測値と全項目一致。

### 検索 / 絞り込み（B6 — 実 Chrome）

```
絞り込みピル「未紐付け」    → 12行 / 「該当 12本 / 全 203本」 / 押し直すと203行に復帰
検索(1文字の部分一致)      → 24行 / 「該当 24本 / 全 203本」    ※値は台帳なのでここに書かない
検索 "zzzzzz"             → 0行 / 「該当なし」+「条件を緩めると出る（勝手に全件へは戻さない）」
ファセットの値数           年 7 / 都道府県 35(県なし 5 を含む) / 紐付け 4
```

- 年の件数は `2026:28 / 2025:33 / 2024:31 / 2023:33 / 2022:65 / 2021:12 / 2020:1` = 203 で、PLAN のログ側サマリと一致（**A10 の実装は Phase 6**。ここで見えているのはファセットの件数）。
- **0件のときに全件へ戻さない**ことが UI コピーとして出ている（brain: 定義域外キーを all にフォールバックさせない）。
- 紐付けファセットが 4値なのは `manual` が0件だから（**存在する値だけをピルにする**）。

### A11 の往復（実 Chrome で export → 全消し → import）

```
1. 「書き出す」             sake-record-backup-YYYY-MM-DD.json をダウンロード(75.7KB / サムネ0件)
   payload の最上位キー      app / schemaVersion / exportedAt / records / aliases  ← aliases が入る
2. 「すべて消す」→ 自作の確認ダイアログ(role=dialog / 「やめる」「消す」/ OS の confirm() ではない)
   → 「記録とエイリアスをすべて消した。」 main ol > li = 0（空状態に戻る）
3. 書き出した JSON を選択    「… をバックアップとして読んだ。記録 203件 / エイリアス 0件（書き出し …）」
4. 「取り込む」             「記録 203件 / エイリアス 0件を取り込んだ。」
                           内訳: 紐付け 186 / 未紐付け 12 / 銘柄不明 5 / フレーバー取得済み 185
5. リロード                 main ol > li = 203
```

統合テスト側でも `export → 全消し → import` を `fake-indexeddb` で往復させ、203件と status 内訳の復元を assert している（`seedImport.test.tsx`「エクスポート → 全消し → インポートで203件が戻る(A11)」）。サムネイル込みの達成は Phase 4。

### オーバーレイと戻るボタン

```
詳細を開く            history.state = {"overlayDepth":1}  見出し「記録の詳細」+「フレーバー」
戻る(history.back())  ダイアログが閉じ history.state = null / 一覧は 203行のまま
詳細 + 確認ダイアログ  history.state = {"overlayDepth":2}（入れ子で段が積まれる）
```

**dev で発見して直した致命バグ**: React StrictMode の擬似 unmount が cleanup の `history.back()` を同期で呼び、2回目の mount が**まだ戻っていない `history.state`** を読んで段を積み直し、遅れて届いた `popstate` を「戻られた」と誤認して**すべてのオーバーレイが開いた瞬間に閉じていた**（取り込み画面も詳細も一切開けない）。cleanup は `back()` を**マイクロタスクに予約**するだけにし、同一タスク内の再マウントは予約を引き継いで積み直さない方式に修正。`Overlay.test.tsx` の StrictMode 2件が回帰を固定する。

### 赤の実演（変異してテストが落ちることを確認した）

**key を `record.id` → `drankOn + brandLabel` に変異**（`Timeline.tsx:229`）して `npm test -- seedImport Timeline`:

```
Tests  5 failed | 31 passed (36)

× Timeline > 同日・同銘柄で内容も同じ2件を、2行として描く（key が record.id である回帰）
    双子を除外する検索語で絞ったあと  expected length 1 → 実際 2（取り残された行が残る）
× seedImport > 同日・同銘柄の重複が絞り込みで落ちても行数がストアと一致する(29件に絞って戻す)
    AssertionError: expected 58 to be 29
× seedImport > 実データ203本 > 同日・同銘柄の組が絞り込みで落ちても、行数がストアと一致する
    AssertionError: expected 67 to be 65
× Timeline > 絞り込み > 都道府県のピルで絞れる（expected 1 → 3）
× Timeline > 絞り込み > 紐付けのピルで絞れる（expected 2 → 3）
```

戻すと 36 passed。**観測された食い違いの向きは「行が余る」だった**（衝突した key を持つ行が絞り込みの再描画で取り残される）。CLAUDE.md は「1行が静かに消える」と書いているが、React 19 + 絞り込みの経路では**残る側に絞ると余る**。どちらの向きでも「ストアの件数 ≠ DOM の行数」なので、**行数を数える assert が唯一効く形**という結論は同じ。**初回描画だけを数えるテストでは検出できない**（203件のままなら行数は減らない）ので、テストは「双子を除外する絞り込みで数える」形にした。

他に確認した変異（統合ステージ実施）: `linking.ts` の失敗 Promise を掴む catch を削除 → `linking.test.ts` が赤 / `App.tsx` の「テーブル未着では詳細を開けない」ガードを常時ハンドラ渡しに変異 → `App.test.tsx` が赤 / 記録読み込み失敗を空リストに変異 → 「空の一覧を黙って描かない」が赤 / Overlay の修正を戻す → StrictMode 2件が赤。

### バッジ対応表が1箇所であることの確認

```
command grep -rn "'自動'|'別名'|'手動'|'未紐付け'|'銘柄不明'" src/ | grep -v src/ui/Timeline/linkStatus.ts
  → 本番コードのヒット 0（残るのは Timeline.test.tsx / RecordDetail.test.tsx のリテラル期待値のみ）
```

`LINK_STATUS_BADGES` は `Record<LinkStatus, _>` なので**型に6値目が増えるとコンパイルエラー**になる。実行時列挙（`backupSchema.ts` の `LINK_STATUSES`）との一致は `Timeline.test.tsx`「対応表は linkStatus の実行時列挙5値を漏れなく覆い、ラベルが重複しない」が固定。**期待値のリテラルはテスト側に独立に書いてあり、対応表を import していない**（B15 の恒真を作らない）。表に無い値は `unknown` に格下げ（確信度を上げる方向に丸めない）。

### 折り返しの対（実 Chrome の DOM から転記）

```html
<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 …">      <!-- 行側 -->
  <p class="whitespace-nowrap">全 203本</p>                          <!-- 原子ラベル -->
  <button class="whitespace-nowrap …">絞り込み</button>
<div class="flex flex-wrap items-baseline gap-x-1.5 gap-y-1.5">     <!-- ファセット行 -->
  <button class="whitespace-nowrap rounded-full …">2026年<span>28</span></button>
```

`RecordCard.tsx` 3箇所 / `Timeline.tsx` 7箇所 / `RecordDetail.tsx` 6箇所 / `LinkStatusBadge.tsx` 2箇所に `whitespace-nowrap`、包む行に `flex-wrap` + `gap-y-*`。`Timeline.test.tsx`「折り返しは対で直してある: バッジに nowrap、包む行に flex-wrap」がクラスの対を固定する。

### スクリーンショット（390px / 1280px）

| ファイル | 中身 | 追跡 |
|---|---|---|
| `docs/evidence/phase3-390-empty.png` | 390px の空状態（記録0件。導線2つ / クレジット / 年齢表記） | **追跡する**（台帳が写らない） |
| `docs/evidence/phase3-390.png` | 390px の一覧（全 203本 / 実データ） | **gitignore**（B24） |
| `docs/evidence/phase3-1280.png` | 1280px の一覧（全 203本 / 実データ。本文は max-w 768px で中央寄せ） | **gitignore**（B24） |

実データの2枚をコミットしない理由: 一覧の1行に (日付, 銘柄, 都道府県) が同時に写るため、**B18 で「射影から復元できた」と問題にした結合キーそのもの**になる。`scripts/check-ledger-leak.mjs` はテキストしか読めないので PNG の混入は検出できない（B24）。ローカルには両方あり、人間はそのまま開いて確認できる。

- 1280px: 本文は `max-w-3xl`(768px) で中央寄せ済み。**下端タブバーは依然全幅に伸びる** → B16 はタブバー側だけ open のまま。
- `100dvh` の実効は Chromium では `dvh == vh` で再現しないため**ここでは検証できていない**（PLAN の既知の穴。実機は Phase 7 / A15）。

### 依存方向（★ 計測環境の罠）

このシェルの `grep` は Claude Code の関数で ugrep に差し替わっており、**該当があっても何も出さず exit 1 を返す**（`grep -c record Timeline.tsx` が空 / `command grep -c` は 25）。**指示どおりの `grep` をそのまま実行すると否定形の検査が無検査のまま緑に見える**。`command grep` で再実行した結果:

```
src/domain/ に react / react-dom / window. / document. / process. の出現なし
src/domain/ → store/ ui/ への import なし（domain のソースは domain 内 + public/data/sakenowa/areas.json のみ）
src/store/  → ui/ への import なし
src/data/   → store/ ui/ への import なし
```

**これは依然として手 grep であって CI の強制ではない** → B21（eslint `no-restricted-imports` の zone）は open のまま。B21 の起票文にこの計測の罠を追記した。

### プライバシー / 射影

- `git status --short` に `data/seed/` は出ない（`git check-ignore` で確認）。committed fixture は1つも増やしていないので `linkBrand.test.ts` の「混入規則」テストは無変更で通る。
- Phase 3 で新規・変更したテストの日付リテラルの異なる値: `seedImport.test.tsx` 0 / `linking.test.ts` 0 / `App.test.tsx` 1 / `backup.test.ts` 2 / `importActions.test.ts` 2 / `Overlay.test.tsx` 0（B22 の想定閾値10未満）。銘柄はすべて合成（`テスト酒` 等）。
- `Timeline.test.tsx` の合成日付は台帳の範囲外（2017〜2019）に寄せた。**以前のレビュー記録にある合成日付とは食い違う**（意図的な変更）。
- Playwright がリポジトリ直下に書いたスクショと、台帳が写った a11y スナップショット `.yml` / ダウンロードしたバックアップ JSON は**削除した**（作業出力は `.playwright-mcp/` = gitignore に閉じる）。

## フェーズ末レビュー

- レビュー所見(このワークフロー内の検証2本 + 統合1本。`/phase-review 3` の code-reviewer subagent は**未実施**):
  - **致命**: すべてのオーバーレイが開いた瞬間に閉じる（StrictMode × `history.back()`）。dev で実ブラウザを触るまでテストは全緑だった → 修正 + StrictMode の回帰テスト2件
  - key 衝突の回帰テストが**初回描画を数える形では赤にならない** → 双子を除外する絞り込みで数える形に書き換え（上の赤の実演）
  - `importAll` が id と (label, 県) の重複を黙って上書きしていた → Map 畳み込み + `errors` に積む
  - 壊れたバックアップで**中身の無いストアの0件置き換え（全消し）**が起き得た → 触れたストアが無ければ `ok:false` で拒否
  - `naming:check` が2つのテストで落ちた（書き出しファイル名にブランド名を含まない、を assert するのにブランド名リテラルを書いていた）→ `config/app.ts` の `APP_NAME` を import して比較（期待値の出所=config、実装の出所=`backupSchema.ts` の `EXPORT_FILE_PREFIX` で別なので B15 の恒真にならない）
  - 生の NUL が入った `Timeline.tsx` / `import-sake-log.mjs` が **git に binary 扱いされて無検査**だった → エスケープ化し、テキスト拡張子の NUL を違反にした
- 対応した点: 上記すべて。`npm run ci` は exit 0（21 files / 397 tests）。
- 積み残し → `docs/BACKLOG.md` に起票した ID: **B24**(実データのスクショが台帳を公開する / PNG は ledger:check の射程外) **B25**(ledger:check の残る穴) **B26**(壊れたバックアップのプレビュー件数が生の行数) **B27**(`.claude/settings.json` の Stop hook 差分の由来が不明 — 人間の確認待ち) **B28**(`manual` バッジは実データ0件なので画面未検証)。継続: B21 / B23 / B16(タブバー側) / B5 / B6(SPEC 本文) / B1 / B2。
