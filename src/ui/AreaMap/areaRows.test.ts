// 産地マップの土台になる純関数のテスト。**合成データだけ**を使う(実台帳の値は書かない)。
// 都道府県名と本数は台帳ではないので、県コードの対応と段の境界はここで固定する。

import { codeFromRomaji } from '../../domain/prefecture.ts'
import type { PrefectureCount } from '../../domain/stats.ts'
import {
  JAPAN_LOCATIONS,
  JAPAN_VIEW_BOX,
  PREFECTURE_TOTAL,
  buildMapShapes,
  buildPrefectureRows,
  countPrefecturesByStep,
} from './areaRows.ts'
import { FILL_STEPS, fillStepIndex } from './fillSteps.ts'

describe('@svg-maps/japan の location', () => {
  it('47件あり、viewBox をパッケージから受け取る', () => {
    expect(JAPAN_LOCATIONS).toHaveLength(47)
    expect(JAPAN_VIEW_BOX).toBe('0 0 438 516')
    expect(PREFECTURE_TOTAL).toBe(47)
  })

  // 地図の id は romaji で、JIS 順でも日本語名でもない。**47件すべてが県コードに解決する**ことを
  // ここで固定する。解決できない id が出ると画面はその形を色無しで残して警告を出すが、
  // それは事故の表示であって正常系ではない(パッケージ更新でここが落ちるのが正しい)。
  it('47件すべてが JIS コードに解決し、1..47 の全単射になる', () => {
    const codes = JAPAN_LOCATIONS.map((location) => codeFromRomaji(location.id))
    const unresolved = JAPAN_LOCATIONS.filter((location) => codeFromRomaji(location.id) === null)

    expect(unresolved.map((location) => location.id)).toEqual([])
    expect(new Set(codes).size).toBe(47)
    expect([...codes].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
      Array.from({ length: 47 }, (_unused, index) => index + 1),
    )
  })

  it('path を全件持つ(空の d で描かれる形が無い)', () => {
    for (const location of JAPAN_LOCATIONS) {
      expect(location.path.length).toBeGreaterThan(0)
    }
  })
})

describe('buildMapShapes', () => {
  it('実データの47件では解決できない id が無く、形も47件返る', () => {
    const { shapes, unresolvedIds } = buildMapShapes(JAPAN_LOCATIONS, new Map())
    expect(shapes).toHaveLength(47)
    expect(unresolvedIds).toEqual([])
  })

  // 定義域外のキーを「全件」や既定の県に落とさない(絶対ルール2)かつ**黙って飛ばさない**。
  it('県コードに解決できない location を飛ばさず、id を unresolvedIds に出す', () => {
    const { shapes, unresolvedIds } = buildMapShapes(
      [
        { id: 'atlantis', name: 'Atlantis', path: 'M0 0 L1 1 Z' },
        { id: 'akita', name: 'Akita', path: 'M2 2 L3 3 Z' },
      ],
      new Map([[5, 3]]),
    )

    expect(unresolvedIds).toEqual(['atlantis'])
    // 形は落とさない。**本数は null**(0本 = 未進出 と混ぜない)
    expect(shapes).toHaveLength(2)
    expect(shapes[0]).toEqual({
      id: 'atlantis',
      code: null,
      name: null,
      path: 'M0 0 L1 1 Z',
      count: null,
      step: null,
    })
    expect(shapes[1]).toEqual({
      id: 'akita',
      code: 5,
      name: '秋田県',
      path: 'M2 2 L3 3 Z',
      count: 3,
      step: 2,
    })
  })

  it('キーの無い県は 0本・未進出の段になる(全件へフォールバックしない)', () => {
    const { shapes } = buildMapShapes(JAPAN_LOCATIONS, new Map([[1, 14]]))
    const hokkaido = shapes.find((shape) => shape.id === 'hokkaido')
    const okinawa = shapes.find((shape) => shape.id === 'okinawa')

    expect(hokkaido).toMatchObject({ code: 1, count: 14, step: 4 })
    expect(okinawa).toMatchObject({ code: 47, count: 0, step: 0 })
    // 0本の県が未進出の段に入るのは1県だけではない(46県すべて)
    expect(shapes.filter((shape) => shape.step === 0)).toHaveLength(46)
  })

  it('入力の並びを変えない(描画順はパッケージの並びのまま)', () => {
    const { shapes } = buildMapShapes(JAPAN_LOCATIONS, new Map())
    expect(shapes.map((shape) => shape.id)).toEqual(JAPAN_LOCATIONS.map((location) => location.id))
  })
})

describe('fillStepIndex / FILL_STEPS', () => {
  it('段の境界に穴も重なりも無い', () => {
    expect(FILL_STEPS[0].min).toBe(0)
    expect(FILL_STEPS[0].max).toBe(0)
    expect(FILL_STEPS[FILL_STEPS.length - 1].max).toBeNull()
    for (let index = 1; index < FILL_STEPS.length; index += 1) {
      const previousMax = FILL_STEPS[index - 1].max
      expect(previousMax).not.toBeNull()
      expect(FILL_STEPS[index].min).toBe((previousMax ?? 0) + 1)
    }
  })

  it('段ごとに違う色を持つ(同じ塗りの段が2つあると凡例が読めない)', () => {
    expect(new Set(FILL_STEPS.map((step) => step.fill)).size).toBe(FILL_STEPS.length)
    expect(new Set(FILL_STEPS.map((step) => step.swatch)).size).toBe(FILL_STEPS.length)
  })

  it('0本だけが未進出の段に入る', () => {
    expect(fillStepIndex(0)).toBe(0)
    expect(fillStepIndex(1)).toBe(1)
  })

  it('段の中と端が定義どおりに落ちる', () => {
    expect([2, 3, 5, 6, 10, 11, 22, 400].map(fillStepIndex)).toEqual([1, 2, 2, 3, 3, 4, 4, 4])
  })

  it('負・NaN は未進出として扱う(段の外に落として例外にしない)', () => {
    expect(fillStepIndex(-1)).toBe(0)
    expect(fillStepIndex(Number.NaN)).toBe(0)
  })
})

describe('buildPrefectureRows', () => {
  const counts: ReadonlyMap<number, number> = new Map([
    [1, 14],
    [5, 8],
    [24, 4],
    [37, 1],
  ])

  it('本数0の県も含めて常に47行返す', () => {
    expect(buildPrefectureRows(counts, 'count')).toHaveLength(47)
    expect(buildPrefectureRows(new Map(), 'jis')).toHaveLength(47)
  })

  it('jis 順は北から南(コード昇順)', () => {
    const rows = buildPrefectureRows(counts, 'jis')
    expect(rows.map((row) => row.code)).toEqual(Array.from({ length: 47 }, (_u, i) => i + 1))
    expect(rows[0].name).toBe('北海道')
    expect(rows[46].name).toBe('沖縄県')
  })

  it('count 順は本数降順 → コード昇順で、0本は末尾に集まる', () => {
    const rows = buildPrefectureRows(counts, 'count')
    expect(rows.slice(0, 4).map((row) => [row.name, row.count])).toEqual([
      ['北海道', 14],
      ['秋田県', 8],
      ['三重県', 4],
      ['香川県', 1],
    ])
    expect(rows.slice(4).every((row) => row.count === 0)).toBe(true)
    // 同数(0本)の並びはコード昇順で決まる = 記録を1件足しても行が入れ替わらない
    const tailCodes = rows.slice(4).map((row) => row.code)
    expect(tailCodes).toEqual([...tailCodes].sort((a, b) => a - b))
  })

  it('段は本数から引く(未進出は0段目)', () => {
    const rows = buildPrefectureRows(counts, 'jis')
    expect(rows[0].step).toBe(4)
    expect(rows[4].step).toBe(3)
    expect(rows[1].step).toBe(0)
  })
})

describe('countPrefecturesByStep', () => {
  it('未進出の県数は 47 - 出現した県数で出す', () => {
    const prefectures: readonly PrefectureCount[] = [
      { code: 1, name: '北海道', count: 14 },
      { code: 5, name: '秋田県', count: 8 },
      { code: 24, name: '三重県', count: 4 },
      { code: 37, name: '香川県', count: 1 },
    ]
    expect(countPrefecturesByStep(prefectures)).toEqual([43, 1, 1, 1, 1])
  })

  it('1県も出現していなければ47県すべてが未進出', () => {
    expect(countPrefecturesByStep([])).toEqual([47, 0, 0, 0, 0])
  })
})
