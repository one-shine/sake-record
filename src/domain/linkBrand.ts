// 記録の銘柄表記(`brandLabel`)を さけのわ の brandId に解決する。
//
// SPEC の `linkBrand(label, prefecture)` は銘柄マスタ(3264件)とランタイムのエイリアス
// (手動紐付けの永続化分)を注入できず純関数にならないので、テーブルを閉じ込めて関数を返す
// `createLinker(tables)` に変えた(BACKLOG B3)。呼び出し側の形は SPEC のまま。
//
// **この層の最重要の規則**: 記録に都道府県があるなら**同県の候補だけを採用し、
// 0件になっても全件にフォールバックしない**。緩めると `Beau Michelle`(神奈川/川西屋酒造) が
// さけのわの同名 3141(長野/伴野酒造) に誤紐付けされる(実測で踏んだ)。
// 候補が2件以上残ったときも機械が選ばず `unlinked` + `candidates` にして本人に委ねる。

import { normalize } from './normalize.ts'
import type { BrandAlias, LinkResult, Linker, LinkerTables, SakenowaBrand } from './types.ts'

/** ログの「銘柄自体が判読できていない」表記(5本)。正規化後のキーで比較する */
const UNKNOWN_KEY = '不明'

function groupBrands(
  brands: readonly SakenowaBrand[],
  keyOf: (brand: SakenowaBrand) => string,
): Map<string, SakenowaBrand[]> {
  const index = new Map<string, SakenowaBrand[]>()
  for (const brand of brands) {
    const key = keyOf(brand)
    const bucket = index.get(key)
    if (bucket) bucket.push(brand)
    else index.set(key, [brand])
  }
  return index
}

/**
 * 銘柄マスタとエイリアス表を閉じ込めて解決関数を返す。索引はここで1回だけ張る。
 *
 * 返す status は `auto` / `alias` / `unlinked` / `unknown` の4つ。`manual` は返さない
 * (手動紐付けの結果は store がエイリアスとして永続化し、次からは `alias` として解決される)。
 */
export function createLinker({ brands, breweries, areas, aliases }: LinkerTables): Linker {
  // areaId 0 は「その他」(海外蔵など)で都道府県ではない。県名として引けるようにすると
  // 記録側の県と突き合わせる経路に JIS 1..47 の外の値が入るので索引に入れない。
  const areaNameById = new Map(areas.filter((area) => area.id !== 0).map((a) => [a.id, a.name]))
  const areaIdByBreweryId = new Map(breweries.map((brewery) => [brewery.id, brewery.areaId]))
  const brandById = new Map(brands.map((brand) => [brand.id, brand]))
  // 銘柄名は一意でない(3264件に対し異なる名前は3196件)ので、どちらの索引も値は配列。
  const byRawName = groupBrands(brands, (brand) => brand.name)
  const byNormalizedName = groupBrands(brands, (brand) => normalize(brand.name))
  const aliasesByKey = new Map<string, BrandAlias[]>()
  for (const alias of aliases) {
    const bucket = aliasesByKey.get(alias.label)
    if (bucket) bucket.push(alias)
    else aliasesByKey.set(alias.label, [alias])
  }

  /** 銘柄 → 蔵 → エリア。都道府県に落ちないものは null(既定の県に落とさない) */
  const prefectureOf = (brand: SakenowaBrand): string | null => {
    const areaId = areaIdByBreweryId.get(brand.breweryId)
    if (areaId === undefined) return null
    return areaNameById.get(areaId) ?? null
  }

  /**
   * 同じキーに複数のエイリアスが載り得る(組み込み8件 + 手動紐付けの永続化分)。
   * 県を指定した側を優先し、同じ具体性なら**後に来た側**を採る。
   * store は `[...BRAND_ALIASES, ...手動分]` の順で渡すので、後勝ち = 本人の判断が優先される。
   */
  const findAlias = (key: string, prefecture: string | null): BrandAlias | undefined => {
    const bucket = aliasesByKey.get(key)
    if (!bucket) return undefined
    let wildcard: BrandAlias | undefined
    let scoped: BrandAlias | undefined
    for (const alias of bucket) {
      if (alias.prefecture === null) wildcard = alias
      else if (alias.prefecture === prefecture) scoped = alias
    }
    return scoped ?? wildcard
  }

  const resolved = (brand: SakenowaBrand, status: 'auto' | 'alias'): LinkResult => ({
    brandId: brand.id,
    // 紐付いたら brandName は必ず埋める(B4)。brandId からの逆引きに任せない
    brandName: brand.name,
    status,
    candidates: [],
  })

  return (label, prefecture) => {
    const key = normalize(label)
    if (key === '' || key === UNKNOWN_KEY) {
      return { brandId: null, brandName: null, status: 'unknown', candidates: [] }
    }

    // 記録の都道府県は未記入('')があり得る。`''` は県名ではなく「絞り込みの手がかりが無い」
    // ことなので null と同じに扱う(県名として突き合わせると全候補が落ちて何も紐付かない)。
    const scope = prefecture !== null && prefecture.trim() !== '' ? prefecture.trim() : null

    const alias = findAlias(key, scope)
    if (alias) {
      const brand = brandById.get(alias.brandId)
      // 上流から銘柄が消えたエイリアスは無視して名称一致に進む。brandId だけ埋まって
      // brandName が null の 'alias' を返すと B4 の不変条件が破れるし、存在しない銘柄を
      // 指したまま「紐付いた」ことにするより未紐付けとして本人に見せるほうが正しい。
      if (brand) return resolved(brand, 'alias')
    }

    const exact = byRawName.get(label.trim()) ?? []
    const normalized = byNormalizedName.get(key) ?? []
    // 生の一致と正規化一致の2段。**これは優先順位ではなく「正規化で潰れた区別を生の表記で
    // 取り戻す」ための2段**: `exact` は常に `normalized` の部分集合(name が等しければ正規化後も
    // 等しい)で、採用するのは要素が1件のときだけなので、両方が1件なら同じ銘柄を指す。
    // つまり**この配列の順序を入れ替えても結果は変わらない**(順序に意味を持たせないこと)。
    // 効いているのは生の一致という段の存在: 神奈川県の `丹沢山`(327) と `丹澤山`(2149) は
    // 正規化すると同じキーに落ちるので、正規化一致だけでは2件で曖昧になりどちらも紐付かない。
    for (const pool of [exact, normalized]) {
      const scoped = scope === null ? pool : pool.filter((brand) => prefectureOf(brand) === scope)
      // 2件以上残ったら機械は決めない。都道府県で絞ってもなお同名が残る組が25ある
      if (scoped.length === 1) return resolved(scoped[0], 'auto')
    }

    return {
      brandId: null,
      brandName: null,
      status: 'unlinked',
      // 候補は手動紐付けUIに渡す材料。**採用は同県に限るが、候補は県が違っても見せる**
      // (`Beau Michelle` は 3141 を候補に出したまま未紐付けに留める)。
      // 索引のバケットをそのまま返すと呼び出し側の書き換えが索引に届くので複製する。
      candidates: [...normalized],
    }
  }
}
