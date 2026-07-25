// @vitest-environment node
// domain 層のテストは jsdom を要求しない(CLAUDE.md の依存方向)。node 環境で回すこと自体が
// その実証で、window/document に触る実装が混ざった瞬間にこのファイルが落ちる。
//
// 実装(linkBrand.ts)は src/domain/ の外を一切 import しない。ここで src/data/tables.ts の
// decodeTables を使うのはテスト側の都合で、タプル行(gzip 用の [id, name, 親id] 形式)を解く
// コードを二重に書かないため。列順の取り違えは静かに壊れるので復号は1本に限る。
import { decodeTables } from '../data/tables.ts'
import { BRAND_ALIASES } from '../data/brand-aliases.ts'
import areasJson from '../../public/data/sakenowa/areas.json'
import brandsJson from '../../public/data/sakenowa/brands.json'
import breweriesJson from '../../public/data/sakenowa/breweries.json'
import flavorChartsJson from '../../public/data/sakenowa/flavorCharts.json'
import linkCases from './linkBrand.cases.json'
import statsFixture from './stats.cases.json'
import { createLinker } from './linkBrand.ts'
import { normalize } from './normalize.ts'
import type {
  AreasFile,
  BrandAlias,
  BrandsFile,
  BreweriesFile,
  FlavorChartsFile,
  LinkStatus,
  LinkerTables,
} from './types.ts'

// JSON モジュール import は行を `(string | number)[]` と推論する(タプルではない)。
// 復号の入口で1回だけ型を宣言し、以降は decodeTables の戻り(型付き)だけを使う。
const tables = decodeTables({
  areas: areasJson as AreasFile,
  breweries: breweriesJson as unknown as BreweriesFile,
  brands: brandsJson as unknown as BrandsFile,
  flavorCharts: flavorChartsJson as unknown as FlavorChartsFile,
})

/**
 * 203本の `{label, prefecture}`。**日付を含まず label 順にソートされている**
 * (public リポジトリに飲酒台帳を置かないための射影。§ 公開リポジトリとシード)。
 * 順序が固定されているのでスナップショットの行順もこのファイルで決まる。
 */
const cases: readonly { label: string; prefecture: string }[] = linkCases

/** `YYYY-MM-DD` らしい部分文字列。コミットする射影に日付が混ざっていないことを見るのに使う */
const DATE_LIKE = /\d{4}-\d{2}-\d{2}/

const linkerTables = (aliases: readonly BrandAlias[]): LinkerTables => ({
  brands: tables.brands,
  breweries: tables.breweries,
  areas: tables.areas,
  aliases,
})

const link = createLinker(linkerTables(BRAND_ALIASES))

const countByStatus = (aliases: readonly BrandAlias[]): Record<LinkStatus, number> => {
  const linker = createLinker(linkerTables(aliases))
  const counts: Record<LinkStatus, number> = {
    auto: 0,
    alias: 0,
    manual: 0,
    unlinked: 0,
    unknown: 0,
  }
  for (const record of cases) counts[linker(record.label, record.prefecture).status] += 1
  return counts
}

/** 紐付いた本数 = auto + alias。エイリアス変異テストの観測量 */
const countLinked = (aliases: readonly BrandAlias[]): number => {
  const counts = countByStatus(aliases)
  return counts.auto + counts.alias
}

describe('203本の紐付け内訳(A3)', () => {
  // **件数で assert する。百分率で書いてはいけない**: 186/203 = 91.58% なので
  // `>= 92%` は実測値そのままで落ちる(SPEC の「92%以上」は誤差。BACKLOG B1)。
  it('auto 173 / alias 13 / unlinked 12 / unknown 5 に分かれる', () => {
    const counts = countByStatus(BRAND_ALIASES)
    expect(cases).toHaveLength(203)
    expect(counts.auto).toBe(173)
    expect(counts.alias).toBe(13)
    expect(counts.auto + counts.alias).toBe(186)
    expect(counts.unlinked).toBe(12)
    expect(counts.unknown).toBe(5)
    // 17本が unlinked(12) と unknown(5) に区別されている(A5)。合計が203に閉じることも見る
    expect(counts.unlinked + counts.unknown).toBe(17)
    // createLinker は 'manual' を返さない(手動紐付けは store がエイリアスとして永続化し、
    // 以降は 'alias' として解決される。機械の判断と本人の判断はそこで区別する)
    expect(counts.manual).toBe(0)
  })

  it('素の完全一致は 172本 / 75種で、173本目は括弧内除去を経て一致する', () => {
    // 「名称が生のまま一致した本数」= 紐付いた銘柄名がログの表記と1文字も違わない本数。
    // 素の一致 172 に対し auto は 173 で、差の1本が no.103 `翔空(Lagoon Brewery)`(BACKLOG B1)。
    const exact = cases.filter((record) => {
      const result = link(record.label, record.prefecture)
      return result.status === 'auto' && result.brandName === record.label
    })
    expect(exact).toHaveLength(172)
    expect(new Set(exact.map((record) => record.label)).size).toBe(75)

    const lagoon = link('翔空(Lagoon Brewery)', '新潟県')
    expect(lagoon.status).toBe('auto')
    expect(lagoon.brandName).toBe('翔空')
    expect(lagoon.brandName).not.toBe('翔空(Lagoon Brewery)')
  })
})

// 203件の (label, prefecture, status, brandId) を固定する。正規化・解決順・同梱データの
// どれが変わってもここに差分が出る(`vitest -u` を叩かない限り)。
// 検証: normalize.ts の異体字マップから `髙` を抜くと `髙砂`2本が落ちて赤くなることを実演済み。
describe('回帰スナップショット(A4)', () => {
  it('203件の (label, prefecture, status, brandId) が変わらない', async () => {
    const rows = cases.map((record) => {
      const result = link(record.label, record.prefecture)
      return JSON.stringify({
        label: record.label,
        prefecture: record.prefecture,
        status: result.status,
        brandId: result.brandId,
      })
    })
    // 1レコード1行。203行の差分をレビューできる形にする(cases.json と同じ体裁)
    const snapshot = `[\n  ${rows.join(',\n  ')}\n]\n`
    // スナップショットは cases.json(label / prefecture)と紐付け結果しか持たない。
    // **日付を1つも含まないこと**を固定する: ここに drankOn を足すと、コミットされる
    // 203行の射影が飲酒台帳そのものになる(§ コミットする射影の混入規則)
    expect(DATE_LIKE.test(snapshot)).toBe(false)
    await expect(snapshot).toMatchFileSnapshot('./linkBrand.snap.json')
  })
})

/**
 * エイリアス1件を抜いたときに紐付く本数(計画時に1件ずつ抜いて実測した値)。
 *
 * **「8件すべてが紐付け数を増やす」は偽**。2件は正規化に食われて冗長で、抜いても 186 のまま
 * (BACKLOG B11)。ここを「全件が効く」と書くとテストが落ちる。
 */
const ALIAS_MUTATIONS: readonly (readonly [
  label: string,
  prefecture: string | null,
  linked: number,
])[] = [
  ['赤武', null, 182], // −4
  ['寒菊', null, 184], // −2(`寒菊` と `寒菊(OCEAN99)` が括弧内除去で同じキーに落ちる)
  ['zebra', null, 185], // −1
  ['magma', null, 185], // −1
  ['荷札酒', null, 185], // −1
  ['会津宮泉', null, 185], // −1
  // 冗長2件。抜いても 186 のまま(alias が auto に振り替わるだけ)。安全網として表に残すが、
  // 冗長であること自体を固定して、正規化が変わって冗長でなくなったら気づける状態にする。
  ['高砂', '三重県', 186], // 異体字 髙→高 + 三重県 で同名4件から一意に絞れる
  ['ゆきのまゆ', null, 186], // さけのわ名 `ゆきのまゆ（醸す森）` が括弧内除去で一致する
]

describe('エイリアス表の変異テスト(B11)', () => {
  it('表を空にすると 186本 → 176本に落ちる', () => {
    expect(countLinked([])).toBe(176)
  })

  it('8キーすべてが変異表に載っている(エントリを足したら期待値も足す)', () => {
    expect(BRAND_ALIASES).toHaveLength(8)
    expect(ALIAS_MUTATIONS).toHaveLength(8)
    for (const [label, prefecture] of ALIAS_MUTATIONS) {
      const matched = BRAND_ALIASES.filter(
        (alias) => alias.label === label && alias.prefecture === prefecture,
      )
      expect(matched, `${label} / ${prefecture ?? '県を問わない'}`).toHaveLength(1)
    }
  })

  it.each(ALIAS_MUTATIONS)('%s(%s) を抜くと紐付きは %i 本', (label, prefecture, linked) => {
    const without = BRAND_ALIASES.filter(
      (alias) => !(alias.label === label && alias.prefecture === prefecture),
    )
    expect(without).toHaveLength(7)
    expect(countLinked(without)).toBe(linked)
  })

  it('必須6件は抜くと当該の記録が unlinked に落ちる(件数だけでなく個票で見る)', () => {
    // 集計が合っていても別の記録で埋め合わせている可能性があるので、抜いた本人を見る。
    const drops: readonly (readonly [label: string, prefecture: string, brandId: number])[] = [
      ['赤武', '岩手県', 2602],
      ['寒菊', '千葉県', 1349],
      ['寒菊(OCEAN99)', '千葉県', 1349],
      ['ZEBRA', '山形県', 1217],
      ['MAGMA', '山形県', 1217],
      ['荷札酒', '新潟県', 3534],
      ['会津宮泉', '福島県', 2401],
    ]
    for (const [label, prefecture, brandId] of drops) {
      expect(link(label, prefecture).brandId, `${label} は alias で紐付く`).toBe(brandId)
      const without = createLinker(linkerTables([]))
      expect(without(label, prefecture).status, `${label} は表なしで unlinked`).toBe('unlinked')
      expect(without(label, prefecture).brandId).toBeNull()
    }
  })

  it('冗長2件は抜くと alias から auto に振り替わる(紐付け先は同じ)', () => {
    const redundant: readonly (readonly [
      label: string,
      prefecture: string,
      aliasLabel: string,
      aliasPrefecture: string | null,
      brandId: number,
    ])[] = [
      ['髙砂', '三重県', '高砂', '三重県', 9941],
      ['ゆきのまゆ', '新潟県', 'ゆきのまゆ', null, 41721],
    ]
    for (const [label, prefecture, aliasLabel, aliasPrefecture, brandId] of redundant) {
      expect(link(label, prefecture).status).toBe('alias')
      const without = createLinker(
        linkerTables(
          BRAND_ALIASES.filter(
            (alias) => !(alias.label === aliasLabel && alias.prefecture === aliasPrefecture),
          ),
        ),
      )
      const result = without(label, prefecture)
      expect(result.status, `${label} は正規化だけで解ける`).toBe('auto')
      expect(result.brandId).toBe(brandId)
    }
  })
})

describe('エイリアスの解決', () => {
  it('ログ表記とさけのわ名が違う13本を回収し、brandName はさけのわ名で埋まる(B4)', () => {
    const expected: readonly (readonly [
      label: string,
      prefecture: string,
      brandId: number,
      brandName: string,
    ])[] = [
      ['赤武', '岩手県', 2602, 'AKABU'],
      ['髙砂', '三重県', 9941, '高砂'],
      ['寒菊', '千葉県', 1349, '総乃寒菊'],
      ['寒菊(OCEAN99)', '千葉県', 1349, '総乃寒菊'],
      ['ZEBRA', '山形県', 1217, '栄光冨士'],
      ['MAGMA', '山形県', 1217, '栄光冨士'],
      ['荷札酒', '新潟県', 3534, '加茂錦'],
      ['会津宮泉', '福島県', 2401, '宮泉'],
      ['ゆきのまゆ', '新潟県', 41721, 'ゆきのまゆ（醸す森）'],
    ]
    for (const [label, prefecture, brandId, brandName] of expected) {
      const result = link(label, prefecture)
      expect(result.status, label).toBe('alias')
      expect(result.brandId, label).toBe(brandId)
      expect(result.brandName, label).toBe(brandName)
      // 決まったものに候補は付けない(手動紐付けUIに出す必要がない)
      expect(result.candidates, label).toEqual([])
    }
  })

  it('県を指定したエイリアスは別の県の記録には効かない', () => {
    // `高砂 + 三重県` のキーは三重県の記録だけを 9941 にする。静岡県の記録は
    // 素の一致で 2359(静岡/富士高砂酒造)へ行く — エイリアスが県を跨いで漏れない
    expect(link('髙砂', '三重県').brandId).toBe(9941)
    const shizuoka = link('高砂', '静岡県')
    expect(shizuoka.status).toBe('auto')
    expect(shizuoka.brandId).toBe(2359)
  })
})

// ここが本フェーズの中核。**定義域外のキーで「全件」にフォールバックしてはならない**。
describe('都道府県での絞り込み — 0件でも全件に広げない', () => {
  it('Beau Michelle(神奈川県) は長野県の同名 3141 に紐付かず、候補としてだけ出る', () => {
    // ログは神奈川/川西屋酒造。さけのわの同名 3141 は長野/伴野酒造で別物(no.58)。
    // 同県の候補が0件になったとき全件に広げると、ここが 3141 に誤紐付けされる。
    const result = link('Beau Michelle', '神奈川県')
    expect(result.status).toBe('unlinked')
    expect(result.brandId).toBeNull()
    expect(result.brandName).toBeNull()
    // 候補は手動紐付けUIに渡す材料なので、県が違っても同名は見せる(決めるのは本人)
    expect(result.candidates.map((brand) => brand.id)).toEqual([3141])
    expect(tables.prefectureOfBrand(3141)).toBe('長野県')
  })

  it('同名4件の `高砂` は三重県で一意になり、県が無いと4件の候補付き unlinked になる', () => {
    // 都道府県はエイリアスの飾りではなく曖昧性解消の本体(同名は都道府県で絞ってもなお25組残る)
    const withoutAliases = createLinker(linkerTables([]))
    expect(withoutAliases('高砂', '三重県').brandId).toBe(9941)

    const ambiguous = withoutAliases('高砂', null)
    expect(ambiguous.status).toBe('unlinked')
    expect(ambiguous.brandId).toBeNull()
    expect(ambiguous.candidates.map((brand) => brand.id)).toEqual([2359, 9941, 66006, 77752])
  })

  it('都道府県が県名でない `静岡県または京都府` は候補を作らない', () => {
    // 合成値は既知の県名と一致しない = 未知。ここで全件に広げると `英君`(静岡) と
    // `英勲`(京都) のどちらかを機械が勝手に選ぶ(no.197)
    const result = link('英君 または 英勲', '静岡県または京都府')
    expect(result.status).toBe('unlinked')
    expect(result.brandId).toBeNull()
    expect(result.candidates).toEqual([])
    // 単独の `英君`(静岡県) は紐付く — 未知なのは合成された銘柄名と県だけ
    expect(link('英君', '静岡県').status).toBe('auto')
  })

  it('正規化で潰れた区別を生の完全一致が取り戻す(同県で衝突する `丹沢山` / `丹澤山`)', () => {
    // 神奈川県には `丹沢山`(327) と `丹澤山`(2149) があり、`澤→沢` で同じキーに落ちる。
    // **同じ県にある**ので都道府県では絞れず、正規化一致だけなら2件で曖昧 = どちらも紐付かない。
    // 生の表記で引く段があるから両方が別々に解ける。
    expect(tables.brandsByNormalizedName.get('丹沢山')?.map((brand) => brand.id)).toEqual([
      327, 2149,
    ])
    expect(tables.prefectureOfBrand(327)).toBe('神奈川県')
    expect(tables.prefectureOfBrand(2149)).toBe('神奈川県')
    expect(link('丹沢山', '神奈川県').brandId).toBe(327)
    expect(link('丹澤山', '神奈川県').brandId).toBe(2149)
    expect(link('丹沢山', '神奈川県').brandName).toBe('丹沢山')
    expect(link('丹澤山', '神奈川県').brandName).toBe('丹澤山')
  })
})

describe('銘柄が判読できていない記録(unknown)', () => {
  it('`不明` は都道府県が空でも unknown で、候補を作らない', () => {
    for (const prefecture of ['', '福島県']) {
      const result = link('不明', prefecture)
      expect(result.status, prefecture).toBe('unknown')
      expect(result.brandId, prefecture).toBeNull()
      expect(result.brandName, prefecture).toBeNull()
      expect(result.candidates, prefecture).toEqual([])
    }
  })

  it('空の銘柄名は unknown(unlinked と区別する)', () => {
    for (const label of ['', '   ', '　']) {
      expect(link(label, '福島県').status, JSON.stringify(label)).toBe('unknown')
    }
  })
})

describe('さけのわに存在しない銘柄(unlinked)', () => {
  it('`寫楽` は異体字を畳んでも未登録なので候補ゼロの unlinked', () => {
    // 蔵元の宮泉銘醸は `宮泉`(2401) として在るが、機械が代替を選ばない(SPEC: 本人判断に委ねる)
    const result = link('寫楽', '福島県')
    expect(result.status).toBe('unlinked')
    expect(result.brandId).toBeNull()
    expect(result.candidates).toEqual([])
    expect(tables.brandsByNormalizedName.get('写楽')).toBeUndefined()
  })

  it('未紐付け12本の内訳が計画時の実測と一致する', () => {
    const unlinked = cases.filter(
      (record) => link(record.label, record.prefecture).status === 'unlinked',
    )
    expect(unlinked).toHaveLength(12)
    // 同じ銘柄が複数本ある(寫楽5本)。ラベルの集合として固定する
    expect([...new Set(unlinked.map((record) => record.label))].sort()).toEqual(
      [
        'Beau Michelle',
        '寿限無',
        '寫楽',
        '無量山',
        '清開',
        '英君 または 英勲',
        '雷',
        '龍吟虎嘯',
      ].sort(),
    )
  })
})

describe('紐付け済み ≠ フレーバー取得済み', () => {
  it('紐付いた186本のうちチャートを持つのは185本で、欠けるのは `ビキニ娘` だけ', () => {
    // Phase 6 の6軸集計の分母はここで決まる。**欠けている1本を0で埋めない**
    // (紐付け率とフレーバー取得率は別の数字であることを固定する)
    const linkedIds = cases
      .map((record) => link(record.label, record.prefecture).brandId)
      .filter((brandId): brandId is number => brandId !== null)
    expect(linkedIds).toHaveLength(186)

    const withChart = linkedIds.filter((brandId) => tables.flavorChartByBrandId.has(brandId))
    expect(withChart).toHaveLength(185)

    const missing = [...new Set(linkedIds.filter((id) => !tables.flavorChartByBrandId.has(id)))]
    expect(missing).toEqual([2020])
    expect(tables.brandById.get(2020)?.name).toBe('ビキニ娘')
  })
})

describe('brandName を必ず埋める(B4)', () => {
  it('紐付いた186本すべてで brandName が非 null で、銘柄マスタの名前と一致する', () => {
    // brandId だけ埋めて brandName を null のまま返すと、Timeline がマスタの非同期ロードを
    // 待つ / 上流から銘柄が消えると過去の記録の表示まで消える
    let linked = 0
    for (const record of cases) {
      const result = link(record.label, record.prefecture)
      if (result.brandId === null) {
        expect(result.brandName, record.label).toBeNull()
        continue
      }
      linked += 1
      expect(result.brandName, record.label).toBe(tables.brandById.get(result.brandId)?.name)
      expect(result.brandName, record.label).not.toBeNull()
    }
    expect(linked).toBe(186)
  })
})

// 実データを要らない側のテスト。数件のリテラルからテーブルを組めることが
// LinkerTables を配列で受けている理由(domain/types.ts)。
describe('注入したテーブルだけを見る', () => {
  const tiny = (aliases: readonly BrandAlias[] = []): LinkerTables => ({
    areas: [
      { id: 0, name: 'その他' },
      { id: 1, name: '北海道' },
      { id: 2, name: '青森県' },
    ],
    breweries: [
      { id: 10, name: '北の蔵', areaId: 1 },
      { id: 20, name: '青森の蔵', areaId: 2 },
      { id: 30, name: '海外の蔵', areaId: 0 },
    ],
    brands: [
      { id: 100, name: '同名酒', breweryId: 10 },
      { id: 200, name: '同名酒', breweryId: 20 },
      { id: 300, name: '海外酒', breweryId: 30 },
      { id: 400, name: '蔵が消えた酒', breweryId: 999 },
      // 異体字で正規化すると同じキーに落ちる2件。**同じ蔵 = 同じ県**なので県では絞れない
      { id: 500, name: '澤酒', breweryId: 10 },
      { id: 600, name: '沢酒', breweryId: 10 },
    ],
    aliases,
  })

  it('同名2件は県で一意になり、県が無ければ候補2件の unlinked', () => {
    const linker = createLinker(tiny())
    expect(linker('同名酒', '北海道').brandId).toBe(100)
    expect(linker('同名酒', '青森県').brandId).toBe(200)
    const ambiguous = linker('同名酒', null)
    expect(ambiguous.status).toBe('unlinked')
    expect(ambiguous.candidates.map((brand) => brand.id)).toEqual([100, 200])
  })

  it('正規化で同じキーに落ちる2件も、生の表記なら別々に解ける', () => {
    // 「生の一致」の段が要る理由を実データに依らない形で固定する。
    // `澤酒`(500) / `沢酒`(600) は `澤→沢` で同じキーになり、同じ県なので県でも絞れない。
    expect(normalize('澤酒')).toBe('沢酒')
    const linker = createLinker(tiny())
    expect(linker('澤酒', '北海道').brandId).toBe(500)
    expect(linker('沢酒', '北海道').brandId).toBe(600)

    // 生のキーに無い表記は正規化一致に落ちる = そこでは2件で曖昧なので機械は決めない
    const ambiguous = linker('沢酒(限定)', '北海道')
    expect(ambiguous.status).toBe('unlinked')
    expect(ambiguous.candidates.map((brand) => brand.id)).toEqual([500, 600])
  })

  it('候補配列を書き換えても次の呼び出しに影響しない(索引を外へ漏らさない)', () => {
    const linker = createLinker(tiny())
    const first = linker('同名酒', null)
    first.candidates.pop()
    expect(linker('同名酒', null).candidates).toHaveLength(2)
  })

  it('areaId 0(その他)の蔵は都道府県を持たないので県一致では選ばれない', () => {
    // 「その他」を県名として扱うと、JIS 1..47 を前提にした経路に定義域外の値が流れる
    const linker = createLinker(tiny())
    expect(linker('海外酒', 'その他').status).toBe('unlinked')
    expect(linker('海外酒', '北海道').status).toBe('unlinked')
    // 県の手がかりが無いときだけ候補全体が対象になるので、一意なら紐付く
    expect(linker('海外酒', null).brandId).toBe(300)
  })

  it('蔵が引けない銘柄も県一致では選ばれない(既定の県に落とさない)', () => {
    const linker = createLinker(tiny())
    expect(linker('蔵が消えた酒', '北海道').status).toBe('unlinked')
    expect(linker('蔵が消えた酒', null).brandId).toBe(400)
  })

  it('空文字の都道府県は「絞り込みの手がかりなし」として扱う', () => {
    // ログの都道府県は5本が未記入。`''` を県名として突き合わせると全候補が落ちて
    // 一意な銘柄名でも紐付かなくなる
    const linker = createLinker(tiny())
    expect(linker('海外酒', '').brandId).toBe(300)
    expect(linker('同名酒', '').status).toBe('unlinked')
  })

  it('ランタイム(手動)のエイリアスが組み込みを上書きする — 後勝ち', () => {
    // store は `[...BRAND_ALIASES, ...手動で永続化した分]` を渡す。同じキーが衝突したら
    // 本人が決めた側を採る
    const linker = createLinker(
      tiny([
        { label: '同名酒', prefecture: null, brandId: 100 },
        { label: '同名酒', prefecture: null, brandId: 200 },
      ]),
    )
    const result = linker('同名酒', null)
    expect(result.status).toBe('alias')
    expect(result.brandId).toBe(200)
  })

  it('県を指定したエイリアスが県を問わないエイリアスより優先される', () => {
    const linker = createLinker(
      tiny([
        { label: '同名酒', prefecture: '青森県', brandId: 200 },
        { label: '同名酒', prefecture: null, brandId: 100 },
      ]),
    )
    expect(linker('同名酒', '青森県').brandId).toBe(200)
    expect(linker('同名酒', '北海道').brandId).toBe(100)
  })

  it('マスタから消えた銘柄を指すエイリアスは無視して名称一致に進む', () => {
    // brandId だけ埋まって brandName が null の 'alias' を返すと B4 の不変条件が破れる。
    // 紐付かないことを隠さないほうが正しい(手動紐付けUIでやり直せる)
    const linker = createLinker(tiny([{ label: '同名酒', prefecture: null, brandId: 99999 }]))
    const stale = linker('同名酒', null)
    expect(stale.status).toBe('unlinked')
    expect(stale.brandId).toBeNull()
    // 名称一致の段は生きている
    expect(linker('同名酒', '北海道').status).toBe('auto')
  })

  it('エイリアスの照合は正規化後のキーで行う(括弧・全角・大文字を吸収する)', () => {
    const linker = createLinker(tiny([{ label: 'zebra', prefecture: null, brandId: 100 }]))
    for (const label of ['ZEBRA', 'Zebra', 'ＺＥＢＲＡ', 'ZEBRA (限定)', ' zebra ']) {
      expect(linker(label, null).brandId, label).toBe(100)
    }
  })
})

// public リポジトリにコミットする2つの射影が「単体では飲酒台帳にならず、結合もできない」
// 状態を CI で守る(PHASE_2 § 公開リポジトリとシード)。
//
// これを固定するまで、混入を防いでいたのは scripts/import-sake-log.mjs の実装だけだった。
// スクリプトを直して日付列や銘柄名列が復活しても、他のテストは全部緑のまま通る
// (紐付けの期待値は label と prefecture しか読まない)。射影の形そのものを検査する。
//
// **共通の列を1つも残さないことが要件**。当初は県を両方のファイルに残していたが、
// 同じ203本の射影なので県ごとの出現数が両側で必ず一致し、片側で1件しかない県
// (実測で9県)は一意に突き合わせられて「銘柄 × 日付」が復元されていた。
// スペックも `赤紀土(赤色系)` `寿限無50 …` のように商品名経由で銘柄名を含む行が4行あった。
// どちらも「行の並びを崩す」では防げない(結合キーが値として残っている)ので、
// stats 側は日付だけの列にした。県別集計(A10)は linkBrand.cases.json の県で検証できる。
const statsCases: readonly string[] = statsFixture

describe('コミットする射影の混入規則', () => {
  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

  it('linkBrand.cases.json は label / prefecture だけを持ち、日付を1つも含まない', () => {
    expect(cases).toHaveLength(203)
    for (const [i, record] of cases.entries()) {
      expect(Object.keys(record).sort(), `cases[${i}]`).toEqual(['label', 'prefecture'])
      for (const value of Object.values(record)) {
        expect(DATE_LIKE.test(value), `cases[${i}] に日付らしい文字列: ${value}`).toBe(false)
      }
    }
  })

  it('stats.cases.json は日付の列そのもので、他の列を1つも持たない', () => {
    expect(statsCases).toHaveLength(203)
    for (const [i, value] of statsCases.entries()) {
      // 要素が「日付に完全一致する文字列」であること = 県もスペックも銘柄名も入り込めない。
      // オブジェクトの列にすると混入の余地ができるので、文字列の配列であることまで見る
      expect(typeof value, `stats[${i}]`).toBe('string')
      expect(value, `stats[${i}]`).toMatch(DATE_ONLY)
    }
  })

  it('2ファイルに共通の値が1つも無い = 結合キーが存在しない', () => {
    const linkValues = new Set(cases.flatMap((record) => [record.label, record.prefecture]))
    const shared = [...new Set(statsCases)].filter((value) => linkValues.has(value))
    expect(shared).toEqual([])
    // 上の「共通値ゼロ」は片側が日付だけであることに依存している。県や銘柄名が
    // stats 側に戻ると、県の多重集合が両側で一致するせいで一意に結合できる県が出る
    expect(statsCases.every((value) => DATE_ONLY.test(value))).toBe(true)
  })

  it('どちらのファイルも行の並びが中身だけで決まる(元の行順 = No. を伝えない)', () => {
    // 行位置が結合キーにならないことの担保。cases は (label, prefecture) のコードポイント順、
    // stats は日付の昇順で、どちらも「同じ多重集合なら必ず同じ並び」になる正規形。
    // 同値な行は互いに区別できないので、この並びは元の行順を1ビットも運ばない。
    const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
    expect(cases).toEqual(
      [...cases].sort(
        (a, b) => byCodePoint(a.label, b.label) || byCodePoint(a.prefecture, b.prefecture),
      ),
    )
    expect(statsCases).toEqual([...statsCases].sort(byCodePoint))
  })

  it('射影は行を畳んでいない(203本の重複がそのまま残っている)', () => {
    // 表/裏ラベルの2組のように内容が同じ行がある。射影の途中で dedupe すると
    // 件数系の期待値(203 / 173 / 186)が全部ずれるので、重複が残っていることを固定する
    expect(cases).toHaveLength(203)
    expect(new Set(cases.map((record) => `${record.label}|${record.prefecture}`)).size).toBe(94)
    expect(statsCases).toHaveLength(203)
    expect(new Set(statsCases).size).toBe(166)
    // 表/裏ラベルの2組は日付を落とした射影でも件数として見える。`(日付, 銘柄)` で
    // dedupe されると `赤武` は 4→3、`加茂錦` は 2→1 に減る(dedupe の痕跡はここに出る)
    const countOf = (label: string) => cases.filter((record) => record.label === label).length
    expect(countOf('赤武')).toBe(4)
    expect(countOf('加茂錦')).toBe(2)
  })
})
