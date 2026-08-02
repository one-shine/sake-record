// 銘柄の顔を、さけのわの味タグから作る(B76)。
//
// ## なぜ並べ替えるのか
//
// さけのわが返す順のまま出すと、どの銘柄を開いても先頭は 酸味・辛口・旨味・フルーティ になる。
// これらは 2,136銘柄の半数以上に付いている語で、**銘柄を区別しない**。銘柄ごとの違いは
// 後ろに埋もれている(獺祭の `シャンパン` は 28銘柄にしか付かないが、生の並びでは後方にある)。
//
// **コーパス全体で何銘柄に付くかで並べ替えると、少ない語が前に来て銘柄の顔になる。**
// 実測(台帳79銘柄): 希少な上位5語の組み合わせが一意なのは 77/79。
//
// ## 推定を混ぜない
//
// ここが返すのは**同梱データを数え直しただけの事実**で、味の推定を1つも足していない。
// 「その語が付く銘柄数」は画面に出せる(出せば並びの理由が読み手に説明できる)。
//
// ## 持たないもの
//
// - **語の名前**。IDだけを扱う(語彙表を引くのは呼び側)。domain は `data/` を見ない。
// - **上位N件の打ち切り**。何件見せるかは画面の判断で、ここは全部を並べ替えて返す。

/** 並べ替えた1語。`brandCount` は**その語が付く銘柄数**(コーパス全体での出現数) */
export type RankedFlavorTag = {
  id: number
  /**
   * その語が付く銘柄数。**数えられなかった語は `null`。**
   *
   * 0 を入れない — 0 は「最も希少」の意味になり、数えられなかった語が先頭に出る。
   * 未知と希少は別物で、混ぜると「推定値を埋めない」規律に反する。
   */
  brandCount: number | null
}

/**
 * 味タグを「その語が付く銘柄が少ない順」に並べ替える。
 *
 * @param tagIds その銘柄に付いている語のID(さけのわが返した順)
 * @param brandCountByTagId 語ID → その語が付く銘柄数(コーパス全体を数えたもの)
 *
 * 数えられなかった語は**末尾**に置く(先頭ではない。上の `brandCount` の doc)。
 * 同数のときはIDの昇順で、**描き直しても並びが変わらない**ことを保証する。
 */
export function rankFlavorTagsByRarity(
  tagIds: readonly number[],
  brandCountByTagId: ReadonlyMap<number, number>,
): readonly RankedFlavorTag[] {
  return tagIds
    .map((id) => ({ id, brandCount: brandCountByTagId.get(id) ?? null }))
    .sort((a, b) => {
      if (a.brandCount === null || b.brandCount === null) {
        if (a.brandCount === b.brandCount) return a.id - b.id
        return a.brandCount === null ? 1 : -1
      }
      if (a.brandCount !== b.brandCount) return a.brandCount - b.brandCount
      return a.id - b.id
    })
}
