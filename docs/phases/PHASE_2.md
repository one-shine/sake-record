# PHASE 2 — ドメイン層 / 203本パーサ / 紐付け回帰 / 都道府県コード

## 目的 / 完了条件

- 目的: React を1行も使わず、A2 / A3 / A4 / A5(domain) を CI で守る。**実現可能性の要**（SPEC「ここが92%を切ったら設計を見直す」）をここで緑にする。
- 完了条件(満たせば done) — チェックの根拠は末尾「## 検証の証拠」:
  - [x] `npm run import:sake-log` が **203** を印字して 0 終了。`## 全記録` 見出しをアンカーにし `^\| \d+ \|` だけを食う（`よく飲む銘柄` / `都道府県別` の2表を取り込まない）。構造不変条件を自己検証: 6セル / `No.` が 1..203 の連番で欠番なし / 日付 `^\d{4}-\d{2}-\d{2}$` / 日付が単調非減少。**集計も紐付けも一切しない**（**A2**）
  - [x] **同日・同銘柄で内容も同じ2件が、2組とも各2件として残る**テスト（表裏ラベルで203に数えられているので dedupe しない。**どの日付・銘柄かは書かない** = 台帳の復元キーを docs に置かない）。**元 md はリポジトリ外なのでスクリプトの自己検証は CI で走らない** → パースは `src/domain/parseSakeLog.ts` に置き、リテラルの markdown で `parseSakeLog.test.ts` が守る
  - [x] `npm test -- linkBrand` が `autoCount === 173` / `auto+alias >= 186` / `unknown === 5` / `unlinked === 12`。**百分率ではなく件数で assert**（186/203 = 91.6% なので `>= 92%` は落ちる。B1）（**A3**）
  - [x] スナップショットが203件の (status, brandId) を固定し、`vitest -u` を意図的に叩かない限り差分が出ない。**素の完全一致は 172本/75種、auto は 173本**（B1）（**A4**）
  - [x] **エイリアス変異テスト**: 表を空にすると 186→**176**。必須6件（赤武 −4 / 寒菊 −2 / ZEBRA −1 / MAGMA −1 / 荷札酒 −1 / 会津宮泉 −1）は各々抜くと減る。**冗長2件（`髙砂/三重県` `ゆきのまゆ`）は現状冗長であることを固定**して、正規化が変わったら気づける状態にする（B11）
  - [x] `Beau Michelle`(神奈川県) が 3141(長野) に紐付か**ない**こと、かつ 3141 が `candidates[]` に出ることのテスト。「都道府県があるなら同県候補のみ / **全件へフォールバックしない**」を明示テストで固定（brain: 定義域外キーを all に落とさない）
  - [x] `prefecture.ts` が `静岡県または京都府` と `''` に対して `null` を返すテスト（**未知は null。all にフォールバックしない**）
  - [x] `prefecture.ts` の romaji ↔ JIS コード対応表が **47対47の全単射**であることのテスト（`@svg-maps/japan` の id は `aichi` `akita` … の romaji で JIS順でも日本語名でもない。日本語県名は さけのわ areas を単一の出所にする）
  - [x] `src/domain/` に `react` / `window` / `document` / `process` の import が0（grep で確認）。**ただし手動 grep での確認であって CI では強制されていない** — eslint に境界ルールが無く、将来 `src/domain/` が `react` を import しても `npm run ci` は緑のまま通る → **B21 に起票**（この完了条件の文面「grep で確認」は満たしているのでチェックを入れた）
  - [x] 17本が `unlinked`(12) / `unknown`(5) として区別される（**A5** の domain 側）

## タスク

- [x] `src/domain/types.ts` — `SakeRecord` / `LinkStatus` / `SakenowaBrand` / `FlavorChart` / `BrandAlias`。**B4 の `brandName` と `sourceNo` を含める**
- [x] `src/domain/normalize.ts` + `.test.ts` — NFKC → 括弧内除去 → 空白除去 → 異体字マップ → lowercase。異体字マップは `髙→高` `寫→写` `冨→富` を含む（NFKC はこれらを畳まない）。実装は21字
- [x] `src/domain/prefecture.ts` + `.test.ts` — 県名 → JIS コード(1..47) → romaji。未知は `null`
- [x] `src/domain/linkBrand.ts` + `.test.ts` — **`createLinker(tables) => (label, prefecture) => Result`**（B3）。解決順: エイリアス → 生の完全一致(県で絞る) → 正規化一致(県で絞る) → `candidates[]` を添えて `unlinked`。**ただし後段2つは優先順位ではない**（`exact ⊆ normalized` で採用は1件のときだけなので入れ替えても出力が同じ。効いているのは段の存在。B20）
- [x] `src/data/brand-aliases.ts` — 8件（SPEC の表は7行だが `ZEBRA / MAGMA` が1行に同居しているため**キーは8個**）。**キーは「正規化後」の値で書く**ので、ログ表記 `髙砂` に対するキーは `高砂`、`ZEBRA`/`MAGMA` は `zebra`/`magma` になる（実装: 赤武 / 高砂+三重県 / 寒菊 / zebra / magma / 荷札酒 / 会津宮泉 / ゆきのまゆ）
- [x] `src/domain/parseSakeLog.ts` + `.test.ts` — markdown の `## 全記録` 表 → 行の純関数（3表のうち全記録だけを食う / 6セル / trim / **dedupe しない** / No. と日付の不変条件）。リポジトリ外の md に依存しない単体テストを持てる形にするためドメイン側に置く
- [x] `scripts/import-sake-log.mjs` — 上記を呼ぶだけの殻。ファイル入出力と「203件であること」の確認、**射影のみ**（TS を直接 import するので Node 22.18+/23.6+ が必要 → B23）
- [x] fixture を**射影して分割**（§ 公開リポジトリとシード）

### 公開リポジトリとシード — fixture を再結合できない形に分割する

「public リポジトリ」「完全な203行はコミットしない」「回帰は CI で守る」を同時に成立させる。

| ファイル | 中身 | 守る基準 |
|---|---|---|
| `src/domain/linkBrand.cases.json`（コミット） | 203 × `{label, prefecture}`。**日付なし・label順ソートで時系列を破壊** | A3 A4 A5 |
| `src/domain/linkBrand.snap.json`（コミット） | 203件の (label, prefecture, status, brandId) スナップショット。cases.json と同じ行順で、**日付は1つも含まない**（label / prefecture は cases.json と同じ値。差分をレビューできるように再掲している） | 回帰 |
| `src/domain/stats.cases.json`（コミット） | 203 × **日付文字列だけ**の配列（県もスペックも銘柄名も持たない） | A10（Phase 6 で使う） |
| `data/seed/sake-log-rows.json`（**gitignore**） | 全203行（銘柄・日付・備考・場所） | ブラウザで取り込む本体 |

片方は「日付のない酒名+県の集合」、もう片方は「それ以外の列を持たない日付の列」。**2つのファイルに共通の列を1つも残さない**のが要件で、これは「行の並びを崩す」では代替できない。

- 当初案（stats 側に `{drankOn, prefecture, spec}`）は**結合できた**: 同じ203本の射影なので県ごとの出現数が両側で必ず一致し、両側で1件しかない県は一意に突き合わせられる（実測で9県が確定 = 銘柄 × 日付が復元される）。並び順を変えても値が残っている限り防げない。
- スペックも出さない: スペックは自由文で、**商品名や酒米名の一部として銘柄名を含む行が4行あった**（銘柄名を冠した商品名・GI 表記・酒米名の形）。県を経由せず単体で 銘柄 × 日付 が読めてしまう。該当行の実物をここに転記すると、この節が防ごうとしている開示をこの節自身が行うことになるため書かない（B18 で同じ誤りを踏んだ）。判定は `stats.cases.json` を日付だけにすることで一律に解決している。
- **県別集計(A10) は `linkBrand.cases.json` の203件の県で検証する**（`福島県` 22件）。県の多重集合は片方のファイルにだけ置けば足りる。年別(2022:65 等)は日付の列で足りる。
- この不変条件自体を `linkBrand.test.ts` の「コミットする射影の混入規則」でテストする（スクリプトを直して列が復活しても他のテストは全部緑のままなので、射影の形を検査する側が必要）。
- **`snap.json` を gitignore にしない判断**: 中身は `cases.json` と同じ `label` / `prefecture` に、公開データ（`brands.json` + このリポジトリの `linkBrand.ts`）から誰でも再計算できる `status` / `brandId` を添えただけで、**新しい情報は1ビットも増えない**（日付ゼロを `DATE_LIKE` の assert で固定）。gitignore にすると差分レビューの対象から外れ、回帰の要という PHASE_2 の指定を満たせなくなる。
- **CI が守れる範囲の限界**: 射影の形（日付が無い / 結合キーが無い）を守るのは `linkBrand.test.ts` の4テストで、**対象は上の3ファイルに限る**。別の場所に台帳を書き出すコードを足せば素通りする → リポジトリ全体のガードは B22。

それでいて**数値系の受け入れ基準4つ(A3/A4/A5/A10)は全部 CI で守れる**。期待値はスクリプトが決めるのではなく `vitest -u` のスナップショットで確定させる（期待値の出所も実装1本）。

### stats.ts をここに置かない理由

年別ヒストグラムは script でも domain でも計算できてしまう。**実装は `src/domain/stats.ts` 1本に限り**（Phase 6）、script 側は構造検証のみにして二重実装を発生させない（brain: 暗黙の再実装は必ずドリフトする）。

## 検証

```bash
npm run import:sake-log    # 203 を印字して 0 終了
npm test -- linkBrand      # 173 / >=186 / 5 / 12 とスナップショット
npm test -- domain         # normalize / prefecture / linkBrand 全部
grep -rnE "from 'react'|window\.|document\.|process\." src/domain/   # 空であること
```

**回帰テストの検証**: スナップショットを固定したら、`normalize.ts` の異体字マップから `髙` を一時的に抜いて `npm test -- linkBrand` が赤くなるのを見る → 戻す。赤くならなければ回帰テストになっていない。

## 検証の証拠

実行環境: Node v24.15.0 / vitest 4.1.10 / vite 8.1.5。以下はすべて実行した出力から転記した。

### `npm run ci`（最終の門 — 緑）

```
> npm run invariants && npm run lint && npm run build && npm run attribution:check && npm run test

✓ データサイズ OK: gzip 84.6KB ≤ 200.0KB (6ファイル)      # 合計 raw 230.7KB
✓ 命名 OK: base は './' / ブランド名は表示文字列のみ       # index.html 1 / src/config/app.ts 2 / public/manifest.json 2
eslint .                                                  # 出力なし
tsc -b && vite build
  dist/index.html                 1.30 kB │ gzip:  0.76 kB
  dist/assets/index-*.css         8.73 kB │ gzip:  2.77 kB
  dist/assets/index-*.js        195.35 kB │ gzip: 62.23 kB
✓ sw.js に必須プリキャッシュを注入した: 9件 (assets 2 / さけのわデータ 7)
✓ クレジット OK: さけのわ(リンク+表記) / @svg-maps/japan(CC-BY 4項目) / noindex
vitest run
  Test Files  6 passed (6)
       Tests  116 passed (116)
```

内訳: `parseSakeLog` 15 / `normalize` 29 / `prefecture` 12 / `linkBrand` 42 / `tables`(src/data) 15 / `Attribution` 3 = 116。

### `npm run import:sake-log`（203 / exit 0）

```
✓ sake-log.md を取り込んだ: 203件
    data/seed/sake-log-rows.json    203件  no/drankOn/brandLabel/prefecture/spec/note (gitignore)
    src/domain/linkBrand.cases.json 203件  label/prefecture (日付なし / label順)
    src/domain/stats.cases.json     203件  drankOn のみ (県・スペック・銘柄名なし)
  2ファイルに共通の列は無い(結合キーを残さない)。県別集計は linkBrand.cases.json の県を使う
  紐付け・集計はここでは行わない(src/domain/linkBrand.ts と stats.ts の1本に限る)
$ echo $?   → 0
```

- **冪等**: 連続2回実行して `linkBrand.cases.json` / `stats.cases.json` / `linkBrand.snap.json` の md5 がバイト一致。
- **失敗経路も確認**: 1行だけの合成 md を渡すと `件数が 1 件で 203 件でない` と「`(日付, 銘柄)` が重複する組が 0 組（期待 2 組）」を報告して **exit 1**（Phase 3 でスクリプト側の期待値を日付・銘柄のリテラルから**構造**の検査に置き換えた。エラー文にも台帳の値を出さない）。**この経路では出力を1バイトも書かない**（問題があれば書き出し前に止まる = 壊れた射影がコミットされない）。
- `git check-ignore -v data/seed/sake-log-rows.json` → `.gitignore:27:data/seed/`（台帳本体は追跡外）。

### コミットする射影から読める数字（A10 の前提が揃っていることの確認）

`linkBrand.cases.json`(県) と `stats.cases.json`(日付) だけから計算した:

```
県  福島県 22 / 和歌山県 20 / 山形県 17 / 空欄 5     バケツ 35（空欄を除くと 34）
年  2020:1 2021:12 2022:65 2023:33 2024:31 2025:33 2026:28  = 203
```

PLAN「Explore 所見」のログ側サマリと全一致。**A10 の集計実装は Phase 6**（`src/domain/stats.ts`）なので、ここで固定したのは「射影が集計に足りる」ことだけ。数値そのものは `snap.json` の203行（label + prefecture）が固定しているので、県の多重集合が変われば回帰スナップショットに差分が出る。

### `npm test -- linkBrand`（42 passed）

主要な assert とその値:

| テスト | 固定した値 |
|---|---|
| 203本の紐付け内訳(A3) | `auto 173` / `alias 13` / `auto+alias 186` / `unlinked 12` / `unknown 5` / `unlinked+unknown 17` / `manual 0` / `cases 203` |
| 素の完全一致 | **172本 / 75種**。173本目は `翔空(Lagoon Brewery)` → `brandName === '翔空'`（括弧内除去を経て一致） |
| 回帰スナップショット(A4) | 203行を `toMatchFileSnapshot('./linkBrand.snap.json')` で固定（`vitest -u` なしでは更新されない）。snapshot 文字列に `\d{4}-\d{2}-\d{2}` が現れないことも assert |
| エイリアス変異(B11) | 空 →**176** / 赤武→182 / 寒菊→184 / zebra→185 / magma→185 / 荷札酒→185 / 会津宮泉→185 / **高砂+三重県→186** / **ゆきのまゆ→186** |
| 冗長2件 | 抜くと `alias` → `auto` に振り替わり、**紐付け先の brandId は同じ**（9941 / 41721） |
| Beau Michelle | `status === 'unlinked'` かつ `candidates` に **3141**（長野/伴野酒造）が出る |
| 高砂 | 三重県で 9941 に一意。県なしだと候補4件の `unlinked`（2359静岡 / 9941三重 / 66006佐賀 / 77752島根） |
| 紐付け済み ≠ フレーバー取得済み | 186本のうちチャートありは **185本**。欠けるのは `ビキニ娘`(2020) だけ（B1 の(2)） |
| 射影の混入規則 | cases.json に日付なし / stats.cases.json は日付だけ / **2ファイルに共通の値がゼロ** / 並びが中身だけで決まる / 203本の重複が畳まれていない |

### `grep` — 依存方向

```
$ grep -rnE "from 'react'|from \"react\"|window\.|document\.|process\." src/domain/
$ echo $?   → 1   (1行もヒットしない)
```

補助的に `linkBrand.test.ts` / `normalize.test.ts` は `// @vitest-environment node` で回しており、`normalize.test.ts` が `typeof document === 'undefined'` を assert している。**ただし `import` の禁止は lint で強制されていない**（`react` を import しても node 環境では動くので CI が緑のまま通る）→ **B21**。

### 赤の実演 1 — 異体字マップから `髙` を抜く

`normalize.ts` の `髙: '高'` を1行削除して `npm test -- linkBrand`:

```
Tests  17 failed | 25 passed (42)
```

落ちた内容（抜粋、いずれも**期待値のほうが正しい**）:

| テスト | 期待 | 実測 |
|---|--:|--:|
| 203本の紐付け内訳 — alias | 13 | **11** |
| 表を空にすると 176 | 176 | **174** |
| 赤武を抜くと 182 | 182 | **180** |
| 未紐付けの内訳 | 12件 | **14件** |
| 髙砂 のエイリアス解決 | `alias` | **`unlinked`** |
| 冗長2件は alias→auto | `alias` | **`unlinked`** |
| 回帰スナップショット | — | **差分あり** |

`髙砂` 2本が丸ごと落ちて **186 → 184**。同時に `npm test -- normalize` も 4 failed（異体字マップの件数 21 / `髙砂 → 高砂` / 全エントリが変換として機能する / DOM 無しで動く）。**回帰テストとして機能していることを確認**。復旧して 98/98 緑に戻した。

### 赤の実演 2 — 都道府県フォールバックを注入する

`linkBrand.ts` の候補絞り込みに **`if (scoped.length === 0) scoped = pool`**（= brain の禁止パターン「定義域外キーで全件にフォールバック」）を入れて `npm test -- linkBrand`:

```
Tests  18 failed | 24 passed (42)
```

| テスト | 期待 | 実測 |
|---|---|---|
| **Beau Michelle(神奈川県)** | `unlinked` | **`auto`**（= 長野/伴野酒造の 3141 に誤紐付け） |
| 203本の紐付け内訳 — auto | 173 | **174** |
| 素の完全一致 | 172本 | **173本** |
| 未紐付けの内訳 | 12件 | **11件** |
| フレーバー分母 | 186 | **187**（先頭に 3141 が混入） |
| areaId 0(その他)の蔵は県一致で選ばれない | `unlinked` | **`auto`** |
| 蔵が引けない銘柄は県一致で選ばれない | `unlinked` | **`auto`** |
| 回帰スナップショット | — | **差分あり** |

**計画時に踏んだ誤紐付けがそのまま再現した**。復旧して緑に戻した。

### 赤の実演 3 — `(日付, 銘柄)` で dedupe する（B19 の追試）

`parseSakeLog.ts` に `if (rows.some(r => r.drankOn === drankOn && r.brandLabel === brandLabel)) continue` を入れて `npm test -- parseSakeLog`:

```
Tests  5 failed | 10 passed (15)
```

同日・同銘柄で内容も同じ2組が各 2 → **1件**に畳まれ、`No. 2 が欠番` も報告された。**元 md がリポジトリ外でもこの不変条件が CI で守られていることを確認**（B19 の是正が効いている）。復旧して緑に戻した。

### 復旧の確認

3つの変異はすべて元ファイルの md5 一致で復旧し、最後に `npm run ci` を再実行して **6 files / 116 tests 緑**。`linkBrand.snap.json` は変異中も md5 不変（`toMatchFileSnapshot` は `-u` なしでは書き換えない）。作業ツリーの変更は `docs/` と `package.json` と新規追加分（`scripts/import-sake-log.mjs` / `src/data/` / `src/domain/`）のみ。

## フェーズ末レビュー

- レビュー所見(code-reviewer):
- 対応した点:
- 積み残し → `docs/BACKLOG.md` に起票した ID:
