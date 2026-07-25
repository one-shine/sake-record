// 統計画面のテスト。**投入データは全部合成**(架空の銘柄・架空の日付)。実台帳の
// 「日付 × 銘柄/県」の対はテストコードに1行も書かない — その1行で台帳の1行が復元でき、
// コミットしてある射影2本を突き合わせる鍵になる(`npm run ledger:check` が見張っている)。
// 日付は実台帳の範囲外の年(1900 / 1996-1999)だけを使い、県名と同じ行に置いても結合キーに
// ならないようにしてある。
//
// このファイルが固定している事故は7つ:
//  1. **数値がテキストで出る**。棒の長さだけで数を語らない(SVG の中に `<text>` を置かない
//     ことも見張る — 座標系を `preserveAspectRatio="none"` で潰しているので、
//     中に文字を入れると歪む。歪みは jsdom では検出できないので構造で禁じる)
//  2. **棒の長さが値に比例している**(常に最大幅で描く実装に退化しても数字だけは合うので、
//     `rect` の width/height 属性まで見る)
//  3. **「重複計上」の説明が出る**。延べ件数が総本数を超えるのは定義どおりで、
//     説明が無いと数え間違いに見える(PHASE_6 の完了条件)
//  4. **0件の行が消えない**(`本醸造` の0は実測値。行を消すと「0本」と「数えていない」が同義になる)。
//     同時に、その語が値を持つときは1件として出ること(=条件が死んでいないこと)も見る
//  5. **県が読めない記録が別枠で件数付きで出る**。県別の棒に混ぜない・丸めない
//  6. **年の 0 埋めは範囲が狭いときだけ**。誤入力の年1件で柱が数十本に増えない
//  7. **0件のときは「0」を並べた表を出さず、空状態を出す**
//
// 期待値はリテラルで書く(実装から import して比べると恒真になる。BACKLOG B15)。
// 唯一の例外は「`computeStats` とドリフトしていない」ことを見る1ケースで、そこだけは
// 画面が自分で数え始めたら落ちるように domain の戻り値と突き合わせる。

import { render, screen, within } from '@testing-library/react'
import { computeStats } from '../../domain/stats.ts'
import type { SakeRecord } from '../../domain/types.ts'
import { Dashboard } from './Dashboard.tsx'

function rec(over: Partial<SakeRecord> & { id: string }): SakeRecord {
  return {
    drankOn: '1996-01-01',
    brandLabel: '合成銘柄',
    sakenowaBrandId: null,
    brandName: null,
    linkStatus: 'unlinked',
    prefecture: null,
    spec: '',
    rating: null,
    place: '',
    note: '',
    thumbnail: null,
    sourceNo: null,
    createdAt: '1996-01-01T00:00:00.000Z',
    updatedAt: '1996-01-01T00:00:00.000Z',
    ...over,
  }
}

/**
 * 7本の合成記録。全節に「別枠に落ちる記録」を1本以上含めてある:
 *   年     … 1997:2 / 1999:4、日付が読めない 1
 *   県     … 福島県2 / 山形県1 / 和歌山県1、決まらない表記 1、未記入 2
 *   スタイル … 延べ11件(> 7本)。`純米吟醸` と `本醸造` は0件
 *   評価   … 1:1 / 3:1 / 5:1、未評価 4
 */
const SET_A: readonly SakeRecord[] = [
  rec({ id: 'a1', drankOn: '1997-03-01', prefecture: '福島県', spec: '純米大吟醸', rating: 5 }),
  rec({ id: 'a2', drankOn: '1997-06-01', prefecture: '福島県', spec: '純米 無濾過生原酒' }),
  rec({ id: 'a3', drankOn: '1999-01-05', prefecture: '山形県', spec: '大吟醸', rating: 3 }),
  rec({ id: 'a4', drankOn: '1999-02-05', spec: '', rating: null }),
  rec({ id: 'a5', drankOn: '1999-03-05', prefecture: '静岡県または京都府', spec: 'にごり', rating: 1 }),
  // 日付の形が違う1本。県は読めるので県別には入り、年別からだけ外れる
  rec({ id: 'a6', drankOn: '1999-4-5', prefecture: '和歌山県', spec: 'ひやおろし' }),
  rec({ id: 'a7', drankOn: '1999-03-06', spec: 'しぼりたて' }),
]

/** 横棒の行 → `{ label, count }`。`<li>` の直下は span / svg / span の順 */
function barRows(name: string): { label: string; count: string }[] {
  return itemsOf(name).map((item) => {
    const spans = [...item.querySelectorAll(':scope > span')]
    return { label: spans[0]?.textContent ?? '', count: spans.at(-1)?.textContent ?? '' }
  })
}

/** 縦棒の列 → `{ label, count }`。こちらは件数が上・ラベルが下なので span の順が逆 */
function columnRows(name: string): { label: string; count: string }[] {
  return itemsOf(name).map((item) => {
    const spans = [...item.querySelectorAll(':scope > span')]
    return { label: spans.at(-1)?.textContent ?? '', count: spans[0]?.textContent ?? '' }
  })
}

function itemsOf(name: string): HTMLElement[] {
  return within(screen.getByRole('list', { name })).getAllByRole('listitem')
}

/**
 * 画面は集計しない(`computeStats` の呼び出しは App の1箇所だけ)ので、テストも**同じ経路**で
 * `Stats` を作って渡す。ここで期待値を `stats` から取っているわけではない — 期待値は各ケースに
 * リテラルで書いてある(実装から import して比べると恒真になる。B15)。
 */
function renderDashboard(records: readonly SakeRecord[]) {
  return render(<Dashboard stats={computeStats(records)} />)
}

/** 値の矩形(軌道の次)の幅。横棒は width、縦棒は height に比例させている */
function valueRect(item: HTMLElement): Element {
  const rects = item.querySelectorAll('rect')
  const rect = rects[rects.length - 1]
  if (rect === undefined) throw new Error('棒の矩形が無い')
  return rect
}

describe('Dashboard', () => {
  it('総本数と5つの節を出す', () => {
    renderDashboard(SET_A)

    // 総本数は数字そのものをテキストで出す(グラフの中に隠さない)
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('本の記録')).toBeInTheDocument()

    for (const heading of ['総本数', '年別', '都道府県別', 'スタイル分布', '評価']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    }
  })

  it('年別は本数と年をテキストで併記し、間の年を0本の柱で埋める', () => {
    renderDashboard(SET_A)

    expect(columnRows('年別の本数')).toEqual([
      { label: '1997', count: '2' },
      { label: '1998', count: '0' },
      { label: '1999', count: '4' },
    ])
    expect(screen.getByText(/記録が無い年も0本の柱として置き/)).toBeInTheDocument()
  })

  it('日付が読めない記録を年別の外に件数付きで出す', () => {
    renderDashboard(SET_A)
    expect(screen.getByText(/読めない記録 1本/)).toBeInTheDocument()
  })

  it('年の範囲が広すぎるときは0埋めせず、軸が連続でないことを書く', () => {
    renderDashboard([
      rec({ id: 'w1', drankOn: '1900-01-02' }),
      rec({ id: 'w2', drankOn: '1999-01-02' }),
    ])

    // 100本の柱を生やさない
    expect(columnRows('年別の本数')).toEqual([
      { label: '1900', count: '1' },
      { label: '1999', count: '1' },
    ])
    expect(screen.getByText(/記録が無い年の柱は置いていない/)).toBeInTheDocument()
  })

  it('都道府県別を本数の多い順に、名前と本数のテキストで出す', () => {
    renderDashboard(SET_A)

    expect(barRows('都道府県別の本数')).toEqual([
      { label: '福島県', count: '2' },
      { label: '山形県', count: '1' },
      { label: '和歌山県', count: '1' },
    ])
    // 区分の数と合計(未記入は含めない)を明示する
    expect(screen.getByText(/4区分に5本/)).toBeInTheDocument()
  })

  it('県名が決まらない表記と未記入を別枠で件数表示し、県別の棒に混ぜない', () => {
    renderDashboard(SET_A)

    expect(barRows('都道府県が読めなかった記録')).toEqual([
      { label: '静岡県または京都府', count: '1' },
      { label: '都道府県が未記入', count: '2' },
    ])
    expect(screen.getByText(/合計 3本 は都道府県が特定できていない/)).toBeInTheDocument()

    const resolved = screen.getByRole('list', { name: '都道府県別の本数' })
    expect(within(resolved).queryByText('静岡県または京都府')).toBeNull()
    expect(within(resolved).queryByText('都道府県が未記入')).toBeNull()
  })

  it('県がすべて読めるときは「その他 / 不明」の別枠を出さない', () => {
    renderDashboard([rec({ id: 'p1', prefecture: '福島県' })])
    expect(screen.queryByRole('list', { name: '都道府県が読めなかった記録' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'その他 / 不明' })).toBeNull()
  })

  it('スタイル分布は重複計上だと明記し、延べ件数が総本数を超える理由を書く', () => {
    renderDashboard(SET_A)

    expect(screen.getByText(/重複計上/)).toBeInTheDocument()
    expect(screen.getByText(/延べ 11件 が総本数 7本 を超えるのは正しい/)).toBeInTheDocument()
    // 対象列を画面でも言う(備考を含めると数が変わる)
    expect(screen.getByText(/備考（メモ）は数えない/)).toBeInTheDocument()
    expect(screen.getByText(/どの語にも当たらない記録 1本/)).toBeInTheDocument()
  })

  it('スタイル分布は語彙の順で、0件の語も行として残す', () => {
    renderDashboard(SET_A)

    expect(barRows('スタイル別の本数')).toEqual([
      { label: '純米大吟醸', count: '1' },
      { label: '大吟醸', count: '2' },
      { label: '純米吟醸', count: '0' },
      { label: '純米', count: '2' },
      { label: '本醸造', count: '0' },
      { label: '生原酒', count: '1' },
      { label: '無濾過', count: '1' },
      { label: '原酒', count: '1' },
      { label: 'ひやおろし', count: '1' },
      { label: 'しぼりたて', count: '1' },
      { label: 'にごり', count: '1' },
    ])
  })

  it('0件だった語も、その語を持つ記録があれば件数として出る', () => {
    // 期待値が常に0の行だけを見ていると「語を打ち間違えて永久に0件」に気付けない
    renderDashboard([rec({ id: 'h1', spec: '本醸造' })])
    expect(barRows('スタイル別の本数')).toContainEqual({ label: '本醸造', count: '1' })
  })

  it('評価は1〜5の段をすべて出し、未評価を別枠の件数で出す', () => {
    renderDashboard(SET_A)

    expect(barRows('評価別の本数')).toEqual([
      { label: '1 / 5', count: '1' },
      { label: '2 / 5', count: '0' },
      { label: '3 / 5', count: '1' },
      { label: '4 / 5', count: '0' },
      { label: '5 / 5', count: '1' },
    ])
    expect(screen.getByText(/評価済み 3本 \/ 未評価 4本/)).toBeInTheDocument()
  })

  it('全件が未評価でも段を消さず、そう書く', () => {
    renderDashboard([rec({ id: 'u1' }), rec({ id: 'u2' })])

    expect(barRows('評価別の本数').map((row) => row.count)).toEqual(['0', '0', '0', '0', '0'])
    expect(screen.getByText(/まだ1本も評価を付けていない/)).toBeInTheDocument()
  })

  it('棒の長さが値に比例する(横棒は幅・縦棒は高さ)', () => {
    renderDashboard(SET_A)

    const prefectures = itemsOf('都道府県別の本数')
    // 最大(2本)が100%、その半分(1本)が50%
    expect(valueRect(prefectures[0]).getAttribute('width')).toBe('100')
    expect(valueRect(prefectures[1]).getAttribute('width')).toBe('50')

    const years = itemsOf('年別の本数')
    expect(valueRect(years[0]).getAttribute('height')).toBe('50')
    // 0本の柱は高さ0(行は残るが棒は伸びない)
    expect(valueRect(years[1]).getAttribute('height')).toBe('0')
    expect(valueRect(years[2]).getAttribute('height')).toBe('100')
  })

  it('SVG は装飾に留め、数値を SVG の文字として描かない', () => {
    const { container } = renderDashboard(SET_A)

    const svgs = [...container.querySelectorAll('svg')]
    expect(svgs.length).toBeGreaterThan(0)
    for (const svg of svgs) {
      // 非等比に潰した座標系なので、中に文字を置くと必ず歪む(jsdom では検出できない)
      expect(svg.getAttribute('preserveAspectRatio')).toBe('none')
      expect(svg.getAttribute('aria-hidden')).toBe('true')
      expect(svg.querySelector('text')).toBeNull()
    }
  })

  it('日本語ラベルの折り返しを対で直してある(行に flex-wrap / 原子ラベルに nowrap)', () => {
    renderDashboard(SET_A)

    const unit = screen.getByText('本の記録')
    expect(unit).toHaveClass('whitespace-nowrap')
    expect(unit.parentElement).toHaveClass('flex-wrap')

    const row = itemsOf('都道府県別の本数')[0]
    expect(row).toHaveClass('flex-wrap')
    const spans = [...row.querySelectorAll(':scope > span')]
    expect(spans[0]).toHaveClass('whitespace-nowrap')
    expect(spans.at(-1)).toHaveClass('whitespace-nowrap')
  })

  it('画面の数が computeStats とドリフトしていない(画面が自分で数え始めたら落ちる)', () => {
    const stats = computeStats(SET_A)
    renderDashboard(SET_A)

    expect(screen.getByText(String(stats.total))).toBeInTheDocument()
    // 0埋めした年を除けば、柱は domain の返した年と件数そのまま
    const observed = columnRows('年別の本数').filter((row) => row.count !== '0')
    expect(observed).toEqual(
      stats.years.map((entry) => ({ label: entry.year, count: String(entry.count) })),
    )
    expect(barRows('都道府県別の本数')).toEqual(
      stats.prefectures.map((entry) => ({ label: entry.name, count: String(entry.count) })),
    )
    expect(barRows('スタイル別の本数')).toEqual(
      stats.styles.map((entry) => ({ label: entry.term, count: String(entry.count) })),
    )
  })

  it('0件では「0」を並べず、空状態を出す', () => {
    renderDashboard([])

    expect(screen.getByText('まだ集計できる記録が無い')).toBeInTheDocument()
    // 0 の行が1つも無い(表そのものを出さない)
    expect(screen.queryAllByRole('list')).toHaveLength(0)
    expect(screen.queryByText('本の記録')).toBeNull()
    // 何が見えるようになるかを書く(「実装されていない」で終わらせない)
    expect(screen.getByText(/総本数・年別・都道府県別・スタイル分布（重複計上）・評価分布/)).toBeInTheDocument()
    expect(screen.getByText(/「記録」タブ/)).toBeInTheDocument()
  })
})
