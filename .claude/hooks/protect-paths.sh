#!/usr/bin/env bash
# PreToolUse(Edit|Write|MultiEdit|NotebookEdit) ガードレール。
# 保護パスへの編集を決定論的にブロックする。CLAUDE.md の「編集禁止」指示は要求にすぎず強制力がないため、
# 確実に止めたいものは hook にする。
# Docs: https://code.claude.com/docs/en/hooks  (exit 2 でブロック / JSON permissionDecision: deny でも可)
set -uo pipefail

# 保護対象。basename で照合するファイル名パターンと、フルパスで照合するディレクトリパターン。
PROTECT_BASENAMES=(".env" ".env.*" "*.pem" "*.key")
PROTECT_PATHS=("*/secrets/*" "*/.ssh/*" "*/node_modules/*")

input="$(cat)"

# tool_input.file_path / notebook_path を取り出す(jq があれば jq、無ければ python3)。
file_path=""
if command -v jq >/dev/null 2>&1; then
  file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' 2>/dev/null)"
elif command -v python3 >/dev/null 2>&1; then
  file_path="$(printf '%s' "$input" | python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: print(""); raise SystemExit
ti=d.get("tool_input") or {}
print(ti.get("file_path") or ti.get("notebook_path") or "")' 2>/dev/null)"
fi

# パスが取れなければ何もしない。
[ -n "$file_path" ] || exit 0
base="$(basename "$file_path")"

deny() {
  local reason="保護パスへの編集をブロックしました: $file_path (パターン: $1)。意図的なら手動で編集してください。"
  # exit 2 + stderr が最も移植性が高い(stderr は Claude にフィードバックされる)。
  printf '%s\n' "$reason" >&2
  exit 2
}

for p in "${PROTECT_BASENAMES[@]}"; do
  # shellcheck disable=SC2254
  case "$base" in $p) deny "$p" ;; esac
done
for p in "${PROTECT_PATHS[@]}"; do
  # shellcheck disable=SC2254
  case "$file_path" in $p) deny "$p" ;; esac
done

exit 0
