#!/usr/bin/env bash
# SessionStart hook: 着手前に必要な最小コンテキスト(branch + BACKLOG進捗)を提示する。
# 「セッション開始時に BACKLOG を読む」を CLAUDE.md の指示(お願い)から決定論的な提示に格上げする。
# SessionStart の stdout(JSON additionalContext)は Claude のコンテキストに渡る。
# Docs: https://code.claude.com/docs/en/hooks
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

branch="$(git branch --show-current 2>/dev/null || echo '(no git)')"

backlog=""
if [ -f docs/BACKLOG.md ]; then
  # 「## 進捗」セクションの中身を数行だけ抜く。
  backlog="$(awk '/^## 進捗/{f=1;next} /^## /{f=0} f' docs/BACKLOG.md | grep -v '^[[:space:]]*$' | head -5)"
fi

ctx="branch: ${branch}"
[ -n "$backlog" ] && ctx="${ctx}
進捗(docs/BACKLOG.md):
${backlog}"

if command -v jq >/dev/null 2>&1; then
  jq -n --arg c "$ctx" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}'
elif command -v python3 >/dev/null 2>&1; then
  python3 -c 'import json,sys; print(json.dumps({"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":sys.argv[1]}}))' "$ctx"
fi
exit 0
