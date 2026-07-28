// OCR に渡す前の縮小。**純関数と「失敗しても元を返す」性質**だけを見る
// （canvas とデコードの実物は jsdom に無いので、往復は実ブラウザ計測が担う）。

import {
  OCR_IMAGE_MIME,
  OCR_IMAGE_QUALITY,
  OCR_MAX_EDGE,
  needsOcrResize,
  prepareOcrImage,
} from './prepareImage.ts'

describe('OCR に渡す画像の縮小', () => {
  // ★ この値は実測で決めた（4000px のまま = 3/9 / 2000px = 6/9 / 1600・2400px = 5/9）。
  // 「大きいほど良い」で戻されるのを止める
  it('長辺は 2000px（サムネイルの 400px とは別物）', () => {
    expect(OCR_MAX_EDGE).toBe(2000)
  })

  it('文字の輪郭を潰さない品質で書き出す', () => {
    expect(OCR_IMAGE_MIME).toBe('image/jpeg')
    expect(OCR_IMAGE_QUALITY).toBeGreaterThanOrEqual(0.9)
  })

  it.each([
    [4000, 3000, true],
    [3000, 4000, true],
    [2001, 100, true],
    [2000, 2000, false],
    [1200, 1600, false],
  ])('%s×%s は縮小が要るか → %s', (width, height, expected) => {
    expect(needsOcrResize(width, height)).toBe(expected)
  })

  // ★ 縮小は前処理でしかない。デコードできない環境やファイルでも**元の画像で OCR を試す**
  // （ここで投げると「写真は選べたのに OCR だけ動かない」状態になる）
  it('デコードできなければ元のファイルをそのまま返す（投げない）', async () => {
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })

    const prepared = await prepareOcrImage(file)

    expect(prepared.blob).toBe(file)
    expect(prepared.resized).toBe(false)
  })
})
