// @vitest-environment node
// decodeTables は純関数で DOM を要らない。node 環境で回すこと自体がその実証で、
// window/document に触る実装が src/data/tables.ts に混ざった瞬間にこのファイルが落ちる。
import { decodeTables } from './tables.ts'
import type { RawSakenowaFiles } from './tables.ts'
import areasJson from '../../public/data/sakenowa/areas.json'
import brandsJson from '../../public/data/sakenowa/brands.json'
import breweriesJson from '../../public/data/sakenowa/breweries.json'
import flavorChartsJson from '../../public/data/sakenowa/flavorCharts.json'
import type {
  AreasFile,
  BrandsFile,
  BreweriesFile,
  FlavorChartsFile,
  SakenowaBrand,
} from '../domain/types.ts'

// 同梱データ本体を JSON モジュール import で読んで decodeTables に食わせる。
// **fetch はテストしない**(さけのわは CORS を返さないので実行時取得は最初から選択肢に無く、
// loadTables の責務は URL の組み立てだけ。復号は純関数側で全部押さえる)。
//
// fs で読まないのは Node の型を要求しないため。`/// <reference types="node" />` は
// @types/node の global 宣言をプログラム全体に効かせてしまい、本番 src でも process/Buffer が
// 型チェックを通るようになる(避けたかった状態そのもの)。linkBrand.test.ts も同じ import 方式。
// `new URL(..., import.meta.url)` は vite がアセット参照に書き換えて public/ 配信用のパスに
// 化けるので使えない(実際に ENOENT '/public/data/...' を踏んだ)。
//
// JSON モジュール import は行を `(string | number)[]` と推論する(タプルではない)。
// 型の宣言は復号の入口の1回だけにして、以降は decodeTables の戻り(型付き)を使う。
const raw: RawSakenowaFiles = {
  areas: areasJson as AreasFile,
  breweries: breweriesJson as unknown as BreweriesFile,
  brands: brandsJson as unknown as BrandsFile,
  flavorCharts: flavorChartsJson as unknown as FlavorChartsFile,
}

const tables = decodeTables(raw)

const ids = (brands: readonly SakenowaBrand[] | undefined) => brands?.map((b) => b.id)

describe('decodeTables — 件数', () => {
  // 同梱データが静かに入れ替わった/取得が変種違いで欠けた(BACKLOG B13 で flavorCharts が
  // 1342 と 1344 の間で往復した)ことを検出するための固定値。
  it('brands 3264 / breweries 1749 / flavorCharts 1344 を復号する', () => {
    expect(tables.brands).toHaveLength(3264)
    expect(tables.breweries).toHaveLength(1749)
    expect(tables.flavorCharts).toHaveLength(1344)
  })

  it('areas は添字が areaId で 0=その他 / 1..47 が JIS 都道府県コード', () => {
    expect(tables.areas).toHaveLength(48)
    expect(tables.areaNameById.get(0)).toBe('その他')
    expect(tables.areaNameById.get(1)).toBe('北海道')
    expect(tables.areaNameById.get(7)).toBe('福島県')
    expect(tables.areaNameById.get(47)).toBe('沖縄県')
    expect(tables.areaNameById.get(48)).toBeUndefined()
    for (let id = 1; id <= 47; id += 1) {
      expect(tables.areaNameById.get(id)).toMatch(/(都|道|府|県)$/)
    }
  })

  it('id 索引が全件を張る(id の重複で件数が減っていない)', () => {
    expect(tables.brandById.size).toBe(3264)
    expect(tables.breweryById.size).toBe(1749)
    expect(tables.flavorChartByBrandId.size).toBe(1344)
  })
})

describe('decodeTables — タプルの列順', () => {
  // タプルは列を入れ替えても型が通り例外も出ないので、先頭行を丸ごと固定して列順を押さえる。
  it('brands / breweries の [id, name, 親id] を取り違えない', () => {
    expect(tables.brands[0]).toEqual({ id: 1, name: '新十津川', breweryId: 1 })
    expect(tables.breweries[0]).toEqual({ id: 1, name: '金滴酒造', areaId: 1 })
  })

  it('flavorCharts の f1..f6 を列の順番どおりに割り当てる', () => {
    expect(tables.flavorChartByBrandId.get(819)).toEqual({
      brandId: 819,
      f1: 45,
      f2: 50,
      f3: 22,
      f4: 38,
      f5: 28,
      f6: 53,
    })
  })

  it('f1..f6 は 0-100 の整数(0.0-1.0 の float と取り違えていない)', () => {
    let max = 0
    for (const chart of tables.flavorCharts) {
      for (const value of [chart.f1, chart.f2, chart.f3, chart.f4, chart.f5, chart.f6]) {
        expect(Number.isInteger(value)).toBe(true)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(100)
        if (value > max) max = value
      }
    }
    // 0.0-1.0 のまま丸めると全部 0/1 になる。「整数かつ 0..100」だけでは気づけないので上限側も見る。
    expect(max).toBeGreaterThan(1)
  })
})

describe('brandsByNormalizedName', () => {
  // 期待値は正規化しても変わらない文字列を選び、**リテラルで**書く。
  // normalize() を通した値をキーにすると期待値が実装と同じ出所になり恒真になる(BACKLOG B15)。
  it('`高砂` は4件返る(名前は一意でない。都道府県で絞ってもなお曖昧)', () => {
    const takasago = tables.brandsByNormalizedName.get('高砂')
    expect(takasago).toHaveLength(4)
    expect(ids(takasago)).toEqual([2359, 9941, 66006, 77752])
    expect(takasago?.map((b) => tables.prefectureOfBrand(b.id))).toEqual([
      '静岡県',
      '三重県',
      '佐賀県',
      '島根県',
    ])
  })

  it('`紀土` は 819 / 和歌山県 で、フレーバーチャートを持つ', () => {
    const kid = tables.brandsByNormalizedName.get('紀土')
    expect(ids(kid)).toEqual([819])
    expect(tables.prefectureOfBrand(819)).toBe('和歌山県')
    expect(tables.flavorChartByBrandId.get(819)).toBeDefined()
  })

  it('`ビキニ娘` は 2020 に引けるが、フレーバーチャートを持たない', () => {
    // 紐付け済み ≠ フレーバー取得済み。203本中 186本が紐付いてチャート有りは 185本。
    // ここを 0 で埋めると6軸集計の分母が静かに水増しされる。
    const bikini = tables.brandsByNormalizedName.get('ビキニ娘')
    expect(ids(bikini)).toEqual([2020])
    expect(tables.flavorChartByBrandId.get(2020)).toBeUndefined()
  })

  it('定義域外のキーは undefined を返す(全件にフォールバックしない)', () => {
    expect(tables.brandsByNormalizedName.get('存在しない銘柄名')).toBeUndefined()
    expect(tables.brandsByNormalizedName.get('')).toBeUndefined()
  })

  it('正規化で潰れる名前は12〜14件に留まる(正規化が過剰に畳んでいない)', () => {
    // 生の異なる名前 3196 に対し正規化キーは 3182(計画時の実測)。
    // 0 なら正規化が効いていないし、大きく増えたら別の酒を同一視し始めた合図。
    const rawDistinct = new Set(raw.brands.rows.map(([, name]) => name)).size
    expect(rawDistinct).toBe(3196)
    const collapsed = rawDistinct - tables.brandsByNormalizedName.size
    expect(collapsed).toBeGreaterThanOrEqual(12)
    expect(collapsed).toBeLessThanOrEqual(14)
  })
})

describe('prefectureOfBrand', () => {
  it('未知の銘柄IDは null(既定値や先頭の県に落ちない)', () => {
    expect(tables.prefectureOfBrand(999999999)).toBeNull()
  })

  it('areaId 0(その他)の蔵の銘柄は null(「その他」を都道府県名として返さない)', () => {
    // 13491 `全黒` は Zenkuro(ニュージーランド)。JIS 1..47 に無いものを県名として流すと
    // 産地マップと県一致の紐付けに定義域外の値が入る。
    const brand = tables.brandById.get(13491)
    expect(tables.breweryById.get(brand?.breweryId ?? -1)?.areaId).toBe(0)
    expect(tables.prefectureOfBrand(13491)).toBeNull()
  })
})

describe('decodeTables は純関数', () => {
  it('入力を書き換えず、呼び出しごとに独立した索引を返す(モジュール状態を持たない)', () => {
    const again = decodeTables(raw)
    expect(again.brands).toEqual(tables.brands)
    expect(again.flavorCharts).toEqual(tables.flavorCharts)
    // 使い回しのキャッシュを持つと、テーブル差し替え(月次更新・テストの部分テーブル)が効かなくなる
    expect(again.brandById).not.toBe(tables.brandById)
    expect(raw.brands.rows).toHaveLength(3264)
    expect(raw.brands.rows[0]).toEqual([1, '新十津川', 1])
  })

  it('数件のリテラルからでもテーブルを組める(実データを要求しない)', () => {
    const tiny = decodeTables({
      areas: { copyright: 'Sakenowa', rows: ['その他', '北海道'] },
      breweries: { copyright: 'Sakenowa', rows: [[1, '金滴酒造', 1]] },
      brands: { copyright: 'Sakenowa', rows: [[1, '新十津川', 1]] },
      flavorCharts: { copyright: 'Sakenowa', rows: [[1, 0, 100, 1, 2, 3, 4]] },
    })
    expect(tiny.prefectureOfBrand(1)).toBe('北海道')
    expect(tiny.brandsByNormalizedName.get('新十津川')).toEqual([
      { id: 1, name: '新十津川', breweryId: 1 },
    ])
    expect(tiny.prefectureOfBrand(2)).toBeNull()
  })
})
