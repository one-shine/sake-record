// @vitest-environment node
// 三段の絞り込み(県 → 蔵元 → 銘柄)の約束を固定する。
//
// **見るのは2つだけ**: (a) 定義域外のキーで「全件」に落ちないこと (b) 行き止まりが無いこと。
// 並びと件数は実データのリテラルで固定する(実装から数えて期待値を組むと恒真になる)。
//
// 銘柄名・蔵元名・都道府県は公開マスタ(さけのわ)の値で、飲酒台帳ではない。

import { decodeTables } from '../data/tables.ts'
import areasJson from '../../public/data/sakenowa/areas.json'
import brandsJson from '../../public/data/sakenowa/brands.json'
import breweriesJson from '../../public/data/sakenowa/breweries.json'
import flavorChartsJson from '../../public/data/sakenowa/flavorCharts.json'
import { createBrandBrowser } from './browseBrands.ts'
import type { AreasFile, BrandsFile, BreweriesFile, FlavorChartsFile } from './types.ts'

const tables = decodeTables({
  areas: areasJson as AreasFile,
  breweries: breweriesJson as unknown as BreweriesFile,
  brands: brandsJson as unknown as BrandsFile,
  flavorCharts: flavorChartsJson as unknown as FlavorChartsFile,
})

const browse = createBrandBrowser(tables)

/**
 * 全件の基準。**リテラルで持たない(B41)** — 上流が1件増えるだけで赤くなり、
 * 月次更新ジョブが「テストが緑のときだけコミットする」ので自動更新が止まる。
 */
const ALL_BRANDS = tables.brands.length
const ALL_BREWERIES = tables.breweries.length

describe('県 → 蔵元 → 銘柄の絞り込み', () => {
  it('県は JIS 順で、`その他` だけ最後に来る', () => {
    const rows = browse.areas()
    expect(rows[0].name).toBe('北海道')
    expect(rows[46].name).toBe('沖縄県')
    // areaId 0(その他 = 海外蔵など)は県ではないので最後。**外しはしない** —
    // 外すとそこに属する銘柄がこの経路から届かなくなる
    expect(rows.at(-1)?.areaId).toBe(0)
    expect(rows.at(-1)?.name).toBe('その他')
    expect(rows).toHaveLength(48)
  })

  it('件数を返す(押す前に絞り込みの効き目が分かる)', () => {
    const rows = browse.areas()
    const byName = new Map(rows.map((row) => [row.name, row]))

    // **期待値を別経路で数え直す。** 実測値をリテラルで書くと上流が増えるだけで赤くなり(B41)、
    // 実装から組み立てると恒真になる(B15)。マスタを直接畳んだ値と突き合わせるのが両方を避ける
    const expected = (areaId: number) => {
      const breweries = tables.breweries.filter((b) => b.areaId === areaId)
      const withBrands = breweries.filter((b) =>
        tables.brands.some((brand) => brand.breweryId === b.id),
      )
      return {
        breweryCount: withBrands.length,
        brandCount: tables.brands.filter((brand) =>
          withBrands.some((b) => b.id === brand.breweryId),
        ).length,
      }
    }
    expect(byName.get('福島県')).toMatchObject({ areaId: 7, ...expected(7) })
    expect(byName.get('新潟県')).toMatchObject({ ...expected(15) })
    // 実測(2026-08): 福島県 52蔵/162銘柄 / 新潟県 93蔵/261銘柄
    expect(byName.get('福島県')?.breweryCount).toBeGreaterThan(0)

    // **「知る」の蔵の数(蔵元マスタの全件)とは一致しない。** ここは銘柄を1件以上持つ蔵だけ
    // (行き止まりを作らないため)。差の分は銘柄が紐づいていない蔵
    const listed = rows.reduce((sum, row) => sum + row.breweryCount, 0)
    expect(listed).toBeLessThan(ALL_BREWERIES)
    expect(listed).toBeGreaterThan(1000)
    // **銘柄は1件も落ちない。** 蔵元を引けない銘柄があるとこの経路から届かなくなるので、
    // 合計がマスタと一致することを見張る
    expect(rows.reduce((sum, row) => sum + row.brandCount, 0)).toBe(ALL_BRANDS)
  })

  it('銘柄を1件も持たない県・蔵元は並べない(行き止まりを作らない)', () => {
    for (const area of browse.areas()) {
      expect(area.brandCount, area.name).toBeGreaterThan(0)
      const rows = browse.breweries(area.areaId)
      expect(rows.length, area.name).toBe(area.breweryCount)
      for (const row of rows) expect(row.brandCount).toBeGreaterThan(0)
    }
  })

  it('蔵元は銘柄の多い順で、名前の無い受け皿だけ最後(福島県)', () => {
    const rows = browse.breweries(7)
    expect(rows.slice(0, 3).map((row) => row.name)).toEqual([
      '大和川酒造店',
      '曙酒造',
      '豊国酒造 (会津)',
    ])
    // 「その県の蔵元不明」は銘柄を17件抱えていて件数では1位になるが、蔵ではないので最後
    expect(rows.at(-1)?.name).toBeNull()
    expect(rows.at(-1)?.brandCount).toBe(17)
    // 受け皿を除けば件数の降順
    const named = rows.filter((row) => row.name !== null)
    for (const [at, row] of named.entries()) {
      if (at === 0) continue
      expect(row.brandCount).toBeLessThanOrEqual(named[at - 1].brandCount)
    }
  })

  it('蔵元名が空の行は `null` にする(空白で描いて取得できているように見せない)', () => {
    // 実データには「その県の蔵元不明」の受け皿が48件ある
    const nameless = browse
      .areas()
      .flatMap((area) => browse.breweries(area.areaId))
      .filter((row) => row.name === null)
    expect(nameless).toHaveLength(44)
    for (const row of nameless) expect(row.brewery.name.trim()).toBe('')
  })

  it('銘柄の行は手で打って選んだときと同じ形(県・蔵元・フレーバーの有無)', () => {
    // 宮泉銘醸(福島県)。**利用者が実際に記録している蔵**
    const brewery = browse.breweries(7).find((row) => row.name === '宮泉銘醸')
    expect(brewery).toBeDefined()
    const rows = browse.brands(brewery!.brewery.id)
    expect(rows.map((row) => row.brand.name)).toEqual(['冩楽', '宮泉'])
    expect(rows[1]).toMatchObject({
      prefecture: '福島県',
      breweryName: '宮泉銘醸',
      hasFlavorChart: true,
    })
    expect(rows[1].brand.id).toBe(2401)
  })

  it('`その他` の銘柄も辿れるが、県名は付けない(areaId 0 を都道府県として扱わない)', () => {
    const rows = browse.breweries(0)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      for (const brand of browse.brands(row.brewery.id)) {
        expect(brand.prefecture, brand.brand.name).toBeNull()
      }
    }
  })

  // -------------------------------------------------------------------------
  // 全件フォールバックの禁止(このリポジトリの中核の規律)
  // -------------------------------------------------------------------------

  it('知らないキーは空を返す(別の県の蔵や全銘柄に落ちない)', () => {
    for (const areaId of [-1, 48, 999, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(browse.breweries(areaId), String(areaId)).toEqual([])
    }
    for (const breweryId of [-1, 0, 999_999_999, Number.NaN]) {
      expect(browse.brands(breweryId), String(breweryId)).toEqual([])
    }
  })

  it('返す配列は呼び出しごとに独立(索引を書き換えられない)', () => {
    const first = browse.areas()
    first.length = 0
    first.push({ areaId: 99, name: '壊れた', breweryCount: 0, brandCount: 0 })
    expect(browse.areas()).toHaveLength(48)

    const rows = browse.breweries(7)
    rows[0].brandCount = -1
    expect(browse.breweries(7)[0].brandCount).toBeGreaterThan(0)
  })

  it('銘柄0件のテーブルでも例外を出さず空を返す', () => {
    const empty = createBrandBrowser({ brands: [], breweries: [], areas: [], flavorCharts: [] })
    expect(empty.areas()).toEqual([])
    expect(empty.breweries(7)).toEqual([])
    expect(empty.brands(1)).toEqual([])
  })
})
