// 枠の座標変換(純関数)の約束を固定する。canvas を使う `cropOcrImage` 本体は jsdom に
// デコーダが無いので実ブラウザ側の検証(Playwright)が担い、ここでは幾何だけを見る。

import { MIN_CROP_DISPLAY_PX, dragToFraction } from './cropImage.ts'

const BOX = { left: 100, top: 200, width: 200, height: 400 }

describe('ドラッグ → 範囲(比率)', () => {
  it('始点と終点から比率の枠を作る', () => {
    expect(dragToFraction(BOX, { x: 150, y: 300 }, { x: 250, y: 500 })).toEqual({
      x: 0.25,
      y: 0.25,
      w: 0.5,
      h: 0.5,
    })
  })

  it('右下から左上に引いても同じ枠になる(上下左右を問わない)', () => {
    const forward = dragToFraction(BOX, { x: 150, y: 300 }, { x: 250, y: 500 })
    const backward = dragToFraction(BOX, { x: 250, y: 500 }, { x: 150, y: 300 })
    expect(backward).toEqual(forward)
  })

  it('枠の外に出たポインタは縁に丸める(指はプレビューの外まで滑る)', () => {
    // 終点が右下の遥か外 → 右下の角まで
    expect(dragToFraction(BOX, { x: 150, y: 300 }, { x: 9999, y: 9999 })).toEqual({
      x: 0.25,
      y: 0.25,
      w: 0.75,
      h: 0.75,
    })
    // 始点も終点も左上の外 → 成立しない(0×0 に丸まる)
    expect(dragToFraction(BOX, { x: 0, y: 0 }, { x: 50, y: 100 })).toBeNull()
  })

  it('短辺が16px未満はタップであって範囲指定ではない', () => {
    expect(MIN_CROP_DISPLAY_PX).toBe(16)
    // 幅15px
    expect(dragToFraction(BOX, { x: 150, y: 300 }, { x: 165, y: 500 })).toBeNull()
    // ちょうど16pxは成立する
    expect(dragToFraction(BOX, { x: 150, y: 300 }, { x: 166, y: 500 })).not.toBeNull()
    // その場タップ
    expect(dragToFraction(BOX, { x: 150, y: 300 }, { x: 150, y: 300 })).toBeNull()
  })

  it('大きさの無い枠(getBoundingClientRect が0)では何も返さない', () => {
    // jsdom の getBoundingClientRect は全部0を返す。0除算の NaN を比率として返さない
    const zero = { left: 0, top: 0, width: 0, height: 0 }
    expect(dragToFraction(zero, { x: 0, y: 0 }, { x: 100, y: 100 })).toBeNull()
  })
})
