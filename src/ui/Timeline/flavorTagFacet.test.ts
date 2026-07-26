// 味タグのファセットの単体テスト。**DOM を要らない純関数**なので画面を描かずに回す。
//
// ここが押さえている事故は4つ:
//  1. **最頻語が既定の可視範囲から外れる**。実データでは 旨味 が186本中184本に付くので、
//     件数降順に素直に並べると先頭が全部これになって絞り込みとして機能しない
//  2. **畳んだ語が消えない**。narrowing + broad が入力の全語をちょうど1回ずつ覆う
//     (「UI を綺麗にするためにデータを消す」のがこのリポジトリの禁じ手)
//  3. **境界でちょうど半数の語を残す**(消す方向に丸めない)
//  4. **紐付いていない記録はどのタグにも当たらない**。推定で埋めず、分母に数えない
//
// 期待値はリテラルで書く(実装から件数や語を引くと恒真になる。B15)。
// 記録は全部合成で、日付は 2017〜2019 に留める(実台帳の日付と衝突させない。B22)。

import { decodeFlavorTags, type DecodedFlavorTags } from '../../data/tables.ts'
import type { SakeRecord } from '../../domain/types.ts'
import { buildFlavorTagFacet, splitTagBands, type FlavorTagCount } from './flavorTagFacet.ts'

function rec(over: Partial<SakeRecord> & { id: string }): SakeRecord {
  return {
    drankOn: '2019-05-01',
    brandLabel: 'テスト酒',
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
    createdAt: '2019-05-01T00:00:00.000Z',
    updatedAt: '2019-05-01T00:00:00.000Z',
    ...over,
  }
}

/**
 * 合成した味タグの表。**索引の作り方を二重実装しない**ために `decodeFlavorTags` を通す
 * (タプルの並び `[銘柄ID, ...タグID]` もここで実際に踏む)。
 */
function tags(): DecodedFlavorTags {
  return decodeFlavorTags({
    flavorTags: {
      copyright: 'synthetic',
      rows: [
        [1, 'テスト味あ'],
        [2, 'テスト味い'],
        [3, 'テスト味う'],
      ],
    },
    brandFlavorTags: {
      copyright: 'synthetic',
      rows: [
        [101, 1, 2, 3],
        [102, 1],
        // 語彙(1..3)に無い ID。**番号や「その他」で埋めない**ことを見るための行
        [103, 1, 99],
      ],
    },
  })
}

function counts(...entries: [string, number][]): FlavorTagCount[] {
  return entries.map(([tag, count]) => ({ tag, count }))
}

describe('splitTagBands', () => {
  it('半数より多くに付く語を既定から外し、半数以下は残す', () => {
    // 10本にタグが付いた集合。6本(60%)の語は畳み、5本(50%)と3本は残す
    const bands = splitTagBands(counts(['広い語', 6], ['半分の語', 5], ['狭い語', 3]), 10)

    expect(bands.narrowing.map((item) => item.tag)).toEqual(['半分の語', '狭い語'])
    expect(bands.broad.map((item) => item.tag)).toEqual(['広い語'])
  })

  it('境界: ちょうど半数は残し、1本多いだけで畳む', () => {
    // **必ず狭い語を1つ添える**。それが無いと「畳むと空になるなら畳まない」規則が先に効いて、
    // 境界そのものを見られない(下のテストがその規則を単独で見る)
    const atHalf = splitTagBands(counts(['ちょうど', 2], ['狭い', 1]), 4)
    expect(atHalf.narrowing).toEqual([
      { tag: 'ちょうど', count: 2 },
      { tag: '狭い', count: 1 },
    ])
    expect(atHalf.broad).toEqual([])

    const overHalf = splitTagBands(counts(['1本多い', 3], ['狭い', 1]), 4)
    expect(overHalf.narrowing).toEqual([{ tag: '狭い', count: 1 }])
    expect(overHalf.broad).toEqual([{ tag: '1本多い', count: 3 }])

    // 奇数の分母(5本)。2本は残り、3本は畳む
    expect(splitTagBands(counts(['2本', 2], ['狭い', 1]), 5).broad).toEqual([])
    expect(splitTagBands(counts(['3本', 3], ['狭い', 1]), 5).broad).toEqual([
      { tag: '3本', count: 3 },
    ])
  })

  it('畳んでも語は消えない（入力の全語をちょうど1回ずつ覆う）', () => {
    const input = counts(['甲', 9], ['乙', 6], ['丙', 5], ['丁', 1])
    const bands = splitTagBands(input, 10)

    const reached = [...bands.narrowing, ...bands.broad].map((item) => item.tag).sort()
    expect(reached).toEqual(['丁', '丙', '乙', '甲'].sort())
    expect(bands.narrowing.length + bands.broad.length).toBe(4)
  })

  it('件数降順の入力の順序を保つ（帯の中で並べ直さない）', () => {
    const bands = splitTagBands(counts(['甲', 9], ['乙', 8], ['丙', 4], ['丁', 2]), 10)

    expect(bands.broad.map((item) => item.count)).toEqual([9, 8])
    expect(bands.narrowing.map((item) => item.count)).toEqual([4, 2])
  })

  it('畳むと既定で見える語が無くなるなら畳まない（空の行に「残りN語」だけ残さない）', () => {
    // 1本しかタグが引けていない集合ではどの語も「半数より多く」に付く
    const bands = splitTagBands(counts(['甲', 1], ['乙', 1]), 1)

    expect(bands.narrowing.map((item) => item.tag)).toEqual(['甲', '乙'])
    expect(bands.broad).toEqual([])
  })

  it('語が無ければ両方とも空（0件のピルを作らない）', () => {
    expect(splitTagBands([], 0)).toEqual({ narrowing: [], broad: [] })
  })
})

describe('buildFlavorTagFacet', () => {
  it('件数は銘柄数ではなく記録の本数（同じ銘柄を2回飲んだら2本）', () => {
    const facet = buildFlavorTagFacet(
      [
        rec({ id: 'a', sakenowaBrandId: 101, linkStatus: 'auto' }),
        rec({ id: 'b', sakenowaBrandId: 101, linkStatus: 'auto', drankOn: '2018-08-09' }),
        rec({ id: 'c', sakenowaBrandId: 102, linkStatus: 'auto', drankOn: '2017-03-04' }),
      ],
      tags(),
    )

    expect(facet.taggedCount).toBe(3)
    // `あ` は 101(2本) と 102(1本) の3本、`い` `う` は 101 の2本。
    // 同数の `い` `う` の並びは語順(件数が同じ語の順序が描画ごとに揺れない)
    const all = [...facet.narrowing, ...facet.broad]
    expect(all).toEqual([
      { tag: 'テスト味あ', count: 3 },
      { tag: 'テスト味い', count: 2 },
      { tag: 'テスト味う', count: 2 },
    ])
  })

  it('紐付いていない記録はどのタグにも当たらず、分母にも入らない', () => {
    const facet = buildFlavorTagFacet(
      [
        rec({ id: 'linked', sakenowaBrandId: 102, linkStatus: 'auto' }),
        rec({ id: 'unlinked', drankOn: '2018-08-09' }),
        // 紐付いてもさけのわ側にタグの行が無い銘柄(3264銘柄中1128件がこれ)
        rec({ id: 'no-tag', sakenowaBrandId: 999, linkStatus: 'auto', drankOn: '2017-03-04' }),
      ],
      tags(),
    )

    expect(facet.taggedCount).toBe(1)
    expect(facet.tagsByRecordId.get('linked')).toEqual(['テスト味あ'])
    expect(facet.tagsByRecordId.get('unlinked')).toBeUndefined()
    expect(facet.tagsByRecordId.get('no-tag')).toBeUndefined()
    expect([...facet.narrowing, ...facet.broad]).toEqual([{ tag: 'テスト味あ', count: 1 }])
  })

  it('語彙に無いタグIDは捨てる（番号や「その他」で埋めない）', () => {
    const facet = buildFlavorTagFacet(
      [rec({ id: 'a', sakenowaBrandId: 103, linkStatus: 'auto' })],
      tags(),
    )

    expect(facet.tagsByRecordId.get('a')).toEqual(['テスト味あ'])
  })

  it('タグを引けた記録が0本なら語も0（推定で埋めない）', () => {
    const facet = buildFlavorTagFacet([rec({ id: 'a' }), rec({ id: 'b' })], tags())

    expect(facet.taggedCount).toBe(0)
    expect(facet.narrowing).toEqual([])
    expect(facet.broad).toEqual([])
  })

  it('自分の記録が持たない語は出さない（141語全部を並べない）', () => {
    const facet = buildFlavorTagFacet(
      [rec({ id: 'a', sakenowaBrandId: 102, linkStatus: 'auto' })],
      tags(),
    )

    const reached = [...facet.narrowing, ...facet.broad].map((item) => item.tag)
    expect(reached).toEqual(['テスト味あ'])
    expect(reached).not.toContain('テスト味い')
  })

  it('最頻語が既定の可視範囲から外れる（実データの 旨味 99% の再現）', () => {
    // 10本すべてに付く語と、2本だけに付く語。前者を先頭に出すと絞り込みにならない
    const records = Array.from({ length: 10 }, (_, index) =>
      rec({
        id: `r${String(index)}`,
        sakenowaBrandId: index < 2 ? 101 : 102,
        linkStatus: 'auto',
      }),
    )

    const facet = buildFlavorTagFacet(records, tags())

    expect(facet.taggedCount).toBe(10)
    expect(facet.narrowing.map((item) => item.tag)).toEqual(['テスト味い', 'テスト味う'])
    expect(facet.broad).toEqual([{ tag: 'テスト味あ', count: 10 }])
  })
})
