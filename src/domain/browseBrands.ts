// 銘柄を**打たずに選ぶ**ための三段の絞り込み: 都道府県 → 蔵元 → 銘柄。
//
// ## なぜ要るか(検索だけでは届かない)
//
// このアプリは**読みのデータを同梱していない**ので、`きど` と打っても `紀土` は出ない
// (`suggest.ts` の制約。スコープ外であって欠陥ではない)。つまり**銘柄名の字を知らないと
// 検索が始まらない**。写真の OCR も、実測で9枚中3枚は銘柄の字を1文字も読めていない。
// どちらも空振りしたとき、いまは手立てが無くなる。
//
// 選択式ならそこが埋まる: **ラベルから確実に読めるのは蔵元名と都道府県**（「福島県会津若松市
// 宮泉銘醸株式会社」は銘柄名より大きく確実に印字されている）で、そこから辿れば打たずに着く。
//
// ## この層の規則(`suggest.ts` / `linkBrand.ts` と同じ)
//
// 1. **定義域外のキーで「全件」に落ちない。** 知らない `areaId` / `breweryId` には空配列を返す。
//    落ちると別の県の蔵が混ざり、選んだつもりのない銘柄に紐付く
// 2. **行き止まりを作らない。** 銘柄を1件も持たない県・蔵元は最初から並べない
//    (押してから空だと分かるのは、絞り込みの効き目が見えないのと同じ)
// 3. **同名を丸めない。** 蔵元名が空の行(実データに48件ある「その県の蔵元不明」の受け皿)は
//    `null` にして「蔵元名がデータに無い」と言い切る。空白で描いて取得できているように見せない
// 4. **`areaId` 0(その他)を都道府県として扱わない。** ただし**一覧からは外さない** —
//    外すとそこに属する銘柄がこの経路から永久に届かなくなる。並びの最後に置き、
//    銘柄の `prefecture` は `null` のままにする(県名として使わせない)

import { normalize } from './normalize.ts'
import type { SuggestHit } from './suggest.ts'
import type { SakenowaBrewery, SakenowaTables } from './types.ts'

/** 一段目の行。**件数を必ず返す**(押す前に絞り込みの効き目が分かるように) */
export type BrowseArea = {
  areaId: number
  name: string
  breweryCount: number
  brandCount: number
}

/** 二段目の行 */
export type BrowseBrewery = {
  brewery: SakenowaBrewery
  /** 表示できる蔵元名があるときだけ非 null(空の行が48件ある) */
  name: string | null
  brandCount: number
}

/**
 * 三段目の行。**`SuggestHit` から `isPrefix` を落としただけ**の形にしてあるので、
 * 選んだ結果は手で打って選んだときと**同じ受け口**(`handlePick`)にそのまま入る。
 */
export type BrowseBrand = Omit<SuggestHit, 'isPrefix'>

export type BrandBrowser = {
  /** 銘柄を持つ県だけを JIS 順で。`areaId` 0(その他)は最後 */
  areas: () => BrowseArea[]
  /** その県の蔵元。**銘柄の多い順**(同数なら名前・ID で決定的に) */
  breweries: (areaId: number) => BrowseBrewery[]
  /** その蔵元の銘柄。名前が短い順 → ID 昇順(`suggest` の同点の崩し方と揃える) */
  brands: (breweryId: number) => BrowseBrand[]
}

/**
 * テーブルを閉じ込めて三段の絞り込みを返す。**索引はここで1回だけ組む**
 * (`createSuggester` と同じ理由。開くたびに 3264 + 1749 件を走査しない)。
 */
export function createBrandBrowser({
  brands,
  breweries,
  areas,
  flavorCharts,
}: SakenowaTables): BrandBrowser {
  // areaId 0 は「その他」で都道府県ではない。**県名としては引けないようにする**が、
  // 一覧の行としては残す(下の `areaRows`)。
  const prefectureById = new Map(
    areas.filter((area) => area.id !== 0).map((area) => [area.id, area.name]),
  )
  const breweryById = new Map(breweries.map((brewery) => [brewery.id, brewery]))
  const brandIdsWithChart = new Set(flavorCharts.map((chart) => chart.brandId))

  /** 蔵元ID → その蔵の銘柄行 */
  const brandsByBrewery = new Map<number, BrowseBrand[]>()
  for (const brand of brands) {
    const brewery = breweryById.get(brand.breweryId)
    // 蔵元が引けない銘柄はこの経路から辿れない(県も蔵元も分からないので枝を作れない)。
    // 検索の経路には出るので、届かなくなるわけではない
    if (brewery === undefined) continue
    const breweryName = brewery.name.trim()
    const row: BrowseBrand = {
      brand,
      prefecture: prefectureById.get(brewery.areaId) ?? null,
      breweryName: breweryName === '' ? null : breweryName,
      hasFlavorChart: brandIdsWithChart.has(brand.id),
    }
    const bucket = brandsByBrewery.get(brewery.id)
    if (bucket) bucket.push(row)
    else brandsByBrewery.set(brewery.id, [row])
  }
  for (const rows of brandsByBrewery.values()) {
    rows.sort((a, b) => {
      const byLength = normalize(a.brand.name).length - normalize(b.brand.name).length
      return byLength !== 0 ? byLength : a.brand.id - b.brand.id
    })
  }

  /** 県ID → その県の蔵元行(銘柄を持つ蔵元だけ) */
  const breweriesByArea = new Map<number, BrowseBrewery[]>()
  for (const brewery of breweries) {
    const brandCount = brandsByBrewery.get(brewery.id)?.length ?? 0
    // 行き止まりを作らない
    if (brandCount === 0) continue
    const name = brewery.name.trim()
    const row: BrowseBrewery = { brewery, name: name === '' ? null : name, brandCount }
    const bucket = breweriesByArea.get(brewery.areaId)
    if (bucket) bucket.push(row)
    else breweriesByArea.set(brewery.areaId, [row])
  }
  for (const rows of breweriesByArea.values()) {
    rows.sort(
      (a, b) =>
        // **名前の無い受け皿は最後。** これは蔵ではなく「その県の蔵元不明」の置き場で、
        // 銘柄を最も多く抱えるので、件数順に素直に並べると各県の先頭がこれになる
        Number(a.name === null) - Number(b.name === null) ||
        // 読みのデータが無いので名前順はコードポイント順にしかならない。**件数の多い順を主にする**
        // (よく見る蔵ほど上に来るので、目で追う距離が短くなる)。名前とIDは同数の崩し方
        b.brandCount - a.brandCount ||
        (a.name ?? '').localeCompare(b.name ?? '', 'ja') ||
        a.brewery.id - b.brewery.id,
    )
  }

  const areaRows: BrowseArea[] = areas
    .map((area) => {
      const rows = breweriesByArea.get(area.id) ?? []
      return {
        areaId: area.id,
        name: area.name,
        breweryCount: rows.length,
        brandCount: rows.reduce((sum, row) => sum + row.brandCount, 0),
      }
    })
    .filter((row) => row.brandCount > 0)
    // JIS 順(= id 順)。`その他`(0)だけは県ではないので最後に回す
    .sort((a, b) => (a.areaId === 0 ? 1 : b.areaId === 0 ? -1 : a.areaId - b.areaId))

  return {
    areas: () => areaRows.map((row) => ({ ...row })),
    // **知らないキーは空。**「全件」に落ちてはならない
    breweries: (areaId) => (breweriesByArea.get(areaId) ?? []).map((row) => ({ ...row })),
    brands: (breweryId) => (brandsByBrewery.get(breweryId) ?? []).map((row) => ({ ...row })),
  }
}
