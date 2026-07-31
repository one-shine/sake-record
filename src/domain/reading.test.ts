import { describe, expect, it } from 'vitest'
import readingsJson from '../../public/data/kanji/readings.json'
import brandsJson from '../../public/data/sakenowa/brands.json'
import {
  createReadingIndex,
  decodeKanjiReadings,
  MIN_TEXT_READING_LENGTH,
  toKatakana,
  type KanjiReadingsFile,
} from './reading.ts'
import type { BrandsFile } from './types.ts'

// 合成の読み表。**同梱データに依存せずに規則を固定する**(件数が動いても赤にならない)
const TABLE = decodeKanjiReadings({
  copyright: 'test',
  chars: {
    宮: 'キュウ,グウ,ミヤ',
    泉: 'イズミ,セン',
    紀: 'キ',
    土: 'ド,ト,ツチ',
    田: 'タ,デン',
    酒: 'サケ,シュ',
    佐: 'サ',
    成: 'セイ,ナリ',
    政: 'セイ,マサ',
  },
})

const BRANDS = [
  { id: 1, name: '宮泉' },
  { id: 2, name: '紀土' },
  { id: 3, name: '田酒' },
  { id: 4, name: '佐々成政' },
  { id: 5, name: 'あさひ' },
]

const index = createReadingIndex(BRANDS, TABLE)
const ids = (hits: readonly { brandId: number }[]) =>
  hits.map((h) => h.brandId).sort((a, b) => a - b)

describe('toKatakana', () => {
  it('ひらがなだけをカタカナに寄せる(漢字とラテンはそのまま)', () => {
    expect(toKatakana('みやいずみkid宮')).toBe('ミヤイズミkid宮')
  })

  it('小書きも濁点付きも落とさない', () => {
    expect(toKatakana('はっせんぎょ')).toBe('ハッセンギョ')
  })
})

describe('decodeKanjiReadings', () => {
  it('カンマ区切りを配列に解く', () => {
    expect(TABLE.get('宮')).toEqual(['キュウ', 'グウ', 'ミヤ'])
  })

  it('空の読みは落とす(空文字がどの位置にも一致する段を作らない)', () => {
    const table = decodeKanjiReadings({ copyright: 'test', chars: { 空: '', 山: 'ヤマ,,サン' } })
    expect(table.has('空')).toBe(false)
    expect(table.get('山')).toEqual(['ヤマ', 'サン'])
  })
})

describe('search — 人が打ったかな', () => {
  it('読みが全部揃えば当たる(`きど` → 紀土)', () => {
    expect(ids(index.search('きど'))).toEqual([2])
  })

  it('カタカナで打っても同じ', () => {
    expect(ids(index.search('キド'))).toEqual([2])
  })

  it('打ち途中(読みの一部)でも当たる — 1字目から反応する', () => {
    // `きゅ` は `宮` の読み `キュウ` の途中。ここで切れるとサジェストが点滅する
    expect(ids(index.search('きゅ'))).toEqual([1])
    expect(ids(index.search('みやい'))).toEqual([1])
  })

  it('銘柄名の途中の字から始まる読みも拾い、先頭一致と区別する', () => {
    const [head] = index.search('みやいずみ')
    expect(head.isPrefix).toBe(true)
    const [tail] = index.search('いずみ')
    expect(tail.brandId).toBe(1)
    expect(tail.isPrefix).toBe(false)
  })

  it('読みが繋がらなければ当たらない(音と訓を跨いだ組でも実在しない並びは出さない)', () => {
    expect(index.search('きゃど')).toEqual([])
  })

  it('`々` は直前の字の読みを引き継ぐ', () => {
    expect(ids(index.search('ささ'))).toEqual([4])
    expect(ids(index.search('ささなりまさ'))).toEqual([4])
  })

  it('かなだけの銘柄名は読み表が無くても引ける', () => {
    expect(ids(index.search('あさ'))).toEqual([5])
    expect(ids(index.search('アサヒ'))).toEqual([5])
  })

  it('読みの無い字が1つでもあれば索引に入れない(推定で埋めない)', () => {
    // `開` は表に無いので `あさ開` は読みを作れない。**部分的な読みで当てにいかない**
    const partial = createReadingIndex([{ id: 9, name: 'あさ開' }], TABLE)
    expect(partial.search('あさ')).toEqual([])
  })

  it('空クエリは0件。**全件に落ちない**', () => {
    expect(index.search('')).toEqual([])
    expect(index.search('   ')).toEqual([])
  })

  it('一致0件も0件のまま返す', () => {
    expect(index.search('ぬるぽ')).toEqual([])
  })
})

describe('find — OCR が読んだ文字列', () => {
  it('雑音に埋もれた読みを1件だけ拾う', () => {
    const hits = index.find('てのココ】にコ)o』大みやいずみcりびね給:Ss、')
    expect(hits.map((h) => h.brandId)).toEqual([1])
    expect(hits[0].reading).toBe('ミヤイズミ')
  })

  it(`${MIN_TEXT_READING_LENGTH}文字未満の読みは採らない — ここが \`ビキニ娘\` の再発を止める門`, () => {
    // `キド`(2文字) も `デンシュ`(4文字) も実在する読みだが、雑音の中では当てずっぽうになる
    expect(index.find('ササきどコキデンシュココ')).toEqual([])
  })

  it('銘柄名の途中からの一致は採らない(全体の読みだけ)', () => {
    // `イズミ` は 宮泉 の後半だが、全体の読みではないので出さない
    expect(index.find('カカいずみトシ')).toEqual([])
  })

  it('同じ銘柄が複数の位置で当たったら長いほうを残す', () => {
    const hits = index.find('みやいずみ と みやいずみ')
    expect(hits).toHaveLength(1)
    expect(hits[0].reading).toBe('ミヤイズミ')
  })

  it('かなが1文字も無ければ0件', () => {
    expect(index.find('宮泉 AIZUMIYAIZUMI 2026')).toEqual([])
  })
})

describe('同梱データ', () => {
  const readings = decodeKanjiReadings(readingsJson as unknown as KanjiReadingsFile)
  const brands = (brandsJson as unknown as BrandsFile).rows.map(([id, name]) => ({ id, name }))
  const real = createReadingIndex(brands, readings)
  const names = new Map(brands.map((b) => [b.id, b.name]))
  const hitNames = (hits: readonly { brandId: number }[]) => hits.map((h) => names.get(h.brandId))

  it('銘柄名に出る漢字をほぼ網羅する(読めない字は々と外字だけ)', () => {
    const missing = new Set<string>()
    for (const { name } of brands) {
      for (const char of name) {
        if (/\p{Script=Han}/u.test(char) && !readings.has(char)) missing.add(char)
      }
    }
    // `々` は繰り返し記号(index 側で解決)、`㐂`(喜) `髙`(高) は KANJIDIC の収録外
    expect([...missing].sort().join('')).toBe('々㐂髙')
  })

  it('`きど` で `紀土` に届く — 打って探す経路の穴が塞がっている', () => {
    expect(hitNames(real.search('きど'))).toContain('紀土')
  })

  it('実写真で読めたふりがな `みやいずみ` が `宮泉` に届き、他を連れてこない', () => {
    const hits = real.find('てのココ】にコ)o』大n登津{て=三:|。|みーー誠omみやいずみcりびね')
    expect(hitNames(hits)).toEqual(['宮泉'])
  })

  it('読みが一意でないときは畳まずに全部返し、先頭一致だけを別に取り出せる', () => {
    const hits = real.search('きど')
    // 先頭から `キド` と読める銘柄は5件ある(`酒`=き / `呑`=ど のような名乗りでも繋がる)。
    // **同名4件の `高砂` を畳まないのと同じ規律で丸めない** — 選ぶのは本人
    expect(hitNames(hits.filter((h) => h.isPrefix)).sort()).toEqual([
      '生道井',
      '祈水',
      '紀土',
      '酒呑童子',
      '酒道粋人',
    ])
    // 途中一致も落とさない。並び順で後ろに送るのは呼び出し側の仕事
    expect(hits.length).toBeGreaterThan(5)
    expect(hits.every((h) => h.reading === 'キド')).toBe(true)
  })
})
