#!/usr/bin/env bash
# Stop hook: ターン終了をチェック(テスト/ビルド)が緑になるまでブロックする検証ゲート。
# VERIFY_CMD が未設定なら no-op(テンプレートとして安全)。プロジェクトの確認コマンドを設定して有効化する。
# 失敗時は exit 2 で停止を抑止し、stderr が Claude に渡る。Claude Code は8回連続ブロックで上書きして終了する。
# Docs: https://code.claude.com/docs/en/hooks#stop
set -uo pipefail

# 例: VERIFY_CMD="npm test --silent"  /  VERIFY_CMD="make verify"
VERIFY_CMD="${VERIFY_CMD:-}"
[ -n "$VERIFY_CMD" ] || exit 0

input="$(cat)"

# 既にこの hook が起点で停止抑止中なら、再帰ループを避けて素通りする。
active=""
if command -v jq >/dev/null 2>&1; then
  active="$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)"
elif command -v python3 >/dev/null 2>&1; then
  active="$(printf '%s' "$input" | python3 -c 'import sys,json
try: print(str(json.load(sys.stdin).get("stop_hook_active", False)).lower())
except Exception: print("false")' 2>/dev/null)"
fi
[ "$active" = "true" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

if out="$(eval "$VERIFY_CMD" 2>&1)"; then
  exit 0
else
  status=$?
  printf '検証に失敗しました (%s が exit %s)。エラーを抑制せず根本原因を直してから終了してください。\n\n%s\n' \
    "$VERIFY_CMD" "$status" "$out" >&2
  exit 2
fi
