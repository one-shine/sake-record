// @vitest-environment node
// 局所適応二値化(純関数)の約束を固定する。
//
// **利用者の指摘「読めた文字数とラベルの文字数が違う」への手当て。** 実機の写真では
// ラベルに20〜30字しか無いのに読み取りが200字を超え、中身は `ー` と `ニ二三` だらけだった
// = 紙の**横リブを長音符として読んでいた**。大域の二値化(tesseract 自前)では消えない。

import {
  BINARIZE_BIAS,
  BINARIZE_MIN_DELTA,
  BINARIZE_MIN_MIDTONE,
  BINARIZE_MIN_RADIUS,
  BINARIZE_RADIUS_DIVISOR,
  binarizeAdaptive,
  midtoneRatio,
  needsBinarize,
} from './binarize.ts'

const W = 96
const H = 96

function blank(value = 200): Uint8Array {
  return new Uint8Array(W * H).fill(value)
}

/**
 * 中央に 6×6 のインク(暗い)を置く。**窓(半径8 = 17×17)より小さくする**のが要点 —
 * 窓より大きい塗りつぶしは局所平均が塗りつぶし自身になるので中まで黒くならない
 * (適応二値化の性質。文字の線幅を想定した半径なので実写では起きない)。
 */
function withInk(gray: Uint8Array, value = 40): Uint8Array {
  for (let y = 45; y < 51; y++) {
    for (let x = 45; x < 51; x++) gray[y * W + x] = value
  }
  return gray
}

describe('局所適応二値化', () => {
  it('周囲より暗い塊だけを黒にする', () => {
    const out = binarizeAdaptive(withInk(blank()), W, H)
    // 中央はインク
    expect(out[47 * W + 47]).toBe(0)
    // 隅は地
    expect(out[2 * W + 2]).toBe(255)
  })

  it('一面の紙(平坦)は1画素も黒くしない', () => {
    for (const level of [0, 128, 200, 255]) {
      const out = binarizeAdaptive(blank(level), W, H)
      expect([...out].every((v) => v === 255), String(level)).toBe(true)
    }
  })

  // **これが実機の症状そのもの。** 横リブは周囲と同じ明るさなので、局所平均で見れば消える。
  // 大域の閾値だと明暗の半分が黒くなり、`ー` の羅列として読まれる。
  it('紙の横リブ(周期的な濃淡)を落とし、その上のインクは残す', () => {
    const ribbed = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) {
      // 紙のリブは局所平均に対して十数階調の濃淡。`BINARIZE_MIN_DELTA`(24)の許容内
      for (let x = 0; x < W; x++) ribbed[y * W + x] = y % 3 === 0 ? 196 : 210
    }
    const ribsOnly = binarizeAdaptive(ribbed, W, H)
    // リブだけの紙は真っ白(1画素も文字にしない)
    expect([...ribsOnly].filter((v) => v === 0)).toHaveLength(0)

    // 同じ紙にインクを載せればインクは残る
    const inked = binarizeAdaptive(withInk(ribbed), W, H)
    expect(inked[47 * W + 47]).toBe(0)
    expect(inked[2 * W + 2]).toBe(255)
  })

  // **ぼけた写真で地が真っ黒になった原因。** 暗い場所では「平均の85%」が平均のすぐ下に
  // 来るので、比だけだとわずかな揺らぎがインクになる(実測でインク率 21.7% = 紙が真っ黒)。
  it('暗い場所のわずかな揺らぎをインクにしない(比だけでは通ってしまう)', () => {
    // 局所平均が100になる揺らぎ。比の閾値は 100×0.85 = 85 なので **80 は比だけなら通る**。
    // 絶対差の閾値は 100−24 = 76 なので、こちらが止める
    const dim = new Uint8Array(W * H)
    for (let at = 0; at < dim.length; at++) dim[at] = at % 2 === 0 ? 80 : 120
    expect([...binarizeAdaptive(dim, W, H)].filter((v) => v === 0)).toHaveLength(0)

    // 同じ場所でも、平均から24階調以上暗い画素はインクとして残す
    const withDark = dim.slice()
    for (let y = 45; y < 51; y++) {
      for (let x = 45; x < 51; x++) withDark[y * W + x] = 20
    }
    expect(binarizeAdaptive(withDark, W, H)[47 * W + 47]).toBe(0)
  })

  // 瓶は丸いので片側が暗くなる。大域の閾値だと暗い側の文字が地ごと黒く潰れる
  it('照明のむら(片側が暗い)があっても、暗い側の地を黒くしない', () => {
    const shaded = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) shaded[y * W + x] = 60 + Math.round((x / W) * 180)
    }
    const out = binarizeAdaptive(shaded, W, H)
    // 暗い側も明るい側も地のまま(勾配は局所平均に吸収される)。
    // **大域の閾値なら暗い側が丸ごと黒くなる** = そこの文字が地に沈む
    expect(out[48 * W + 20]).toBe(255)
    expect(out[48 * W + (W - 20)]).toBe(255)
    // 同じ勾配の上に置いたインクは、暗い側でも拾える
    const inkedDark = shaded.slice()
    for (let y = 45; y < 51; y++) {
      for (let x = 15; x < 21; x++) inkedDark[y * W + x] = 30
    }
    expect(binarizeAdaptive(inkedDark, W, H)[47 * W + 17]).toBe(0)
  })

  it('大きさの無い画像でも例外を出さない', () => {
    expect(binarizeAdaptive(new Uint8Array(0), 0, 0)).toHaveLength(0)
    expect(binarizeAdaptive(new Uint8Array(1), 1, 1)).toHaveLength(1)
  })

  it('調整済みの定数(変えるときは実ラベルで測り直す)', () => {
    expect(BINARIZE_BIAS).toBe(0.85)
    expect(BINARIZE_MIN_DELTA).toBe(24)
    expect(BINARIZE_RADIUS_DIVISOR).toBe(24)
    expect(BINARIZE_MIN_RADIUS).toBe(8)
  })
})

describe('二値化が要る画像かどうか', () => {
  it('既に白黒に近い画像には掛けない', () => {
    // 白地に黒の印刷。中間調はほぼ無い(実測: 合成の綺麗なラベル9枚で 0.2〜0.4%)
    const printed = new Uint8Array(W * H).fill(255)
    for (let y = 20; y < 40; y++) {
      for (let x = 20; x < 40; x++) printed[y * W + x] = 0
    }
    expect(midtoneRatio(printed)).toBe(0)
    expect(needsBinarize(printed)).toBe(false)
  })

  it('紙や瓶が写った写真には掛ける', () => {
    // 中間調だらけ(実測: 瓶が写るシーン 17.3% / 写真ふう 67.3% / 実機 63.1〜66.2%)
    const photo = new Uint8Array(W * H)
    for (let at = 0; at < photo.length; at++) photo[at] = 100 + (at % 60)
    expect(midtoneRatio(photo)).toBe(1)
    expect(needsBinarize(photo)).toBe(true)
  })

  it('境は5%(実測の谷。両側が2桁離れている)', () => {
    expect(BINARIZE_MIN_MIDTONE).toBe(0.05)
    const make = (midtones: number) => {
      const gray = new Uint8Array(1000).fill(255)
      for (let at = 0; at < midtones; at++) gray[at] = 128
      return gray
    }
    expect(needsBinarize(make(49))).toBe(false)
    expect(needsBinarize(make(50))).toBe(true)
  })

  it('空の画像は掛けない(0除算しない)', () => {
    expect(midtoneRatio(new Uint8Array(0))).toBe(0)
    expect(needsBinarize(new Uint8Array(0))).toBe(false)
  })
})
