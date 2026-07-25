# PHASE 7 — 実機 / 月次更新 / バックアップ督促 / リリース

## 目的 / 完了条件

- 目的: A7(オフライン) / A15 / A16 を**実機で**証明し、運用を自動化してリリースする。
- 完了条件(満たせば done):
  - [ ] **iPhone 実機**: 公開URLをホーム画面に追加 → **機内モード**で起動 → 記録の閲覧と新規作成（銘柄サジェスト含む）ができる（**A7 / A16**、e2e手順15）
  - [ ] **実機で下端のUIが切れない**（**A15**）。Chromium は `dvh == vh` なのでブラウザ自動化では検出できない — **実機スクショが唯一の証拠**
  - [ ] `npm run ci` が緑、`npm audit --audit-level=high` が緑
  - [ ] `update-sakenowa.yml` を `workflow_dispatch` で1回実走させ、(a) 差分なしならコミットしない (b) `data:check` と `test` を**コミット前に**通す (c) 差分ありならコミット → **デプロイまで到達する**ことを観測した（B9）
  - [ ] `navigator.storage.persist()` を初回書き込み時に要求。iOS Safari は無視するので、初回に「ホーム画面に追加すると消えにくい」と案内する（B7）
  - [ ] 最終エクスポートからの経過日数警告（14日で注意 / 30日で強め）。SPEC「アプリ側で経過日数を警告表示して緩和する」
  - [ ] **A1〜A17 の17項目全部にチェックが入り、各々に証拠**（コマンド出力 or スクショ）が PHASE ファイルに貼られている
  - [ ] `docs/BACKLOG.md` の残 open が把握されている → `/release`

## タスク

- [ ] `.github/workflows/update-sakenowa.yml`
- [ ] `src/store/meta.ts` — `lastExportedAt`
- [ ] `src/ui/ImportExport/BackupNag.tsx`
- [ ] `public/screenshots/mobile-1.png` / `desktop-1.png`（manifest 用）
- [ ] `README.md`
- [ ] 組み込みエイリアス8件の brandId が `brands.json` に存在することのテスト（上流から消えたら月次ジョブが赤で止まり、ぶら下がったエイリアスが出荷されない）

### 月次更新ワークフローの設計

`schedule` + `workflow_dispatch` / `permissions: contents: write` / `git diff --quiet -- public/data/sakenowa` ガード。要点2つ:

1. **検査をコミットの前に置く**（`fetch` → `data:check` → `test` → 差分判定 → commit → deploy）。順序が逆だと壊れたデータが main に入って自動デプロイまで走る
2. **`GITHUB_TOKEN` で push したコミットは他 workflow の `on: push` を再トリガしない** → `deploy-pages.yml` に `on: workflow_call` を足して**このジョブから直接呼ぶ**（PAT も `repository_dispatch` も不要）。コードベース初のコミットバックなので手動実行で1回目で見る

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

## フェーズ末レビュー

- レビュー所見(code-reviewer):
- 対応した点:
- 積み残し → `docs/BACKLOG.md` に起票した ID:
