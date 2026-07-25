#!/usr/bin/env bash
# PostToolUse(Edit|Write|MultiEdit): 編集したファイルを整形/lintする。
# PostToolUse はツール実行後に走るため非ブロッキング(失敗しても編集は取り消されない)。
# フォーマッタが未インストールなら何もしない(no-op)。テンプレートとして安全な既定。
set -uo pipefail

input="$(cat)"

file_path=""
if command -v jq >/dev/null 2>&1; then
  file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""' 2>/dev/null)"
elif command -v python3 >/dev/null 2>&1; then
  file_path="$(printf '%s' "$input" | python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: print(""); raise SystemExit
print((d.get("tool_input") or {}).get("file_path") or "")' 2>/dev/null)"
fi

[ -n "$file_path" ] || exit 0
[ -f "$file_path" ] || exit 0

run() { command -v "$1" >/dev/null 2>&1 && "$@" >/dev/null 2>&1 || true; }

# プロジェクト内の devDependency を先に見る。素の `prettier` は PATH に無いのが普通で、
# それだけを探すとこのフックは恒久 no-op になる。
prettier_bin="prettier"
if [ -x "${CLAUDE_PROJECT_DIR:-.}/node_modules/.bin/prettier" ]; then
  prettier_bin="${CLAUDE_PROJECT_DIR:-.}/node_modules/.bin/prettier"
fi

case "$file_path" in
  # .mjs / .cjs も対象に含める(scripts/*.mjs がここから漏れていた)
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.css|*.scss|*.md|*.html|*.yaml|*.yml)
    run "$prettier_bin" --write "$file_path" ;;
  *.py)
    run ruff format "$file_path" ;;
  *.go)
    run gofmt -w "$file_path" ;;
  *.rs)
    run rustfmt "$file_path" ;;
esac

exit 0
