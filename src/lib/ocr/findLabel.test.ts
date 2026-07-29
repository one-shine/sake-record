// ラベル位置の自動検出(純関数部)の約束を固定する。canvas を使う `detectLabelRegion` は
// jsdom にデコーダが無いので実ブラウザ側の検証が担い、ここでは配列 → 枠 の幾何だけを見る。
//
// 検出しているのは「**強い縁を持つ画素の割合**が高いセルの最大連結成分」= 文字らしい領域。
// 明るさではないので、黒地に白文字のラベルも同じ式で見つかる。

import {
  DETECT_CELL,
  DETECT_EDGE,
  DETECT_MAX_AREA,
  DETECT_MIN_CELLS,
  DETECT_MIN_PEAK,
  cellTextScore,
  findTextRegion,
} from './findLabel.ts'

/** 128×128(16×16セル)の平坦な画像 */
function flat(value = 128): Uint8Array {
  return new Uint8Array(128 * 128).fill(value)
}

/** [x0,x1)×[y0,y1) を1pxごとの縞にする(全画素が勾配を持つ = 文字の近似) */
function paintStripes(gray: Uint8Array, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) gray[y * 128 + x] = x % 2 === 0 ? 0 : 255
  }
  return gray
}

// **利用者の実機写真で検出が外した原因がここにある。** 石の天板は弱い勾配が一面にあるので
// 「平均勾配」では文字より濃く見え、検出が天板を掴んでラベルを完全に外していた。
// セル単位の採点を直に比べて、その数値関係を固定する。
describe('セルの文字らしさ', () => {
  /** 細かい質感: 市松(縦横とも差24 = 1画素あたり48)。**強い縁は1本も無いが平均は48** */
  function texture(): Uint8Array {
    const gray = flat(128)
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) gray[y * 128 + x] = (x + y) % 2 === 0 ? 128 : 152
    }
    return gray
  }

  /** 文字: 8px おきの明暗の境目。8画素に1つだけ 255 = **平均は32で質感より低い** */
  function strokes(): Uint8Array {
    const gray = flat(128)
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) gray[y * 128 + x] = Math.floor(x / 8) % 2 === 0 ? 0 : 255
    }
    return gray
  }

  it('平均勾配が低くても、強い縁を持つほうを高く採点する', () => {
    const textureScore = cellTextScore(texture(), 128, 128, 40, 40)
    const strokeScore = cellTextScore(strokes(), 128, 128, 40, 40)
    // 質感は平均48・強い縁0本 / 文字は平均32・強い縁12.5%。**平均で採ると逆転する**
    expect(textureScore).toBe(0)
    expect(strokeScore).toBeCloseTo(12.5, 1)
    expect(strokeScore).toBeGreaterThan(textureScore)
  })

  it('一様なセルは0', () => {
    expect(cellTextScore(flat(200), 128, 128, 40, 40)).toBe(0)
  })
})

describe('文字らしい領域の検出', () => {
  it('文字のある塊を、1セルの余白付きで囲む', () => {
    // セル5..9(px 40..80)に縞。余白1セルなので px 32..88 = 0.25..0.6875
    const region = findTextRegion(paintStripes(flat(), 40, 40, 80, 80), 128, 128)
    expect(region).toEqual({ x: 0.25, y: 0.25, w: 0.4375, h: 0.4375 })
  })

  it('一様な画像(勾配が無い)は null = 全体を読む', () => {
    expect(findTextRegion(flat(0), 128, 128)).toBeNull()
    expect(findTextRegion(flat(255), 128, 128)).toBeNull()
  })

  it('弱い縁だけの画像は null(ノイズの相対比較で枠を作らない)', () => {
    // 差2の縞 = `DETECT_EDGE`(50) を1画素も超えない。門が無いと「最大に対する比」だけで
    // ノイズが枠に化ける(ぼけた写真で起きる)
    const gray = flat()
    for (let y = 40; y < 80; y++) {
      for (let x = 40; x < 80; x++) gray[y * 128 + x] = x % 2 === 0 ? 128 : 130
    }
    expect(findTextRegion(gray, 128, 128)).toBeNull()
  })

  it('小さすぎる塊はノイズとして無視する(瓶の縁の切れ端)', () => {
    // 2×1セルの縞(min 4 未満)
    expect(findTextRegion(paintStripes(flat(), 40, 40, 56, 48), 128, 128)).toBeNull()
  })

  it('離れた塊があるときは大きい方を囲む(裏ラベルの断片より銘柄の塊)', () => {
    const gray = paintStripes(paintStripes(flat(), 16, 16, 56, 56), 96, 96, 120, 120)
    const region = findTextRegion(gray, 128, 128)
    expect(region).not.toBeNull()
    // 大きい方(16..56)を囲み、小さい方(96..120)は入れない
    expect(region!.x + region!.w).toBeLessThan(0.75)
  })

  it('セルより小さい画像は null(解析できる粗さが無い)', () => {
    expect(findTextRegion(new Uint8Array(8 * 8).fill(0), 8, 8)).toBeNull()
  })

  it('調整済みの定数(変えるときは gray.json の走査で測り直す)', () => {
    expect(DETECT_CELL).toBe(8)
    expect(DETECT_MIN_CELLS).toBe(4)
    expect(DETECT_EDGE).toBe(50)
    expect(DETECT_MIN_PEAK).toBe(2)
    expect(DETECT_MAX_AREA).toBe(0.8)
  })
})
