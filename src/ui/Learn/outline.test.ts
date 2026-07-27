// 構成表の自己整合。**型で捕まらない壊れ方だけ**をここで見る。
//
// `LEARN_SUB_TITLES` は `Record<LearnSubId, string>` なので語の足し忘れはコンパイルエラーに
// なるが、**`LEARN_PANELS` のどれにも並べ忘れる**のは型では捕まらない。本文には出るのに
// タブの説明から落ちるだけなので、画面は正しく見える。逆に2つのタブに同じ小見出しを並べると
// DOM の id が重複する。

import {
  LEARN_DEFAULT_PANEL,
  LEARN_PANELS,
  LEARN_SUB_TITLES,
  panelDomId,
  subDomId,
  tabDomId,
  type LearnSubId,
} from './outline.ts'

const listed = LEARN_PANELS.flatMap((panel) => panel.subs)

describe('「知る」の構成表', () => {
  it('小見出しはすべてどれか1つのタブに並んでいる', () => {
    const all = Object.keys(LEARN_SUB_TITLES) as LearnSubId[]

    expect([...listed].sort()).toEqual([...all].sort())
  })

  it('同じ小見出しを2つのタブに並べない（DOM の id が重複する）', () => {
    expect(new Set(listed).size).toBe(listed.length)
  })

  // 接頭辞がタブの id と揃っていれば、DOM の id (`learn-<subId>`) からどのタブの語か分かる
  it('小見出しの id は属するタブの id で始まる', () => {
    for (const panel of LEARN_PANELS) {
      for (const sub of panel.subs) {
        expect(sub.startsWith(`${panel.id}-`)).toBe(true)
      }
    }
  })

  it('タブ・パネル・小見出しで DOM の id が衝突しない', () => {
    const ids = [
      ...LEARN_PANELS.map((panel) => panelDomId(panel.id)),
      ...LEARN_PANELS.map((panel) => tabDomId(panel.id)),
      ...listed.map(subDomId),
    ]

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('タブはすべて短いラベル・題・1行の説明を持つ', () => {
    for (const panel of LEARN_PANELS) {
      // タブ帯は grid-cols-6。390px では1つ 65px なので、ラベルは3文字までに収める
      expect(panel.tab.length).toBeGreaterThan(0)
      expect(panel.tab.length).toBeLessThanOrEqual(3)
      expect(panel.title.length).toBeGreaterThan(0)
      expect(panel.summary.length).toBeGreaterThan(0)
    }
  })

  // タブ帯は `grid-cols-6` のリテラル。数が変わったらクラスも直す必要がある
  // （文字列連結で作ると本番の CSS に規則が生成されず、タブが2段に折り返す）
  it('タブは6つ（`grid-cols-6` のリテラルと対）', () => {
    expect(LEARN_PANELS).toHaveLength(6)
  })

  it('既定で開くタブは表に在る', () => {
    expect(LEARN_PANELS.some((panel) => panel.id === LEARN_DEFAULT_PANEL)).toBe(true)
  })
})
