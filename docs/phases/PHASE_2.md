# PHASE 2 — ドメイン層 / 203本パーサ / 紐付け回帰 / 都道府県コード

## 目的 / 完了条件

- 目的: React を1行も使わず、A2 / A3 / A4 / A5(domain) を CI で守る。**実現可能性の要**（SPEC「ここが92%を切ったら設計を見直す」）をここで緑にする。
- 完了条件(満たせば done):
  - [ ] `npm run import:sake-log` が **203** を印字して 0 終了。`## 全記録` 見出しをアンカーにし `^\| \d+ \|` だけを食う（`よく飲む銘柄` / `都道府県別` の2表を取り込まない）。構造不変条件を自己検証: 6セル / `No.` が 1..203 の連番で欠番なし / 日付 `^\d{4}-\d{2}-\d{2}$` / 日付が単調非減少。**集計も紐付けも一切しない**（**A2**）
  - [ ] **2025-12-08 赤武×2 と 2025-12-12 加茂錦×2 が2件として残る**テスト（表裏ラベルで203に数えられているので dedupe しない）
  - [ ] `npm test -- linkBrand` が `autoCount === 173` / `auto+alias >= 186` / `unknown === 5` / `unlinked === 12`。**百分率ではなく件数で assert**（186/203 = 91.6% なので `>= 92%` は落ちる。B1）（**A3**）
  - [ ] スナップショットが203件の (status, brandId) を固定し、`vitest -u` を意図的に叩かない限り差分が出ない。**素の完全一致は 172本/75種、auto は 173本**（B1）（**A4**）
  - [ ] **エイリアス変異テスト**: 表を空にすると 186→**176**。必須6件（赤武 −4 / 寒菊 −2 / ZEBRA −1 / MAGMA −1 / 荷札酒 −1 / 会津宮泉 −1）は各々抜くと減る。**冗長2件（`髙砂/三重県` `ゆきのまゆ`）は現状冗長であることを固定**して、正規化が変わったら気づける状態にする（B11）
  - [ ] `Beau Michelle`(神奈川県) が 3141(長野) に紐付か**ない**こと、かつ 3141 が `candidates[]` に出ることのテスト。「都道府県があるなら同県候補のみ / **全件へフォールバックしない**」を明示テストで固定（brain: 定義域外キーを all に落とさない）
  - [ ] `prefecture.ts` が `静岡県または京都府` と `''` に対して `null` を返すテスト（**未知は null。all にフォールバックしない**）
  - [ ] `prefecture.ts` の romaji ↔ JIS コード対応表が **47対47の全単射**であることのテスト（`@svg-maps/japan` の id は `aichi` `akita` … の romaji で JIS順でも日本語名でもない。日本語県名は さけのわ areas を単一の出所にする）
  - [ ] `src/domain/` に `react` / `window` / `document` / `process` の import が0（grep で確認）
  - [ ] 17本が `unlinked`(12) / `unknown`(5) として区別される（**A5** の domain 側）

## タスク

- [ ] `src/domain/types.ts` — `SakeRecord` / `LinkStatus` / `SakenowaBrand` / `FlavorChart` / `BrandAlias`。**B4 の `brandName` と `sourceNo` を含める**
- [ ] `src/domain/normalize.ts` + `.test.ts` — NFKC → 括弧内除去 → 空白除去 → 異体字マップ → lowercase。異体字マップは `髙→高` `寫→写` `冨→富` を含む（NFKC はこれらを畳まない）
- [ ] `src/domain/prefecture.ts` + `.test.ts` — 県名 → JIS コード(1..47) → romaji。未知は `null`
- [ ] `src/domain/linkBrand.ts` + `.test.ts` — **`createLinker(tables) => (label, prefecture) => Result`**（B3）。解決順: エイリアス → 生の完全一致(県で絞る) → 正規化一致(県で絞る) → `candidates[]` を添えて `unlinked`
- [ ] `src/data/brand-aliases.ts` — 8件（キーは 赤武 / 髙砂 / 寒菊 / ZEBRA / MAGMA / 荷札酒 / 会津宮泉 / ゆきのまゆ。SPEC の表は7行だが `ZEBRA / MAGMA` が1行に同居しているため**キーは8個**）
- [ ] `scripts/import-sake-log.mjs` — markdown → 行JSON の**射影のみ**
- [ ] fixture を**射影して分割**（§ 公開リポジトリとシード）

### 公開リポジトリとシード — fixture を再結合できない形に分割する

「public リポジトリ」「完全な203行はコミットしない」「回帰は CI で守る」を同時に成立させる。

| ファイル | 中身 | 守る基準 |
|---|---|---|
| `src/domain/linkBrand.cases.json`（コミット） | 203 × `{label, prefecture}`。**日付なし・label順ソートで時系列を破壊** | A3 A4 A5 |
| `src/domain/linkBrand.snap.json`（コミット） | 203件の (status, brandId) スナップショット | 回帰 |
| `src/domain/stats.cases.json`（コミット） | 203 × `{drankOn, prefecture, spec}`。**銘柄名なし** | A10（Phase 6 で使う） |
| `data/seed/sake-log-rows.json`（**gitignore**） | 全203行（銘柄・日付・備考・場所） | ブラウザで取り込む本体 |

片方は「日付のない酒名の集合」、もう片方は「銘柄名のない日付+県+スペックの列」。単体では飲酒台帳にならず結合もできない。それでいて**数値系の受け入れ基準4つ(A3/A4/A5/A10)は全部 CI で守れる**。期待値はスクリプトが決めるのではなく `vitest -u` のスナップショットで確定させる（期待値の出所も実装1本）。

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

## フェーズ末レビュー

- レビュー所見(code-reviewer):
- 対応した点:
- 積み残し → `docs/BACKLOG.md` に起票した ID:
