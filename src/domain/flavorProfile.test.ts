// @vitest-environment node
// 味タグを希少な順に並べ替える約束を固定する(B76)。
//
// 見るのは3つ: (a) 並びが希少な順になること (b) 数えられなかった語が**先頭に来ない**こと
// (c) 実データで銘柄の顔になること(生の並びでは区別できないことを対で示す)。
//
// 銘柄名・語は公開マスタ(さけのわ)の値で、飲酒台帳ではない。

import { decodeFlavorTags } from '../data/tables.ts'
import brandFlavorTagsJson from '../../public/data/sakenowa/brandFlavorTags.json'
import flavorTagsJson from '../../public/data/sakenowa/flavorTags.json'
import brandsJson from '../../public/data/sakenowa/brands.json'
import { rankFlavorTagsByRarity } from './flavorProfile.ts'
import type { BrandFlavorTagsFile, BrandsFile, FlavorTagsFile } from './types.ts'

const tags = decodeFlavorTags({
  flavorTags: flavorTagsJson as unknown as FlavorTagsFile,
  brandFlavorTags: brandFlavorTagsJson as unknown as BrandFlavorTagsFile,
})
const brandIdByName = new Map(
  (brandsJson as unknown as BrandsFile).rows.map(([id, name]) => [name, id]),
)

/** 銘柄名 → 希少な順の語(名前で見えるようにする) */
function profile(brandName: string, take: number): string[] {
  const brandId = brandIdByName.get(brandName)
  if (brandId === undefined) throw new Error(`銘柄「${brandName}」がマスタに無い`)
  const tagIds = tags.tagIdsByBrandId.get(brandId)
  if (tagIds === undefined) throw new Error(`銘柄「${brandName}」に味タグの行が無い`)
  return rankFlavorTagsByRarity(tagIds, tags.brandCountByTagId)
    .slice(0, take)
    .map((t) => tags.tagNameById.get(t.id) ?? String(t.id))
}

/**
 * 同梱データの並び = **いま画面に出ている順**。並べ替えの効果を対で見るために使う。
 *
 * これは「さけのわが返した順」ではない — `scripts/fetch-sakenowa.mjs` が語IDの昇順に
 * 揃えているので、上流が持っていた並びは同梱の時点で失われている(B77)。
 */
function bundledOrder(brandName: string, take: number): string[] {
  const brandId = brandIdByName.get(brandName)
  if (brandId === undefined) throw new Error(`銘柄「${brandName}」がマスタに無い`)
  return (tags.tagIdsByBrandId.get(brandId) ?? [])
    .slice(0, take)
    .map((id) => tags.tagNameById.get(id) ?? String(id))
}

describe('rankFlavorTagsByRarity', () => {
  it('その語が付く銘柄が少ない順に並ぶ', () => {
    const counts = new Map([
      [1, 500],
      [2, 10],
      [3, 100],
    ])
    expect(rankFlavorTagsByRarity([1, 2, 3], counts)).toEqual([
      { id: 2, brandCount: 10 },
      { id: 3, brandCount: 100 },
      { id: 1, brandCount: 500 },
    ])
  })

  it('同数のときはIDの昇順で、描き直しても並びが変わらない', () => {
    const counts = new Map([
      [7, 50],
      [3, 50],
      [5, 50],
    ])
    expect(rankFlavorTagsByRarity([7, 3, 5], counts).map((t) => t.id)).toEqual([3, 5, 7])
    expect(rankFlavorTagsByRarity([5, 7, 3], counts).map((t) => t.id)).toEqual([3, 5, 7])
  })

  // **未知と希少は別物。** 0 で埋めると数えられなかった語が「最も希少」として先頭に立ち、
  // その銘柄の一番の特徴として読まれる(推定値を埋めないのと同じ規律)
  it('数えられなかった語は末尾に置き、件数を 0 で埋めない', () => {
    const counts = new Map([[1, 300]])
    expect(rankFlavorTagsByRarity([9, 1], counts)).toEqual([
      { id: 1, brandCount: 300 },
      { id: 9, brandCount: null },
    ])
  })

  it('語が1つも無ければ空を返す', () => {
    expect(rankFlavorTagsByRarity([], new Map())).toEqual([])
  })
})

describe('実データ(さけのわ同梱分)', () => {
  // 分母。**リテラルで持つのは「上流が動いたら赤くする」ため**(画面だけ古くなるのを防ぐ)
  it('コーパスの分母と、語の出現数の上位が実測と一致する', () => {
    expect(tags.tagIdsByBrandId.size).toBe(2136)
    const top = [...tags.brandCountByTagId.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([id, n]) => `${tags.tagNameById.get(id) ?? String(id)}${String(n)}`)
    expect(top).toEqual(['甘味1269', '旨味1245', '酸味1191', '辛口1132'])
  })

  // **並べ替えの理由そのもの。** いまの並びだと先頭3語が3銘柄で同一になる
  it('いまの並びは銘柄が違っても同じ顔になるが、希少な順にすると分かれる', () => {
    expect(bundledOrder('獺祭', 3)).toEqual(['酸味', '辛口', '旨味'])
    expect(bundledOrder('越乃景虎', 3)).toEqual(['酸味', '辛口', '旨味'])

    expect(profile('獺祭', 3)).toEqual(['シャンパン', 'ハチミツ', '安定'])
    expect(profile('越乃景虎', 3)).toEqual(['アミノ酸', '昔ながら', 'さらり'])
  })

  it('希少な順の上位5語は銘柄ごとに違う', () => {
    expect(profile('越乃景虎', 5)).toEqual(['アミノ酸', '昔ながら', 'さらり', '安定', 'キリリ'])
    expect(profile('雨後の月', 5)).toEqual(['マスカット', '上品', 'メロン', '軽快', '綺麗'])
  })
})
