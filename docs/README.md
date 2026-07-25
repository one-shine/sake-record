# docs — spec駆動 開発プロセス

要件 → 仕様 → 実装計画 →(大規模はフェーズ分割)→ フェーズ実装 → フェーズ末レビュー → 課題はBACKLOGへ → リリース、を回す。
公式の **Explore→Plan→Code→Commit** と「検証を必ず付ける / 別文脈でレビューする」を、プロジェクトの文書運用に落としたもの。

## 流れ

1. **詰める(Explore)** — plan mode で探索する、または `/spec` で interview する。
2. **仕様 `SPEC.md`** — 自己完結(対象ファイル/IF・スコープ外・end-to-end検証)。`/spec` が `SPEC_TEMPLATE.md` に沿って書く。
3. **実装計画 `PLAN.md`** — `/plan` が SPEC を入力に作る。Explore所見 + 段取り + 規模判定。
   - 大規模 → **フェーズ分割**。各フェーズを `phases/PHASE_n.md`(目的・タスク・完了条件・検証)に切り出し、`PLAN.md` はフェーズ index にする。
4. **フェーズ実装** — 着手前に `BACKLOG.md`(進捗)を読む。1フェーズ = 完了判定できる単位。各フェーズに検証を持たせる。
5. **フェーズ末レビュー** — `/phase-review <n>`: 検証を回し、`code-reviewer` subagent で diff をレビュー。**気になる点・スコープ外の発見・積み残しは `BACKLOG.md` に ID 付きで起票**。PHASE / PLAN の状態を更新する。
6. **次フェーズへ** — レビューの課題を反映して続行。BACKLOG が進捗の正典。
7. **リリース** — `/release`。

## 正典(single source of truth)

| 何 | ファイル |
|---|---|
| 仕様(今の姿) | `SPEC.md` |
| 進捗・課題 | `BACKLOG.md`（セッション開始時にまず読む） |
| 各フェーズ詳細・完了条件 | `phases/PHASE_n.md` |
| 実装計画 / フェーズ index | `PLAN.md` |

## テンプレの使い方

`*_TEMPLATE.md` をコピーして `SPEC.md` / `PLAN.md` / `BACKLOG.md` を作る。フェーズは `phases/PHASE_TEMPLATE.md` を `phases/PHASE_1.md` 等に。
**小規模(1文で差分を言える)ならフェーズ分割は省略**し、`PLAN.md` 1枚で進めてよい(過剰なプロセスは避ける)。
