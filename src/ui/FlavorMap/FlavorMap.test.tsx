import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FlavorMap } from './FlavorMap.tsx'
import type { FlavorChart, LinkStatus, SakeRecord } from '../../domain/types.ts'

// **合成データだけを使う。** 実際の飲酒記録(日付と銘柄の対)はテストに書かない
// (`data/seed/` は gitignore 済み。フレーバーの集計は「銘柄 × 6軸値」が同じ表に並ぶので、
//  実データを写すと台帳の結合キーそのものになる。`npm run ledger:check`)。
//
// 写すのは**件数の形だけ**(203 / 185 / 12 / 5 / 1)。件数は docs で公開済みの集計値で、
// これが分母の内訳として画面に出ることがこのフェーズの主目的(B29 / B1(3))。
// 日付は台帳の範囲外の1種、銘柄名は架空、6軸の値も架空にしてある。

const SYNTHETIC_DATE = '1999-01-01'

let seq = 0

function record(partial: Partial<SakeRecord> = {}): SakeRecord {
  seq += 1
  return {
    id: `r${String(seq)}`,
    drankOn: SYNTHETIC_DATE,
    brandLabel: `てすと酒${String(seq)}`,
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
    createdAt: '1999-01-01T00:00:00.000Z',
    updatedAt: '1999-01-01T00:00:00.000Z',
    ...partial,
  }
}

function linked(brandId: number, status: LinkStatus = 'auto'): SakeRecord {
  return record({
    sakenowaBrandId: brandId,
    brandName: `さけのわ銘柄${String(brandId)}`,
    linkStatus: status,
  })
}

type Values = readonly [number, number, number, number, number, number]

function chart(brandId: number, [f1, f2, f3, f4, f5, f6]: Values): FlavorChart {
  return { brandId, f1, f2, f3, f4, f5, f6 }
}

/** 6軸を同じ値で埋める(軸ごとの取り違えを見ないテスト用) */
function flat(brandId: number, value: number): FlavorChart {
  return chart(brandId, [value, value, value, value, value, value])
}

function charts(...list: readonly FlavorChart[]): ReadonlyMap<number, FlavorChart> {
  return new Map(list.map((c) => [c.brandId, c]))
}

// ---------------------------------------------------------------------------
// 実測の件数の形を合成で作る(値・日付・銘柄は架空)
// ---------------------------------------------------------------------------

/** 6軸で違う値にしておく。平均の表示が軸ごとに区別できる */
const BASE_VALUES: Values = [20, 30, 40, 50, 60, 70]
/** 手動紐付けで増える5本。平均を確実に動かすため base と離した値にする */
const EXTRA_VALUES: Values = [100, 100, 100, 100, 100, 100]

/**
 * 203本 = フレーバー取得済み185 + 未紐付け12 + 銘柄不明5 + チャート無し1。
 *
 * `manualLinked` は「未紐付け5本を手動で紐付けた後」の状態(分母 185 → 190)。
 * チャートは紐付ける前から表に載っている — **状態が `unlinked` の間は引かない**のが約束。
 */
function buildLedger({ manualLinked }: { manualLinked: boolean }): {
  records: SakeRecord[]
  flavorCharts: ReadonlyMap<number, FlavorChart>
} {
  const records: SakeRecord[] = []
  const list: FlavorChart[] = []

  // 185本: 紐付き & チャート有り
  for (let index = 0; index < 185; index += 1) {
    const brandId = 900000 + index
    list.push(chart(brandId, BASE_VALUES))
    records.push(linked(brandId))
  }
  // 5本: 手動紐付けの対象。紐付け前は未紐付け(表にチャートはある)
  for (let index = 0; index < 5; index += 1) {
    const brandId = 910000 + index
    list.push(chart(brandId, EXTRA_VALUES))
    records.push(manualLinked ? linked(brandId, 'manual') : record({ linkStatus: 'unlinked' }))
  }
  // 残り7本の未紐付け(紐付け前は合計12本)
  for (let index = 0; index < 7; index += 1) records.push(record({ linkStatus: 'unlinked' }))
  // 銘柄不明5本
  for (let index = 0; index < 5; index += 1) records.push(record({ linkStatus: 'unknown' }))
  // 紐付き & チャート無し1本(186 と 185 の差)
  records.push(linked(990001))

  return { records, flavorCharts: new Map(list.map((c) => [c.brandId, c])) }
}

// ---------------------------------------------------------------------------
// 取り出し
// ---------------------------------------------------------------------------

function sectionOf(heading: string): HTMLElement {
  const section = screen.getByRole('heading', { name: heading }).closest('section')
  if (section === null) throw new Error(`「${heading}」の節が見つからない`)
  return section
}

const radarSection = () => sectionOf('6軸の平均')
const coverageSection = () => sectionOf('なぞった領域と空白地帯')

/** 未取得3種の行。ラベルは `Timeline/linkStatus.ts` の対応表から出ている */
function missingRow(label: string): HTMLElement {
  const row = screen.getByText(label).closest('li')
  if (row === null) throw new Error(`「${label}」の行が見つからない`)
  return row
}

/** 網掛け(fill が pattern 参照)のセル = 図の上の空白地帯 */
function hatchedCells(): Element[] {
  return [...coverageSection().querySelectorAll('rect')].filter((rect) =>
    (rect.getAttribute('fill') ?? '').startsWith('url(#'),
  )
}

// ---------------------------------------------------------------------------

describe('分母と内訳', () => {
  it('分母と未取得3種の内訳を出す(185 だけでなく 12 / 5 / 1 も)', () => {
    const { records, flavorCharts } = buildLedger({ manualLinked: false })
    render(<FlavorMap records={records} flavorChartByBrandId={flavorCharts} />)

    expect(screen.getByText(/203本中 185本のデータで集計/)).toBeInTheDocument()
    expect(screen.getByText(/フレーバー未取得は 18本/)).toBeInTheDocument()

    // 3種を1つに潰さない。「チャート無し 1本」が 186 ≠ 185 の差の出所
    expect(missingRow('未紐付け')).toHaveTextContent('12本')
    expect(missingRow('銘柄不明')).toHaveTextContent('5本')
    expect(missingRow('チャート無し')).toHaveTextContent('1本')

    // B29 の恒久策: 紐付けが分母に効くことを画面で言う
    expect(screen.getByText(/手動紐付けすると銘柄が決まり、この分母が増える/)).toBeInTheDocument()
    expect(screen.getByText(/推定値は入れない/)).toBeInTheDocument()
  })

  it('分母が変われば表示が変わる(手動紐付けで 185 → 190)', () => {
    const before = buildLedger({ manualLinked: false })
    const { rerender } = render(
      <FlavorMap records={before.records} flavorChartByBrandId={before.flavorCharts} />,
    )

    expect(screen.getByText(/203本中 185本のデータで集計/)).toBeInTheDocument()
    expect(missingRow('未紐付け')).toHaveTextContent('12本')
    // f1 の平均。185本すべて 20 なので 20.0
    expect(within(radarSection()).getByText('20.0')).toBeInTheDocument()

    const after = buildLedger({ manualLinked: true })
    rerender(<FlavorMap records={after.records} flavorChartByBrandId={after.flavorCharts} />)

    expect(screen.getByText(/203本中 190本のデータで集計/)).toBeInTheDocument()
    expect(screen.queryByText(/203本中 185本のデータで集計/)).not.toBeInTheDocument()
    expect(missingRow('未紐付け')).toHaveTextContent('7本')
    // (185 × 20 + 5 × 100) / 190 = 22.105… → 平均も動く(整数に丸めると見えなくなる差)
    expect(within(radarSection()).getByText('22.1')).toBeInTheDocument()
    expect(within(radarSection()).queryByText('20.0')).not.toBeInTheDocument()
  })
})

describe('推定値を入れない', () => {
  it('unlinked の記録の値は6軸に現れない(件数だけ数える)', () => {
    // 表にはチャートを入れておく。**status を無視して brandId でチャートを引く実装**なら
    // 平均が 20.0 から 43.3 に動いてここで落ちる(壊れた記録: unlinked なのに brandId がある)。
    const records = [
      linked(1),
      linked(2),
      record({ linkStatus: 'unlinked', sakenowaBrandId: 3 }),
    ]
    render(
      <FlavorMap
        records={records}
        flavorChartByBrandId={charts(flat(1, 20), flat(2, 20), flat(3, 90))}
      />,
    )

    expect(screen.getByText(/3本中 2本のデータで集計/)).toBeInTheDocument()
    expect(missingRow('未紐付け')).toHaveTextContent('1本')

    const radar = radarSection()
    // 6軸すべてが 20.0(90 が混ざれば 43.3 になる)
    expect(within(radar).getAllByText('20.0')).toHaveLength(6)
    expect(radar.textContent ?? '').not.toContain('90')
    expect(radar.textContent ?? '').not.toContain('43.3')

    // 散布図の点も2つだけ(未紐付けの1本を薄い点として描いてもいない)
    expect(coverageSection().querySelectorAll('circle')).toHaveLength(2)
  })
})

describe('分母0', () => {
  it('NaN / Infinity を出さず、平均を出せないと言う', () => {
    const records = [
      record({ linkStatus: 'unlinked' }),
      record({ linkStatus: 'unlinked' }),
      record({ linkStatus: 'unknown' }),
    ]
    render(<FlavorMap records={records} flavorChartByBrandId={charts(flat(1, 50))} />)

    expect(screen.getByText(/3本中 0本のデータで集計/)).toBeInTheDocument()
    expect(screen.getByText(/平均を出せない/)).toBeInTheDocument()
    expect(screen.getByText(/空白地帯も判定できない/)).toBeInTheDocument()
    // 件数0の行も消さない(3種の区別を保つ)
    expect(missingRow('チャート無し')).toHaveTextContent('0本')

    expect(document.body.textContent ?? '').not.toMatch(/NaN|Infinity/)
    // 0 で埋めた平均も、全面が空白の図も描かない
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(document.querySelectorAll('circle')).toHaveLength(0)
  })

  it('記録が0本なら集計できないと言う(0本中0本と書かない)', () => {
    render(<FlavorMap records={[]} flavorChartByBrandId={charts(flat(1, 50))} />)

    expect(screen.getByText(/記録が1本も無いので集計できない/)).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toMatch(/NaN|Infinity/)
    expect(screen.queryByText(/データで集計/)).not.toBeInTheDocument()
  })
})

describe('空白地帯', () => {
  /** 3本すべて 6軸 10 → どの面も左下のセルだけに載る。1面 16セルのうち 15セルが空白 */
  function renderNarrow() {
    const records = [linked(1), linked(2), linked(3)]
    render(
      <FlavorMap
        records={records}
        flavorChartByBrandId={charts(flat(1, 10), flat(2, 10), flat(3, 10))}
      />,
    )
  }

  it('全体の空白セル数と、選んだ面の空白セル数を出す', () => {
    renderNarrow()

    // 2軸15面 × 16セル = 240セル。1面あたり15セルが空白なので 225
    expect(screen.getByText(/240セル中 225セルに記録が1本も無い/)).toBeInTheDocument()
    expect(screen.getByText('16セル中 15セルが空白')).toBeInTheDocument()
  })

  it('図に網掛けのセル、度数表に 0 のセルを描く(色だけに頼らない)', () => {
    renderNarrow()

    expect(hatchedCells()).toHaveLength(15)
    expect(coverageSection().querySelectorAll('pattern')).toHaveLength(1)

    const table = screen.getByRole('table')
    // 空白セルの 0 が15個。範囲の見出し(`0〜24`)は別の文字列なので混ざらない
    expect(within(table).getAllByText('0')).toHaveLength(15)
    expect(within(table).getByText('3')).toBeInTheDocument()
  })

  it('面を切り替えると図と表がその面になる', async () => {
    const user = userEvent.setup()
    renderNarrow()

    expect(screen.getByText('16セル中 15セルが空白')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: /重厚 × 軽快/ })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    await user.click(button)

    expect(button).toHaveAttribute('aria-pressed', 'true')
    const face = screen.getByText('16セル中 15セルが空白').closest('p')
    expect(face).not.toBeNull()
    expect(face).toHaveTextContent('重厚 × 軽快')
    // 表の見出しも切り替わる
    expect(screen.getByRole('table')).toHaveTextContent('重厚')
  })

  // 転置は例外を出さずに「空白がどの味の領域か」を入れ替える。全軸同じ値の合成データでは
  // 見えないので、x と y をはっきり違うビンに置いて向きを固定する。
  it('図と度数表の向きが domain の counts[x][y] と一致する(転置していない)', () => {
    // 既定の面は f1 × f2。華やか(f1)=10 は左端のビン、芳醇(f2)=90 は上端のビン
    render(
      <FlavorMap
        records={[linked(1)]}
        flavorChartByBrandId={charts(chart(1, [10, 90, 10, 10, 10, 10]))}
      />,
    )

    const rows = within(screen.getByRole('table')).getAllByRole('row')
    // 行は y の高い側から並ぶので、見出し行の次が 芳醇 75〜100
    const topRow = rows[1]
    expect(within(topRow).getByRole('rowheader')).toHaveTextContent('75〜100')
    const cells = within(topRow).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('1') // 華やか 0〜24
    expect(cells[3]).toHaveTextContent('0') // 華やか 75〜100

    // 散布図の点も左上に落ちる(viewBox から相対で見る。座標の定数はここに写さない)
    const svg = coverageSection().querySelector('svg')
    const [, , width, height] = (svg?.getAttribute('viewBox') ?? '').split(' ').map(Number)
    const circle = svg?.querySelector('circle')
    expect(Number(circle?.getAttribute('cx'))).toBeLessThan(width / 2)
    expect(Number(circle?.getAttribute('cy'))).toBeLessThan(height / 2)
  })

  it('15面すべてを面ごとの空白件数つきで出す', () => {
    renderNarrow()

    const faces = screen.getAllByRole('button', { pressed: false })
    // 6軸から2つ取る15面のうち、選択中の1つは pressed: true なので14
    expect(faces).toHaveLength(14)
    expect(screen.getAllByText('空白 15/16')).toHaveLength(15)
  })
})

describe('軸ラベル', () => {
  // f1..f6 = 華やか / 芳醇 / 重厚 / 穏やか / ドライ / 軽快。**値と対で検査する** —
  // ラベルの有無だけを見ると、対応表が入れ替わっていても6語そろって緑になる(恒真述語)。
  const AXES: readonly [string, string][] = [
    ['華やか', '20.0'],
    ['芳醇', '30.0'],
    ['重厚', '40.0'],
    ['穏やか', '50.0'],
    ['ドライ', '60.0'],
    ['軽快', '70.0'],
  ]

  it('6軸のラベルを f1..f6 の値と対で出す', () => {
    render(<FlavorMap records={[linked(1)]} flavorChartByBrandId={charts(chart(1, BASE_VALUES))} />)

    const radar = radarSection()
    for (const [label, value] of AXES) {
      const text = within(radar).getByText(label)
      expect(text).toBeInTheDocument()
      // ラベルと値は同じ <g> に入っている(軸1本ぶんの組)
      expect(text.closest('g')).toHaveTextContent(value)
    }
  })
})
