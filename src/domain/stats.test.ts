// @vitest-environment node
// domain 層のテストは jsdom を要求しない(CLAUDE.md の依存方向)。node 環境で回すこと自体が
// その実証で、window/document に触る実装が混ざった瞬間にこのファイルが落ちる。
//
// ## 何を実データで見て、何を合成データで見るか
//
// 公開リポジトリに飲酒台帳を置かないため、コミットしてあるのは**共通の列を1つも持たない射影2本**
// (突き合わせると台帳の行が復元されるので、日付と銘柄/県は同じファイルに同居させない):
//   - `stats.cases.json`     … 203件の**日付だけ**       → **年別**を実データで検証する
//   - `linkBrand.cases.json` … 203件の {銘柄, 都道府県}   → **県別**を実データで検証する
//
// **スペック列はどちらの射影にも無い**(商品名経由で銘柄名が混ざる列なので新しい fixture にも
// 書き出さない)。よって**スタイル分布は「規則」を合成データで固定し、実台帳の数値は
// 期待表として置いて検証ステージがブラウザで突き合わせる**。評価も射影に無いので合成データ。
//
// 期待値は**すべてリテラルで書く**。実装から import して比べると恒真になる(BACKLOG B15)。
import linkCases from './linkBrand.cases.json'
import statsFixture from './stats.cases.json'
import { STYLE_TERMS, computeStats, isStyleTerm, matchesStyleTerm } from './stats.ts'
import type { Stats, StyleTerm } from './stats.ts'
import type { Rating, SakeRecord } from './types.ts'

/** 203件の日付(昇順)。年別集計の実データ */
const statsCases: readonly string[] = statsFixture

/** 203件の {銘柄, 都道府県}。**このテストは `prefecture` 列しか読まない** */
const linkedCases: readonly { label: string; prefecture: string }[] = linkCases

/**
 * 合成レコードの日付。**台帳に存在しない年(1999)を使う** — 台帳の日付と台帳の銘柄/県が
 * 同じ行に並ぶと、その1行で台帳の1行が復元でき2つの射影を突き合わせる鍵になる
 * (`npm run ledger:check` が見張っている)。
 */
const SYNTH_DATE = '1999-01-01'

let seq = 0

/** 指定した列だけを変えた合成レコード。集計に効く列以外は空にしておく */
function record(over: Partial<SakeRecord> = {}): SakeRecord {
  seq += 1
  return {
    id: `synth-${seq}`,
    drankOn: SYNTH_DATE,
    brandLabel: `合成銘柄${seq}`,
    sakenowaBrandId: null,
    brandName: null,
    linkStatus: 'unlinked',
    prefecture: null,
    spec: '',
    rating: null,
    place: '',
    note: '',
    thumbnail: null,
    sourceNo: null,
    createdAt: `${SYNTH_DATE}T00:00:00.000Z`,
    updatedAt: `${SYNTH_DATE}T00:00:00.000Z`,
    ...over,
  }
}

/** スタイル分布を語 → 件数の素な形にする(戻り値の並びに依存しない比較のため) */
function stylesOf(stats: Stats): Record<StyleTerm, number> {
  return Object.fromEntries(stats.styles.map((entry) => [entry.term, entry.count])) as Record<
    StyleTerm,
    number
  >
}

/** 全語0。`toEqual` の期待値の土台にする */
function noStyles(): Record<StyleTerm, number> {
  return {
    純米大吟醸: 0,
    大吟醸: 0,
    純米吟醸: 0,
    純米: 0,
    本醸造: 0,
    生原酒: 0,
    無濾過: 0,
    原酒: 0,
    ひやおろし: 0,
    しぼりたて: 0,
    にごり: 0,
  }
}

// ===========================================================================
// 境界
// ===========================================================================

describe('境界', () => {
  it('空配列 — 0 を返し、バケツを1つも作らない', () => {
    const stats = computeStats([])
    expect(stats.total).toBe(0)
    expect(stats.years).toEqual([])
    expect(stats.undatedCount).toBe(0)
    expect(stats.prefectures).toEqual([])
    expect(stats.byPrefectureCode.size).toBe(0)
    expect(stats.unresolvedPrefectures).toEqual([])
    expect(stats.noPrefectureCount).toBe(0)
    expect(stylesOf(stats)).toEqual(noStyles())
    expect(stats.styleTotal).toBe(0)
    expect(stats.styleMatchedCount).toBe(0)
    // 評価だけは**0件でも5段の行が返る**(段が消えると分布が読めない)
    expect(stats.ratings).toEqual([
      { rating: 1, count: 0 },
      { rating: 2, count: 0 },
      { rating: 3, count: 0 },
      { rating: 4, count: 0 },
      { rating: 5, count: 0 },
    ])
    expect(stats.unratedCount).toBe(0)
  })

  it('1件 — 総数1。年・県・スタイル・評価がすべてその1件で埋まる', () => {
    const stats = computeStats([
      record({ drankOn: '1999-03-04', prefecture: '福島県', spec: '純米吟醸', rating: 4 }),
    ])
    expect(stats.total).toBe(1)
    expect(stats.years).toEqual([{ year: '1999', count: 1 }])
    expect(stats.prefectures).toEqual([{ code: 7, name: '福島県', count: 1 }])
    expect(stats.byPrefectureCode.get(7)).toBe(1)
    expect(stylesOf(stats)).toEqual({ ...noStyles(), 純米吟醸: 1, 純米: 1 })
    expect(stats.ratings).toEqual([
      { rating: 1, count: 0 },
      { rating: 2, count: 0 },
      { rating: 3, count: 0 },
      { rating: 4, count: 1 },
      { rating: 5, count: 0 },
    ])
    expect(stats.unratedCount).toBe(0)
  })

  it('全件が未評価 — 5段すべて0のまま未評価に積む', () => {
    const stats = computeStats([record(), record(), record()])
    expect(stats.ratings.map((entry) => entry.count)).toEqual([0, 0, 0, 0, 0])
    expect(stats.unratedCount).toBe(3)
    expect(stats.total).toBe(3)
  })

  it('全件が県なし — 県のバケツを作らず、未記入として数える', () => {
    // `null` / 空文字 / 空白のみの3通り。**どれも「県が確定していない」で同じ枠**
    const stats = computeStats([
      record({ prefecture: null }),
      record({ prefecture: '' }),
      record({ prefecture: '   ' }),
    ])
    expect(stats.prefectures).toEqual([])
    expect(stats.byPrefectureCode.size).toBe(0)
    expect(stats.unresolvedPrefectures).toEqual([])
    expect(stats.noPrefectureCount).toBe(3)
  })
})

// ===========================================================================
// 年別 — 実データ(203件の日付)
// ===========================================================================

describe('年別(実データ203件)', () => {
  const stats = computeStats(statsCases.map((drankOn) => record({ drankOn })))

  it('総本数は203', () => {
    expect(statsCases).toHaveLength(203)
    expect(stats.total).toBe(203)
  })

  it('年別のヒストグラムが sake-log.md のサマリと一致する', () => {
    // **リテラルで書く**。実装から作った期待値と比べると常に緑になる(B15)
    expect(stats.years).toEqual([
      { year: '2020', count: 1 },
      { year: '2021', count: 12 },
      { year: '2022', count: 65 },
      { year: '2023', count: 33 },
      { year: '2024', count: 31 },
      { year: '2025', count: 33 },
      { year: '2026', count: 28 },
    ])
  })

  it('年別の合計が総本数と一致する(どの年にも入らなかった記録が無い)', () => {
    const sum = stats.years.reduce((acc, entry) => acc + entry.count, 0)
    expect(sum).toBe(203)
    expect(stats.undatedCount).toBe(0)
    expect(sum + stats.undatedCount).toBe(stats.total)
  })

  it('並びは昇順(古い年が先)', () => {
    const years = stats.years.map((entry) => entry.year)
    expect(years).toEqual([...years].sort())
    expect(years[0]).toBe('2020')
    expect(years.at(-1)).toBe('2026')
  })

  it('入力の並びを変えても同じ結果になる(集計は行順に依存しない)', () => {
    const reversed = computeStats([...statsCases].reverse().map((drankOn) => record({ drankOn })))
    expect(reversed.years).toEqual(stats.years)
    expect(reversed.total).toBe(203)
  })
})

describe('年別(規則)', () => {
  it('日付として読めない `drankOn` は年のバケツを作らず別枠で数える', () => {
    // 先頭4桁を無条件に切ると、空文字から `''`、`不明` から `不明` という年ができる。
    // **でっち上げの年を作らず、読めなかった件数を表に出す**(既定の年に丸めない)
    const stats = computeStats([
      record({ drankOn: '' }),
      record({ drankOn: '不明' }),
      record({ drankOn: '1999-13' }),
      record({ drankOn: '1999/01/01' }),
      record({ drankOn: '1999-01-01' }),
    ])
    expect(stats.years).toEqual([{ year: '1999', count: 1 }])
    expect(stats.undatedCount).toBe(4)
    expect(stats.total).toBe(5)
  })

  it('間の年を0件で埋めない(観測された年だけを返す)', () => {
    // 誤入力の年が1つ入るだけで空の年が数十行生まれてヒストグラムが読めなくなるため。
    // 等間隔に並べるかどうかは表示側の判断に残す
    const stats = computeStats([
      record({ drankOn: '1999-01-01' }),
      record({ drankOn: '2003-06-15' }),
    ])
    expect(stats.years).toEqual([
      { year: '1999', count: 1 },
      { year: '2003', count: 1 },
    ])
  })
})

// ===========================================================================
// 都道府県別 — 実データ(203件の県)
// ===========================================================================

/**
 * 期待する県別バケツ `[JISコード, 県名, 本数]`。**件数の降順 → コードの昇順**。
 *
 * `linkBrand.cases.json`(コミット済みの射影)の `prefecture` 列を数えたものなので、
 * この表に台帳の新しい情報は無い(日付は1つも含まない)。全行をリテラルで書くのは、
 * 上位3件だけでは**同数バケツの並び**と**バケツの取りこぼし**を検出できないから。
 */
const EXPECTED_PREFECTURES: readonly (readonly [code: number, name: string, count: number])[] = [
  [7, '福島県', 22],
  [30, '和歌山県', 20],
  [6, '山形県', 17],
  [9, '栃木県', 16],
  [2, '青森県', 14],
  [15, '新潟県', 13],
  [24, '三重県', 11],
  [35, '山口県', 11],
  [5, '秋田県', 8],
  [17, '石川県', 6],
  [18, '福井県', 6],
  [23, '愛知県', 6],
  [3, '岩手県', 5],
  [26, '京都府', 4],
  [34, '広島県', 4],
  [4, '宮城県', 3],
  [8, '茨城県', 3],
  [10, '群馬県', 3],
  [12, '千葉県', 3],
  [28, '兵庫県', 3],
  [41, '佐賀県', 3],
  [16, '富山県', 2],
  [20, '長野県', 2],
  [22, '静岡県', 2],
  [39, '高知県', 2],
  [1, '北海道', 1],
  [11, '埼玉県', 1],
  [13, '東京都', 1],
  [14, '神奈川県', 1],
  [29, '奈良県', 1],
  [33, '岡山県', 1],
  [42, '長崎県', 1],
  [43, '熊本県', 1],
]

describe('都道府県別(実データ203件)', () => {
  const stats = computeStats(
    // **`prefecture` 列だけを読む**(このファイルに銘柄名を持ち込まない)
    linkedCases.map((row) => record({ prefecture: row.prefecture })),
  )

  it('県のバケツが1件ずつ一致する(件数降順 → JISコード昇順)', () => {
    expect(stats.prefectures).toEqual(
      EXPECTED_PREFECTURES.map(([code, name, count]) => ({ code, name, count })),
    )
    // 濃く塗られるのは福島・和歌山・山形(PHASE_6 の受け入れ基準)
    expect(stats.prefectures.slice(0, 3)).toEqual([
      { code: 7, name: '福島県', count: 22 },
      { code: 30, name: '和歌山県', count: 20 },
      { code: 6, name: '山形県', count: 17 },
    ])
  })

  it('解決できた県は33バケツ・197本', () => {
    expect(stats.prefectures).toHaveLength(33)
    expect(stats.prefectures.reduce((acc, entry) => acc + entry.count, 0)).toBe(197)
  })

  it('`静岡県または京都府` は独自バケツになり、静岡県にも京都府にも足されない', () => {
    // ルックアップの定義域外を既定の県に丸めないことの実データ側の証拠。
    // 丸めると静岡2→3 か 京都4→5 になり、この行が落ちる
    expect(stats.unresolvedPrefectures).toEqual([{ label: '静岡県または京都府', count: 1 }])
    expect(stats.byPrefectureCode.get(22)).toBe(2)
    expect(stats.byPrefectureCode.get(26)).toBe(4)
  })

  it('県が空欄の5本は未記入として別枠で数える', () => {
    expect(stats.noPrefectureCount).toBe(5)
    // 曖昧な表記(1本)と未記入(5本)を同じ枠に混ぜない
    expect(stats.unresolvedPrefectures.reduce((acc, entry) => acc + entry.count, 0)).toBe(1)
  })

  it('空欄を除くと34バケツ・合計198(PHASE_6 の受け入れ基準)', () => {
    const buckets = stats.prefectures.length + stats.unresolvedPrefectures.length
    const bottles =
      stats.prefectures.reduce((acc, entry) => acc + entry.count, 0) +
      stats.unresolvedPrefectures.reduce((acc, entry) => acc + entry.count, 0)
    expect(buckets).toBe(34)
    expect(bottles).toBe(198)
    // 3つの枠で203本を余さず説明できる(どこにも入らない記録が無い)
    expect(bottles + stats.noPrefectureCount).toBe(203)
    expect(stats.total).toBe(203)
  })

  it('未進出県はキーを持たない(0件の行を作らず、読む側が `?? 0` で読む)', () => {
    // 山梨県(19) / 鳥取県(31) / 沖縄県(47) は203本に1本も無い。**「その他」にも丸めない**
    for (const code of [19, 31, 47]) {
      expect(stats.byPrefectureCode.has(code)).toBe(false)
      expect(stats.byPrefectureCode.get(code) ?? 0).toBe(0)
    }
    expect(stats.byPrefectureCode.size).toBe(33)
  })

  it('`byPrefectureCode` は `prefectures` と同じ値(2つの形が食い違わない)', () => {
    for (const entry of stats.prefectures) {
      expect(stats.byPrefectureCode.get(entry.code)).toBe(entry.count)
    }
  })

  it('入力の並びを変えても同じ結果になる', () => {
    const reversed = computeStats(
      [...linkedCases].reverse().map((row) => record({ prefecture: row.prefecture })),
    )
    expect(reversed.prefectures).toEqual(stats.prefectures)
    expect(reversed.unresolvedPrefectures).toEqual(stats.unresolvedPrefectures)
    expect(reversed.noPrefectureCount).toBe(5)
  })
})

describe('都道府県別(規則)', () => {
  it('解決できない表記が複数あれば件数降順 → 表記順で並ぶ', () => {
    const stats = computeStats([
      record({ prefecture: '静岡県または京都府' }),
      record({ prefecture: 'アメリカ' }),
      record({ prefecture: 'アメリカ' }),
      record({ prefecture: 'その他' }),
    ])
    expect(stats.unresolvedPrefectures).toEqual([
      { label: 'アメリカ', count: 2 },
      { label: 'その他', count: 1 },
      { label: '静岡県または京都府', count: 1 },
    ])
    // areas.json の添字0は `その他` だが**県ではない**。県のバケツに入れない
    expect(stats.prefectures).toEqual([])
  })

  it('前後の空白は落として同じ県に寄せる(表示名は areas.json の表記に揃える)', () => {
    const stats = computeStats([
      record({ prefecture: '山形県' }),
      record({ prefecture: ' 山形県 ' }),
    ])
    expect(stats.prefectures).toEqual([{ code: 6, name: '山形県', count: 2 }])
  })
})

// ===========================================================================
// スタイル分布 — 規則は合成データで固定する(スペック列は射影に無い)
// ===========================================================================

/**
 * 語ごとの**手書きの**スペック例(合成データ。実台帳の文字列ではない)。
 *
 * **`STYLE_TERMS` から入力を作らないためにこの表がある。** 各語をその語自身の文字列に当てると
 * `spec.includes(term)` は綴りが何であれ必ず成立し、「全語が発火する」検査が恒真になる
 * (実装の `ひやおろし` を `ひやおろす` に変えても緑のまま = 期待値を実装と同じ出所から
 * 取っている。B15 と同じ罠)。ここが独立したリテラルなので、実装側の綴りが動けば赤になる。
 *
 * 型が `Record<StyleTerm, string>` なので、語を足す/直すとこの表がコンパイルで落ちる
 * (期待値の無い語が黙って0件で出荷されるのを防ぐ)。
 */
const STYLE_TERM_SAMPLE_SPECS: Record<StyleTerm, string> = {
  純米大吟醸: '純米大吟醸 磨き三割五分',
  大吟醸: '大吟醸 斗瓶囲い',
  純米吟醸: '純米吟醸 おりがらみ',
  純米: '特別純米 山廃',
  本醸造: '本醸造 辛口',
  生原酒: '生原酒 直汲み',
  無濾過: '無濾過 瓶囲い',
  原酒: '原酒 三年熟成',
  ひやおろし: 'ひやおろし 秋あがり',
  しぼりたて: 'しぼりたて 新酒',
  にごり: 'にごり酒 活性',
}

describe('スタイル分布(規則)', () => {
  it('`純米大吟醸` の1本は `大吟醸` にも `純米` にも数える(重複計上)', () => {
    const stats = computeStats([record({ spec: '純米大吟醸' })])
    expect(stylesOf(stats)).toEqual({ ...noStyles(), 純米大吟醸: 1, 大吟醸: 1, 純米: 1 })
    // **合計が件数を超えるのが正しい。** 表示側はここに「重複計上」と書く
    expect(stats.styleTotal).toBe(3)
    expect(stats.styleTotal).toBeGreaterThan(stats.total)
    expect(stats.styleMatchedCount).toBe(1)
  })

  it('`生原酒` の1本は `原酒` にも数える', () => {
    const stats = computeStats([record({ spec: '無濾過生原酒' })])
    expect(stylesOf(stats)).toEqual({ ...noStyles(), 無濾過: 1, 生原酒: 1, 原酒: 1 })
    expect(stats.styleTotal).toBe(3)
  })

  it('備考(`note`)は対象にしない — 同じ文字列でも列が違えば数が変わる', () => {
    // これが「対象はスペック列だけ」という規則が効いていることの証拠。
    // 実台帳では備考を混ぜると `にごり` が 4 → 5 にずれる
    const inNote = computeStats([record({ spec: '純米', note: 'にごり。無濾過だと思う' })])
    expect(stylesOf(inNote)).toEqual({ ...noStyles(), 純米: 1 })
    expect(inNote.styleTotal).toBe(1)

    const inSpec = computeStats([record({ spec: '純米 にごり 無濾過', note: '' })])
    expect(stylesOf(inSpec)).toEqual({ ...noStyles(), 純米: 1, にごり: 1, 無濾過: 1 })
    expect(inSpec.styleTotal).toBe(3)
  })

  it('銘柄名や場所も対象にしない(スペック列以外は一切見ない)', () => {
    const stats = computeStats([
      record({ brandLabel: '純米大吟醸という名前ではない銘柄', place: '大吟醸バー', spec: '' }),
    ])
    expect(stylesOf(stats)).toEqual(noStyles())
    expect(stats.styleMatchedCount).toBe(0)
  })

  it('1本の中に同じ語が2回出ても1件(単位は本数、出現回数ではない)', () => {
    const stats = computeStats([record({ spec: '原酒(原酒表記あり)' })])
    expect(stylesOf(stats)).toEqual({ ...noStyles(), 原酒: 1 })
    expect(stats.styleTotal).toBe(1)
  })

  it('スペックが空・語彙の外の1本はどの語にも入らない(合計と一致件数で見える)', () => {
    const stats = computeStats([
      record({ spec: '' }),
      record({ spec: '山廃仕込' }),
      record({ spec: '純米' }),
    ])
    expect(stats.styleTotal).toBe(1)
    expect(stats.styleMatchedCount).toBe(1)
    // 語彙外・未記入は total - styleMatchedCount として読める(0本と混ざらない)
    expect(stats.total - stats.styleMatchedCount).toBe(2)
  })

  it('戻り値の並びは `STYLE_TERMS` の宣言順', () => {
    const stats = computeStats([record({ spec: '純米大吟醸' })])
    expect(stats.styles.map((entry) => entry.term)).toEqual([...STYLE_TERMS])
  })

  it('全語が発火する — 語の綴りが1文字でも違えばその語は永久に0件になる', () => {
    // 恒真述語の検出。`無濾過` の `濾` のように打ち間違えても例外は出ず、
    // その語だけが静かに0のままになるので**全語が1回以上数えられることを確かめる**。
    //
    // 入力は `STYLE_TERM_SAMPLE_SPECS`(手書きのリテラル)。**`STYLE_TERMS` から作ってはいけない** —
    // 各語をその語自身の文字列に当てると綴りが何であれ必ず一致し、この検査が恒真になる。
    const stats = computeStats(
      Object.values(STYLE_TERM_SAMPLE_SPECS).map((spec) => record({ spec })),
    )
    for (const entry of stats.styles) {
      expect(entry.count, `語 ${entry.term} が1本も数えられていない`).toBeGreaterThanOrEqual(1)
    }
    // 11本の合成スペックに対する分布を**リテラルで**固定する。語を打ち間違えるとその語が
    // 0 になり(語の綴りごと変わるので)ここが落ちる
    expect(stylesOf(stats)).toEqual({
      純米大吟醸: 1, // 「純米大吟醸 磨き三割五分」
      大吟醸: 2, // 上の1本 + 「大吟醸 斗瓶囲い」
      純米吟醸: 1, // 「純米吟醸 おりがらみ」
      純米: 3, // 純米大吟醸 + 純米吟醸 + 「特別純米 山廃」
      本醸造: 1,
      生原酒: 1,
      無濾過: 1,
      原酒: 2, // 「生原酒 直汲み」 + 「原酒 三年熟成」
      ひやおろし: 1,
      しぼりたて: 1,
      にごり: 1,
    })
    // 部分一致の包含関係(この不変条件はどんな入力でも成り立つ)
    const counts = stylesOf(stats)
    expect(counts.大吟醸).toBeGreaterThanOrEqual(counts.純米大吟醸)
    expect(counts.原酒).toBeGreaterThanOrEqual(counts.生原酒)
    expect(counts.純米).toBeGreaterThanOrEqual(counts.純米大吟醸)
    expect(counts.純米).toBeGreaterThanOrEqual(counts.純米吟醸)
    // 11本しか入れていないのに延べは15件(重複計上)
    expect(stats.total).toBe(11)
    expect(stats.styleMatchedCount).toBe(11)
    expect(stats.styleTotal).toBe(15)
    expect(stats.styleTotal).toBeGreaterThan(11)
  })
})

// ---------------------------------------------------------------------------
// 述語の切り出し(絞り込みのピルと分布が同じ規則を通ることの担保)
// ---------------------------------------------------------------------------

describe('matchesStyleTerm(1本 × 1語)', () => {
  it('`純米大吟醸` の1本は `大吟醸` にも `純米` にも当たる(重複あり部分一致)', () => {
    expect(matchesStyleTerm(record({ spec: '純米大吟醸' }), '大吟醸')).toBe(true)
    expect(matchesStyleTerm(record({ spec: '純米大吟醸' }), '純米')).toBe(true)
    expect(matchesStyleTerm(record({ spec: '純米大吟醸' }), '純米大吟醸')).toBe(true)
  })

  it('当たらない語は false(部分一致は含む方向にだけ効く)', () => {
    expect(matchesStyleTerm(record({ spec: '純米大吟醸' }), '本醸造')).toBe(false)
    expect(matchesStyleTerm(record({ spec: '' }), '純米')).toBe(false)
  })

  it('備考(`note`)は見ない — 同じ文字列でも列が違えば当たらない', () => {
    // 分布側と同じ規則(実台帳では備考を混ぜると `にごり` が 4 → 5 にずれる)。
    // 絞り込みのピルが別の述語を持つと、ピルの件数と絞った行数が食い違う
    expect(matchesStyleTerm(record({ spec: '', note: 'にごり' }), 'にごり')).toBe(false)
    expect(matchesStyleTerm(record({ spec: 'にごり', note: '' }), 'にごり')).toBe(true)
  })

  it('銘柄名も場所も見ない', () => {
    expect(
      matchesStyleTerm(
        record({ brandLabel: '純米大吟醸という名前ではない銘柄', place: '大吟醸バー', spec: '' }),
        '純米',
      ),
    ).toBe(false)
  })

  it('スペックは正規化しない — 括弧の中身も語中の空白もそのまま扱う', () => {
    // 検索欄(`searchRecord.ts`)は生一致 OR 正規化一致の和集合だが、こちらは**分布の定義**
    // なので生の部分一致だけ。実測値(43 / 45 / 51 / 112 / …)がその基準で得た値である
    expect(matchesStyleTerm(record({ spec: '純米大吟醸(限定)' }), '純米大吟醸')).toBe(true)
    expect(matchesStyleTerm(record({ spec: '純米 大吟醸' }), '純米大吟醸')).toBe(false)
  })

  it('分布の件数と述語が一致する(`computeStats` が同じ述語を通っている)', () => {
    const records = [
      record({ spec: '純米大吟醸' }),
      record({ spec: '特別純米' }),
      record({ spec: '', note: '純米' }),
      record({ spec: '山廃仕込' }),
    ]
    // リテラルの期待値: `純米` は1本目と2本目の2本(3本目は備考なので入らない)
    expect(records.filter((entry) => matchesStyleTerm(entry, '純米')).length).toBe(2)
    expect(stylesOf(computeStats(records)).純米).toBe(2)
  })
})

describe('isStyleTerm', () => {
  it('語彙の中だけを通す(定義域外のキーで全件に戻さないための番人)', () => {
    expect(isStyleTerm('純米')).toBe(true)
    expect(isStyleTerm('にごり')).toBe(true)
    expect(isStyleTerm('純吟')).toBe(false)
    expect(isStyleTerm('')).toBe(false)
    expect(isStyleTerm('大吟醸 ')).toBe(false)
    expect(isStyleTerm('無濾過生原酒')).toBe(false)
  })

  it('`STYLE_TERMS` の全語を通す(語を足したときに番人が置き去りにならない)', () => {
    for (const term of STYLE_TERMS) expect(isStyleTerm(term)).toBe(true)
  })
})

/**
 * 実台帳203本のスタイル分布(PHASE_6 の受け入れ基準)。**スペック列は射影に無いので、
 * この数値はここで期待表として固定し、実データとの突き合わせは検証ステージが
 * ブラウザで行う**(スペックを新しい fixture に書き出さない)。
 *
 * 型が `Record<StyleTerm, number>` なので、`STYLE_TERMS` に語を足すとこの表がコンパイルで
 * 落ちる(期待値の無い語が黙って0件で出荷されるのを防ぐ)。
 *
 * **この表は `computeStats` の出力と比較していない**(下の describe の4 it はすべて
 * リテラル同士の自己整合で、実装を通らない)。ここを実装に突き合わせるには 203本の
 * スペック列が必要で、それは射影2ファイルに無く**新しい fixture にも書き出せない**
 * (商品名経由で銘柄名が混ざる列。privacy)。実装に対して 112 / 延べ314 を固定しているのは
 * `src/integration/screens.test.tsx` の1箇所で、**`data/seed/` が無い環境(CI)では skip される**。
 * 隠さずここに書いておく: CI が守っているのは規則(重複計上 / `spec` 列のみ / 備考除外)まで。
 */
const EXPECTED_STYLE_COUNTS: Record<StyleTerm, number> = {
  純米大吟醸: 43,
  大吟醸: 45,
  純米吟醸: 51,
  純米: 112,
  本醸造: 0,
  生原酒: 15,
  無濾過: 13,
  原酒: 16,
  ひやおろし: 7,
  しぼりたて: 8,
  にごり: 4,
}

/**
 * **0 が正しい語。** 実台帳に本醸造は1本も無い。ここに載っていない語が0になったら
 * 「実データにその酒が無い」ではなく「条件が死んでいる」と読む(恒真述語の検出)。
 */
const TERMS_EXPECTED_ZERO: readonly StyleTerm[] = ['本醸造']

describe('スタイル分布(実台帳の期待表)', () => {
  it('期待表の語が `STYLE_TERMS` と一致する(表だけ・実装だけに語がある状態を作らない)', () => {
    // 綴り事故の検出役その2(その1は「全語が発火する」)。左辺はこのファイルのリテラルキー
    // なので、実装の語を1文字でも変えると両辺が食い違って落ちる
    expect(Object.keys(EXPECTED_STYLE_COUNTS).sort()).toEqual([...STYLE_TERMS].sort())
  })

  it('0 が正しい語と、0 なら壊れている語を区別する', () => {
    for (const term of STYLE_TERMS) {
      const expected = EXPECTED_STYLE_COUNTS[term]
      if (TERMS_EXPECTED_ZERO.includes(term)) {
        expect(expected, `${term} は実台帳に無いので0が正しい`).toBe(0)
      } else {
        expect(expected, `${term} が0なら条件が死んでいる`).toBeGreaterThan(0)
      }
    }
    expect(TERMS_EXPECTED_ZERO).toEqual(['本醸造'])
  })

  it('合計は203本を超える(重複計上である証拠)', () => {
    const sum = Object.values(EXPECTED_STYLE_COUNTS).reduce((acc, count) => acc + count, 0)
    expect(sum).toBe(314)
    expect(sum).toBeGreaterThan(203)
  })

  it('期待表が部分一致の包含関係を満たす(排他バケツの数字ではない)', () => {
    // 排他バケツの集計に差し替わると必ずこの関係が崩れる
    expect(EXPECTED_STYLE_COUNTS.大吟醸).toBeGreaterThanOrEqual(EXPECTED_STYLE_COUNTS.純米大吟醸)
    expect(EXPECTED_STYLE_COUNTS.原酒).toBeGreaterThanOrEqual(EXPECTED_STYLE_COUNTS.生原酒)
    expect(EXPECTED_STYLE_COUNTS.純米).toBeGreaterThanOrEqual(EXPECTED_STYLE_COUNTS.純米大吟醸)
    expect(EXPECTED_STYLE_COUNTS.純米).toBeGreaterThanOrEqual(EXPECTED_STYLE_COUNTS.純米吟醸)
  })
})

// ===========================================================================
// 評価の分布
// ===========================================================================

describe('評価の分布', () => {
  it('1..5 と未評価をそれぞれ数える', () => {
    const ratings: readonly Rating[] = [1, 2, 3, 3, 5]
    const stats = computeStats([...ratings.map((rating) => record({ rating })), record()])
    expect(stats.ratings).toEqual([
      { rating: 1, count: 1 },
      { rating: 2, count: 1 },
      { rating: 3, count: 2 },
      { rating: 4, count: 0 },
      { rating: 5, count: 1 },
    ])
    expect(stats.unratedCount).toBe(1)
    // 5段 + 未評価で全件を説明できる
    const sum = stats.ratings.reduce((acc, entry) => acc + entry.count, 0)
    expect(sum + stats.unratedCount).toBe(stats.total)
  })

  it('1..5 の段は0件でも消えず、昇順で必ず5行返る', () => {
    const stats = computeStats([record({ rating: 3 })])
    expect(stats.ratings.map((entry) => entry.rating)).toEqual([1, 2, 3, 4, 5])
    expect(stats.ratings.map((entry) => entry.count)).toEqual([0, 0, 1, 0, 0])
  })

  it('1..5 の外の値は段に足さず未評価として数える(NaN を画面に出さない)', () => {
    // 型では起き得ないが、手で編集したバックアップや壊れた DB から入ってくる。
    // 存在しない段に加算すると undefined + 1 = NaN が分布に混ざる
    const broken = [0, 6, -1, 3.5].map((value) => record({ rating: value as Rating }))
    const stats = computeStats(broken)
    expect(stats.ratings.map((entry) => entry.count)).toEqual([0, 0, 0, 0, 0])
    expect(stats.unratedCount).toBe(4)
    for (const entry of stats.ratings) expect(Number.isInteger(entry.count)).toBe(true)
  })
})

// ===========================================================================
// 純関数であること
// ===========================================================================

describe('純関数', () => {
  it('入力の配列とレコードを変更しない', () => {
    const records = [
      record({ prefecture: '山形県', spec: '純米大吟醸', rating: 5 }),
      record({ prefecture: '', spec: '' }),
    ]
    const before = JSON.stringify(records)
    computeStats(Object.freeze(records))
    expect(JSON.stringify(records)).toBe(before)
  })

  it('同じ入力で2回呼ぶと同じ結果になる(内部状態を持たない)', () => {
    const records = statsCases.map((drankOn) => record({ drankOn }))
    expect(computeStats(records)).toEqual(computeStats(records))
  })
})
