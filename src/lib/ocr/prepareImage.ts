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
// ## 縮小のあとに白黒へ落とす(2026-07-28(7))
//
// 利用者の指摘「読めた文字数とラベルの文字数が違う」が正しかった。実機の写真では
// ラベルに20〜30字しか無いのに読み取りが200字を超え、中身は `ー` と `ニ二三` だらけ =
// **紙の横リブを長音符として読んでいた**。tesseract 自前の大域二値化では質感も照明むらも
// 落とせないので、**局所適応二値化**(`binarize.ts`)を挟む。実測でこれだけが
// ふりがな「みやいずみ」を読ませた。
//
// ## 失敗しても OCR を止めない
//
// 縮小も二値化もあくまで前処理なので、デコードや canvas に失敗したら**元のファイルを
// そのまま返す**。ここで投げると「写真は選べたのに OCR だけ動かない」状態を作ることになり、
// 元の画像で読める可能性まで捨ててしまう。二値化だけが失敗したときは縮小済みの画像を返す。

import { computeTargetSize } from '../image/resize.ts'
import { binarizeAdaptive, needsBinarize } from './binarize.ts'

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

export type DecodedOcrImage = {
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}

/**
 * OCR 用のデコード。**EXIF の向きを反映した状態**で返す(横倒しのまま渡すと縦書きの行が
 * 横に見える)。`cropImage.ts`(切り出し)と共有するので export してある — 別々に書くと
 * 「縮小は向きを直すが切り出しは直さない」type の食い違いが生まれる。
 */
export async function decodeOcrImage(file: Blob): Promise<DecodedOcrImage | null> {
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

/**
 * 描いた画素を二値化して書き戻す。**掛けたら true**。
 * 既に白黒に近い画像には掛けない(掛けると読み取りが落ちる = `needsBinarize`)。
 */
function binarizeInPlace(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  width: number,
  height: number,
): boolean {
  const image = ctx.getImageData(0, 0, width, height)
  const px = image.data
  const gray = new Uint8Array(width * height)
  for (let at = 0, i = 0; at < gray.length; at++, i += 4) {
    gray[at] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000
  }
  if (!needsBinarize(gray)) return false
  const bits = binarizeAdaptive(gray, width, height)
  for (let at = 0, i = 0; at < bits.length; at++, i += 4) {
    px[i] = px[i + 1] = px[i + 2] = bits[at]
    px[i + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return true
}

function makeCanvas(width: number, height: number) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height)
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/**
 * 縮小と二値化を1枚の canvas で済ませる。**どちらも要らなければ null** を返し、
 * 呼び出し側は元のファイルをそのまま渡す — **要らない再エンコードをしない**
 * (JPEG を無意味に再圧縮すると、それだけで読み取りが落ちるのを実測した)。
 */
async function render(
  source: CanvasImageSource,
  width: number,
  height: number,
  resized: boolean,
): Promise<Blob | null> {
  const canvas = makeCanvas(width, height)
  if (canvas === null) return null
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null
  if (ctx === null) return null
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  let binarized = false
  try {
    binarized = binarizeInPlace(ctx, width, height)
  } catch {
    /* 二値化できなければ縮小だけで渡す */
  }
  if (!resized && !binarized) return null
  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: OCR_IMAGE_MIME, quality: OCR_IMAGE_QUALITY })
  }
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), OCR_IMAGE_MIME, OCR_IMAGE_QUALITY)
  })
}

/**
 * OCR に渡す画像を作る。**縮小できなければ元のファイルをそのまま返す**（例外を投げない）。
 * 呼び出し側は `resized` を見て計測に使えるが、分岐する必要は無い。
 */
export async function prepareOcrImage(file: Blob, maxEdge = OCR_MAX_EDGE): Promise<PreparedOcrImage> {
  const decoded = await decodeOcrImage(file)
  if (decoded === null) return { blob: file, resized: false, width: null, height: null }

  try {
    // **縮小が要らない画像でも通す。** 二値化はどの大きさでも効くので、
    // 「小さい画像だけ質感が残る」という食い違いを作らない(切り出した範囲は大抵小さい)
    const resized = needsOcrResize(decoded.width, decoded.height, maxEdge)
    const size = resized
      ? computeTargetSize(decoded.width, decoded.height, maxEdge)
      : { width: decoded.width, height: decoded.height }
    const blob = await render(decoded.source, size.width, size.height, resized)
    // null = 縮小も二値化も要らなかった。**元のファイルをそのまま渡す**
    if (blob === null) {
      return { blob: file, resized: false, width: decoded.width, height: decoded.height }
    }
    return { blob, resized, width: size.width, height: size.height }
  } catch {
    return { blob: file, resized: false, width: decoded.width, height: decoded.height }
  } finally {
    decoded.close()
  }
}
