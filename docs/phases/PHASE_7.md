# PHASE 7 — 実機 / 月次更新 / バックアップ督促 / リリース

## 目的 / 完了条件

- 目的: A7(オフライン) / A15 / A16 を**実機で**証明し、運用を自動化してリリースする。
- 完了条件(満たせば done):
  - [ ] **iPhone 実機**: 公開URLをホーム画面に追加 → **機内モード**で起動 → 記録の閲覧と新規作成（銘柄サジェスト含む）ができる（**A7 / A16**、e2e手順15）
        → **未実行。実機（iPhone）が必要**。Chromium での代替（配信元を止めて再読込 → 204件描画 →
        `brands.json` 3264件が SW キャッシュから読めて新規1件作成 → 205件）は**機構の確認まで**で、
        iOS Safari / ホーム画面追加 / 機内モードは1度も踏んでいない
  - [ ] **実機で下端のUIが切れない**（**A15**）。Chromium は `dvh == vh` なのでブラウザ自動化では検出できない — **実機スクショが唯一の証拠**
        → **未実行。実機（iPhone）が必要**。手元で取れたのは `vh == dvh == svh == 900`（=
        Chromium では差が出ないことの確認）と 390/1280px で横あふれ0 まで。**この条件は原理的に自動化で埋められない**
  - [x] `npm run ci` が緑、`npm audit --audit-level=high` が緑（**40 files / 801 passed | 3 skipped** / `found 0 vulnerabilities`。Phase 6 は 36 files / 729 passed。+1ファイル/+13件は SW の回帰テスト = B38）
  - [ ] `update-sakenowa.yml` を `workflow_dispatch` で1回実走させ、(a) 差分なしならコミットしない (b) `data:check` と `test` を**コミット前に**通す (c) 差分ありならコミット → **デプロイまで到達する**ことを観測した（B9）
        → **未実走**。ワークフロー定義は入り、静的には `fetch` → `data:check` → `test` → 差分判定 →
        commit → deploy の順（検査がコミットの前）で、deploy は `uses: ./deploy-pages.yml` +
        job 側 `permissions`（pages / id-token / contents:read）+ `ref = 新しい sha` を渡す形になっている。
        **実走（`gh workflow run`）はオーケストレーターの担当**（このステージは対外的な操作を実行しない）。
        実走時に確認すること: (1) 定義が既定ブランチに載ってからでないと `workflow_dispatch` は現れない
        (2) deploy 側のログ `built <sha> …` が**月次コミットの sha** であること（ref 修正の実地検証）
        (3) 今日時点で上流に実差分があるので「差分あり」経路が観測できる見込み
  - [ ] `navigator.storage.persist()` を初回書き込み時に要求。iOS Safari は無視するので、初回に「ホーム画面に追加すると消えにくい」と案内する（B7）
        → **要求は2経路とも入った**（取り込み成功時 / フォームで1本目を保存したとき。実ブラウザで
        1本目のみ呼ばれることを観測）が、**案内を出す `BackupNag` は「取り込み / 書き出し」画面の中にしかない**。
        フォームから始めた人はその画面を開くまで案内を見ないので**まだ満たしていない**（時系列の上端にも置くなら
        `App.tsx` が件数・最終書き出し日時・永続化状態を読んで渡す）
  - [x] 最終エクスポートからの経過日数警告（14日で注意 / 30日で強め）。SPEC「アプリ側で経過日数を警告表示して緩和する」
        （`BackupNag` = 14日で注意 / 30日で強め / 未書き出しは段を上げず事実だけ。実ブラウザで
        「まだ一度も書き出していない」→ 書き出し後に消える、までを観測。**出る場所は上記のとおり書き出し画面のみ**）
  - [ ] **A1〜A17 の17項目全部にチェックが入り、各々に証拠**（コマンド出力 or スクショ）が PHASE ファイルに貼られている
        → **14/17 達成・3件未達**（**A7 / A15 / A16 = すべて iPhone 実機が必要**）。一覧は下の
        「受け入れ基準 A1〜A17 の達成状況」節
  - [ ] `docs/BACKLOG.md` の残 open が把握されている → `/release`
        → open の一覧は `docs/BACKLOG.md` の `## 進捗` 先頭に整理した（**B1 B2 B5 B6 B7 B9 B10 B11 B16
        B25 B26 B30 B31 B32 B34 B35 B36 B37 B39 B40 B41 B42**）。**`/release` 自体は未実施**

## タスク

- [x] `.github/workflows/update-sakenowa.yml`（**未実走**。`workflow_dispatch` の実行はオーケストレーターに委ねる）
- [x] `src/store/meta.ts` — `lastExportedAt`
- [x] `src/ui/ImportExport/BackupNag.tsx`（配線先は `ImportExportPanel` の上端。時系列タブには出ない）
- [ ] `public/screenshots/mobile-1.png` / `desktop-1.png`（manifest 用）— **未着手**。`public/manifest.json` に
      `screenshots` フィールドが無いことを実ブラウザで確認済み（→ **B42**）
- [ ] `README.md` — **未着手**（→ **B42**）
- [x] 組み込みエイリアス8件の brandId が `brands.json` に存在することのテスト（上流から消えたら月次ジョブが赤で止まり、ぶら下がったエイリアスが出荷されない）

### 月次更新ワークフローの設計

`schedule` + `workflow_dispatch` / `permissions: contents: write` / `git diff --quiet -- public/data/sakenowa` ガード。要点2つ:

1. **検査をコミットの前に置く**（`fetch` → `data:check` → `test` → 差分判定 → commit → deploy）。順序が逆だと壊れたデータが main に入って自動デプロイまで走る
2. **`GITHUB_TOKEN` で push したコミットは他 workflow の `on: push` を再トリガしない** → `deploy-pages.yml` に `on: workflow_call` を足して**このジョブから直接呼ぶ**（PAT も `repository_dispatch` も不要）。コードベース初のコミットバックなので手動実行で1回目で見る
3. **呼ぶときに `ref` を渡す**（統合ステージで追加）。reusable workflow は**呼び出し側と同じ ref・sha の文脈で走る**ので、`deploy-pages.yml` の `actions/checkout` が既定で pin する `github.sha` は**月次コミットの1つ前**になる。渡さないと「差分ありでコミット → デプロイ」が**「コミットはしたが古いデータを公開する」**になり、例外も警告も出ない（B9 の完了条件 (c) が「到達した」で緑に見えてしまう）。`deploy-pages.yml` に `workflow_call.inputs.ref`（既定 `''` = 従来どおり `github.sha`）を足し、`update-sakenowa.yml` の deploy ジョブが `with: { ref: needs.update.outputs.sha }` を渡す。ビルドしたコミットは deploy 側の `Show built commit` がログに出す

`fetchedAt` をデータに入れない（毎月必ず差分が出て `git diff --quiet` ガードが無意味になる）。上流の `etag` / `last-modified` だけを `meta.json` に記録する。

### 紐付けた銘柄が上流から消えた場合（2層で守る）

- **CI 側** — 組み込み8件の brandId が `brands.json` に存在することをテスト。消えたら月次ジョブが赤で止まる
- **実行時** — 記録は `sakenowaBrandId` を保持し「銘柄マスタから消えた」バッジを出してフレーバー分母から外す。**id を自動クリアしない**（本人の判断を上流の都合で破棄しない）。表示は非正規化した `brandName` で継続

## 検証

SPEC の end-to-end 検証手順1〜15 を通しで実行する。とくに:

- 手順10（分母の明示）と手順12（本人の判断で紐付けられる）が**本アプリの中核**。ここが崩れているなら未完成
- 手順15（実機・機内モード・下端が切れない）

```bash
npm run ci
npm audit --audit-level=high
gh workflow run update-sakenowa.yml     # 実走 → デプロイ到達を観測
```

`/security-review` で差分のセキュリティ問題（秘密の混入・入力検証）を確認 → `/release`。

### 検証の証拠（統合ステージ / e2e手順1〜14。**手順15 は未実行 = 実機が要る**）

実行環境は本番ビルド（`npm run build` → `vite preview` の `http://localhost:4173/`）を実 Chromium で駆動。
**画面の証拠は DOM 実測で取り、実データのスクリーンショットは撮っていない**（B24: 実データの画面は
(日付, 銘柄, 都道府県) が同居する = 台帳の結合キーそのもの。PNG は `ledger:check` の射程外）。

| 手順 | 結果 |
|------|------|
| 1 `fetch:sakenowa` | 成功。areas 48 / breweries 1749 / **brands 3264** / **flavorCharts 1344** / flavorTags 141 / brandFlavorTags **2980**。上流が動いていて `brandFlavorTags.json` と `meta.json` に差分が出た（2回目の実行でも同じ 2980 = `accept-encoding: identity` 固定と id 昇順ソートが効いている）。**差分は `git checkout` で戻した** — 月次ジョブの `workflow_dispatch` 実走（B9 の完了条件 (c)「差分ありならコミット → デプロイまで到達」）が観測できなくなるため、この差分は上流の変化として残す |
| 2 `import:sake-log` | 成功。**203件**。`data/seed/sake-log-rows.json`(gitignore) / `linkBrand.cases.json` / `stats.cases.json` を再生成し、追跡ファイルに差分なし（射影が決定的） |
| 3 `npm test -- linkBrand` | 3 files / **87 passed**。「auto 173 / alias 13 / unlinked 12 / unknown 5」「素の完全一致は 172本 / 75種」を含む |
| 4 `npm test -- domain` | 8 files / **218 passed** |
| 5 `npm run check` → `npm run build` | どちらも exit 0（`tsc -b` + `eslint .` / `vite build` + SW プリキャッシュ注入9件） |
| 6 `check-attribution.mjs dist/` | 緑。さけのわ(リンク+表記) / @svg-maps/japan(CC-BY 4項目) / noindex |
| 7 `vite preview` | 起動。以下は本番ビルドを実ブラウザで操作した結果 |
| 8 取り込み | 2段（読む → 取り込む）を経て **203件**。内訳を画面が出す: **紐付け186 / 未紐付け12 / 銘柄不明5 / フレーバー取得済み185**。一覧の `<li>` も IndexedDB の件数も 203 |
| 9 統計 | **総本数203** / 年別 2020:1 2021:12 **2022:65** 2023:33 2024:31 2025:33 2026:28 / **福島県22**・和歌山県20・山形県17 / 都道府県別「**34区分に198本**」＋「その他/不明 6本」 |
| 10 フレーバー分布 | **「203本中 185本のデータで集計（91%）」** と分母を明示。未取得18本の内訳（未紐付け12 / 銘柄不明5 / チャート無し1）も画面に出る。**SPEC 本文の「186本」は B1(2) のとおり誤りで、画面が正しい** |
| 11 産地マップ | 訪問**33県 / 47県** / 塗った197本 / **未進出14県** / 「地図に塗れなかった 6本」。SVG の `path` 47枚を計算後の `fill` で数えると 11本以上8県・6〜10本4県・3〜5本9県・1〜2本12県・未進出14県（合計47）で、濃淡が段階になっている |
| 12 手動紐付け | 詳細に `未紐付け` バッジ＋「フレーバー未取得」。手動紐付けで「同じ表記で未紐付けの他4本もまとめて」と**書き込む前に**波及件数を出し、確定後 `manual` 5件 / `unlinked` 12→7 / 別名1件。**フレーバーの分母が 185 → 190（93%）に増えた**（SPEC 本文の191 は B1(3) のとおり誤り） |
| 13 新規記録（**B34(1) 回収**） | 写真(1280×800 JPEG)を選ぶ → **サムネイル 400×250 / 8,073バイト**（実 canvas の往復。jsdom では skip している経路） → サジェストで銘柄を選ぶ → **和歌山県・平和酒造・6軸 45/50/22/38/28/53 が自動で入る** → 評価4・場所「自宅」で保存 → **一覧の先頭**に出る。DB は 203 → 204 |
| 14 復元（**B34(4) / A11 回収**） | 書き出し **86,940バイト**（記録204 / エイリアス1 / サムネイルは data URL）→ `indexedDB.deleteDatabase('sake-record')` → 再読込で**0件**（空状態の文言）→ 取り込みで**204件 + エイリアス1件**。サムネイルは **Blob 8,073バイト**で書き出し前と一致し、一覧の `<img>` が 400×250 で描画された |
| 15 実機 | **実行できない**（iPhone 実機が要る）。手元でできたのは Chromium での代替のみ: **配信元を止めた状態で再読込しても 204件が描画され**、`./data/sakenowa/brands.json` も 3264件が SW キャッシュから読めた。その状態で銘柄サジェストから1本作成して 205件になった（A7 / A16 の**機構**は動いている）。**A15（下端が切れない）は Chromium では `dvh == vh` なので原理的に検出できず、実機スクショが唯一の証拠** |

補足（この2つは e2e の番号に無い）:

- **B7 の初回書き込み**: 取り込み経路に加えて**フォームから1本目を作る経路**でも
  `navigator.storage.persist()` を要求するようにした（`App.tsx` の `handleSubmit`）。実ブラウザで
  `navigator.storage.persist` を包んで観測: 1本目の保存で `persisted()` → `persist()` が各1回、
  **2本目の保存では0回**（許可を尋ねるブラウザで毎回訊かないため）。Chromium は `denied` を返すので
  `BackupNag` の「永続化を得られなかった」案内が実際に出た
- **B34(5) 回収**: 詳細 → 編集 → 保存 → 詳細に戻る / 詳細 → 削除 → **自作の確認ダイアログ**
  （OS の `confirm()` ではない）→ 0件、を実ブラウザでクリックして通した。
  このとき**銘柄不明の記録で確認文が「」と空になる**のを見つけた → **B37** に起票

### CI の穴を閉じた（B21 / B23 / skip の可視化）

`npm run ci` = `invariants(node:check + data:check + naming:check + ledger:check)` → `lint` →
`boundaries:check` → `build` → `attribution:check` → `test:report` → `skips:check`。

- **B21 依存方向を lint で強制**（`eslint.config.js`）。`src/domain/**` は `react` / `react-dom` /
  `@testing-library/*` と `../{data,store,ui}/` を、`src/store/**` は `../ui/`、`src/data/**` は
  `../{store,ui}/` を `no-restricted-imports` で禁止。domain の**テストだけ** `../data/` を許す
  （実表を fixture にするため。react と store/ui はテストでも禁止）。
  実際に違反を書いて `npm run lint` が7件で落ちることを確認し、消した。
  ルール自体が消えても気づけるよう、`npm run boundaries:check`
  （`scripts/check-lint-boundaries.mjs`）が合成コード11件で「逆流7件が検出される / 正しい向き4件は
  素通りする」を毎回確かめる。緩める変異・広げすぎる変異の両方で落ちることを実測済み。
- **B23 Node 版を宣言して検査**。`engines.node = ">=22.18.0 <23.0.0 || >=23.6.0"`
  （TS 型ストリップが要る = `scripts/import-sake-log.mjs` が `parseSakeLog.ts` を直接 import するため。
  23.0〜23.5 に穴が空くのは仕様どおり）。`npm run node:check` が**走っている Node と
  `.github/workflows/*.yml` の `node-version` 3件の両方**を照合する。
- **CI で一度も走らないもの**（`npm run ci` が緑でも未検証。ログに毎回出す）:
  - `npm run import:sake-log` — 入力の markdown がリポジトリ外（brain）。**手元でしか走らない**。
    実データ側の期待値（203件 / 重複2組）を確かめるのは手動実行のときだけ。
  - `src/integration/` の3ファイル — `data/seed/`（個人の台帳・gitignore）が無い CI では
    `describe.skipIf` で丸ごと skip。**実測値 203 / 2022年65 / 福島22 / 分母185 → 手動紐付け後190 は
    CI では一度も検証されていない**。`npm run skips:check` が skip の件数・場所・「何が未検証か」を
    stdout と GitHub のジョブ要約に出す（黙って緑にしない）。seed が**あるのに** skip された場合、
    未登録の場所で skip された場合、登録した場所が消えた場合は落とす。

### SW の「明示的な失敗応答」が反転していた（B38）

実機検証で見つけた**オフライン経路の不具合**。`public/sw.js` の `offlineFailure()` が
`new Response('', { status: 504, statusText: 'オフラインでキャッシュにも無い' })` を返していたが、
`statusText` は **ByteString（ISO-8859-1）**なので日本語を入れると **Response の構築自体が TypeError**
（実測: `Cannot convert argument to a ByteString because the character at index 0 has a value of 12458`）。
`respondWith` に渡した promise が reject し、「`undefined` を respondWith しないための明示的な失敗応答」が
**避けようとしていた素のネットワークエラーそのもの**になっていた（実測: preview を止めた Chromium で
`fetch('./data/sakenowa/__missing__.json')` が 504 ではなく `Failed to fetch` / `net::ERR_FAILED`）。
副作用として `src/data/tables.ts` の `if (!res.ok) throw new Error('さけのわデータを取得できない: … (504)')`
が到達不能で、原因を名指しする文言がブラウザ既定の文言に置き換わっていた。

- 直し方: **理由の日本語は本文に置き**、`statusText` は `'Gateway Timeout'`（ASCII）にする。
  修正後の実測は status 504 / statusText `Gateway Timeout` / body「オフラインでキャッシュにも無い」。
- **この関数を覆うテストは1本も無かった**（だから実ブラウザで踏むまで気づけなかった）。
  `src/pwa/sw.test.ts` を追加し、**出荷される `public/sw.js` 本体**を `?raw` で読んで
  （写しを作ると写しだけが正しくなる）ビルドと同じ2箇所のプレースホルダを置換し、
  `self` / `caches` / `fetch` だけ差し替えて評価する。`Response` は Node（undici）のまま使う
  = 実ブラウザと同じ ByteString 検査が効く。13件で以下を固定:
  install の原子性（SHELL 4件＋注入資産の**1回の addAll**・1件失敗で install ごと reject して
  キャッシュに何も残さない）/ activate の旧世代削除と `clients.claim` / **オフライン未キャッシュで
  504 の Response が返る**（statusText に 0xff 超の文字が無いことも直接 assert）/ ナビゲーションの
  シェルへのフォールバックとシェルも無い場合の 504 / cache-first（ヒット時にネットワークへ出ない・
  未キャッシュは取得して入れる・`ok` でない応答は返すが入れない）/ `ignoreVary: true` /
  クロスオリジンと非 GET は `respondWith` しない。
- **回帰テストとして機能することを確認**: 修正を外すと「オフライン未キャッシュで 504」と
  「シェルも無ければ 504」の2件が上記の TypeError で赤くなり、戻すと 13/13 緑。
  `ignoreVary` を落とす変異でもその1件だけが赤くなる（失敗の原因が1対1）。
- 覆えていないもの: 実 CacheStorage の意味論（Vary の突合・容量・LRU）と実ブラウザの
  install/activate ライフサイクル。これは実機・実ブラウザの担当（e2e 手順15）。

## 検証の証拠（実行したコマンドと数値）

docs 更新ステージで最後にもう1回回した実測（他ステージの報告値と一致した）:

| コマンド | 結果 |
|---|---|
| `npm run ci` | **exit 0 / Test Files 40 passed (40) / Tests 801 passed \| 3 skipped (804)**。Phase 6 は 36 files / 729 passed。`skips:check` は「skip 3件 / 全804件（テストファイル 40件・**seed あり**）＝ `src/lib/image/resize.test.ts` の実 canvas 往復のみ」「実データ依存のテスト 3ファイルは skip されず実行された」を出力 |
| `npm run check` | exit 0（`tsc -b` + `eslint .`） |
| `npm run build` | exit 0（`vite build` / SW プリキャッシュ注入 **9件**） |
| `npm audit --audit-level=high` | `found 0 vulnerabilities` |
| `npm run ledger:check` | 緑（**179ファイル**を走査 = 日付166種 × 銘柄/県128種 / 射影3ファイルは対象外 / `docs/evidence/demo-backup.json` は記録27件で**台帳の日付0種・銘柄0種** / `docs/evidence/` の画像は追跡3枚・allowlist 11枚）。docs を更新した後にもう1度回して exit 0 |
| `node scripts/check-attribution.mjs dist/` | 緑（さけのわ / `@svg-maps/japan` の CC-BY 4項目 / `noindex`） |
| `npm test -- linkBrand` | 3 files / **87 passed** |
| `npm test -- domain` | 8 files / **218 passed** |
| `git status --short` | `data/seed/` は現れない。`public/data/sakenowa` も差分なし（手順1の上流差分は `git checkout` で HEAD に戻した） |

赤の実演（CI が本当に検査しているかの確認。すべて復元済み）:

- `src/domain` に `react`・`src/store` に `ui` の import を注入 → `lint` が exit 1 で2件を名指し。復元後 exit 0
- `brand-aliases` の brandId を `2602` → `999999` に変異 → 2件赤。復元後11件緑
- `BackupNag` の閾値を 14/30 → 15/31 に変えると3件赤（閾値は非 export・テスト側はリテラル）
- `persist` を `granted` 固定にすると4件赤（`denied` / `unsupported` を区別している）
- `data/seed/` を退避 → `ci` は exit 0 のまま **skip 22件 / 791件**を名指しし「3/3ファイル未検証」を警告
- `fetch:sakenowa` を2回実行 → `diff -r` で完全一致（`meta.json` 含む。生成物に時刻を入れていない）
- `ledger:check` に合成の結合キーを入れると exit 1、消すと exit 0

**撮っていない証拠**: 実データのスクリーンショットは1枚も撮っていない（B24。画面の証拠は DOM 実測）。
実機（iPhone）のスクリーンショットも無い（**A15 の唯一の証拠なので、これが無い限り A15 は未達**）。

## 受け入れ基準 A1〜A17 の達成状況

`docs/SPEC.md`「受け入れ基準」の17項目を上から A1..A17。**達成 14 / 未達 3（未達はすべて iPhone 実機待ち）**。

| | 基準（要約） | 判定 | 根拠 / 未達の理由 |
|---|---|---|---|
| A1 | `fetch:sakenowa` 6endpoint・gzip ≤200KB | 達成 | 手順1: areas 48 / breweries 1749 / brands **3264** / flavorCharts **1344** / flavorTags 141 / brandFlavorTags **2980**。サイズは `npm run data:check`（`ci` の `invariants`）が毎回検査して緑 |
| A2 | `import:sake-log` が203行を落とさず自己検証 | 達成 | 手順2: **203件**で exit 0。再生成しても追跡ファイルに差分なし（射影が決定的）。**CI では走らない**（入力がリポジトリ外 = B23 に明記） |
| A3 | 186本以上が `auto`/`alias` で紐付く | 達成 | 手順3: `npm test -- linkBrand` 3 files / **87 passed**（auto 173 / alias 13 = **186** / unlinked 12 / unknown 5）。取り込み画面でも紐付け**186** |
| A4 | 回帰: 素で一致していた本数が壊れない | 達成 | 同テストが「素の完全一致は **172本 / 75種**」を brandId ごと固定。**SPEC 本文の「173本」は B1(4) の既知誤りで、実測が正しい** |
| A5 | 17本が `unlinked`/`unknown` として区別され分母から除外 | 達成 | 手順8: 未紐付け12 / 銘柄不明5 = 17。手順10: 「203本中 **185本**のデータで集計（91%）」＋未取得18本の内訳（未紐付け12 / 不明5 / チャート無し1）を画面が出す |
| A6 | 手動紐付けが他4本にも適用され永続化 | 達成 | 手順12: 書き込む前に波及件数を出し、確定で `manual` 5件 / `unlinked` 12→7 / 別名1件。分母 **185→190（93%）**。`src/integration/manualLink.test.tsx` 4件が同じ値を固定（`ci` 内で実行された） |
| A7 | サジェストが3264件でインクリメンタル検索でき**オフラインでも動く** | **未達** | 検索側は達成（手順13 でサジェストから銘柄選択 → 県・蔵・6軸が自動充填）。オフライン側は **Chromium で機構のみ**（配信元を止めて 204件描画・`brands.json` 3264件がキャッシュから読める・その状態で新規1件 → 205件）。**iOS Safari / 機内モードは未検証 = 実機が必要**（e2e手順15） |
| A8 | 長辺400px・1件50KB以下 | 達成 | 手順13: 1280×800 JPEG → **400×250 / 8,073バイト**（実 canvas 経路）。Phase 4 では 3000×4000・9.27MB → 300×400 / 12,896バイト |
| A9 | 4画面が203本の実データで表示される | 達成 | 手順8〜11 の4画面すべて。console の error / warning **0件** |
| A10 | 統計が `sake-log.md` のサマリと一致 | 達成 | 手順9: 総本数**203** / 年別 2020:1 2021:12 **2022:65** 2023:33 2024:31 2025:33 2026:28 / **福島22**・和歌山20・山形17 / 都道府県別 **34区分198本** ＋その他・不明6 |
| A11 | export → サイトデータ削除 → import でサムネイル込み復元 | 達成 | 手順14: 書き出し **86,940バイト**（記録204 / 別名1）→ `indexedDB.deleteDatabase('sake-record')` → 再読込で**0件** → 取り込みで**204件 + 別名1**。サムネイルは Blob **8,073バイト**で一致し `<img>` が 400×250 で描画 |
| A12 | 全画面にさけのわクレジットとリンク | 達成 | 実 Chromium で**4タブすべて**にクレジット4リンクが出ることを確認（Phase 6 の未達だった「フッターの実地確認」をここで回収）。加えて手順6 の `check-attribution.mjs dist/` が緑 |
| A13 | `check-attribution.mjs` がクレジット欠落で CI を落とす | 達成 | 今回は緑の再確認のみ（`ci` の `attribution:check`）。**落ちることの赤の実演は Phase 1 で実施済み**で、今回は再実演していない |
| A14 | `noindex` meta が成果物に含まれる | 達成 | 手順6 の `check-attribution.mjs dist/` が `noindex` を検査して緑 |
| A15 | iOS で下端UIが画面外に出ない（`100dvh`） | **未達** | 機構は入っている（`src/index.css` の `min-height:100vh` は直後の `100dvh` に上書きされるフォールバックのみ / `img{height:auto}` は `@layer base` の中）。しかし **Chromium は `dvh == vh`（実測 `vh == dvh == svh == 900`）なので原理的に検出できない — 実機スクショが唯一の証拠**。**実機が必要** |
| A16 | PWA としてホーム画面追加・機内モードで動作 | **未達** | 機構は確認済み（SW = activated / scope = `/` / caches 13件 = SHELL 4 + precache 9 / manifest の `start_url`・`scope`・`id` = `./`・アイコン4種が 200）。**ホーム画面追加と機内モード起動は iPhone 実機が必要**（e2e手順15）。manifest の `screenshots` は未着手（B42） |
| A17 | ブランド名が `base` と表示文字列以外に出現しない | 達成 | `npm run naming:check`（`ci` の `invariants`）が緑 |

## フェーズ末レビュー

- レビュー所見(code-reviewer):
- 対応した点:
- 積み残し → `docs/BACKLOG.md` に起票した ID:
