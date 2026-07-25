---
name: phase-review
description: 実装フェーズ完了時に検証を回し diff をレビューする。気になる点・スコープ外の発見を docs/BACKLOG.md に起票し、フェーズ状態を更新する。/phase-review <Phase番号> で呼ぶ
disable-model-invocation: true
---

フェーズ末レビューを行う。対象フェーズ: $ARGUMENTS

1. 該当フェーズの diff を把握する(`git diff`)。`docs/phases/PHASE_<n>.md` の完了条件と突き合わせる。
2. 検証を実行する: テスト・型チェック・ビルド。失敗は根本原因を直す(抑制しない)。**証拠**(出力)を残す。
3. `code-reviewer` subagent に diff をレビューさせる(正しさ・SPEC/PLAN 逸脱のみ。スタイルや過剰指摘はしない)。同梱の `/code-review` も併用してよい。
4. 完了条件を満たしていれば `PHASE_<n>.md` と `PLAN.md` のフェーズ状態を done にする。満たさなければ残タスクを明示する。
5. **気になる点・スコープ外の発見・積み残しは `docs/BACKLOG.md` に ID 付きで起票**する(次フェーズへ回す)。
6. 結果(レビュー所見・対応・起票ID)を `PHASE_<n>.md` の「フェーズ末レビュー」に記録する。
