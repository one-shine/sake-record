// OCR にかける前に画像を**縮小**する層。
//
// ## なぜ原寸を渡さないのか（2026-07-28 の実測で方針を変えた）
//
// もとは「原寸の元ファイルを渡す（長辺400pxのサムネイルでは解像度が足りない）」だった。
// サムネイルを使わない、という判断は**いまも正しい**が、**原寸のまま渡すのは逆に悪い**ことが
// 実測で分かった。スマホの写真は長辺4000px前後あり、tesseract のレイアウト解析はそこまで
// 大きい画像で崩れる（銘柄の字が読めなくなる）。しかも遅い。
//
//   合成した写真ふうのラベル9枚（縦書き・背景あり・傾き・ぼけ・JPEG劣化）で計測:
//     長辺4000px のまま … 銘柄の字が門を通ったのは **3/9**、3パス合計 3,934ms
//     長辺2000px に縮小 … **6/9**、3パス合計 **1,134ms**
//     長辺1600 / 2400px … どちらも 5/9（2000 が最も良かった）
//
// → **長辺 2000px に縮めてから渡す**。サムネイル（長辺400px / 50KB以下）とは別物で、
// あちらの仕様は変えない（保存されるのはサムネイルだけ / これは OCR に渡すためだけの一時画像）。
//
// ## 失敗しても OCR を止めない
//
// 縮小はあくまで前処理なので、デコードや canvas に失敗したら**元のファイルをそのまま返す**。
// ここで投げると「写真は選べたのに OCR だけ動かない」状態を作ることになり、
// 元の画像で読める可能性まで捨ててしまう。

import { computeTargetSize } from '../image/resize.ts'

/**
 * OCR に渡す画像の長辺。**実測で決めた値**（上のコメント）。
 * 変えるときは同じ手順で測り直す — 大きいほど良いわけではない。
 */
export const OCR_MAX_EDGE = 2000

/** 書き出す形式。文字の輪郭を潰さないために品質は高めに取る */
export const OCR_IMAGE_MIME = 'image/jpeg'
export const OCR_IMAGE_QUALITY = 0.92

/** 縮小したかどうかを呼び出し側（計測とテスト）に見せる */
export interface PreparedOcrImage {
  readonly blob: Blob
  readonly resized: boolean
  readonly width: number | null
  readonly height: number | null
}

/** 縮小が要るか。**元が小さければ何もしない**（拡大はしない） */
export function needsOcrResize(width: number, height: number, maxEdge = OCR_MAX_EDGE): boolean {
  return Math.max(width, height) > maxEdge
}

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void }

async function decode(file: Blob): Promise<Decoded | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      // EXIF の向きを反映させる（横倒しのまま渡すと縦書きの行が横に見える）
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => {
          bitmap.close()
        },
      }
    } catch {
      /* 次の経路へ */
    }
  }
  if (typeof Image !== 'function' || typeof URL?.createObjectURL !== 'function') return null
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => {
        URL.revokeObjectURL(url)
      },
    }
  } catch {
    URL.revokeObjectURL(url)
    return null
  }
}

async function toBlob(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (ctx === null) return null
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, width, height)
    return canvas.convertToBlob({ type: OCR_IMAGE_MIME, quality: OCR_IMAGE_QUALITY })
  }
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), OCR_IMAGE_MIME, OCR_IMAGE_QUALITY)
  })
}

/**
 * OCR に渡す画像を作る。**縮小できなければ元のファイルをそのまま返す**（例外を投げない）。
 * 呼び出し側は `resized` を見て計測に使えるが、分岐する必要は無い。
 */
export async function prepareOcrImage(file: Blob, maxEdge = OCR_MAX_EDGE): Promise<PreparedOcrImage> {
  const decoded = await decode(file)
  if (decoded === null) return { blob: file, resized: false, width: null, height: null }

  try {
    if (!needsOcrResize(decoded.width, decoded.height, maxEdge)) {
      return { blob: file, resized: false, width: decoded.width, height: decoded.height }
    }
    const size = computeTargetSize(decoded.width, decoded.height, maxEdge)
    const blob = await toBlob(decoded.source, size.width, size.height)
    if (blob === null) return { blob: file, resized: false, width: decoded.width, height: decoded.height }
    return { blob, resized: true, width: size.width, height: size.height }
  } catch {
    return { blob: file, resized: false, width: decoded.width, height: decoded.height }
  } finally {
    decoded.close()
  }
}
