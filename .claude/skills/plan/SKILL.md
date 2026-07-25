---
name: plan
description: docs/SPEC.md を入力に実装計画 docs/PLAN.md を作る。大規模ならフェーズに分割し docs/phases/ へ切り出す。/plan で呼ぶ
disable-model-invocation: true
---

実装計画を立てる。対象: $ARGUMENTS

1. plan mode を推奨。`docs/SPEC.md` と関連コードを読み、Explore 所見をまとめる。
2. `docs/PLAN_TEMPLATE.md` に沿って `docs/PLAN.md` を書く: Explore所見・設計方針・規模判定。
3. **小規模**(1文で差分を言える)なら「単一の段取り」で完結。フェーズ分割しない(過剰なプロセスを避ける)。
4. **大規模**なら「完了判定できる単位」でフェーズに分け、各フェーズを `docs/phases/PHASE_n.md`(目的・タスク・完了条件・検証)に切り出す。`PLAN.md` はフェーズ index にする。
5. `docs/BACKLOG.md` が無ければ `docs/BACKLOG_TEMPLATE.md` から作り、進捗を Phase1 着手前の状態に初期化する。
6. 書き込み前に方針(段取り/フェーズ分割の有無)を提示して確認を取る。
