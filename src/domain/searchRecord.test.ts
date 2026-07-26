// @vitest-environment node
// domain 層のテストは jsdom を要求しない(CLAUDE.md の依存方向)。node 環境で回すこと自体が
// その実証で、window/document に触る実装が混ざった瞬間にこのファイルが落ちる。
//
// **このファイルが CI で守るもの**(`src/integration/` は `data/seed/` が無い環境で skip されるので、
// 検索の正しさを毎回検査できるのはここだけ):
//   1. 検索対象が5フィールド(銘柄名 / 記録の表記 / スペック / 場所 / メモ)であること
//   2. **生一致は必ず残る**(正規化で消える文字列 = 括弧の中身が打てなくならない)
//   3. **正規化でだけ当たる表記ゆれを拾う**(異体字 / 半角カナ / 全角英数 / 語中の空白)
//   4. ★ **正規化後に空になる検索語で全件に落ちない**(`()` だけを打っても0件)
//   5. ★ **フィールドを跨いだ部分一致が生まれない**(`place` の末尾 + `note` の先頭で当たらない)
//
// 期待値はリテラルで書く(実装から import して比べると恒真になる。BACKLOG B15)。
// 銘柄の表記は既にリポジトリのコメントに出ている実在の表記だけを使い、**日付と同じ行に置かない**
// (日付 × 銘柄の対は台帳の1行を復元する結合キーになる。`npm run ledger:check` が見張っている)。

import { normalize } from './normalize.ts'
import { buildSearchText, matchesQuery } from './searchRecord.ts'
import type { SakeRecord } from './types.ts'

/** 台帳に存在しない年。この列は検索に関係しないが、合成であることを日付でも示しておく */
const SYNTH_DATE = '1999-01-01'

let seq = 0

function record(over: Partial<SakeRecord> = {}): SakeRecord {
  seq += 1
  return {
    id: `synth-${String(seq)}`,
    drankOn: SYNTH_DATE,
    brandLabel: `合成銘柄${String(seq)}`,
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

/** 「この記録はこの検索語に当たるか」。実際の呼び側(Timeline)と同じ2段構え */
function hits(over: Partial<SakeRecord>, query: string): boolean {
  return matchesQuery(buildSearchText(record(over)), query)
}

describe('検索対象のフィールド', () => {
  it('さけのわの銘柄名でも記録した生の表記でも当たる', () => {
    expect(hits({ brandLabel: 'テスト別名', brandName: 'テスト正名' }, 'テスト別名')).toBe(true)
    expect(hits({ brandLabel: 'テスト別名', brandName: 'テスト正名' }, 'テスト正名')).toBe(true)
  })

  it('`brandName` が null でも例外にならず、生の表記で当たる', () => {
    expect(hits({ brandLabel: 'テスト酒', brandName: null }, 'テスト酒')).toBe(true)
  })

  it('スペックで当たる(画面に出ている列が打てる)', () => {
    // RecordCard / RecordDetail は `spec` を本文に描いているのに検索対象外だった。
    // 見えている文字列で当たらないのは「入っているのに出ない」の一種
    expect(hits({ spec: '純米大吟醸 無濾過生原酒' }, '無濾過')).toBe(true)
    expect(hits({ spec: '純米大吟醸 無濾過生原酒' }, 'ひやおろし')).toBe(false)
  })

  it('場所とメモで当たる', () => {
    expect(hits({ place: '架空バー' }, '架空バー')).toBe(true)
    expect(hits({ note: 'メモ甲' }, 'メモ')).toBe(true)
  })

  it('検索対象でない列では当たらない(都道府県は絞り込みの軸で持つ)', () => {
    // 県は単一選択のピルで濾す。検索テキストに混ぜると「福島」で福島県の記録が全部出て、
    // 銘柄・メモの部分一致という検索の意味が薄まる
    expect(hits({ prefecture: '福島県' }, '福島')).toBe(false)
  })
})

describe('空の検索語は絞り込みなし', () => {
  it('空文字・空白だけ・全角空白だけは true(全件が残る)', () => {
    expect(hits({ brandLabel: 'テスト酒' }, '')).toBe(true)
    expect(hits({ brandLabel: 'テスト酒' }, '   ')).toBe(true)
    expect(hits({ brandLabel: 'テスト酒' }, '　')).toBe(true)
  })
})

describe('生一致は必ず残る(正規化で置き換えない)', () => {
  it('括弧の中身で当たる — 正規化すると消える文字列', () => {
    // 前提の確認: `normalize()` は括弧を中身ごと落とすので、正規化一致だけでは当たらない。
    // ここが恒真でないことの証拠になる(消えないなら生一致の枝が無くても通ってしまう)
    expect(normalize('寒菊(OCEAN99)')).toBe('寒菊')

    expect(hits({ brandLabel: '寒菊(OCEAN99)' }, 'OCEAN99')).toBe(true)
    expect(hits({ brandLabel: '寒菊(OCEAN99)' }, 'ocean99')).toBe(true)
    expect(hits({ brandLabel: '寒菊(OCEAN99)' }, '寒菊')).toBe(true)
  })

  it('大文字小文字は無視する', () => {
    expect(hits({ brandLabel: 'Zebra' }, 'zebra')).toBe(true)
    expect(hits({ brandLabel: 'zebra' }, 'ZEBRA')).toBe(true)
  })
})

describe('正規化でだけ当たる表記ゆれ', () => {
  it('異体字を畳む(`写楽` で `寫楽` の記録が出る / 逆も)', () => {
    expect(hits({ brandLabel: '寫楽' }, '写楽')).toBe(true)
    expect(hits({ brandLabel: '写楽' }, '寫楽')).toBe(true)
  })

  it('半角カナで打っても全角カナの記録が出る(NFKC)', () => {
    expect(hits({ place: 'ﾊﾞｰ架空' }, 'バー架空')).toBe(true)
    expect(hits({ place: 'バー架空' }, 'ﾊﾞｰ架空')).toBe(true)
  })

  it('全角英数で打っても半角の記録が出る(NFKC)', () => {
    expect(hits({ brandLabel: 'OCEAN99' }, 'ＯＣＥＡＮ９９')).toBe(true)
  })

  it('語中の空白を無視する(`純米 大吟醸` が `純米大吟醸` で出る)', () => {
    expect(hits({ spec: '純米 大吟醸' }, '純米大吟醸')).toBe(true)
  })
})

// ===========================================================================
// ★ ガード2つ。どちらも1行の抜けで「静かに全件」「静かに誤一致」になる
// ===========================================================================

describe('正規化後に空になる検索語で全件に落ちない', () => {
  it('括弧だけを打つと0件(`includes(\'\')` が常に true になる罠)', () => {
    // `normalize('()')` は空文字。空文字を needle にすると全記録が一致する =
    // 「定義域外のキーで全件にフォールバック」の直撃違反
    expect(normalize('()')).toBe('')
    expect(hits({ brandLabel: 'テスト酒', note: 'メモ' }, '()')).toBe(false)
    expect(hits({ brandLabel: 'テスト酒', note: 'メモ' }, '【】')).toBe(false)
    expect(hits({ brandLabel: 'テスト酒', note: 'メモ' }, '[]')).toBe(false)
  })

  it('中身のある括弧も、生一致しなければ0件(括弧を打った本人の意図を尊重する)', () => {
    // `(架空)` は正規化すると空になる。ここで正規化側に落ちると全件が出る
    expect(normalize('(架空)')).toBe('')
    expect(hits({ note: '架空バー' }, '(架空)')).toBe(false)
    // 括弧を外せば当たる(取りこぼしではなく、打った文字どおりの結果)
    expect(hits({ note: '架空バー' }, '架空')).toBe(true)
  })

  it('括弧だけの検索語は、括弧を持つ記録には生一致で当たる', () => {
    // 全件に落ちないことと「1件も当たらない」は別。生一致の枝は生きている
    expect(hits({ brandLabel: '寒菊(OCEAN99)' }, '()')).toBe(false)
    expect(hits({ brandLabel: '寒菊(OCEAN99)' }, '(OCEAN')).toBe(true)
  })
})

describe('フィールドを跨いだ部分一致が生まれない', () => {
  it('`place` の末尾 + `note` の先頭では当たらない', () => {
    // `normalize()` は空白を落とすので、**結合してから**正規化すると `自宅` + `酒` が
    // `自宅酒` という1つの文字列になり `宅酒` で当たってしまう
    const fields = { place: '自宅', note: '酒' }
    expect(hits(fields, '宅酒')).toBe(false)
    // 検査が恒偽でないことの確認: 各フィールドの中では当たる
    expect(hits(fields, '自宅')).toBe(true)
    expect(hits(fields, '宅')).toBe(true)
    expect(hits(fields, '酒')).toBe(true)
  })

  it('銘柄名 + 記録の表記の跨ぎでも当たらない(隣接する2フィールド)', () => {
    const fields = { brandName: 'テスト正名', brandLabel: 'テスト別名' }
    expect(hits(fields, '正名テスト')).toBe(false)
    expect(hits(fields, '名テスト')).toBe(false)
  })
})

describe('buildSearchText', () => {
  it('生と正規化の2本を持ち、どちらもフィールドを改行で区切る', () => {
    const text = buildSearchText(
      record({ brandName: null, brandLabel: 'Zebra', spec: '純米 大吟醸', place: '自宅', note: '酒' }),
    )
    // 先頭は brandName(null → 空文字)なので改行から始まる。**区切りが残っている**ことが
    // フィールド跨ぎを防いでいる唯一の仕組み
    expect(text.raw).toBe('\nzebra\n純米 大吟醸\n自宅\n酒')
    expect(text.norm).toBe('\nzebra\n純米大吟醸\n自宅\n酒')
  })

  it('記録を変更しない', () => {
    const target = record({ brandLabel: 'テスト酒', note: 'メモ' })
    const before = JSON.stringify(target)
    buildSearchText(target)
    expect(JSON.stringify(target)).toBe(before)
  })
})
