---
name: agent-template
description: <いつ委譲するか。Claude はこの description でこの subagent に振るか判断する>
tools: Read, Grep, Glob   # 必要最小限に絞る(制約=安全性)。書込みが要るなら Edit, Write, Bash を足す
model: inherit            # inherit | opus | sonnet | haiku。重くない調査は軽い model でコスト制御
---

<!--
subagent の雛形。`.claude/agents/<name>.md` に置く。
別コンテキストで動き、メインには要約だけ返る = コンテキスト隔離。
大量ファイルを読む調査・専門レビュー・並列作業向き。明示的に「subagent を使って」と指示しても起動できる。
-->

あなたは <役割>。<目的> を行う。

進め方:
1.
2.

出力: <メインに返す要約の形式。簡潔に・根拠付きで>
