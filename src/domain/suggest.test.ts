// @vitest-environment node
// domain 層のテストは jsdom を要求しない(CLAUDE.md の依存方向)。node 環境で回すこと自体が
// その実証で、window/document に触る実装が混ざった瞬間にこのファイルが落ちる。
//
// 実装(suggest.ts)は src/domain/ の外を一切 import しない。ここで src/data/tables.ts の
// decodeTables を使うのはテスト側の都合で、タプル行を解くコードを二重に書かないため
// (linkBrand.test.ts と同じ方針。列順の取り違えは静かに壊れるので復号は1本に限る)。
//
// **銘柄名・蔵元名・都道府県は公開マスタ(さけのわ)の値**で、飲酒台帳ではない。ここに
// 日付や「日付 × 銘柄」の対を書くと `npm run ledger:check` が落ちる(意図通り)。
import { decodeTables } from '../data/tables.ts'
import areasJson from '../../public/data/sakenowa/areas.json'
import brandsJson from '../../public/data/sakenowa/brands.json'
import breweriesJson from '../../public/data/sakenowa/breweries.json'
import flavorChartsJson from '../../public/data/sakenowa/flavorCharts.json'
import { createSuggester, DEFAULT_SUGGEST_LIMIT } from './suggest.ts'
import type { SuggesterTables, SuggestHit } from './suggest.ts'
import { normalize } from './normalize.ts'
import type {
  AreasFile,
  BrandsFile,
  BreweriesFile,
  FlavorChartsFile,
  SakenowaBrand,
} from './types.ts'

const decoded = decodeTables({
  areas: areasJson as AreasFile,
  breweries: breweriesJson as unknown as BreweriesFile,
  brands: brandsJson as unknown as BrandsFile,
  flavorCharts: flavorChartsJson as unknown as FlavorChartsFile,
})

/** サジェストは4つの表を全部使う(県 = areas 経由 / 蔵元 = breweries / 6軸の有無 = flavorCharts) */
const tables: SuggesterTables = {
  brands: decoded.brands,
  breweries: decoded.breweries,
  areas: decoded.areas,
  flavorCharts: decoded.flavorCharts,
}

const suggest = createSuggester(tables)

const ids = (hits: readonly SuggestHit[]) => hits.map((hit) => hit.brand.id)
const names = (hits: readonly SuggestHit[]) => hits.map((hit) => hit.brand.name)

/** 「全件」に落ちていないことを言うための基準値。3264件が返る枝は存在してはいけない */
const ALL_BRANDS = 3264

describe('実データ3264件のインクリメンタル検索(A7)', () => {
  it('索引の母数は3264件', () => {
    expect(tables.brands).toHaveLength(ALL_BRANDS)
  })

  it('`紀土` は 819 / 和歌山県 / 平和酒造 で、フレーバー6軸を持つ', () => {
    // e2e手順13 の銘柄。選ぶと県・蔵元・6軸が埋まる = この1行が持っている情報がそのまま入る
    const hits = suggest('紀土')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toEqual({
      brand: { id: 819, name: '紀土', breweryId: expect.any(Number) },
      prefecture: '和歌山県',
      breweryName: '平和酒造',
      hasFlavorChart: true,
      isPrefix: true,
    })
  })

  it('かな入力では一致しない — 読みのデータを同梱していない(制約であって欠陥ではない)', () => {
    // さけのわの銘柄マスタは `[id, name, breweryId]` で**読みを持たない**。`きど` → `紀土` の
    // 変換はこの層では不可能で、かな検索は SPEC のスコープ外。
    // **ここを「いずれ効く」と曖昧にしないために0件を明示的に固定する**: 変換確定前に
    // 「該当なし」を出さない責務は UI 側(compositionstart/compositionend)にあり、
    // ドメインは0件を0件として返す。この期待値が緑のままなら、IME 対応を UI から外せない。
    for (const kana of ['きど', 'キド', 'たかさご', 'しゃらく', 'きっど']) {
      expect(suggest(kana, ALL_BRANDS), kana).toEqual([])
    }
    // 漢字に確定すれば引ける(0件の原因が「検索が壊れている」ではなく「読みが無い」ことの担保)
    expect(ids(suggest('紀土'))).toEqual([819])
  })

  it('全角・大文字小文字・括弧はクエリ側も正規化される', () => {
    // クエリと索引の両方が normalize() を通る。`ＡＫＡＢＵ`(全角) も `akabu`(小文字) も同じ銘柄
    for (const query of ['AKABU', 'akabu', 'ＡＫＡＢＵ', ' akabu ']) {
      expect(ids(suggest(query)), query).toEqual([2602])
    }
    // 括弧内は商品名・シリーズ名で銘柄名ではないので落ちる。`寒菊(OCEAN99)` は `寒菊` と同じ結果
    expect(ids(suggest('寒菊(OCEAN99)'))).toEqual(ids(suggest('寒菊')))
    // 異体字も畳む(`髙砂` と `高砂` は NFKC 後も別字。normalize の異体字マップが効いている)
    expect(ids(suggest('髙砂'))).toEqual(ids(suggest('高砂')))
    expect(normalize('髙砂')).toBe('高砂')
  })
})

describe('同名を1つに丸めない — 4件の `高砂` を選び分けられる', () => {
  // PHASE_4 の完了条件。「銘柄名 + 都道府県 + 蔵元」が出ていないと本人が選べない。
  const hits = suggest('高砂')
  const sameName = hits.filter((hit) => hit.brand.name === '高砂')

  it('同名4件がすべて返り、名前だけでは区別できない', () => {
    expect(ids(sameName)).toEqual([2359, 9941, 66006, 77752])
    // 4件の名前は完全に同じ文字列。これが「県と蔵元を出す」要件の根拠そのもの
    expect(new Set(names(sameName)).size).toBe(1)
  })

  it('4件それぞれに都道府県と蔵元が付いていて、両方が互いに異なる', () => {
    expect(sameName.map((hit) => hit.prefecture)).toEqual(['静岡県', '三重県', '佐賀県', '島根県'])
    expect(sameName.map((hit) => hit.breweryName)).toEqual([
      '富士高砂酒造',
      '木屋正酒造',
      '小柳酒造',
      '財間酒場',
    ])
    // どちらの列も4件が別々の値 = 1行で一意に指せる
    expect(new Set(sameName.map((hit) => hit.prefecture)).size).toBe(4)
    expect(new Set(sameName.map((hit) => hit.breweryName)).size).toBe(4)
  })

  it('6軸を持つのは4件のうち2件で、持たない側を推定で埋めない', () => {
    // 「紐付け済み ≠ フレーバー取得済み」を選ぶ前に示せる(選んでから空だと分かるのは遅い)
    expect(sameName.map((hit) => hit.hasFlavorChart)).toEqual([true, true, false, false])
  })

  it('部分一致なので5件目 `高砂金漿` も出る — 同名4件が先頭に並ぶ', () => {
    // **「`高砂` は4件」は同名4件が全部返るという要件**で、部分一致で入る行を隠す意味ではない。
    // 完全一致は前方一致の最短なので必ず先に来る(この期待値が動いたらマスタに `高砂` を含む
    // 銘柄が増えた/減った合図。並び順の規則が壊れたのではないかを先に見る)。
    expect(hits).toHaveLength(5)
    expect(names(hits)).toEqual(['高砂', '高砂', '高砂', '高砂', '高砂金漿'])
    expect(ids(hits)[4]).toBe(66007)
    expect(hits.every((hit) => hit.isPrefix)).toBe(true)
  })
})

describe('一致0件は0件 — 全件にフォールバックしない', () => {
  it('`寫楽` は異体字を畳んでも未登録なので0件(3264件が返らない)', () => {
    // brain の絶対ルール: ルックアップのキーが定義域外のとき「全件」に落ちてはならない。
    // ここで全件を返すと、入力欄に3264行が出るだけでなく「さけのわに無い」という事実が消える。
    expect(normalize('寫楽')).toBe('写楽')
    expect(suggest('寫楽')).toEqual([])
    expect(suggest('写楽')).toEqual([])
    // 上限を母数より大きくしても0件のまま(「limit で刻んでいるから小さく見える」を排除する)
    const generous = suggest('寫楽', ALL_BRANDS * 2)
    expect(generous).toHaveLength(0)
    expect(generous.length).not.toBe(ALL_BRANDS)
  })

  it('存在しない語・記号だけの語も0件', () => {
    for (const query of ['存在しない銘柄名', 'zzzzzz', '★★★']) {
      expect(suggest(query, ALL_BRANDS), query).toEqual([])
    }
  })

  it('空クエリは0件(全件でもない)', () => {
    // 何も絞り込んでいない状態は「候補なし」。空文字を「条件なし = 全件」と読むと3264行出る
    for (const query of ['', ' ', '　', '\t\n', '()', '（）']) {
      expect(suggest(query, ALL_BRANDS), JSON.stringify(query)).toEqual([])
    }
    // 括弧だけのクエリが0件なのは normalize が括弧内を落として空になるから(全件ではない)
    expect(normalize('（）')).toBe('')
  })
})

describe('並び順 — 前方一致 → 含む一致', () => {
  it('`土` は前方一致5件が先に、含む一致4件が後に来る', () => {
    const hits = suggest('土', ALL_BRANDS)
    expect(hits).toHaveLength(9)
    // 境界を1箇所だけ跨ぐ(true が並んでから false が並ぶ)ことを列として固定する
    expect(hits.map((hit) => hit.isPrefix)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ])
    // `紀土`(819) は含む一致。前方一致のどれよりも後ろにある
    const kid = hits.findIndex((hit) => hit.brand.id === 819)
    expect(hits[kid].isPrefix).toBe(false)
    expect(kid).toBeGreaterThan(hits.filter((hit) => hit.isPrefix).length - 1)
  })

  it('前方一致の中では正規化名が短い順 = 完全一致が先頭', () => {
    const hits = suggest('土', ALL_BRANDS)
    const lengths = hits
      .filter((hit) => hit.isPrefix)
      .map((hit) => normalize(hit.brand.name).length)
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b))
    // 完全一致は「クエリと同じ長さの前方一致」なので、存在すれば先頭に立つ
    expect(names(suggest('高砂'))[0]).toBe('高砂')
    expect(names(suggest('寒菊'))).toEqual(['寒菊 どぶろく 銀八', '総乃寒菊'])
  })
})

describe('limit', () => {
  it('既定は20件で、一致がそれ未満なら一致件数どおり', () => {
    expect(DEFAULT_SUGGEST_LIMIT).toBe(20)
    expect(suggest('土')).toHaveLength(9)
    // 母数の大きい語で既定の上限が効く(`越` は前方一致だけで66件ある)
    expect(suggest('越')).toHaveLength(20)
    expect(suggest('越', ALL_BRANDS)).toHaveLength(71)
  })

  it('limit は上位から切る(順序を崩さない)', () => {
    const all = suggest('土', ALL_BRANDS)
    expect(ids(suggest('土', 3))).toEqual(ids(all).slice(0, 3))
    expect(ids(suggest('土', 1))).toEqual(ids(all).slice(0, 1))
    expect(suggest('土', 9)).toHaveLength(9)
    // 一致件数より大きい上限でも増えない
    expect(suggest('土', 100)).toHaveLength(9)
  })

  it('0以下・NaN・小数の limit で結果が化けない', () => {
    // `slice(0, -1)` は**末尾を1件落として残りを返す**ので、負値を素通しすると
    // 「1件も出さない」つもりが「8件出す」に静かに化ける。0件として扱うことを固定する
    for (const limit of [0, -1, -100, Number.NaN]) {
      expect(suggest('土', limit), String(limit)).toEqual([])
    }
    expect(suggest('土', 2.9)).toHaveLength(2)
    expect(suggest('土', Number.POSITIVE_INFINITY)).toHaveLength(9)
  })
})

describe('索引は createSuggester の中で1回だけ組む', () => {
  it('検索のたびに銘柄マスタを読み直さない', () => {
    // 構築時に1回だけ `brands` を読むことを、プロパティのアクセス回数で直接見る。
    // クエリごとに読んでいたら 500 回になる。
    let brandsReads = 0
    const counted: SuggesterTables = {
      get brands() {
        brandsReads += 1
        return tables.brands
      },
      breweries: tables.breweries,
      areas: tables.areas,
      flavorCharts: tables.flavorCharts,
    }
    const counting = createSuggester(counted)
    expect(brandsReads).toBe(1)
    for (let i = 0; i < 500; i += 1) counting('高砂')
    expect(brandsReads).toBe(1)
  })

  it('検索のたびに銘柄名を normalize し直さない', () => {
    // 上のテストは「配列を読み直さない」までしか言えない(参照を持ったまま毎回 normalize する
    // 実装も通る)。normalize には銘柄名の読み出しが必要なので、`name` のアクセス回数で見る。
    let nameReads = 0
    const brand: SakenowaBrand = {
      id: 1,
      breweryId: 10,
      get name() {
        nameReads += 1
        return '合成酒'
      },
    }
    const lazy = createSuggester({
      brands: [brand],
      breweries: [{ id: 10, name: '合成蔵', areaId: 1 }],
      areas: [
        { id: 0, name: 'その他' },
        { id: 1, name: '北海道' },
      ],
      flavorCharts: [],
    })
    expect(nameReads).toBe(1)
    for (let i = 0; i < 50; i += 1) expect(lazy('合成')).toHaveLength(1)
    expect(nameReads).toBe(1)
  })

  it('3264件の検索が「毎回 normalize する」実装より一桁速い', () => {
    // 絶対時間で閾値を置くと機械の速さに依存するので、**排除したい実装を同じ機械で測って比べる**。
    // 実測(vitest / node 24 / Apple Silicon): 200回で 索引あり 4.2ms / 毎回 normalize する版
    // 106.1ms(25倍)。索引の構築自体は 0.9ms で、1キーストロークあたりのコストは 0.02ms。
    // 検証: 照合を `normalize(entry.hit.brand.name)` に差し替えると 108ms 対 106ms で赤くなる。
    const naive = (query: string): number => {
      const key = normalize(query)
      let count = 0
      for (const brand of tables.brands) if (normalize(brand.name).includes(key)) count += 1
      return count
    }
    // JIT の暖機。どちらかだけが冷えたまま測ると比が数倍ぶれる
    for (let i = 0; i < 5; i += 1) {
      suggest('高砂')
      naive('高砂')
    }

    const t0 = performance.now()
    let hits = 0
    for (let i = 0; i < 200; i += 1) hits += suggest('高砂', ALL_BRANDS).length
    const indexed = performance.now() - t0

    const t1 = performance.now()
    let naiveHits = 0
    for (let i = 0; i < 200; i += 1) naiveHits += naive('高砂')
    const rescanned = performance.now() - t1

    // 同じ仕事をしていることの確認(速い代わりに取りこぼしている、を排除する)
    expect(hits).toBe(200 * 5)
    expect(naiveHits).toBe(hits)
    expect(indexed * 4).toBeLessThan(rescanned)
    // 病的に遅くなったら気づけるだけの緩い上限も置く(実測 4.2ms に対し 100倍以上の余裕)
    expect(indexed).toBeLessThan(500)
  })

  it('構築後にマスタ配列へ追加しても結果が変わらない(構築時のスナップショットを見る)', () => {
    const mutable: SakenowaBrand[] = [{ id: 1, name: '合成酒', breweryId: 10 }]
    const snapshot = createSuggester({
      brands: mutable,
      breweries: [{ id: 10, name: '合成蔵', areaId: 1 }],
      areas: [{ id: 1, name: '北海道' }],
      flavorCharts: [],
    })
    expect(ids(snapshot('合成'))).toEqual([1])
    mutable.push({ id: 2, name: '合成酒弐号', breweryId: 10 })
    // 月次更新でマスタが変わったら suggester を作り直す(store の責務)。黙って半分だけ
    // 新しい状態にならないことを固定する
    expect(ids(snapshot('合成'))).toEqual([1])
    expect(ids(createSuggester({ ...tables, brands: mutable })('合成'))).toEqual([1, 2])
  })
})

describe('不確実な列を埋めない', () => {
  it('areaId 0(その他)の蔵の銘柄は都道府県が null(「その他」を県名にしない)', () => {
    // 13491 `全黒` は Zenkuro(ニュージーランド)。JIS 1..47 の外を県名として流すと
    // 産地マップと県一致の紐付けに定義域外の値が入る
    const hits = suggest('全黒')
    expect(ids(hits)).toEqual([13491])
    expect(hits[0].prefecture).toBeNull()
    // 蔵元名は取れているので出す。**取れないのは県だけ**という状態をそのまま見せる
    expect(hits[0].breweryName).toBe('Zenkuro')
  })

  it('蔵元名が空の行は null に畳む(空欄を「取得できている」ように見せない)', () => {
    // さけのわの蔵元マスタには名前が空の行が48件ある(都道府県ごとに1件 + areaId 0 の1件)。
    // 2880 `土手森` はそこに属していて、県は分かるが蔵元は分からない
    const hits = suggest('土手森')
    expect(ids(hits)).toEqual([2880])
    expect(hits[0].prefecture).toBe('岡山県')
    expect(hits[0].breweryName).toBeNull()

    // 稀な例外ではない = 「蔵元で選び分ける」が常に成り立つ前提で UI を書けない。
    // 正確な件数は月次更新で動くので下限で押さえる(実測: 蔵元名が空の蔵48件 / 配下の銘柄262件)
    const namelessBreweryIds = new Set(
      tables.breweries.filter((brewery) => brewery.name.trim() === '').map((b) => b.id),
    )
    expect(namelessBreweryIds.size).toBeGreaterThan(40)
    const affected = tables.brands.filter((brand) => namelessBreweryIds.has(brand.breweryId))
    expect(affected.length).toBeGreaterThan(200)
  })

  it('6軸を持たない銘柄は hasFlavorChart が false(0 で埋めない)', () => {
    // `ビキニ娘`(2020) は銘柄として在るがチャートが無い。0 埋めすると6軸集計の分母が水増しされる
    const hits = suggest('ビキニ娘')
    expect(ids(hits)).toEqual([2020])
    expect(hits[0].hasFlavorChart).toBe(false)
  })
})

// 実データを要らない側。数件のリテラルからテーブルを組めることが、テーブルを配列で
// 受け取っている理由(domain/types.ts)。境界の分岐をここで1ケースずつ出す。
describe('注入したテーブルだけを見る', () => {
  const tiny: SuggesterTables = {
    areas: [
      { id: 0, name: 'その他' },
      { id: 1, name: '北海道' },
      { id: 2, name: '青森県' },
    ],
    breweries: [
      { id: 10, name: '北の蔵', areaId: 1 },
      { id: 20, name: '青森の蔵', areaId: 2 },
      { id: 30, name: '海外の蔵', areaId: 0 },
      { id: 40, name: '   ', areaId: 1 },
    ],
    brands: [
      { id: 100, name: '同名酒', breweryId: 10 },
      { id: 200, name: '同名酒', breweryId: 20 },
      { id: 300, name: '海外酒', breweryId: 30 },
      { id: 400, name: '蔵が消えた酒', breweryId: 999 },
      { id: 500, name: '名無し蔵の酒', breweryId: 40 },
      { id: 600, name: '同名酒の兄弟', breweryId: 10 },
      { id: 700, name: '限定の同名酒', breweryId: 10 },
    ],
    flavorCharts: [{ brandId: 100, f1: 45, f2: 50, f3: 22, f4: 38, f5: 28, f6: 53 }],
  }
  const search = createSuggester(tiny)

  it('前方一致 → 含む一致 → 名前が短い順 → ID 昇順で並ぶ', () => {
    // 4件の並びが4つの規則を1本ずつ通る: 100/200 は完全一致(名前が最短)で ID 昇順、
    // 600 は前方一致で長い、700 は含む一致なので最後
    expect(ids(search('同名酒'))).toEqual([100, 200, 600, 700])
    expect(search('同名酒').map((hit) => hit.isPrefix)).toEqual([true, true, true, false])
  })

  it('同名2件は県と蔵元で区別できる', () => {
    const hits = search('同名酒', 2)
    expect(hits.map((hit) => hit.prefecture)).toEqual(['北海道', '青森県'])
    expect(hits.map((hit) => hit.breweryName)).toEqual(['北の蔵', '青森の蔵'])
    expect(hits.map((hit) => hit.hasFlavorChart)).toEqual([true, false])
  })

  it('蔵が引けない銘柄は県も蔵元も null(既定の県に落とさない)', () => {
    const hits = search('蔵が消えた酒')
    expect(ids(hits)).toEqual([400])
    expect(hits[0].prefecture).toBeNull()
    expect(hits[0].breweryName).toBeNull()
  })

  it('空白だけの蔵元名も null(空欄を値として通さない)', () => {
    const hits = search('名無し蔵の酒')
    expect(hits[0].breweryName).toBeNull()
    expect(hits[0].prefecture).toBe('北海道')
  })

  it('areaId 0 の蔵は県が null で、蔵元名は残る', () => {
    const hits = search('海外酒')
    expect(hits[0].prefecture).toBeNull()
    expect(hits[0].breweryName).toBe('海外の蔵')
  })

  it('一致0件でテーブルの中身が漏れない', () => {
    expect(search('存在しない酒', 999)).toEqual([])
    expect(search('')).toEqual([])
  })

  it('返した配列・要素を書き換えても次の呼び出しに影響しない(索引を外へ漏らさない)', () => {
    const first = search('同名酒')
    first.pop()
    first[0].prefecture = '沖縄県'
    const second = search('同名酒')
    expect(second).toHaveLength(4)
    expect(second[0].prefecture).toBe('北海道')
  })

  it('createSuggester は入力を書き換えず、呼び出しごとに独立した索引を返す', () => {
    const again = createSuggester(tiny)
    expect(ids(again('同名酒'))).toEqual(ids(search('同名酒')))
    expect(tiny.brands).toHaveLength(7)
    expect(tiny.brands[0]).toEqual({ id: 100, name: '同名酒', breweryId: 10 })
  })
})
