// 最近飲んだ銘柄。**記録フォームの「もう一度」用**の並び。
//
// この記録アプリは同じ銘柄を何度も飲む（203本のうち銘柄は94種）。それなのに2回目以降も
// 毎回「銘柄名を打つ → 候補から選ぶ」を通っていた。**直近の銘柄をそのまま押せる**ようにすると、
// 写真も OCR も要らずに紐付きの記録が1タップで始められる。
//
// ## 規律
//
// - **紐付いた記録だけを対象にする**（`sakenowaBrandId` が null の記録は「銘柄が確定していない」
//   ので、ここに出すと未確定の表記を確定として押させることになる）
// - **並びは「最後に飲んだ日」の降順**。よく飲む順（回数）ではない — 回数で並べると
//   何年も前に集中して飲んだ銘柄が上に残り、いま手元にある酒が下に沈む
// - 同じ銘柄は1件に畳む
// - **同点は決定的に並べる**（同じ日に複数飲むのは普通にある）。日付が同じなら `sourceNo` の
//   降順、それも無ければ銘柄IDの昇順。並びが run ごとに変わると、押す位置が動いて
//   「さっきと同じ場所を押したら別の銘柄だった」が起きる

import type { SakeRecord } from './types.ts'

/** 既定で出す数。**タブ帯と同じで「1画面に収まる」ことが条件**（390px で2段以内） */
export const RECENT_BRAND_LIMIT = 6

export type RecentBrand = {
  readonly brandId: number
  /** 記録に保存されている表示名。上流から銘柄が消えても名前が残る */
  readonly brandName: string | null
  /** 最後に飲んだ日（`drankOn`） */
  readonly lastDrankOn: string
}

/**
 * 最近飲んだ銘柄を新しい順に返す。**記録を破壊的に並べ替えない**（呼び出し側の配列を守る）。
 */
export function recentBrands(
  records: readonly SakeRecord[],
  limit: number = RECENT_BRAND_LIMIT,
): RecentBrand[] {
  const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : RECENT_BRAND_LIMIT
  if (max === 0) return []

  const best = new Map<number, { record: SakeRecord; name: string | null }>()
  for (const record of records) {
    const brandId = record.sakenowaBrandId
    if (brandId === null) continue
    const current = best.get(brandId)
    if (current === undefined || isNewer(record, current.record)) {
      best.set(brandId, { record, name: record.brandName ?? current?.name ?? null })
    }
  }

  return [...best.entries()]
    .sort(([idA, a], [idB, b]) => compareRecency(a.record, b.record) || idA - idB)
    .slice(0, max)
    .map(([brandId, entry]) => ({
      brandId,
      brandName: entry.name,
      lastDrankOn: entry.record.drankOn,
    }))
}

/** 新しいほう。日付が同じなら `sourceNo` の大きいほう（取り込み順の後ろ） */
function isNewer(candidate: SakeRecord, current: SakeRecord): boolean {
  return compareRecency(candidate, current) < 0
}

/** 新しい順の比較子（負なら a が新しい）。**同値を返さない**ように最後まで決める */
function compareRecency(a: SakeRecord, b: SakeRecord): number {
  if (a.drankOn !== b.drankOn) return a.drankOn < b.drankOn ? 1 : -1
  const noA = a.sourceNo ?? -1
  const noB = b.sourceNo ?? -1
  if (noA !== noB) return noB - noA
  return 0
}
