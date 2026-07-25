// @vitest-environment node
// 元 markdown(brain/40_Resources/sake-log.md)はリポジトリ外なので、CI で回せるのは
// **リテラルの markdown に対するパースの振る舞い**だけ。ここが唯一の防波堤:
// scripts/import-sake-log.mjs の自己検証は元ファイルが手元にある人しか実行しない。
import { parseSakeLog } from './parseSakeLog.ts'

const HEADER = '| No. | 日付 | 銘柄 | 都道府県 | スペック | 備考 |'
const DIVIDER = '|---|---|---|---|---|---|'

/** `## 全記録` 節だけを持つ最小の markdown。行はリテラルで渡す */
const doc = (...rows: readonly string[]): string =>
  ['## 全記録', '', HEADER, DIVIDER, ...rows, ''].join('\n')

/**
 * 実ファイルと同じ構成: 表が3つあり、`全記録` より前の2表にも「第1セルが数字」の行がある。
 * 空セルは半角スペース2つ。**同日・同銘柄で内容も同じ2件を2組**含む(同一ボトルの表/裏ラベルを
 * 別々に1本として数えている実データの再現 — この2組は PHASE_2 の完了条件そのもの)。
 *
 * **日付・銘柄・備考はすべて架空。** 実台帳の値は1つも書かない(公開リポジトリに
 * 「日付と銘柄の対」を残さない。BACKLOG B22 / `npm run ledger:check` が全ファイルを見張る)。
 * 日付は実台帳の範囲外の年にしてある。
 */
const THREE_TABLES = [
  '# 飲酒ログ',
  '',
  '## よく飲む銘柄',
  '',
  '| 銘柄 | 本数 |',
  '|---|---|',
  '| 1 | テスト酒 |',
  '| 2 | サンプル酒 |',
  '',
  '## 都道府県別',
  '',
  '| 都道府県 | 本数 |',
  '|---|---|',
  '| 1 | 架空県 |',
  '',
  '## 全記録',
  '',
  HEADER,
  DIVIDER,
  '| 1 | 2019-01-05 | テスト酒 | 架空県 | 純米酒 |  |',
  '| 2 | 2019-01-05 | テスト酒 | 架空県 | 純米酒 |  |',
  '| 3 | 2019-01-09 | サンプル酒 | 仮想県 |  | 備考A |',
  '| 4 | 2019-01-09 | サンプル酒 | 仮想県 |  | 備考B |',
  '| 5 | 2019-02-03 | 不明 |  |  |  |',
  '',
  '## 次の節',
  '',
  '| 9 | 2019-03-01 | 節の外の酒 | 東京都 |  |  |',
  '',
].join('\n')

describe('`## 全記録` 節だけを食う', () => {
  it('前後の表を取り込まない(見出しがアンカー / 節は次の `##` で終わる)', () => {
    const { rows, problems } = parseSakeLog(THREE_TABLES)
    expect(problems).toEqual([])
    expect(rows).toHaveLength(5)
    expect(rows.map((row) => row.no)).toEqual([1, 2, 3, 4, 5])
    // 「最初の表」や「`|` で始まる行」を取ると 2列の集計表を食って壊れる
    expect(rows.map((row) => row.brandLabel)).not.toContain('架空県')
    // 節の外(次の見出し以降)の行も食わない
    expect(rows.map((row) => row.brandLabel)).not.toContain('節の外の酒')
  })

  it('6列を順番どおりに読む', () => {
    const { rows } = parseSakeLog(THREE_TABLES)
    expect(rows[2]).toEqual({
      no: 3,
      drankOn: '2019-01-09',
      brandLabel: 'サンプル酒',
      prefecture: '仮想県',
      spec: '',
      note: '備考A',
    })
  })

  it('空セル(半角スペース2つ)は空文字になる', () => {
    const { rows } = parseSakeLog(THREE_TABLES)
    expect(rows[4].prefecture).toBe('')
    expect(rows[4].spec).toBe('')
    expect(rows[4].note).toBe('')
    expect(rows[0].note).toBe('')
  })

  it('見出しが無ければ1行も返さずに問題として報告する', () => {
    const { rows, problems } = parseSakeLog(['## 全記録録', HEADER, DIVIDER, '| 1 | x |'].join('\n'))
    expect(rows).toEqual([])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('## 全記録')
  })
})

describe('内容が同じ行を dedupe しない(PHASE_2 の完了条件)', () => {
  // 同一ボトルの表/裏ラベルの写真が別々に1本として数えられている組が実データに2つある。
  // 素朴な dedupe を入れると203本が静かに201本になり、しかも「件数が合わない」以外の症状が
  // 出ない。実データのどの2組かはここに書かない(合成データで同じ構造を再現する)。
  it('同日・同銘柄で内容も同じ2件が、2組とも各2件として残る', () => {
    const { rows } = parseSakeLog(THREE_TABLES)
    const same = (drankOn: string, brandLabel: string) =>
      rows.filter((row) => row.drankOn === drankOn && row.brandLabel === brandLabel)

    expect(same('2019-01-05', 'テスト酒')).toHaveLength(2)
    expect(same('2019-01-09', 'サンプル酒')).toHaveLength(2)
    // 区別できるのは No. だけ(日付・銘柄・県・スペックは完全に同じ)
    expect(same('2019-01-05', 'テスト酒').map((row) => row.no)).toEqual([1, 2])
    expect(rows).toHaveLength(5)
  })

  it('6列すべてが同一の行も落とさない', () => {
    const { rows, problems } = parseSakeLog(
      doc('| 1 | 2026-01-01 | 同じ酒 | 東京都 | 純米 | 同じ備考 |', '| 2 | 2026-01-01 | 同じ酒 | 東京都 | 純米 | 同じ備考 |'),
    )
    expect(problems).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ ...rows[1], no: 1 })
  })
})

describe('構造不変条件を問題として返す', () => {
  it('セル数が6でない行', () => {
    const { problems } = parseSakeLog(doc('| 1 | 2026-01-01 | 酒 | 東京都 | 純米 |'))
    expect(problems).toEqual([
      '表の行が想定形でない — 5セル(期待 6): | 1 | 2026-01-01 | 酒 | 東京都 | 純米 |',
    ])
  })

  it('セルに `|` が入った行(7セルになる)', () => {
    const { rows, problems } = parseSakeLog(doc('| 1 | 2026-01-01 | 酒 | 東京都 | 純米|生 |  |'))
    expect(rows).toEqual([])
    expect(problems[0]).toContain('7セル(期待 6)')
  })

  it('日付が YYYY-MM-DD でない行', () => {
    const { problems } = parseSakeLog(doc('| 1 | 2026/01/01 | 酒 | 東京都 |  |  |'))
    expect(problems).toEqual(['No. 1 の日付 "2026/01/01" が YYYY-MM-DD でない'])
  })

  it('日付が単調非減少でない', () => {
    const { problems } = parseSakeLog(
      doc('| 1 | 2026-01-02 | 酒 | 東京都 |  |  |', '| 2 | 2026-01-01 | 酒 | 東京都 |  |  |'),
    )
    expect(problems).toEqual([
      '日付が単調非減少でない: No. 1(2026-01-02) → No. 2(2026-01-01)',
    ])
  })

  it('No. の重複と欠番', () => {
    const { problems } = parseSakeLog(
      doc('| 1 | 2026-01-01 | 酒 | 東京都 |  |  |', '| 1 | 2026-01-02 | 酒 | 東京都 |  |  |'),
    )
    expect(problems).toEqual(['No. 1 が重複している', 'No. 2 が欠番'])
  })

  it('No. が 1 から始まらない', () => {
    const { problems } = parseSakeLog(doc('| 2 | 2026-01-01 | 酒 | 東京都 |  |  |'))
    expect(problems).toEqual(['No. 1 が欠番'])
  })

  it('日付は形式だけを見る(暦として不正な値は通す)', () => {
    // 不変条件は `^\d{4}-\d{2}-\d{2}$` と単調非減少の2つだけ(PHASE_2)。年別集計は先頭4桁しか
    // 見ないので、ここで暦の妥当性まで見ない。通ることを明示しておく(黙って通すのと違う)
    const { rows, problems } = parseSakeLog(doc('| 1 | 2026-13-99 | 酒 | 東京都 |  |  |'))
    expect(problems).toEqual([])
    expect(rows[0].drankOn).toBe('2026-13-99')
  })

  it('問題が複数あればすべて返す(最初の1件で止めない)', () => {
    const { rows, problems } = parseSakeLog(
      doc('| 1 | 2026-01-01 | 酒 | 東京都 |  |', '| 3 | 2026-1-1 | 酒 | 東京都 |  |  |'),
    )
    expect(rows).toHaveLength(1)
    expect(problems).toEqual([
      '表の行が想定形でない — 5セル(期待 6): | 1 | 2026-01-01 | 酒 | 東京都 |  |',
      'No. 1 が欠番',
      'No. 3 の日付 "2026-1-1" が YYYY-MM-DD でない',
    ])
  })
})

describe('行順', () => {
  it('markdown 側の行順が崩れていても No. 昇順で返す', () => {
    const { rows, problems } = parseSakeLog(
      doc('| 2 | 2026-01-02 | 後の酒 | 東京都 |  |  |', '| 1 | 2026-01-01 | 先の酒 | 東京都 |  |  |'),
    )
    expect(problems).toEqual([])
    expect(rows.map((row) => row.brandLabel)).toEqual(['先の酒', '後の酒'])
  })
})
