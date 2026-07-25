// sake-log.md(brain 側の飲酒ログ)の `## 全記録` 表を行に落とす純関数。
//
// **なぜ scripts/ ではなくここに置くか**: 元 markdown はリポジトリ外(brain)にあるので、
// 取り込みスクリプトの中で自己検証しても CI では一度も走らない。「表/裏ラベルの2組を
// dedupe しない」のような構造上の不変条件は、リテラルの markdown で単体テストできる形に
// 置かないと守れない(PHASE_2 の完了条件)。scripts/import-sake-log.mjs はこの関数を呼ぶだけの
// 薄い殻(ファイル入出力と「203件であること」の確認)にして、パースの実装をここ1本に限る。
//
// 依存は無し(React も node も触らない)。文字列 → 行の射影だけで、紐付けも集計もしない。

/** 表の1行。列は `| No. | 日付 | 銘柄 | 都道府県 | スペック | 備考 |` の6列固定 */
export type SakeLogRow = {
  /** 1..N の連番。`drankOn` は同日に最大6〜7件あるので、行を識別できるのはこれだけ */
  no: number
  /** 'YYYY-MM-DD' */
  drankOn: string
  /** 本人が書いた生の銘柄表記(正規化前) */
  brandLabel: string
  /** 日本語の県名。未記入は空文字 */
  prefecture: string
  /** 「純米大吟醸 無濾過生原酒」等の自由文。未記入は空文字 */
  spec: string
  /** 未記入は空文字 */
  note: string
}

/**
 * `problems` が空でなければ元 markdown の形が想定と違う。**行を捨てずに全部返す**
 * (呼び出し側が全問題を一度に印字できるように、最初の1件で止めない)。
 */
export type ParsedSakeLog = {
  rows: SakeLogRow[]
  problems: string[]
}

/**
 * ファイルには表が3つある(`よく飲む銘柄` / `都道府県別` / `全記録`)。「最初の表」や
 * 「`|` で始まる行」を取ると別の表を食って件数が壊れるので、見出しをアンカーにして
 * その節の中の「第1セルが数字」の行だけを消費する。
 */
const ANCHOR = '## 全記録'
const NEXT_HEADING_RE = /^##\s/
const ROW_RE = /^\|\s*\d+\s*\|/
const EXPECTED_CELLS = 6
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function parseSakeLog(markdown: string): ParsedSakeLog {
  const lines = markdown.split('\n')
  const anchorAt = lines.findIndex((line) => line.trim() === ANCHOR)
  if (anchorAt === -1) {
    return { rows: [], problems: [`見出し "${ANCHOR}" が無い。どの表が全記録か特定できない`] }
  }
  const endAt = lines.findIndex((line, i) => i > anchorAt && NEXT_HEADING_RE.test(line))
  const section = lines.slice(anchorAt + 1, endAt === -1 ? lines.length : endAt)

  const rows: SakeLogRow[] = []
  const problems: string[] = []

  for (const raw of section) {
    const line = raw.trim()
    if (!ROW_RE.test(line)) continue

    const parts = line.split('|')
    if (parts[0] !== '' || parts[parts.length - 1] !== '') {
      problems.push(`表の行が想定形でない — 両端が "|" でない: ${line}`)
      continue
    }
    // 空セルは半角スペース2つで書かれているので全セル trim が必須。
    const cells = parts.slice(1, -1).map((cell) => cell.trim())
    if (cells.length !== EXPECTED_CELLS) {
      problems.push(`表の行が想定形でない — ${cells.length}セル(期待 ${EXPECTED_CELLS}): ${line}`)
      continue
    }

    const [no, drankOn, brandLabel, prefecture, spec, note] = cells
    // **dedupe しない**。表/裏ラベルの写真が別々に数えられている2組
    // (2025-12-08 赤武 / 2025-12-12 加茂錦)は日付も銘柄も完全に同じで、内容では区別できない。
    // 「重複行」として畳むと静かに201本になる。両者を分けるのは No. だけ。
    rows.push({ no: Number(no), drankOn, brandLabel, prefecture, spec, note })
  }

  // No. 昇順に並べたうえで検証する(元 markdown の行順が崩れていても同じ結論になるように)。
  rows.sort((a, b) => a.no - b.no)
  problems.push(...invariantProblems(rows))
  return { rows, problems }
}

/** 件数に依存しない構造不変条件。「203件であること」は呼び出し側(データ固有の期待値)で見る */
function invariantProblems(rows: readonly SakeLogRow[]): string[] {
  const problems: string[] = []

  const seen = new Set<number>()
  for (const row of rows) {
    if (seen.has(row.no)) problems.push(`No. ${row.no} が重複している`)
    seen.add(row.no)
  }
  for (let no = 1; no <= rows.length; no++) {
    if (!seen.has(no)) problems.push(`No. ${no} が欠番`)
  }

  for (const row of rows) {
    if (!DATE_RE.test(row.drankOn)) {
      problems.push(`No. ${row.no} の日付 "${row.drankOn}" が YYYY-MM-DD でない`)
    }
  }

  // 日付が単調非減少であること(ISO8601 なので辞書順比較で足りる)。
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].drankOn < rows[i - 1].drankOn) {
      problems.push(
        `日付が単調非減少でない: No. ${rows[i - 1].no}(${rows[i - 1].drankOn}) → No. ${rows[i].no}(${rows[i].drankOn})`,
      )
    }
  }

  return problems
}
