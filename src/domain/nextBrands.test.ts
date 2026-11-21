// @vitest-environment node
// **合成データのみ。** 銘柄IDも6軸も架空(実台帳の銘柄 × 評価を写すと台帳の結合キーになる)。

import { NEXT_BRANDS_PER_ANCHOR, flavorDistance, suggestNextBrands } from './nextBrands.ts'
import type { FlavorPoint } from './flavor.ts'
import type { FlavorChart, Rating } from './types.ts'

type Values = readonly [number, number, number, number, number, number]

function chart(brandId: number, [f1, f2, f3, f4, f5, f6]: Values): FlavorChart {
  return { brandId, f1, f2, f3, f4, f5, f6 }
}

let seq = 0
function point(brandId: number, rating: Rating | null, values: Values): FlavorPoint {
  seq += 1
  const [f1, f2, f3, f4, f5, f6] = values
  return {
    recordId: `r${String(seq)}`,
    brandId,
    label: `てすと銘柄${String(brandId)}`,
    rating,
    axes: { f1, f2, f3, f4, f5, f6 },
  }
}

const HIGH: Values = [80, 80, 80, 80, 80, 80]
const LOW: Values = [20, 20, 20, 20, 20, 20]

describe('flavorDistance', () => {
  it('6軸の差の絶対値の平均(0〜100 のまま読める)', () => {
    expect(flavorDistance(chart(1, HIGH), chart(2, LOW))).toBe(60)
    expect(flavorDistance(chart(1, [10, 0, 0, 0, 0, 0]), chart(2, [4, 0, 0, 0, 0, 0]))).toBe(1)
  })
})

describe('suggestNextBrands', () => {
  it('好きな記録(評価4〜5)に近い、まだ飲んでいない銘柄を近い順に出す', () => {
    const result = suggestNextBrands({
      points: [point(1, 5, HIGH)],
      flavorCharts: [
        chart(1, HIGH),
        chart(10, [78, 80, 80, 80, 80, 80]),
        chart(11, [70, 80, 80, 80, 80, 80]),
        chart(12, LOW),
      ],
      drunkBrandIds: new Set([1]),
    })
    expect(result.anchors).toBe(1)
    expect(result.candidates.map((c) => c.brandId)).toEqual([10, 11])
    expect(result.candidates[0]).toMatchObject({ anchorBrandId: 1, anchorLabel: 'てすと銘柄1' })
  })

  it('飲んだ銘柄は記録の状態や評価にかかわらず候補にしない', () => {
    const result = suggestNextBrands({
      points: [point(1, 5, HIGH)],
      flavorCharts: [chart(1, HIGH), chart(10, HIGH)],
      drunkBrandIds: new Set([1, 10]),
    })
    expect(result.candidates).toEqual([])
  })

  it('評価3・未評価・苦手の記録は起点にしない', () => {
    const result = suggestNextBrands({
      points: [point(1, 3, HIGH), point(2, null, HIGH), point(3, 2, HIGH)],
      flavorCharts: [chart(10, HIGH)],
      drunkBrandIds: new Set([1, 2, 3]),
    })
    expect(result.anchors).toBe(0)
    expect(result.candidates).toEqual([])
  })

  it('好きと苦手の両方の記録がある銘柄は起点にしない(好みと言い切れない)', () => {
    const result = suggestNextBrands({
      points: [point(1, 5, HIGH), point(1, 1, HIGH)],
      flavorCharts: [chart(10, HIGH)],
      drunkBrandIds: new Set([1]),
    })
    expect(result.anchors).toBe(0)
  })

  it('1つの起点からは一定数までしか採らない(似た候補で一覧が埋まらない)', () => {
    const near = Array.from({ length: 6 }, (_, index) =>
      chart(100 + index, [80 - index, 80, 80, 80, 80, 80]),
    )
    const result = suggestNextBrands({
      points: [point(1, 5, HIGH), point(2, 4, LOW)],
      flavorCharts: [...near, chart(200, [22, 20, 20, 20, 20, 20])],
      drunkBrandIds: new Set([1, 2]),
    })
    const fromFirst = result.candidates.filter((c) => c.anchorBrandId === 1)
    expect(fromFirst).toHaveLength(NEXT_BRANDS_PER_ANCHOR)
    expect(result.candidates.map((c) => c.brandId)).toContain(200)
  })

  it('accept で外した銘柄は起点ごとの枠を使わない', () => {
    const result = suggestNextBrands({
      points: [point(1, 5, HIGH)],
      flavorCharts: [chart(10, HIGH), chart(11, HIGH), chart(12, [70, 80, 80, 80, 80, 80])],
      drunkBrandIds: new Set([1]),
      accept: (brandId) => brandId === 12,
    })
    expect(result.candidates.map((c) => c.brandId)).toEqual([12])
  })

  it('同じ距離なら銘柄IDの昇順(描くたびに並びが変わらない)', () => {
    const result = suggestNextBrands({
      points: [point(1, 5, HIGH)],
      flavorCharts: [chart(12, HIGH), chart(11, HIGH)],
      drunkBrandIds: new Set([1]),
    })
    expect(result.candidates.map((c) => c.brandId)).toEqual([11, 12])
  })

  it('limit で打ち切る', () => {
    const result = suggestNextBrands({
      points: [point(1, 5, HIGH), point(2, 5, LOW)],
      flavorCharts: [chart(10, HIGH), chart(11, HIGH), chart(12, LOW), chart(13, LOW)],
      drunkBrandIds: new Set([1, 2]),
      limit: 3,
    })
    expect(result.candidates).toHaveLength(3)
  })
})
