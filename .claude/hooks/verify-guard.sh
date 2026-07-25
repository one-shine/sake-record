#!/usr/bin/env bash
# Stop hook のガード。verify.sh を呼ぶ前に「マルチエージェントのワークフローが進行中か」を見る。
#
# なぜ必要か: 複数のサブエージェントが並列でファイルを書くワークフローでは、ステージの途中で
# ツリーが正当に不整合になる（例: records.test.ts が先に書かれ records.ts がまだ無い）。
# その状態で `npm run check` を Stop hook にすると、ターン終了が毎回ブロックされ、
# 実装が進んでいないかのように見えてしまう。一方でフックを外すと、通常のターンで
# 型エラーを抱えたまま終わる事故を捕まえられなくなる。
#
# そこで「進行中なら通し、停止中なら検証する」にする。進行中の判定は、ワークフローの
# トランスクリプト（agent-*.jsonl）が直近 WINDOW_MIN 分に更新されているかで行う。
# ワークフローが落ちたり終わったりすれば数分後に自動で検証が復活する（明示的な解除操作が不要）。
#
# 注意: 判定には -mmin を使う。GNU の -newermt は macOS の find に無く、
# 指定しても**エラーにならず空を返す**ため、常に「停止中」と誤判定して意味を失う（実測で踏んだ）。
set -uo pipefail

WINDOW_MIN=3
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# このプロジェクトのワークフロー・トランスクリプト置き場（セッションごとにディレクトリが分かれる）。
# VERIFY_GUARD_WF_GLOB で差し替えられるのはテストのため（進行中/停止中の両経路を確かめる）。
WF_GLOB="${VERIFY_GUARD_WF_GLOB:-$HOME/.claude/projects/-Users-kazuki-Documents-claude-project-saketime/*/subagents/workflows}"

for d in $WF_GLOB; do
  [ -d "$d" ] || continue
  if find "$d" -type f -name 'agent-*.jsonl' -mmin "-$WINDOW_MIN" 2>/dev/null | grep -q .; then
    printf 'ワークフローが進行中のため検証をスキップしました（%s 分以内にエージェントの更新あり）。\n' "$WINDOW_MIN" >&2
    exit 0
  fi
done

# 進行中でなければ通常の検証ゲートに委譲する（VERIFY_CMD はこの hook の呼び出し側が渡す）
exec "$HOOK_DIR/verify.sh"
