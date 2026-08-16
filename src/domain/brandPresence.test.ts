// @vitest-environment node
// domain 層のテストは jsdom を要求しない(CLAUDE.md の依存方向)。
//
// **ここが守っているのは「打てる手が違うものを同じ状態にしない」(B31)。**
// 上流から消えた銘柄と、上流にチャートが無いだけの銘柄は、画面で言うべきことが違う。
import { describe, expect, it } from 'vitest'
import { brandPresence } from './brandPresence.ts'

/** 上流のマスタに在る銘柄IDの集合(合成) */
const master = new Set([1, 2, 3])
const has = (id: number) => master.has(id)

describe('brandPresence', () => {
  it('紐付いていて上流にも在るなら present', () => {
    expect(brandPresence({ sakenowaBrandId: 2 }, has)).toBe('present')
  })

  // **ここが本題。** 以前は `sakenowaBrandId !== null` だけを見ていたので、
  // 消えた銘柄にも「紐付け自体は済んでいる」と言い続けていた
  it('紐付いているが上流に無いなら gone', () => {
    expect(brandPresence({ sakenowaBrandId: 999999 }, has)).toBe('gone')
  })

  it('紐付いていなければ none', () => {
    expect(brandPresence({ sakenowaBrandId: null }, has)).toBe('none')
  })

  // **由来と直交する。** 手動で紐付けた銘柄も機械が当てた銘柄も同じように消えうるので、
  // `linkStatus` は判定に一切参加しない(引数にも取らない)
  it('判定に linkStatus を使わない(由来と直交する軸)', () => {
    expect(brandPresence({ sakenowaBrandId: 1 }, has)).toBe('present')
    expect(brandPresence({ sakenowaBrandId: 4 }, has)).toBe('gone')
  })

  // マスタが1件も読めていない状態で `present` を返すと、引けない銘柄に
  // 「紐付けは済んでいる」と言うことになる
  it('マスタが空なら紐付け済みの記録は gone(在ることにしない)', () => {
    expect(brandPresence({ sakenowaBrandId: 1 }, () => false)).toBe('gone')
  })
})
