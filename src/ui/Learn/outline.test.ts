// 構成表の自己整合。**型で捕まらない壊れ方だけ**をここで見る。
//
// `LEARN_SUB_TITLES` は `Record<LearnSubId, string>` なので語の足し忘れはコンパイルエラーに
// なるが、**`LEARN_SECTIONS` のどれにも並べ忘れる**のは型では捕まらない。落ちるのは目次からで、
// 本文の見出しは出たままなので画面は正しく見える（「目次に無い節がある」= 構造化の目的が
// 静かに欠ける）。逆に2つの節に同じ小見出しを並べると DOM の id が重複し、
// 目次から送る先が1つ目に固定される。

import {
  LEARN_SECTIONS,
  LEARN_SUB_TITLES,
  sectionDomId,
  subDomId,
  type LearnSubId,
} from './outline.ts'

const listed = LEARN_SECTIONS.flatMap((section) => section.subs)

describe('「知る」の構成表', () => {
  it('小見出しはすべてどれか1つの節に並んでいる（目次から落ちない）', () => {
    const all = Object.keys(LEARN_SUB_TITLES) as LearnSubId[]

    expect([...listed].sort()).toEqual([...all].sort())
  })

  it('同じ小見出しを2つの節に並べない（DOM の id が重複する）', () => {
    expect(new Set(listed).size).toBe(listed.length)
  })

  // 接頭辞が節の id と揃っていれば、DOM の id (`learn-<subId>`) からどの節の語か分かる
  it('小見出しの id は属する節の id で始まる', () => {
    for (const section of LEARN_SECTIONS) {
      for (const sub of section.subs) {
        expect(sub.startsWith(`${section.id}-`)).toBe(true)
      }
    }
  })

  it('節と小見出しで DOM の id が衝突しない', () => {
    const ids = [
      ...LEARN_SECTIONS.map((section) => sectionDomId(section.id)),
      ...listed.map(subDomId),
    ]

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('節はすべて題と1行の説明を持つ（目次の行が空にならない）', () => {
    for (const section of LEARN_SECTIONS) {
      expect(section.title.length).toBeGreaterThan(0)
      expect(section.summary.length).toBeGreaterThan(0)
    }
  })
})
