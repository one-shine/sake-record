// 写真の一部(**人が囲んだ範囲**)を切り出して OCR に渡す層。
//
// ## なぜ要るか(2026-07-28 の実測 + 利用者の実機報告)
//
// tesseract のレイアウト解析は「画面いっぱいの文書」を前提にしていて、**瓶の全体が写る
// 写真からラベルの文字ブロックを見つけられない**。瓶全体の合成9枚では読めた字の到達が
// 4/9 に落ち、実機の写真(反射・暗さが加わる)では「全く読み取っていない」ように見える —
// 利用者の見立てどおり、**文字の場所を特定できていない**のが実態。
//
// 場所の特定を機械に推測させると「もっともらしい誤り」の供給源になるだけなので、
// **囲むのは人**にする(候補を確定しないのと同じ規律)。切り出しは範囲を変えるだけで、
// 縮小(2000px)や照合の判断は既存の経路がそのまま持つ — 切り出した Blob は
// `recognizeLabel` に渡り、そこで必要なら縮小される。
//
// ## 座標は「表示に対する比率」で受け取る
//
// UI が知っているのは**画面上のプレビューでの位置**で、ここが知っているのは**画像の実寸**。
// px で受け渡すとどちらの座標系か曖昧になる(実測でずれた画像が読めなくなる)ので、
// 0..1 の比率に正規化してから渡す。プレビューは EXIF の向きを反映して表示され、
// デコードも `decodeOcrImage` が同じ向きで返すので、比率は両者で一致する。

import { OCR_IMAGE_MIME, OCR_IMAGE_QUALITY, decodeOcrImage } from './prepareImage.ts'

/** 囲んだ範囲。**すべて 0..1 の比率**(表示サイズにも実寸にも依存しない) */
export interface CropFraction {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * ドラッグとして成立する最小の辺(表示px)。これ未満は「タップ」であって範囲指定ではない。
 * 誤タップのたびに 16px 四方の切れ端へ OCR が走るのを防ぐ。
 */
export const MIN_CROP_DISPLAY_PX = 16

/**
 * ドラッグの始点と終点を範囲(比率)に直す。**純関数**。
 *
 * - 始点と終点の上下左右は問わない(右下→左上に引いても同じ範囲)
 * - 枠の外に出たポインタは枠の縁に丸める(指はプレビューの外まで滑る)
 * - 短辺が `minPx` 未満なら `null`(範囲指定として成立していない)
 */
export function dragToFraction(
  box: { left: number; top: number; width: number; height: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
  minPx = MIN_CROP_DISPLAY_PX,
): CropFraction | null {
  if (!(box.width > 0) || !(box.height > 0)) return null
  const clampX = (value: number) => Math.min(Math.max(value, box.left), box.left + box.width)
  const clampY = (value: number) => Math.min(Math.max(value, box.top), box.top + box.height)
  const left = Math.min(clampX(start.x), clampX(end.x))
  const right = Math.max(clampX(start.x), clampX(end.x))
  const top = Math.min(clampY(start.y), clampY(end.y))
  const bottom = Math.max(clampY(start.y), clampY(end.y))
  if (right - left < minPx || bottom - top < minPx) return null
  return {
    x: (left - box.left) / box.width,
    y: (top - box.top) / box.height,
    w: (right - left) / box.width,
    h: (bottom - top) / box.height,
  }
}

async function paint(
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): Promise<Blob | null> {
  // `prepareImage.ts` の toBlob と似ているが、あちらは全面の縮小でこちらは部分の切り出し
  // (drawImage の9引数)。引数の形が違うので共有せず、デコードだけを共有している。
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(sw, sh)
    const ctx = canvas.getContext('2d')
    if (ctx === null) return null
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)
    return canvas.convertToBlob({ type: OCR_IMAGE_MIME, quality: OCR_IMAGE_QUALITY })
  }
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), OCR_IMAGE_MIME, OCR_IMAGE_QUALITY)
  })
}

/**
 * 範囲を実寸で切り出す。**原寸から切る**(縮小後から切ると、囲んだ字の解像度まで落ちる)。
 * 切り出し後の縮小(長辺2000px)は `recognizeLabel` → `prepareOcrImage` が既に持っているので
 * ここではやらない。
 *
 * 失敗(デコード不能・canvas 不在)は `null`。**元の全体画像に黙って落ちない** —
 * 囲んだのに全体が読まれると「枠が効いていない」ように見え、枠を直す手がかりが消える。
 */
export async function cropOcrImage(file: Blob, frac: CropFraction): Promise<Blob | null> {
  const decoded = await decodeOcrImage(file)
  if (decoded === null) return null
  try {
    const sx = Math.max(0, Math.floor(frac.x * decoded.width))
    const sy = Math.max(0, Math.floor(frac.y * decoded.height))
    const sw = Math.min(decoded.width - sx, Math.max(1, Math.round(frac.w * decoded.width)))
    const sh = Math.min(decoded.height - sy, Math.max(1, Math.round(frac.h * decoded.height)))
    if (sw < 1 || sh < 1) return null
    return await paint(decoded.source, sx, sy, sw, sh)
  } catch {
    return null
  } finally {
    decoded.close()
  }
}
