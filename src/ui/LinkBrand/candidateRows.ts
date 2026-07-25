// 候補1行に出す材料を組む。**2つの入口(候補 / 全件検索)の行を同じ形に揃える**ためのモジュール。
//
// 定数と純関数をコンポーネント(.tsx)から分けているのは Fast Refresh のため
// (`ui/Timeline/linkStatus.ts` / `ui/AppShell/tabs.ts` と同じ理由)。
//
// ## 銘柄名だけでは選べない
//
// 同名の銘柄がある(`高砂` は静岡/三重/佐賀/島根の4件)ので、行には**都道府県と蔵元**を出す。
// さらに**蔵元名が空の行が48件あり262銘柄がそこに属す**(さけのわの「その県の蔵元不明」の受け皿)。
// 空文字をそのまま描くと「取得できている」ように見えるので `null` に畳んで、
// 「蔵元名がデータに無い」と明示する(`domain/suggest.ts` の `SuggestHit` と同じ規則)。
//
// `hasFlavorChart` は「選ぶとフレーバー6軸が埋まるか」。**紐付け済み ≠ フレーバー取得済み**
// (`ビキニ娘` は銘柄として在るがチャートが無い)なので、選ぶ前に分かるようにしておく。

import type { SuggestHit } from '../../domain/suggest.ts'
import type { FlavorChart, SakenowaBrand, SakenowaBrewery } from '../../domain/types.ts'
import { scopeOf } from './applyManualLink.ts'

/** 候補行を組むのに引く索引だけを要求する最小の面。`DecodedTables` がそのまま満たす */
export type CandidateTables = {
  breweryById: ReadonlyMap<number, SakenowaBrewery>
  /** **欠けを 0 で埋めない。** 有無だけを見る */
  flavorChartByBrandId: ReadonlyMap<number, FlavorChart>
  /** 銘柄 → 蔵 → エリア。都道府県に落ちないものは `null`(既定の県に落とさない) */
  prefectureOfBrand: (brandId: number) => string | null
}

export type CandidateRow = {
  brand: SakenowaBrand
  /** 都道府県に辿れないものは `null`(海外蔵など。適当な県で埋めない) */
  prefecture: string | null
  /** 表示できる蔵元名があるときだけ非 `null` */
  breweryName: string | null
  hasFlavorChart: boolean
  /** 記録の都道府県と一致する。**候補の並びの根拠**(県一致を先に出す) */
  samePrefecture: boolean
}

function breweryNameOf(tables: CandidateTables, brand: SakenowaBrand): string | null {
  const name = tables.breweryById.get(brand.breweryId)?.name.trim() ?? ''
  return name === '' ? null : name
}

function rowOf(
  tables: CandidateTables,
  brand: SakenowaBrand,
  recordPrefecture: string | null,
): CandidateRow {
  const prefecture = tables.prefectureOfBrand(brand.id)
  return {
    brand,
    prefecture,
    breweryName: breweryNameOf(tables, brand),
    hasFlavorChart: tables.flavorChartByBrandId.has(brand.id),
    // 記録の県が空('' / null)のときは「一致」にしない。県で優先する根拠が無い
    samePrefecture: recordPrefecture !== null && prefecture === recordPrefecture,
  }
}

/**
 * `LinkResult.candidates`(表記が一致した銘柄)を行にする。**都道府県一致を先に出す。**
 *
 * `candidates` は県で絞られていない(`createLinker` は候補には県違いの同名も入れる)。
 * ここで**落とさずに並べ替えるだけ**にするのは、`Beau Michelle` のように「県は違うが
 * 同じ名前がある」ことこそ本人が見て判断する材料だから。0件を全件に広げることもしない。
 */
export function candidateRows(
  brands: readonly SakenowaBrand[],
  tables: CandidateTables,
  recordPrefecture: string | null,
): CandidateRow[] {
  const scope = scopeOf(recordPrefecture)
  const rows = brands.map((brand) => rowOf(tables, brand, scope))
  // 県一致 → 銘柄ID昇順。ID を最後に挟むのは同順位の並びを決定的にするため
  return rows.sort((a, b) => {
    if (a.samePrefecture !== b.samePrefecture) return a.samePrefecture ? -1 : 1
    return a.brand.id - b.brand.id
  })
}

/**
 * 全件検索の結果を行にする。**並べ替えない** — 前方一致 → 含む一致 → 短い順 → ID昇順という
 * 並びは `createSuggester` の契約(完全一致が必ず先頭に来る)で、ここで県一致を優先すると
 * 入力に対する応答の順序が壊れる。県一致は印だけ付けて見せる。
 */
export function suggestRows(
  hits: readonly SuggestHit[],
  recordPrefecture: string | null,
): CandidateRow[] {
  const scope = scopeOf(recordPrefecture)
  return hits.map((hit) => ({
    brand: hit.brand,
    prefecture: hit.prefecture,
    breweryName: hit.breweryName,
    hasFlavorChart: hit.hasFlavorChart,
    samePrefecture: scope !== null && hit.prefecture === scope,
  }))
}
