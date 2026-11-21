// 次に飲む候補。好きな記録(評価4〜5)の銘柄に6軸が近い、まだ飲んでいない銘柄を並べる。
//
// React 非依存の純TS。
//
// ## これは推定であって記録ではない
//
// 候補はさけのわの6軸の近さだけで選ぶ。**記録の欄には何も書かない**し、`unlinked` に推定値を
// 埋めないのと同じ規律で、候補の側にも「好きそう」のような判定の語を持たせない。返すのは
// 近さの数値と、どの記録の銘柄に近いか(= 理由)だけで、画面はその2つをそのまま出す。
//
// ## 起点にする銘柄
//
// 評価4〜5の記録があり、**評価1〜2の記録が1本も無い**銘柄。両方ある銘柄は好みと言い切れない
// (スペック違いや飲んだ日の差が6軸に表れないので、どちらの評価が銘柄の味によるのか分からない)。
//
// ## 距離
//
// 6軸の差の絶対値の平均。0〜100 の単位のまま読めるので、画面が「各軸の差 平均 3.2」と
// そのまま言える(ユークリッド距離は単位が読めない)。

import { FLAVOR_AXIS_KEYS, ratingGroupOf, type FlavorPoint } from './flavor.ts'
import type { FlavorChart } from './types.ts'

/** 1つの起点から採る上限。無いと、記録の多い味の近所だけで一覧が埋まる */
export const NEXT_BRANDS_PER_ANCHOR = 2
export const NEXT_BRANDS_LIMIT = 8

export type NextBrandCandidate = {
  brandId: number
  /** 6軸の差の絶対値の平均(0〜100) */
  distance: number
  /** いちばん近い起点。候補を出した理由として画面に出す */
  anchorBrandId: number
  /** 起点の記録に非正規化保存された名前(`FlavorPoint.label`) */
  anchorLabel: string
}

export type NextBrandsResult = {
  /** 起点にできた銘柄の数。0 なら候補も 0 で、画面はその理由を言う */
  anchors: number
  candidates: readonly NextBrandCandidate[]
}

type Axes = Pick<FlavorChart, 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6'>

export function flavorDistance(a: Axes, b: Axes): number {
  let sum = 0
  for (const key of FLAVOR_AXIS_KEYS) sum += Math.abs(a[key] - b[key])
  return sum / FLAVOR_AXIS_KEYS.length
}

type Anchor = { brandId: number; label: string; axes: Axes }

function anchorsOf(points: readonly FlavorPoint[]): Anchor[] {
  const liked = new Map<number, Anchor>()
  const disliked = new Set<number>()
  for (const point of points) {
    const group = ratingGroupOf(point.rating)
    if (group === 'disliked') disliked.add(point.brandId)
    if (group === 'liked' && !liked.has(point.brandId)) {
      liked.set(point.brandId, { brandId: point.brandId, label: point.label, axes: point.axes })
    }
  }
  return [...liked.values()].filter((anchor) => !disliked.has(anchor.brandId))
}

/**
 * @param points `computeFlavor` の `points`(フレーバー取得済みの記録)
 * @param drunkBrandIds 記録のどれかが紐付いている銘柄。**状態や評価を問わず**候補から外す
 * @param accept 候補に残す条件(まだ飲んでいない県だけ、など)。外した銘柄は起点ごとの枠を使わない
 */
export function suggestNextBrands({
  points,
  flavorCharts,
  drunkBrandIds,
  accept,
  limit = NEXT_BRANDS_LIMIT,
}: {
  points: readonly FlavorPoint[]
  flavorCharts: readonly FlavorChart[]
  drunkBrandIds: ReadonlySet<number>
  accept?: (brandId: number) => boolean
  limit?: number
}): NextBrandsResult {
  const anchors = anchorsOf(points)
  if (anchors.length === 0) return { anchors: 0, candidates: [] }

  const scored: NextBrandCandidate[] = []
  for (const chart of flavorCharts) {
    if (drunkBrandIds.has(chart.brandId)) continue
    if (accept !== undefined && !accept(chart.brandId)) continue
    let best: NextBrandCandidate | null = null
    for (const anchor of anchors) {
      const distance = flavorDistance(chart, anchor.axes)
      if (best === null || distance < best.distance) {
        best = {
          brandId: chart.brandId,
          distance,
          anchorBrandId: anchor.brandId,
          anchorLabel: anchor.label,
        }
      }
    }
    if (best !== null) scored.push(best)
  }
  scored.sort((a, b) => a.distance - b.distance || a.brandId - b.brandId)

  const perAnchor = new Map<number, number>()
  const candidates: NextBrandCandidate[] = []
  for (const candidate of scored) {
    if (candidates.length >= limit) break
    const used = perAnchor.get(candidate.anchorBrandId) ?? 0
    if (used >= NEXT_BRANDS_PER_ANCHOR) continue
    perAnchor.set(candidate.anchorBrandId, used + 1)
    candidates.push(candidate)
  }
  return { anchors: anchors.length, candidates }
}
