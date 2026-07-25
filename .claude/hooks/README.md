# hooks

ライフサイクルイベントで決定論的に走るスクリプト。CLAUDE.md の指示と違い**必ず発火する**ので、
「毎回必ず起きてほしいこと」「確実に止めたいこと」をここに置く。登録は `.claude/settings.json` の `hooks`。

| スクリプト | イベント / matcher | 役割 | ブロック |
|---|---|---|---|
| `session-context.sh` | `SessionStart` / `startup\|resume` | 着手前に branch + BACKLOG 進捗を提示(additionalContext) | 非ブロッキング |
| `protect-paths.sh` | `PreToolUse` / `Edit\|Write\|MultiEdit\|NotebookEdit` | 保護パス(.env, secrets/ 等)の編集を拒否 | exit 2 で編集をブロック |
| `format.sh` | `PostToolUse` / `Edit\|Write\|MultiEdit` | 編集ファイルを整形(prettier/ruff/gofmt/rustfmt) | 非ブロッキング(未インストールなら no-op) |
| `verify.sh` | `Stop` | テスト/ビルドが緑になるまでターン終了を抑止 | `VERIFY_CMD` 設定時のみ。失敗で exit 2 |

## 仕組み(公式)
- hook は stdin に JSON を受け、**exit 0=成功 / exit 2=ブロック(stderr が Claude に渡る)**。
- `PreToolUse` の exit 2 = ツール呼び出しをブロック。`Stop` の exit 2 = 停止を抑止(8回連続で上書き終了)。`PostToolUse` はツール実行後なので非ブロッキング。
- パスは `${CLAUDE_PROJECT_DIR}` 起点。実行権限が必要: `chmod +x .claude/hooks/*.sh`。
- JSON 解析は `jq` があれば `jq`、無ければ `python3` を使う(両方無い環境では素通り)。

## 有効化・調整
- `verify.sh` は既定 no-op。プロジェクトの確認コマンドを設定して有効化する:
  例) `settings.json` の Stop hook に環境変数を渡すか、スクリプト内 `VERIFY_CMD` を編集。
- `protect-paths.sh` の保護対象は `PROTECT_BASENAMES` / `PROTECT_PATHS` を編集。
- 強制ではなく「指針」でよいものは hook でなく `.claude/rules/` に。permission で弾けるもの(秘密の読取等)は `settings.json` の `deny` に。
- 登録状況は `/hooks` で確認できる。
