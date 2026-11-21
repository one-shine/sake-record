// @vitest-environment node
// **合成データのみ。** 日付は台帳の範囲外(1999年)、銘柄名は架空。

import { sameBrandRecords } from './brandHistory.ts'
import type { LinkStatus, SakeRecord } from './types.ts'

let seq = 0

function record(partial: Partial<SakeRecord> = {}): SakeRecord {
  seq += 1
  return {
    id: `r${String(seq)}`,
    drankOn: '1999-01-01',
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

function linked(brandId: number, extra: Partial<SakeRecord> = {}, status: LinkStatus = 'auto') {
  return record({ sakenowaBrandId: brandId, brandName: `かくう${String(brandId)}`, linkStatus: status, ...extra })
}

describe('sameBrandRecords', () => {
  it('紐付いた記録は同じ銘柄IDの他の記録を新しい順に返す(自分は含めない)', () => {
    const target = linked(1, { drankOn: '1999-02-01' })
    const older = linked(1, { drankOn: '1999-01-01' }, 'manual')
    const newer = linked(1, { drankOn: '1999-03-01' }, 'alias')
    const other = linked(2)
    expect(sameBrandRecords([older, target, other, newer], target)).toEqual([newer, older])
  })

  it('同じ日は作った時刻の新しい順', () => {
    const target = linked(1)
    const a = linked(1, { createdAt: '1999-01-01T01:00:00.000Z' })
    const b = linked(1, { createdAt: '1999-01-01T02:00:00.000Z' })
    expect(sameBrandRecords([a, b, target], target)).toEqual([b, a])
  })

  it('未紐付けの記録は正規化した表記が同じ未紐付けの記録を返す', () => {
    const target = record({ brandLabel: 'ＡＢＣ酒' })
    const same = record({ brandLabel: 'abc酒' })
    const linkedSameLabel = linked(5, { brandLabel: 'ABC酒' })
    expect(sameBrandRecords([target, same, linkedSameLabel], target)).toEqual([same])
  })

  it('紐付いた記録の側は、表記が同じでも銘柄IDが違えば返さない', () => {
    const target = linked(1, { brandLabel: '同じ表記' })
    expect(sameBrandRecords([target, linked(2, { brandLabel: '同じ表記' })], target)).toEqual([])
  })

  it('銘柄不明・表記が空の記録には何も返さない(全件に落ちない)', () => {
    const unknown = record({ linkStatus: 'unknown', brandLabel: '' })
    const blank = record({ brandLabel: '  ' })
    const others = [record({ linkStatus: 'unknown', brandLabel: '' }), record({ brandLabel: '' })]
    expect(sameBrandRecords([unknown, blank, ...others], unknown)).toEqual([])
    expect(sameBrandRecords([unknown, blank, ...others], blank)).toEqual([])
  })
})
