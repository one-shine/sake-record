import { normalize } from '../domain/normalize.ts'
import { decodeKanjiReadings, type KanjiReadings, type KanjiReadingsFile } from '../domain/reading.ts'
import type {
  AreasFile,
  BrandFlavorTagsFile,
  BrandsFile,
  BreweriesFile,
  FlavorChart,
  FlavorChartsFile,
  FlavorTagsFile,
  SakenowaArea,
  SakenowaBrand,
  SakenowaBrewery,
  SakenowaTables,
} from '../domain/types.ts'

// 同梱 JSON(タプル形式)を解いて索引を張る層。
//
// ここが `src/data/` にあるのは依存方向 `domain ← data/store ← ui` を保つため。
// `src/domain/` は `SakenowaTables` 型を受け取るだけで、この復号にも fetch にも依存しない。

/** decodeTables の入力。`public/data/sakenowa/*.json` をそのまま JSON.parse した形 */
export type RawSakenowaFiles = {
  areas: AreasFile
  breweries: BreweriesFile
  brands: BrandsFile
  flavorCharts: FlavorChartsFile
  /** 漢字の読み表(B68)。**取れなくても他の4本は使える**ので任意 */
  kanjiReadings?: KanjiReadingsFile | null
}

/**
 * 配列(`SakenowaTables`)に索引と解決関数を足した束。
 *
 * 索引を `SakenowaTables` 自体に含めないのは意図的(domain/types.ts 参照)。
 * `createLinker` は紐付け用の索引を自前で作るので、こちらはサジェスト・詳細表示・
 * フレーバー集計が使う引き方だけを持つ。
 */
export type DecodedTables = SakenowaTables & {
  brandById: ReadonlyMap<number, SakenowaBrand>
  /**
   * 正規化名 → 銘柄。**値が配列なのは名前が一意でないから**
   * (3264件に対し異なる名前は3196件。`高砂` は静岡/三重/佐賀/島根の4件)。
   * 定義域外のキーは `undefined` を返す。**全件にフォールバックしてはならない**。
   */
  brandsByNormalizedName: ReadonlyMap<string, readonly SakenowaBrand[]>
  breweryById: ReadonlyMap<number, SakenowaBrewery>
  /** areaId → 名前。**0 は「その他」で都道府県ではない**(1..47 が JIS 都道府県コード) */
  areaNameById: ReadonlyMap<number, string>
  /** 1344件。**紐付け済み ≠ フレーバー取得済み**なので `undefined` を 0 で埋めない */
  flavorChartByBrandId: ReadonlyMap<number, FlavorChart>
  /** 銘柄 → 蔵 → エリアを辿った都道府県名。都道府県に落ちないものは `null` */
  prefectureOfBrand: (brandId: number) => string | null
  /**
   * 漢字 → 読み(B68)。**取得に失敗したら空**で、その場合はかなによる検索が効かないだけ。
   * ここを必須にすると、読み表1本が落ちただけで**記録が作れなくなる**(`loadTables` の doc)。
   */
  kanjiReadings: KanjiReadings
}

export function decodeTables(raw: RawSakenowaFiles): DecodedTables {
  // areas.json は **添字が areaId**(rows[0] === 'その他' / rows[7] === '福島県')
  const areas: SakenowaArea[] = raw.areas.rows.map((name, id) => ({ id, name }))
  const breweries: SakenowaBrewery[] = raw.breweries.rows.map(([id, name, areaId]) => ({
    id,
    name,
    areaId,
  }))
  const brands: SakenowaBrand[] = raw.brands.rows.map(([id, name, breweryId]) => ({
    id,
    name,
    breweryId,
  }))
  const flavorCharts: FlavorChart[] = raw.flavorCharts.rows.map(
    ([brandId, f1, f2, f3, f4, f5, f6]) => ({ brandId, f1, f2, f3, f4, f5, f6 }),
  )

  const areaNameById = new Map(areas.map((area) => [area.id, area.name]))
  const breweryById = new Map(breweries.map((brewery) => [brewery.id, brewery]))
  const brandById = new Map(brands.map((brand) => [brand.id, brand]))
  const flavorChartByBrandId = new Map(flavorCharts.map((chart) => [chart.brandId, chart]))

  const brandsByNormalizedName = new Map<string, SakenowaBrand[]>()
  for (const brand of brands) {
    const key = normalize(brand.name)
    const bucket = brandsByNormalizedName.get(key)
    if (bucket) bucket.push(brand)
    else brandsByNormalizedName.set(key, [brand])
  }

  const prefectureOfBrand = (brandId: number): string | null => {
    const brand = brandById.get(brandId)
    if (!brand) return null
    const brewery = breweryById.get(brand.breweryId)
    if (!brewery) return null
    // areaId 0 は「その他」= 海外蔵など。都道府県名として返すと、県一致による紐付けや
    // JIS 1..47 前提の産地マップに定義域外の値が流れ込むので null にする。
    if (brewery.areaId === 0) return null
    return areaNameById.get(brewery.areaId) ?? null
  }

  return {
    brands,
    breweries,
    areas,
    flavorCharts,
    kanjiReadings:
      raw.kanjiReadings === undefined || raw.kanjiReadings === null
        ? new Map()
        : decodeKanjiReadings(raw.kanjiReadings),
    brandById,
    brandsByNormalizedName,
    breweryById,
    areaNameById,
    flavorChartByBrandId,
    prefectureOfBrand,
  }
}

/**
 * 同梱 JSON のファイル名。**2つの束に分かれているのは意図的**(`loadFlavorTags` の doc を読む)。
 * 上の4本は `loadTables()` が、下の2本は `loadFlavorTags()` が読む。
 */
const FILE_NAMES = {
  areas: 'areas.json',
  breweries: 'breweries.json',
  brands: 'brands.json',
  flavorCharts: 'flavorCharts.json',
  flavorTags: 'flavorTags.json',
  brandFlavorTags: 'brandFlavorTags.json',
} as const

/** 読み表だけ別のディレクトリ(出所が KANJIDIC でさけのわではない) */
const KANJI_READINGS_PATH = 'kanji/readings.json'

/**
 * 起動に要る4表 + 読み表。
 *
 * **読み表の失敗だけは飲み込む。** 4表は無いと銘柄が1件も引けない(記録が作れない)ので
 * 拒否をそのまま投げるが、読み表が無くて失われるのは「かなで探せる」ことだけで、
 * 銘柄名を打つ経路も一覧から選ぶ経路もそのまま使える。**任意の1本のために
 * 「記録が作れない」条件を増やさない**(`loadFlavorTags` を別の束にしてあるのと同じ判断)。
 */
export async function loadTables(): Promise<DecodedTables> {
  const [areas, breweries, brands, flavorCharts, kanjiReadings] = await Promise.all([
    fetchFile<AreasFile>(FILE_NAMES.areas),
    fetchFile<BreweriesFile>(FILE_NAMES.breweries),
    fetchFile<BrandsFile>(FILE_NAMES.brands),
    fetchFile<FlavorChartsFile>(FILE_NAMES.flavorCharts),
    fetchData<KanjiReadingsFile>(KANJI_READINGS_PATH).catch(() => null),
  ])
  return decodeTables({ areas, breweries, brands, flavorCharts, kanjiReadings })
}

// ---------------------------------------------------------------------------
// 味タグ(B5)。**上の4表とは別の束にする**
// ---------------------------------------------------------------------------

/** decodeFlavorTags の入力。味タグの2ファイルをそのまま JSON.parse した形 */
export type RawFlavorTagFiles = {
  flavorTags: FlavorTagsFile
  brandFlavorTags: BrandFlavorTagsFile
}

/**
 * 味タグの語彙と銘柄→タグの索引。**`DecodedTables` に混ぜない**(`loadFlavorTags` の doc)。
 */
export type DecodedFlavorTags = {
  /** タグID → 語。定義域外は `undefined`。**未知のIDを「その他」等で埋めない** */
  tagNameById: ReadonlyMap<number, string>
  /**
   * 銘柄ID → その銘柄のタグID。**タグが1つも無い銘柄は行ごと無い**(空配列も入っていない。
   * 3264銘柄のうち 2136件しか行が無い)。`undefined` を空タグとして扱ってよいが、
   * **「タグが無い = その味がない」と読んではいけない**(下の `atCapBrandCount` を見る)。
   */
  tagIdsByBrandId: ReadonlyMap<number, readonly number[]>
  /**
   * 1銘柄あたりのタグ数の最大値 = **上流の打ち切り上限**(同梱データでは20)。
   *
   * リテラルで持たない。20語ちょうどの銘柄が731件ある一方 19語は16件しかなく、この段差は
   * 味の分布ではなく上限そのものだが、上流が上限を変えたときに画面の説明文だけが古くなる
   * (しかも画面は正しく見える)。実データから出す。
   */
  maxTagsPerBrand: number
  /** 上限に達している銘柄数(同梱データでは 2136件中731件)。**21番目以降の語が落ちている銘柄** */
  atCapBrandCount: number
}

export function decodeFlavorTags(raw: RawFlavorTagFiles): DecodedFlavorTags {
  const tagNameById = new Map(raw.flavorTags.rows.map(([id, tag]) => [id, tag]))

  // 行は [銘柄ID, ...タグID]。先頭をタグIDに混ぜると 銘柄IDと同値のタグが全銘柄に付く
  const tagIdsByBrandId = new Map<number, readonly number[]>()
  let maxTagsPerBrand = 0
  for (const [brandId, ...tagIds] of raw.brandFlavorTags.rows) {
    tagIdsByBrandId.set(brandId, tagIds)
    if (tagIds.length > maxTagsPerBrand) maxTagsPerBrand = tagIds.length
  }

  let atCapBrandCount = 0
  // 上限が 0(空の同梱データ)のときに「0語ちょうどの銘柄が全件」と言わない
  if (maxTagsPerBrand > 0) {
    for (const tagIds of tagIdsByBrandId.values()) {
      if (tagIds.length === maxTagsPerBrand) atCapBrandCount += 1
    }
  }

  return { tagNameById, tagIdsByBrandId, maxTagsPerBrand, atCapBrandCount }
}

/**
 * 味タグの2ファイル。**`loadTables()` に畳まない。**
 *
 * `loadTables()` の成否は「記録フォーム / 記録の詳細 / 手動紐付けを開けるか」を決めている
 * (`App` の `openWithTables` / `TABLES_REQUIRED`)。**任意のファセット1つのために
 * 「記録が作れない」条件を増やすのは robustness の後退**なので、取得も失敗も別に持つ。
 *
 * 呼ぶのは本人が絞り込みパネルを開いたときだけ(`App` の `ensureFlavorTags`)。Service Worker が
 * 既にこの2本のバイト列を持っているので取得自体は実質ゼロコストだが、開かないセッションでは
 * 22KB の parse と索引の構築も走らせない。
 */
export async function loadFlavorTags(): Promise<DecodedFlavorTags> {
  const [flavorTags, brandFlavorTags] = await Promise.all([
    fetchFile<FlavorTagsFile>(FILE_NAMES.flavorTags),
    fetchFile<BrandFlavorTagsFile>(FILE_NAMES.brandFlavorTags),
  ])
  return decodeFlavorTags({ flavorTags, brandFlavorTags })
}

async function fetchFile<T>(fileName: string): Promise<T> {
  return fetchData<T>(`sakenowa/${fileName}`, 'さけのわデータ')
}

async function fetchData<T>(path: string, label = '同梱データ'): Promise<T> {
  // base 相対で組む。base は './' なので、絶対パス(`/data/...`)で書くと
  // GitHub Pages のサブパス配信で 404 になる。
  const url = `${import.meta.env.BASE_URL}data/${path}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${label}を取得できない: ${url} (${res.status})`)
  return (await res.json()) as T
}
