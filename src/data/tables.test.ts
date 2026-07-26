// @vitest-environment node
// decodeTables は純関数で DOM を要らない。node 環境で回すこと自体がその実証で、
// window/document に触る実装が src/data/tables.ts に混ざった瞬間にこのファイルが落ちる。
import { decodeFlavorTags, decodeTables } from './tables.ts'
import type { RawFlavorTagFiles, RawSakenowaFiles } from './tables.ts'
import areasJson from '../../public/data/sakenowa/areas.json'
import brandFlavorTagsJson from '../../public/data/sakenowa/brandFlavorTags.json'
import brandsJson from '../../public/data/sakenowa/brands.json'
import breweriesJson from '../../public/data/sakenowa/breweries.json'
import flavorChartsJson from '../../public/data/sakenowa/flavorCharts.json'
import flavorTagsJson from '../../public/data/sakenowa/flavorTags.json'
import type {
  AreasFile,
  BrandFlavorTagsFile,
  BrandsFile,
  BreweriesFile,
  FlavorChartsFile,
  FlavorTagsFile,
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

const rawTags: RawFlavorTagFiles = {
  flavorTags: flavorTagsJson as unknown as FlavorTagsFile,
  brandFlavorTags: brandFlavorTagsJson as unknown as BrandFlavorTagsFile,
}

const flavorTags = decodeFlavorTags(rawTags)

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

describe('decodeFlavorTags — 件数と打ち切り', () => {
  // 同梱データが静かに入れ替わったことを検出するための固定値(brands 3264 と同じ役目)
  it('語彙141語 / タグを持つ銘柄2136件を復号する', () => {
    expect(flavorTags.tagNameById.size).toBe(141)
    expect(flavorTags.tagIdsByBrandId.size).toBe(2136)
  })

  // **画面がこの2つの数字で「タグが無い ≠ その味がない」を説明する。**
  // リテラルで持たずに実データから出す設計なので、値そのものをここで固定する
  it('1銘柄あたり最大20語で、上限に達した銘柄が731件ある(上流の打ち切り)', () => {
    expect(flavorTags.maxTagsPerBrand).toBe(20)
    expect(flavorTags.atCapBrandCount).toBe(731)
  })

  it('19語の銘柄は16件しかない = 20語の山は味の分布ではなく上限', () => {
    // 打ち切りが無ければ 19語と20語の件数は近い値になるはず。**この段差が偽陰性の根拠**
    let at19 = 0
    for (const tagIds of flavorTags.tagIdsByBrandId.values()) {
      if (tagIds.length === 19) at19 += 1
    }
    expect(at19).toBe(16)
  })
})

describe('decodeFlavorTags — タプルの列順と定義域', () => {
  it('行の先頭は銘柄IDで、残りがタグID(取り違えていない)', () => {
    // 819 は `紀土`(和歌山県)。**先頭の 819 が tagIds に混ざっていないこと**を全件で押さえる
    expect(flavorTags.tagIdsByBrandId.get(819)).toEqual([
      2, 3, 5, 6, 7, 9, 12, 17, 20, 24, 26, 32, 38, 40, 45, 48, 77, 80, 100, 126,
    ])
    expect(flavorTags.tagNameById.get(2)).toBe('酸味')
    expect(flavorTags.tagNameById.get(5)).toBe('旨味')
  })

  it('参照されるタグIDが全部語彙にある(語彙だけ古い表を混ぜていない)', () => {
    let unknown = 0
    for (const tagIds of flavorTags.tagIdsByBrandId.values()) {
      for (const id of tagIds) {
        if (!flavorTags.tagNameById.has(id)) unknown += 1
      }
    }
    expect(unknown).toBe(0)
  })

  it('タグが無い銘柄は行ごと無い(空配列で埋めない)', () => {
    // 1 は `新十津川`。3264銘柄のうち1128件はタグの行を持たない。
    // **紐付け済み ≠ タグ取得済み**なので、ここを空配列で埋めると「タグが無い」と
    // 「タグを引けなかった」が同じ見た目になる
    expect(tables.brandById.get(1)).toBeDefined()
    expect(flavorTags.tagIdsByBrandId.get(1)).toBeUndefined()
    expect(flavorTags.tagIdsByBrandId.get(999999999)).toBeUndefined()
    expect(flavorTags.tagNameById.get(999999999)).toBeUndefined()
  })

  it('数件のリテラルからでも組める。上限と到達数は入力から数える', () => {
    const tiny = decodeFlavorTags({
      flavorTags: {
        copyright: 'synthetic',
        rows: [
          [10, 'テスト味あ'],
          [11, 'テスト味い'],
        ],
      },
      brandFlavorTags: {
        copyright: 'synthetic',
        rows: [
          [1, 10, 11],
          [2, 10],
          [3, 10, 11],
        ],
      },
    })

    expect(tiny.tagIdsByBrandId.get(1)).toEqual([10, 11])
    expect(tiny.tagNameById.get(11)).toBe('テスト味い')
    // 上限は2語で、そこに達しているのは2銘柄(20 のリテラルを持っていない)
    expect(tiny.maxTagsPerBrand).toBe(2)
    expect(tiny.atCapBrandCount).toBe(2)
  })

  it('空の表では「0語ちょうどの銘柄が全件」と言わない', () => {
    const empty = decodeFlavorTags({
      flavorTags: { copyright: 'synthetic', rows: [] },
      brandFlavorTags: { copyright: 'synthetic', rows: [] },
    })

    expect(empty.maxTagsPerBrand).toBe(0)
    expect(empty.atCapBrandCount).toBe(0)
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
