// @vitest-environment node
// brand-aliases.ts はデータだけの純モジュールなので jsdom を要らない。node 環境で回すこと自体が
// その実証で、DOM に触るコードが src/data/ の入口に混ざった瞬間にこのファイルが落ちる。
//
// **このファイルの役目**: 組み込みエイリアス8件の brandId が同梱の銘柄マスタに**実在する**ことを
// 月次更新ワークフロー(.github/workflows/update-sakenowa.yml)のコミット前に固定する。
//
// なぜ必要か: `createLinker` は上流から消えた brandId を指すエイリアスを**黙って読み飛ばす**
// (linkBrand.ts:99 — 存在しない銘柄を指したまま「紐付いた」と言うより未紐付けにする、という
// 実行時の判断としては正しい)。つまり上流が銘柄を削除しても実行時は例外も警告も出さず、
// エイリアスが1件ぶら下がったまま出荷される。月次更新は人手を介さず main にコミットして
// デプロイまで走るので、**ここで赤くして止める**のが唯一の検出点になる。
//
// linkBrand.test.ts の変異テストも件数の変化で間接的には気づくが、落ちるのは「176/185/186」と
// いう紐付け本数の期待値であって、原因(どのエイリアスが宙に浮いたか)を名指ししない。
// ここは brandId の実在だけを見て、消えた label を出力に出す。
import { decodeTables } from './tables.ts'
import type { RawSakenowaFiles } from './tables.ts'
import { BRAND_ALIASES } from './brand-aliases.ts'
import areasJson from '../../public/data/sakenowa/areas.json'
import brandsJson from '../../public/data/sakenowa/brands.json'
import breweriesJson from '../../public/data/sakenowa/breweries.json'
import flavorChartsJson from '../../public/data/sakenowa/flavorCharts.json'
import type {
  AreasFile,
  BrandAlias,
  BrandsFile,
  BreweriesFile,
  FlavorChartsFile,
  SakenowaBrand,
} from '../domain/types.ts'

// 同梱データ本体を JSON モジュール import で読む(fs を使わない理由は tables.test.ts の冒頭)。
// タプル行を解くのは decodeTables に任せる — 列順の取り違えは静かに壊れるので復号は1本に限り、
// 列順そのものは tables.test.ts の「タプルの列順」が固定している。
const raw: RawSakenowaFiles = {
  areas: areasJson as AreasFile,
  breweries: breweriesJson as unknown as BreweriesFile,
  brands: brandsJson as unknown as BrandsFile,
  flavorCharts: flavorChartsJson as unknown as FlavorChartsFile,
}

const tables = decodeTables(raw)

/**
 * brandId が銘柄マスタに無いエントリを返す。**実データでは空**であることが不変条件。
 * 検査を関数に切り出しているのは、下で合成テーブルに食わせて「この検査が恒真でない」ことを
 * 実演するため(BACKLOG B15: 実装から導いた期待値で書くと検査が自分自身を追認する)。
 */
const danglingAliases = (
  aliases: readonly BrandAlias[],
  brandById: ReadonlyMap<number, SakenowaBrand>,
): readonly BrandAlias[] => aliases.filter((alias) => !brandById.has(alias.brandId))

/**
 * 8エントリの (label, prefecture) → brandId / さけのわ名 / 蔵の所在県 を**リテラルで**固定する。
 * brandId の実在だけでは「id が別の酒に再利用された」ことを検出できないので名前も県も見る。
 * 1217(栄光冨士) は zebra / magma の2エントリから指されるので brandId は7種・エントリは8件。
 */
const EXPECTED: readonly (readonly [
  label: string,
  prefecture: string | null,
  brandId: number,
  brandName: string,
  brandPrefecture: string,
])[] = [
  ['赤武', null, 2602, 'AKABU', '岩手県'],
  ['高砂', '三重県', 9941, '高砂', '三重県'],
  ['寒菊', null, 1349, '総乃寒菊', '千葉県'],
  ['zebra', null, 1217, '栄光冨士', '山形県'],
  ['magma', null, 1217, '栄光冨士', '山形県'],
  ['荷札酒', null, 3534, '加茂錦', '新潟県'],
  ['会津宮泉', null, 2401, '宮泉', '福島県'],
  ['ゆきのまゆ', null, 41721, 'ゆきのまゆ（醸す森）', '新潟県'],
]

describe('組み込みエイリアスの brandId が銘柄マスタに実在する', () => {
  it('ぶら下がったエイリアスが1件も無い', () => {
    // 失敗時は消えた label が出る(件数だけだとどれが宙に浮いたか分からない)。
    expect(danglingAliases(BRAND_ALIASES, tables.brandById).map((alias) => alias.label)).toEqual([])
  })

  it('この検査は恒真ではない — マスタから1件消すと当該 label を検出する', () => {
    // 上流削除の模擬。全件から 2602(AKABU) だけ抜いたマスタを食わせる。
    const without2602 = new Map(
      [...tables.brandById].filter(([id]) => id !== 2602),
    ) as ReadonlyMap<number, SakenowaBrand>
    expect(without2602.size).toBe(tables.brandById.size - 1)
    expect(danglingAliases(BRAND_ALIASES, without2602).map((alias) => alias.label)).toEqual(['赤武'])
  })

  it('8エントリすべてが期待表に載っている(表にエントリを足したらここも足す)', () => {
    expect(BRAND_ALIASES).toHaveLength(8)
    expect(EXPECTED).toHaveLength(8)
    for (const [label, prefecture] of EXPECTED) {
      const matched = BRAND_ALIASES.filter(
        (alias) => alias.label === label && alias.prefecture === prefecture,
      )
      // 1件に絞れることは「期待表が全件を覆う」と「キーが重複していない」を同時に言う。
      // 同じキーが2件あると findAlias の後勝ちで一方が黙って影に入る。
      expect(matched, `${label} / ${prefecture ?? '県を問わない'}`).toHaveLength(1)
    }
  })

  it.each(EXPECTED)(
    '%s(%s) → brandId %i は実在し、さけのわ名 %s / %s の蔵',
    (label, prefecture, brandId, brandName, brandPrefecture) => {
      const entry = BRAND_ALIASES.find(
        (alias) => alias.label === label && alias.prefecture === prefecture,
      )
      expect(entry?.brandId).toBe(brandId)

      const brand = tables.brandById.get(brandId)
      // toBeDefined() だけだと「消えた」以外の理由(id の再利用)を見逃す。
      expect(brand?.name).toBe(brandName)
      // 蔵の所在県も見る: 県を指定したエントリ(高砂/三重県)は蔵が県を跨いだ瞬間に解決しなくなり、
      // 県を問わないエントリでも「同じ id が別の県の酒になった」ことの合図になる。
      expect(tables.prefectureOfBrand(brandId)).toBe(brandPrefecture)
    },
  )
})
