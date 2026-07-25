// @vitest-environment node
// domain 層のテストは jsdom を要求しない。node 環境で回すこと自体がその実証で、
// window/document に触る実装が混ざった瞬間にこのファイルが落ちる。
//
// **合成データのみを使う。** 実台帳(`data/seed/`)も射影 fixture も読まない:
// フレーバーの集計は (銘柄, 都道府県) と 6軸値が同じ表に並ぶので、実データを書くと
// 台帳の結合キーそのものになる(privacy 規約 / `npm run ledger:check`)。
// 実データの 203/186/185 は検証ステージがブラウザで確認する。ここで固定するのは**規則**。

import {
  FLAVOR_AXIS_KEYS,
  FLAVOR_AXIS_PAIRS,
  FLAVOR_BINS,
  computeFlavor,
  flavorBinIndex,
} from './flavor.ts'
import type { FlavorChart, FlavorAxisKey, LinkStatus, SakeRecord } from './types.ts'

// ---------------------------------------------------------------------------
// 合成データの組み立て
// ---------------------------------------------------------------------------

/** 台帳の範囲外の日付を使う(実データと取り違えられない値にする) */
const SYNTHETIC_DATE = '1999-01-01'

let seq = 0

function record(partial: Partial<SakeRecord> = {}): SakeRecord {
  seq += 1
  return {
    id: `r${seq}`,
    drankOn: SYNTHETIC_DATE,
    brandLabel: `てすと酒${seq}`,
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

/** 紐付け済みの記録。`status` の既定は `auto` */
function linked(brandId: number, status: LinkStatus = 'auto', extra: Partial<SakeRecord> = {}) {
  return record({
    sakenowaBrandId: brandId,
    brandName: `さけのわ銘柄${brandId}`,
    linkStatus: status,
    ...extra,
  })
}

type Values = readonly [number, number, number, number, number, number]

function chart(brandId: number, [f1, f2, f3, f4, f5, f6]: Values): FlavorChart {
  return { brandId, f1, f2, f3, f4, f5, f6 }
}

function charts(...list: readonly FlavorChart[]): ReadonlyMap<number, FlavorChart> {
  return new Map(list.map((c) => [c.brandId, c]))
}

const EMPTY_CHARTS: ReadonlyMap<number, FlavorChart> = new Map()

/** 6軸を同じ値で埋める(軸ごとの取り違えを見たいテスト以外で使う) */
function flat(brandId: number, value: number): FlavorChart {
  return chart(brandId, [value, value, value, value, value, value])
}

/** ある点が2軸射影のどのセルに落ちるか(実装と別経路で数えるための素朴版) */
function cellOf(chartLike: FlavorChart, x: FlavorAxisKey, y: FlavorAxisKey): [number, number] {
  const binOf = (value: number) =>
    FLAVOR_BINS.findIndex((bin) => value >= bin.min && value <= bin.max)
  return [binOf(chartLike[x]), binOf(chartLike[y])]
}

const CELLS_PER_FACE = FLAVOR_BINS.length * FLAVOR_BINS.length
const ALL_CELLS = FLAVOR_AXIS_PAIRS.length * CELLS_PER_FACE

// ---------------------------------------------------------------------------

describe('未取得の3種を別々に数える', () => {
  // 186(紐付け済み) と 185(フレーバー取得済み) の差を説明できる状態を保つ。
  // 3種を1つの「未取得」に潰すと、差が1本あるのに理由が読めなくなる。
  it('unlinked / unknown / linkedWithoutChart を混ぜない', () => {
    const records = [
      linked(1),
      linked(2, 'alias'),
      linked(3, 'manual'),
      // 紐付いているがチャートが無い(= ビキニ娘の合成版)
      linked(4),
      record({ linkStatus: 'unlinked', brandLabel: 'てすと寫楽' }),
      record({ linkStatus: 'unlinked', brandLabel: 'てすと寫楽' }),
      record({ linkStatus: 'unknown', brandLabel: '不明' }),
    ]
    const summary = computeFlavor(records, charts(flat(1, 50), flat(2, 50), flat(3, 50)))

    expect(summary.total).toBe(7)
    expect(summary.denominator).toBe(3)
    expect(summary.missing).toEqual({ unlinked: 2, unknown: 1, linkedWithoutChart: 1 })
  })

  // これが 186 ≠ 185 を分ける唯一の仕組みなので明示的に固定する。
  it('紐付け済みでもチャートが無い記録は分母から外れる(linkedWithoutChart で数える)', () => {
    const withChart = [linked(1), linked(2), linked(3)]
    const withoutChart = linked(999)
    const tables = charts(flat(1, 10), flat(2, 20), flat(3, 30))

    const before = computeFlavor(withChart, tables)
    const after = computeFlavor([...withChart, withoutChart], tables)

    expect(before.denominator).toBe(3)
    expect(after.denominator).toBe(3) // 総数は増えても分母は増えない
    expect(after.total).toBe(4)
    expect(after.missing.linkedWithoutChart).toBe(1)
    expect(after.missing.unlinked).toBe(0)
    // 平均も動かない = 欠けた1本を0で埋めていない
    expect(after.axes).toEqual(before.axes)
  })

  // 定義域外のキーで「表の別の行」に落ちてはいけない(全件フォールバック禁止の系)。
  it('brandId が表に無いときは他の銘柄のチャートを借りない', () => {
    const summary = computeFlavor([linked(777)], charts(flat(1, 100)))

    expect(summary.denominator).toBe(0)
    expect(summary.axes).toBeNull()
    expect(summary.points).toEqual([])
    expect(summary.missing.linkedWithoutChart).toBe(1)
  })

  // 実データでは起きない(createLinker は unlinked/unknown で brandId を null にする)が、
  // 壊れた JSON から来た記録に対しても「推定値で埋めない」を status 側で守る。
  it('unlinked/unknown はチャートを引ける brandId を持っていても集計しない', () => {
    const records = [
      record({ linkStatus: 'unlinked', sakenowaBrandId: 1 }),
      record({ linkStatus: 'unknown', sakenowaBrandId: 2 }),
    ]
    const summary = computeFlavor(records, charts(flat(1, 100), flat(2, 100)))

    expect(summary.denominator).toBe(0)
    expect(summary.axes).toBeNull()
    expect(summary.missing).toEqual({ unlinked: 1, unknown: 1, linkedWithoutChart: 0 })
  })

  // 紐付いた status なのに brandId が無い記録(壊れた JSON)。引くキーが無いので集計できない。
  // `unlinked` に数え替えると「本人が未紐付けにした」ことになるので linkedWithoutChart に入れる。
  it('紐付いた status で brandId が null の記録は linkedWithoutChart に落ちる', () => {
    const summary = computeFlavor(
      [record({ linkStatus: 'auto', sakenowaBrandId: null, brandName: 'なにか' })],
      charts(flat(1, 100)),
    )

    expect(summary.denominator).toBe(0)
    expect(summary.missing).toEqual({ unlinked: 0, unknown: 0, linkedWithoutChart: 1 })
  })

  it('分母と未取得3種の合計が総数と一致する(どこにも数え漏れが無い)', () => {
    const records = [
      linked(1),
      linked(2, 'alias'),
      linked(3, 'manual'),
      linked(4),
      linked(5),
      record({ linkStatus: 'unlinked' }),
      record({ linkStatus: 'unknown' }),
      record({ linkStatus: 'unknown' }),
    ]
    const summary = computeFlavor(records, charts(flat(1, 1), flat(2, 2), flat(3, 3)))
    const { unlinked, unknown, linkedWithoutChart } = summary.missing

    expect(summary.denominator + unlinked + unknown + linkedWithoutChart).toBe(summary.total)
    expect(summary.total).toBe(records.length)
  })

  it('列挙外の linkStatus は「紐付いている」側に寄せる(未紐付けに格上げしない)', () => {
    // 壊れた値を unlinked に丸めると「本人が未紐付けにした」と嘘をつくことになる。
    // ui/Timeline/linkStatus.ts の isLinkedStatus と同じ扱い。
    const broken = linked(1, 'いつかの5値目' as LinkStatus)
    const summary = computeFlavor([broken], charts(flat(1, 40)))

    expect(summary.denominator).toBe(1)
    expect(summary.missing).toEqual({ unlinked: 0, unknown: 0, linkedWithoutChart: 0 })
  })
})

describe('6軸の平均', () => {
  // 未取得を0として混ぜた実装だと必ず値が変わる形にする。
  it('取得済みのレコードだけで平均する(未取得を0で埋めない)', () => {
    const records = [
      linked(1),
      linked(2),
      record({ linkStatus: 'unlinked' }),
      record({ linkStatus: 'unknown' }),
      linked(999), // チャート無し
    ]
    const summary = computeFlavor(records, charts(flat(1, 100), flat(2, 80)))

    expect(summary.denominator).toBe(2)
    // 取得済み2本の平均 = 90。0を混ぜて5で割ると 36 になる
    for (const key of FLAVOR_AXIS_KEYS) {
      expect(summary.axes?.[key], key).toBe(90)
    }
    expect(summary.axes?.f1).not.toBe(36)
  })

  // 軸を取り違える実装(f1 の合計を f2 に足す等)を検出するため、軸ごとに違う値を入れる。
  it('6軸をそれぞれ独立に平均する', () => {
    const records = [linked(1), linked(2)]
    const tables = charts(chart(1, [0, 20, 40, 60, 80, 100]), chart(2, [10, 30, 50, 70, 90, 0]))
    const summary = computeFlavor(records, tables)

    expect(summary.axes).toEqual({ f1: 5, f2: 25, f3: 45, f4: 65, f5: 85, f6: 50 })
  })

  it('平均を丸めない(丸めは表示層の関心)', () => {
    const summary = computeFlavor([linked(1), linked(2)], charts(flat(1, 0), flat(2, 1)))

    expect(summary.axes?.f1).toBe(0.5)
  })

  it('同じ銘柄を複数回飲んだ記録は本数ぶん重みを持つ', () => {
    // 銘柄で重複排除しない。集計の単位は「飲んだ本数」であって「銘柄数」ではない。
    const summary = computeFlavor(
      [linked(1), linked(1), linked(2)],
      charts(flat(1, 90), flat(2, 0)),
    )

    expect(summary.denominator).toBe(3)
    expect(summary.axes?.f1).toBe(60)
  })

  it('FLAVOR_AXIS_KEYS は f1..f6 の6軸(順序込み)', () => {
    expect(FLAVOR_AXIS_KEYS).toEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'f6'])
  })
})

describe('分母が0のとき', () => {
  it('全件が未取得ならゼロ除算せず axes は null', () => {
    const records = [
      record({ linkStatus: 'unlinked' }),
      record({ linkStatus: 'unknown' }),
      linked(1), // チャート無し
    ]
    const summary = computeFlavor(records, EMPTY_CHARTS)

    expect(summary.denominator).toBe(0)
    expect(summary.axes).toBeNull()
    expect(summary.points).toEqual([])
    expect(summary.total).toBe(3)
    // 0/0 = NaN を軸の平均として返していない(null で「出せない」と言う)。
    // NaN は JSON にすると null に化けるので、型ではなく値で見る
    expect(Object.is(summary.axes, null)).toBe(true)
  })

  it('空配列でも例外を出さない', () => {
    const summary = computeFlavor([], charts(flat(1, 50)))

    expect(summary).toMatchObject({
      axes: null,
      denominator: 0,
      total: 0,
      missing: { unlinked: 0, unknown: 0, linkedWithoutChart: 0 },
    })
    expect(summary.points).toEqual([])
    // 記録が無いことは「空白地帯が無い」ではない。全域が空白
    expect(summary.gaps).toHaveLength(ALL_CELLS)
  })

  it('1件だけでもその1件の値がそのまま平均になる', () => {
    const summary = computeFlavor([linked(1)], charts(chart(1, [1, 2, 3, 4, 5, 6])))

    expect(summary.denominator).toBe(1)
    expect(summary.axes).toEqual({ f1: 1, f2: 2, f3: 3, f4: 4, f5: 5, f6: 6 })
    // 15面それぞれに1セルだけ埋まる
    expect(summary.gaps).toHaveLength(ALL_CELLS - FLAVOR_AXIS_PAIRS.length)
  })
})

describe('散布図用の点', () => {
  it('取得済みの記録だけが点になる', () => {
    const records = [
      linked(1),
      record({ linkStatus: 'unlinked' }),
      linked(999),
      linked(2, 'manual'),
    ]
    const summary = computeFlavor(records, charts(flat(1, 10), flat(2, 20)))

    expect(summary.points).toHaveLength(2)
    expect(summary.points.map((point) => point.brandId)).toEqual([1, 2])
    expect(summary.points[0].axes).toEqual({ f1: 10, f2: 10, f3: 10, f4: 10, f5: 10, f6: 10 })
    expect(summary.points.length).toBe(summary.denominator)
  })

  it('点のラベルは紐付いた銘柄名を優先し、無ければ本人の表記に落とす', () => {
    const named = linked(1, 'auto', { brandLabel: '本人の表記' })
    const unnamed = linked(2, 'auto', { brandName: null, brandLabel: '本人の表記だけ' })
    const summary = computeFlavor([named, unnamed], charts(flat(1, 10), flat(2, 10)))

    expect(summary.points.map((point) => point.label)).toEqual(['さけのわ銘柄1', '本人の表記だけ'])
  })

  it('点は記録の id を持つ(UI が記録に戻れる)', () => {
    const one = linked(1)
    const summary = computeFlavor([one], charts(flat(1, 10)))

    expect(summary.points[0].recordId).toBe(one.id)
  })
})

describe('空白地帯(gaps)', () => {
  it('記録がある領域を gaps に含めない', () => {
    const values: Values[] = [
      [0, 0, 0, 0, 0, 0],
      [100, 100, 100, 100, 100, 100],
      [30, 60, 90, 10, 40, 70],
    ]
    const tables = charts(...values.map((v, index) => chart(index + 1, v)))
    const records = values.map((_, index) => linked(index + 1))
    const summary = computeFlavor(records, tables)

    const gapKeys = new Set(
      summary.gaps.map((gap) => `${gap.axes[0]}/${gap.axes[1]}/${gap.bins[0]}/${gap.bins[1]}`),
    )
    for (const [brandId] of tables) {
      const one = tables.get(brandId)
      if (!one) throw new Error('fixture が壊れている')
      for (const [x, y] of FLAVOR_AXIS_PAIRS) {
        const [bx, by] = cellOf(one, x, y)
        expect(gapKeys.has(`${x}/${y}/${bx}/${by}`), `${x}-${y} の (${bx},${by})`).toBe(false)
      }
    }
    // 逆向き: 空白が実際に残っている(恒偽の条件で緑になっていない)
    expect(summary.gaps.length).toBeGreaterThan(0)
    expect(summary.gaps.length).toBeLessThan(ALL_CELLS)
  })

  it('gaps は grids の件数0のセルとちょうど一致する', () => {
    const summary = computeFlavor(
      [linked(1), linked(2)],
      charts(chart(1, [0, 10, 20, 30, 40, 50]), chart(2, [99, 88, 77, 66, 55, 44])),
    )

    let zeroCells = 0
    let occupied = 0
    for (const grid of summary.grids) {
      for (const row of grid.counts) {
        for (const count of row) {
          if (count === 0) zeroCells += 1
          else occupied += count
        }
      }
    }
    expect(zeroCells).toBe(summary.gaps.length)
    // 各点が15面に1回ずつ数えられる
    expect(occupied).toBe(summary.denominator * FLAVOR_AXIS_PAIRS.length)
  })

  it('gaps の値域はビン定義と一致し、同じセルを2度返さない', () => {
    const summary = computeFlavor([], EMPTY_CHARTS)
    const seen = new Set<string>()

    for (const gap of summary.gaps) {
      const key = `${gap.axes[0]}/${gap.axes[1]}/${gap.bins[0]}/${gap.bins[1]}`
      expect(seen.has(key), key).toBe(false)
      seen.add(key)
      expect(gap.ranges[0]).toEqual(FLAVOR_BINS[gap.bins[0]])
      expect(gap.ranges[1]).toEqual(FLAVOR_BINS[gap.bins[1]])
      expect(gap.axes[0]).not.toBe(gap.axes[1])
    }
    expect(seen.size).toBe(ALL_CELLS)
  })

  it('軸の組は6軸から2つ取る15面で、同じ組を重複させない', () => {
    expect(FLAVOR_AXIS_PAIRS).toHaveLength(15)
    const keys = FLAVOR_AXIS_PAIRS.map(([x, y]) => `${x}/${y}`)
    expect(new Set(keys).size).toBe(15)
    // 逆順の重複が無い(f1/f2 と f2/f1 を両方持たない)
    for (const [x, y] of FLAVOR_AXIS_PAIRS) {
      expect(keys).not.toContain(`${y}/${x}`)
    }
  })
})

describe('ビンの境界', () => {
  it('0-100 を4等分に近い閉区間で覆い、隙間も重なりも無い', () => {
    expect(FLAVOR_BINS).toHaveLength(4)
    expect(FLAVOR_BINS[0].min).toBe(0)
    expect(FLAVOR_BINS[FLAVOR_BINS.length - 1].max).toBe(100)
    for (let index = 1; index < FLAVOR_BINS.length; index += 1) {
      expect(FLAVOR_BINS[index].min).toBe(FLAVOR_BINS[index - 1].max + 1)
    }
  })

  it('境界値がどちらのビンに入るか固定する', () => {
    expect(flavorBinIndex(0)).toBe(0)
    expect(flavorBinIndex(24)).toBe(0)
    expect(flavorBinIndex(25)).toBe(1)
    expect(flavorBinIndex(49)).toBe(1)
    expect(flavorBinIndex(50)).toBe(2)
    expect(flavorBinIndex(74)).toBe(2)
    expect(flavorBinIndex(75)).toBe(3)
    expect(flavorBinIndex(100)).toBe(3)
  })

  it('0-100 の外は端のビンに寄せ、数でない値は null(でたらめなセルを作らない)', () => {
    // f1..f6 は 0-100 の整数という前提だが、105 は依然「高い側」であって不明ではない
    expect(flavorBinIndex(101)).toBe(3)
    expect(flavorBinIndex(-1)).toBe(0)
    expect(flavorBinIndex(NaN)).toBeNull()
    expect(flavorBinIndex(Infinity)).toBeNull()
  })

  it('0.0-1.0 の値を渡すと最下位ビンに潰れる(単位の取り違えを見せる)', () => {
    // さけのわ API の原値は 0.0-1.0 だが同梱データは100倍した整数。
    // 取り違えると例外は出ないまま全点が左下隅に集まる、という形で現れる。
    expect(flavorBinIndex(0.8)).toBe(0)
    expect(flavorBinIndex(1)).toBe(0)
  })
})
