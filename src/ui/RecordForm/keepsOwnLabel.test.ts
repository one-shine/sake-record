// 打った文字を残すか、銘柄名で置き換えるか。
//
// **この表が規則の意味そのもの。** 台帳から取り込んだ `寫楽` `会津宮泉` `日高見(平孝酒造)` は
// 本人が書いた表記なので残し、`きど` `ほまれきりん` `KID` は銘柄を探すために打った検索語なので
// 置き換える。実データに出てくる表記だけを並べる(日付は書かない = `ledger:check`)。
//
// 画面での配線(候補を押すと入力欄が実際に変わる)は `RecordForm.test.tsx` の担当。

import { describe, expect, it } from 'vitest'
import { keepsOwnLabel } from './keepsOwnLabel.ts'

describe('keepsOwnLabel', () => {
  it.each([
    ['寫楽', '冩楽', '異体字。正規化すると一致する'],
    ['会津宮泉', '宮泉', '前に字が付いた本人の表記'],
    ['九平次', '醸し人九平次', '銘柄名の一部だけを打った'],
    ['髙砂', '高砂', '異体字'],
    ['日高見(平孝酒造)', '日高見', '括弧内は正規化で落ちる'],
  ])('残す: %s → %s (%s)', (label, brandName) => {
    expect(keepsOwnLabel(label, brandName)).toBe(true)
  })

  it.each([
    ['きど', '紀土', 'かなで探した(B68)。字が1つも重ならない'],
    ['ほまれきりん', 'ほまれ麒麟', 'かな混じりで探した'],
    ['KID', '紀土', 'ローマ字で探した'],
    ['', 'カクウ', '空欄から選んだ'],
  ])('置き換える: %s → %s (%s)', (label, brandName) => {
    expect(keepsOwnLabel(label, brandName)).toBe(false)
  })

  // 銘柄名が空になることは実データでは無いが、境界として固定しておく
  it('銘柄名が空なら残さない(置き換える側に倒す)', () => {
    expect(keepsOwnLabel('きど', '')).toBe(false)
  })
})
