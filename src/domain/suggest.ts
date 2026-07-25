// 銘柄名のインクリメンタル検索(3264件)。記録フォームで1キーストロークごとに走る経路。
//
// `createLinker` と同じ注入形にしてある(`createSuggester(tables)` → 検索関数)。テーブルを
// import せずに受け取るので domain 層は同梱 JSON の復号にも fetch にも依存せず、テストは
// 数件のリテラルからテーブルを組める。
//
// **この層の規則は2つ**:
// 1. **一致0件のとき全件に落ちない。** 空配列を返す(brain: 定義域外のキーでルックアップが
//    「全件」にフォールバックしてはならない)。3264件を出すと入力の邪魔になるだけでなく、
//    「該当なし」という事実を隠す。
// 2. **同名を1つに丸めない。** `高砂` は静岡/三重/佐賀/島根の4件あり、行に都道府県と蔵元が
//    出ていなければ本人が選び分けられない。曖昧さは畳まずに全部見せる。
//
// 正規化は `normalize()`(NFKC → 括弧内除去 → 空白除去 → 異体字 → lowercase)。**読みの
// データは同梱していないので、かな入力(`きど` → `紀土`)は一致しない** — これは制約であって
// 欠陥ではない(SPEC のスコープ外)。IME の変換途中に「該当なし」を出さない責務は UI 側
// (`compositionstart` / `compositionend`)にあり、この層は0件を0件として返すだけ。

import { normalize } from './normalize.ts'
import type { SakenowaBrand, SakenowaTables } from './types.ts'

/**
 * サジェスト1行。**銘柄名だけでは足りない**: 同名4件の `高砂` を選び分けるには
 * 都道府県と蔵元が要る(PHASE_4 の完了条件)。
 *
 * `hasFlavorChart` は「選ぶとフレーバー6軸が埋まるか」。紐付け済み ≠ フレーバー取得済み
 * (`ビキニ娘` 2020 は銘柄として在るがチャートが無い)なので、**推定で埋めずに事前に示す**。
 */
export type SuggestHit = {
  brand: SakenowaBrand
  /** 銘柄 → 蔵 → エリアを辿った都道府県名。蔵が引けない / areaId 0(その他)は `null` */
  prefecture: string | null
  /**
   * **表示できる蔵元名があるときだけ非 null。**
   *
   * さけのわの蔵元マスタには**名前が空の行が48件**あり(都道府県ごとに1件 + areaId 0 の1件 =
   * 「その県の蔵元不明」の受け皿)、**262件の銘柄がそこに属している**。空文字をそのまま返すと
   * UI が蔵元の欄を空白で描いて「取得できている」ように見えるので、ここで `null` に畳む。
   * 蔵元で選び分けられない銘柄が一定数あることは、隠さず県だけで見せるほうが正しい。
   */
  breweryName: string | null
  hasFlavorChart: boolean
  /**
   * 正規化後の銘柄名がクエリで始まるか。並び順の根拠(前方一致 → 含む一致)そのもので、
   * UI が区切りを出すためにも使える。
   *
   * 一致位置を返さないのは意図的: 位置は**正規化後**の文字列上の値で、括弧内除去や NFKC で
   * 長さが変わるため生の銘柄名には対応しない。それで強調範囲を描くとずれる。
   */
  isPrefix: boolean
}

/** createSuggester が要求するテーブル束。`SakenowaTables` がそのまま満たす */
export type SuggesterTables = SakenowaTables

export type Suggester = (query: string, limit?: number) => SuggestHit[]

/**
 * 既定の上限。サジェストは「絞り込めていない」ことが分かる程度に出せばよく、
 * 一致件数そのものは行数で伝えない(必要なら呼び出し側が `limit` を渡す)。
 */
export const DEFAULT_SUGGEST_LIMIT = 20

type IndexEntry = {
  /** normalize() 済みの銘柄名。照合はこの文字列への `indexOf` だけで済ませる */
  key: string
  /** クエリに依存しない部分。1回組んだら以降は複製せずに使い回す */
  hit: Omit<SuggestHit, 'isPrefix'>
}

type Match = { entry: IndexEntry; isPrefix: boolean }

/**
 * 前方一致 → 含む一致 → 正規化名が短い順 → 銘柄ID の昇順。
 *
 * 名前の短い順が入ると、前方一致の中では**完全一致が必ず先頭に来る**(クエリと同じ長さが
 * 前方一致の最短)。ID を最後に挟むのは同順位の並びを決定的にするため
 * (同名4件の `高砂` のような組は他のキーで区別できない)。
 */
function compareMatches(a: Match, b: Match): number {
  if (a.isPrefix !== b.isPrefix) return a.isPrefix ? -1 : 1
  if (a.entry.key.length !== b.entry.key.length) return a.entry.key.length - b.entry.key.length
  return a.entry.hit.brand.id - b.entry.hit.brand.id
}

/**
 * 銘柄マスタを閉じ込めて検索関数を返す。**索引はここで1回だけ張る。**
 *
 * 毎回 3264件を `normalize()` すると1キーストロークあたり NFKC + 正規表現置換が3264回走り、
 * 日本語入力の変換中(1文字ごとに `input` が飛ぶ)に体感で詰まる。正規化はこの構築時に
 * 3264回で終わらせ、以降の照合は文字列の `indexOf` だけにする。
 *
 * 返す関数は構築時のテーブルのスナップショットを見る。月次更新でテーブルが変わったら
 * suggester も作り直す(store 側の責務)。
 */
export function createSuggester({
  brands,
  breweries,
  areas,
  flavorCharts,
}: SuggesterTables): Suggester {
  // areaId 0 は「その他」(海外蔵など)で都道府県ではない。県名として引けるようにすると
  // JIS 1..47 前提の産地マップや県一致の紐付けに定義域外の値が流れ込む(linkBrand と同じ規則)。
  const areaNameById = new Map(
    areas.filter((area) => area.id !== 0).map((area) => [area.id, area.name]),
  )
  const breweryById = new Map(breweries.map((brewery) => [brewery.id, brewery]))
  // 有無だけを見るので Set。**欠けているものを 0 で埋めない**(6軸集計の分母が水増しされる)
  const brandIdsWithChart = new Set(flavorCharts.map((chart) => chart.brandId))

  const index: IndexEntry[] = brands.map((brand) => {
    const brewery = breweryById.get(brand.breweryId)
    const breweryName = brewery?.name.trim() ?? ''
    return {
      key: normalize(brand.name),
      hit: {
        brand,
        prefecture: brewery ? (areaNameById.get(brewery.areaId) ?? null) : null,
        breweryName: breweryName === '' ? null : breweryName,
        hasFlavorChart: brandIdsWithChart.has(brand.id),
      },
    }
  })

  return (query, limit = DEFAULT_SUGGEST_LIMIT) => {
    const key = normalize(query)
    // 空クエリは「全件」ではなく0件。まだ何も絞り込んでいない状態で3264行を出さない
    if (key === '') return []
    // `slice(0, -1)` は末尾を1件落とすので、負値や NaN をそのまま渡すと静かに結果が化ける。
    // 1件も出せない上限は0件として扱う。
    const max = Math.floor(limit)
    if (!(max >= 1)) return []

    const matched: Match[] = []
    for (const entry of index) {
      const at = entry.key.indexOf(key)
      if (at < 0) continue
      matched.push({ entry, isPrefix: at === 0 })
    }
    // 一致0件なら空配列。ここで index 全体を返す枝を作ってはいけない
    matched.sort(compareMatches)
    return matched.slice(0, max).map(({ entry, isPrefix }) => ({ ...entry.hit, isPrefix }))
  }
}
