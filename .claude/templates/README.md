# .claude/templates — 雛形(コピー元)

ここのファイルは Claude Code に**ロードされない**(機能ディレクトリ `rules/` `skills/` `agents/` の外にあるため)。
新しい rule / skill / agent を作るときに、ここからコピーして所定の場所に置く。雛形を機能ディレクトリ直下に置くと、phantom skill/agent として登録されたり、rule が誤って適用されるので注意。

| 雛形 | コピー先 |
|---|---|
| `rule.md` | `.claude/rules/<topic>.md`（パス別にするなら frontmatter の `paths:` を設定／不要なら frontmatter ごと削除し常時ロード） |
| `skill/SKILL.md` | `.claude/skills/<name>/SKILL.md`（ディレクトリ名 = frontmatter の `name` に揃える） |
| `agent.md` | `.claude/agents/<name>.md` |

docs 系の雛形(`SPEC_TEMPLATE` / `PLAN_TEMPLATE` / `PHASE_TEMPLATE` / `BACKLOG_TEMPLATE`)は `docs/` 配下。`docs/` は Claude Code の機能ディレクトリではないので、そのまま置いてコピーして使う。
