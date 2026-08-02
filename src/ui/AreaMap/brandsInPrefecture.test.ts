// 産地タブの「その県で飲んだ銘柄」。**地図の本数と合計が一致すること**が最大の不変条件。
//
// 一致しないと、地図に「22本」と出ているのに一覧の合計が21本、という状態になる。
// 画面からはどちらが正しいか判定できないので、ここで固定する。

import { describe, expect, it } from 'vitest'
import { computeStats } from '../../domain/stats.ts'
import type { SakeRecord } from '../../domain/types.ts'
import { brandsInPrefecture } from './brandsInPrefecture.ts'

/** 福島県 = 7 / 山形県 = 6(JIS の都道府県コード) */
const FUKUSHIMA = 7
const YAMAGATA = 6

let seq = 0
function record(over: Partial<SakeRecord> = {}): SakeRecord {
  seq += 1
  return {
    id: `r${String(seq)}`,
    drankOn: '2026-01-01',
    brandLabel: `てすと酒${String(seq)}`,
    sakenowaBrandId: null,
    brandName: null,
    linkStatus: 'unlinked',
    prefecture: '福島県',
    spec: '',
    rating: null,
    place: '',
    note: '',
    thumbnail: null,
    sourceNo: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/** 紐付いた記録 */
function linked(brandId: number, brandName: string, over: Partial<SakeRecord> = {}) {
  return record({ sakenowaBrandId: brandId, brandName, linkStatus: 'auto', ...over })
}

describe('brandsInPrefecture', () => {
  it('同じ銘柄IDの記録を1行に畳み、本数を数える', () => {
    const rows = brandsInPrefecture(
      [linked(1616, '冩楽'), linked(1616, '冩楽'), linked(1616, '冩楽')],
      FUKUSHIMA,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: '冩楽', count: 3, brandId: 1616 })
  })

  // 表記が揺れていても同じ銘柄なら1行(`寫楽` と `冩楽`)
  it('表記が違っても銘柄IDが同じなら1行にする', () => {
    const rows = brandsInPrefecture(
      [linked(1616, '冩楽', { brandLabel: '寫楽' }), linked(1616, '冩楽', { brandLabel: '冩楽' })],
      FUKUSHIMA,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.count).toBe(2)
  })

  // **紐付いていない記録を正規化して畳まない。** 本人が別物として書き分けたものを勝手に1つにしない
  it('紐付いていない記録は本人の表記ごとに分ける', () => {
    const rows = brandsInPrefecture(
      [record({ brandLabel: '寿限無' }), record({ brandLabel: '寿限無' }), record({ brandLabel: '清開' })],
      FUKUSHIMA,
    )
    expect(rows.map((row) => [row.name, row.count])).toEqual([
      ['寿限無', 2],
      ['清開', 1],
    ])
  })

  it('本数の多い順、同数なら名前の順に並べる(全順序)', () => {
    const rows = brandsInPrefecture(
      [
        linked(2, 'いろは'),
        linked(3, 'あいう'),
        linked(1, 'かきく'),
        linked(1, 'かきく'),
      ],
      FUKUSHIMA,
    )
    expect(rows.map((row) => row.name)).toEqual(['かきく', 'あいう', 'いろは'])
  })

  it('別の県の記録は入れない', () => {
    const rows = brandsInPrefecture(
      [linked(1616, '冩楽'), linked(1100, '山本', { prefecture: '山形県' })],
      FUKUSHIMA,
    )
    expect(rows.map((row) => row.name)).toEqual(['冩楽'])
  })

  // **知らないキーで全件に落ちない**(`linkBrand` / `suggest` と同じ規律)
  it('その県の記録が無ければ空を返す', () => {
    expect(brandsInPrefecture([linked(1616, '冩楽')], YAMAGATA)).toEqual([])
  })

  it('県が未記入の記録はどの県にも入らない', () => {
    expect(brandsInPrefecture([record({ prefecture: null }), record({ prefecture: '  ' })], FUKUSHIMA)).toEqual([])
  })

  it('銘柄名が無い記録は本人の表記で出す', () => {
    const rows = brandsInPrefecture([record({ brandLabel: '寿限無' })], FUKUSHIMA)
    expect(rows[0]).toMatchObject({ name: '寿限無', label: null, linkStatus: 'unlinked' })
  })

  it('銘柄名と表記が違うときだけ表記を添える', () => {
    const rows = brandsInPrefecture([linked(1616, '冩楽', { brandLabel: '寫楽' })], FUKUSHIMA)
    expect(rows[0]?.label).toBe('寫楽')
  })

  // **地図に出る本数と、この一覧の合計は必ず一致する。** 県の突き合わせを2箇所に書かないための検査
  it('合計が地図の本数(computeStats)と一致する', () => {
    const records = [
      linked(1616, '冩楽'),
      linked(1616, '冩楽', { brandLabel: '寫楽' }),
      record({ brandLabel: '寿限無' }),
      // 前後に空白のある県名も同じ県として数える(normalizePrefecture を通すため)
      linked(1616, '冩楽', { prefecture: ' 福島県 ' }),
      linked(1100, '山本', { prefecture: '山形県' }),
      record({ prefecture: null }),
    ]
    const stats = computeStats(records)
    for (const code of [FUKUSHIMA, YAMAGATA]) {
      const rows = brandsInPrefecture(records, code)
      const sum = rows.reduce((total, row) => total + row.count, 0)
      expect(sum).toBe(stats.byPrefectureCode.get(code) ?? 0)
    }
  })
})
