// 最近飲んだ銘柄の並び。**「押す位置が動かない」ことが要件**なので、同値の潰し方まで固定する。
//
// 銘柄名は**架空**（カクウ / ホシ …）。実在の銘柄名を日付と同じ行に書くと、それだけで
// 台帳の1行になる（`npm run ledger:check` が落とす）。

import { RECENT_BRAND_LIMIT, recentBrands } from './recentBrands.ts'
import type { SakeRecord } from './types.ts'

function record(over: Partial<SakeRecord> & { id: string; drankOn: string }): SakeRecord {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    brandLabel: '',
    brandName: null,
    sakenowaBrandId: null,
    linkStatus: 'unknown',
    prefecture: null,
    spec: '',
    place: '',
    note: '',
    rating: null,
    thumbnail: null,
    sourceNo: null,
    ...over,
  } as SakeRecord
}

describe('最近飲んだ銘柄', () => {
  it('新しい順に返し、同じ銘柄は1件に畳む', () => {
    const rows = [
      record({ id: 'a', drankOn: '2026-01-10', sakenowaBrandId: 1, brandName: 'カクウ' }),
      record({ id: 'b', drankOn: '2026-02-01', sakenowaBrandId: 2, brandName: 'ホシ' }),
      record({ id: 'c', drankOn: '2026-03-01', sakenowaBrandId: 1, brandName: 'カクウ' }),
    ]

    expect(recentBrands(rows).map((entry) => entry.brandId)).toEqual([1, 2])
    expect(recentBrands(rows)[0]?.lastDrankOn).toBe('2026-03-01')
  })

  // ★ 紐付いていない記録を出すと、未確定の表記を確定として押させることになる
  it('銘柄が紐付いていない記録は出さない', () => {
    const rows = [
      record({ id: 'a', drankOn: '2026-03-01' }),
      record({ id: 'b', drankOn: '2026-01-01', sakenowaBrandId: 7, brandName: 'ニゴウ' }),
    ]

    expect(recentBrands(rows).map((entry) => entry.brandId)).toEqual([7])
  })

  // ★ 回数で並べない。何年も前に集中して飲んだ銘柄が上に残ると、いま手元にある酒が沈む
  it('よく飲んだ順ではなく、最後に飲んだ順で並べる', () => {
    const rows = [
      record({ id: 'a', drankOn: '2020-01-01', sakenowaBrandId: 1 }),
      record({ id: 'b', drankOn: '2020-01-02', sakenowaBrandId: 1 }),
      record({ id: 'c', drankOn: '2020-01-03', sakenowaBrandId: 1 }),
      record({ id: 'd', drankOn: '2026-05-05', sakenowaBrandId: 2 }),
    ]

    expect(recentBrands(rows).map((entry) => entry.brandId)).toEqual([2, 1])
  })

  // 同じ日に複数飲むのは普通にある。並びが run ごとに変わると押す位置が動く
  it('同じ日なら sourceNo の大きい順、それも同じなら銘柄IDの昇順で決まる', () => {
    const rows = [
      record({ id: 'a', drankOn: '2026-01-01', sakenowaBrandId: 5, sourceNo: 1 }),
      record({ id: 'b', drankOn: '2026-01-01', sakenowaBrandId: 3, sourceNo: 9 }),
      record({ id: 'c', drankOn: '2026-01-01', sakenowaBrandId: 4 }),
    ]

    expect(recentBrands(rows).map((entry) => entry.brandId)).toEqual([3, 5, 4])
  })

  it('保存されている銘柄名をそのまま返す（上流から消えても名前が残る）', () => {
    const rows = [record({ id: 'a', drankOn: '2026-01-01', sakenowaBrandId: 1, brandName: 'サンゴウ' })]

    expect(recentBrands(rows)[0]?.brandName).toBe('サンゴウ')
  })

  it('既定は6件までで、上限は指定できる', () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      record({ id: `r${String(index)}`, drankOn: `2026-01-${String(index + 10)}`, sakenowaBrandId: index + 1 }),
    )

    expect(recentBrands(rows)).toHaveLength(RECENT_BRAND_LIMIT)
    expect(recentBrands(rows, 3)).toHaveLength(3)
    expect(recentBrands(rows, 0)).toEqual([])
  })

  it('渡した配列を並べ替えない', () => {
    const rows = [
      record({ id: 'a', drankOn: '2026-01-01', sakenowaBrandId: 1 }),
      record({ id: 'b', drankOn: '2026-03-01', sakenowaBrandId: 2 }),
    ]
    const before = rows.map((row) => row.id)

    recentBrands(rows)

    expect(rows.map((row) => row.id)).toEqual(before)
  })
})
