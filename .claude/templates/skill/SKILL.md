---
name: skill-template
description: <いつ使うかを明確に。Claude はこの description で起動可否を判断する>
# disable-model-invocation: true   # 副作用がある/自分だけ手動で呼びたいワークフローは有効化(自動起動を止め、文脈コストもゼロに)
---

<!--
skill の雛形。`.claude/skills/<name>/SKILL.md` に置く。ディレクトリ名と name を一致させる。
- 「参照型」= 知識(APIスタイルガイド等)。Claude が必要時に読む。
- 「アクション型」= `/<name> 引数` で起動する手順。`$ARGUMENTS` で引数を受ける。
- 常時効かせたいものは CLAUDE.md、たまに要るものだけ skill に。
-->

# <Skill 名>

目的: <この skill が与える知識 or 実行する手順>

手順 / 内容:
1.
2.
