// @vitest-environment node
// domain 層のテストは jsdom を要求しない(CLAUDE.md の依存方向)。
//
// ここが守っているのは**出典に辿り着けること**。CC BY-SA 4.0 の表示義務は記事URLで、
// URL は記事名から導いている(別に持つとずれる)ので、**記事名の変換を外すと義務が壊れる**。
import { describe, expect, it } from 'vitest'
import { breweryArticleUrl, decodeBreweryArticles } from './breweryNote.ts'

const file = (rows: readonly (readonly [number, string, string])[]) => ({
  copyright: 'ウィキペディア日本語版 / CC BY-SA 4.0',
  rows,
})

describe('breweryArticleUrl', () => {
  it('記事名を ja.wikipedia の記事URLにする', () => {
    // 期待値はリテラルで書く(実装から組み立てると恒真になる。B15)
    expect(breweryArticleUrl('新政酒造')).toBe(
      'https://ja.wikipedia.org/wiki/%E6%96%B0%E6%94%BF%E9%85%92%E9%80%A0',
    )
  })

  it('空白は `_` にする(ja.wikipedia の正規形)', () => {
    expect(breweryArticleUrl('Foo Bar')).toBe('https://ja.wikipedia.org/wiki/Foo_Bar')
  })

  // 曖昧さ回避の括弧付き記事名(`獺祭 (企業)`)はこの経路を通る。潰すと記事に届かない
  it('括弧付きの記事名でも届く形にする', () => {
    expect(breweryArticleUrl('獺祭 (企業)')).toBe(
      'https://ja.wikipedia.org/wiki/%E7%8D%BA%E7%A5%AD_(%E4%BC%81%E6%A5%AD)',
    )
  })

  // `encodeURIComponent` だと `/` まで潰れて記事名に `/` を含む項目に届かなくなる
  it('記事名の `/` を潰さない', () => {
    expect(breweryArticleUrl('A/B')).toBe('https://ja.wikipedia.org/wiki/A/B')
  })

  it('`?` はクエリの開始と読まれるので逃がす', () => {
    expect(breweryArticleUrl('A?B')).toBe('https://ja.wikipedia.org/wiki/A%3FB')
  })
})

describe('decodeBreweryArticles', () => {
  it('蔵元IDで引ける形にし、URL を記事名から導く', () => {
    const articles = decodeBreweryArticles(file([[42, '新政酒造', '秋田県秋田市にある酒蔵。']]))

    expect(articles.get(42)).toEqual({
      breweryId: 42,
      title: '新政酒造',
      extract: '秋田県秋田市にある酒蔵。',
      url: 'https://ja.wikipedia.org/wiki/%E6%96%B0%E6%94%BF%E9%85%92%E9%80%A0',
    })
  })

  // **全件にフォールバックしない**(定義域外のキーで別の蔵の説明を出さない)
  it('知らない蔵元IDは undefined', () => {
    const articles = decodeBreweryArticles(file([[42, '新政酒造', '説明']]))
    expect(articles.get(43)).toBeUndefined()
  })

  it('行が1つも無ければ空(節が出ないだけ)', () => {
    expect(decodeBreweryArticles(file([])).size).toBe(0)
  })

  // **1行のために説明が全部消えない。** 壊れた行だけ落として残りを通す
  describe('壊れた行は落として残りを通す', () => {
    it('蔵元IDが正の整数でない行を落とす', () => {
      const articles = decodeBreweryArticles(
        file([
          [0, 'ゼロ', '説明'],
          [-1, 'マイナス', '説明'],
          [1.5, '小数', '説明'],
          [7, '正しい', '説明'],
        ]),
      )
      expect([...articles.keys()]).toEqual([7])
    })

    it('記事名が空の行を落とす(出典に辿り着けない = 表示義務を満たせない)', () => {
      const articles = decodeBreweryArticles(
        file([
          [1, '', '説明'],
          [2, 'ある', '説明'],
        ]),
      )
      expect([...articles.keys()]).toEqual([2])
    })

    it('書き出しが空の行を落とす(見出しだけの節を作らない)', () => {
      const articles = decodeBreweryArticles(
        file([
          [1, '記事', ''],
          [2, '記事', '説明'],
        ]),
      )
      expect([...articles.keys()]).toEqual([2])
    })
  })

  // 内容の妥当性(その蔵の記事か)はここで見ない。人が確定した表の役目で、
  // 二重に実装すると必ずずれる
  it('中身の妥当性は判定しない(門は人が確定した表の側にある)', () => {
    const articles = decodeBreweryArticles(
      file([[1, '獺祭魚', 'カワウソが捕らえた魚を並べることを指す語。']]),
    )
    expect(articles.get(1)?.title).toBe('獺祭魚')
  })
})
