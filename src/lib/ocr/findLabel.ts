// 写真から「ラベルらしい範囲」を**自動で**見つける層。
//
// ## 何を検出しているか(明るさではなく、文字の密度)
//
// ラベル = 文字が密集した領域。グレースケールの**勾配(隣との差)が濃いセル**の最大連結成分を
// 囲む。明るさで探すと黒地に白文字のラベル(黒龍など)を取りこぼすが、文字は地の色に
// かかわらず勾配を作る。瓶の輪郭も勾配を作るが、細い線なのでセル単位の密度では文字に負ける。
//
// ## 外れてもよい設計になっている(だから自動にできる)
//
// この提案が外れたときに起きるのは「候補が出ない」だけで、誤った銘柄が出るわけではない
// (照合の門は別にある)。しかも枠は画面に出て、人が「ラベルを囲んで読み取る」で引き直せる。
// **銘柄を推測しない規律と衝突しない**のは、これが場所の提案であって内容の判定ではないから。
//
// ## 見つからないときは null = 全体を読む
//
// 一様な画像(勾配が無い)や、文字が画面いっぱいの画像(枠を切る意味が無い)は null を返す。
// 呼び出し側はそのまま全体を OCR に渡す — 従来の挙動に戻るだけで、悪化はしない。

import type { CropFraction } from './cropImage.ts'
import { decodeOcrImage } from './prepareImage.ts'

/** 解析する画像の長辺。文字の有無が分かればよいので粗くてよい(大きいほど遅い) */
export const DETECT_MAX_EDGE = 256

/** 密度の門: 最大セルに対する比。これ未満のセルは「文字が無い」とみなす */
export const DETECT_DENSITY_RATIO = 0.3

/** 最大密度がこれ未満なら画像全体に文字が無い(一様・ぼけ)とみなして null */
export const DETECT_MIN_PEAK = 10

/**
 * 連結成分の最小セル数。これ未満はノイズ(瓶の縁の切れ端など)。
 * **6 だと2字の銘柄(七賢・田酒・而今)のシーン画像が null になる**(文字が少ない = 成分が
 * 小さい)。4 で9枚とも枠が出て、銘柄の字の列を覆えたのは 8/9(調整の走査は ratio 0.2〜0.3 ×
 * min 3〜6 の9通りで、0.3×4 が最良)。
 */
export const DETECT_MIN_CELLS = 4

/** 枠が画像のこれ以上を覆うなら切る意味が無い(文字が画面いっぱい) */
export const DETECT_MAX_AREA = 0.8

/** 1セルの辺(解析画像のpx)。文字1〜2字がセルに収まる粗さ */
export const DETECT_CELL = 8

/**
 * グレースケール画素から文字らしい領域を返す。**純関数**(配列と幅高さだけを見る)。
 * 見つからなければ null。
 */
export function findTextRegion(
  gray: Uint8Array | readonly number[],
  width: number,
  height: number,
  cell = DETECT_CELL,
): CropFraction | null {
  if (width < cell * 2 || height < cell * 2) return null
  const cols = Math.floor(width / cell)
  const rows = Math.floor(height / cell)

  // セルごとの勾配密度(隣接画素との差の平均)
  const density = new Float64Array(cols * rows)
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let sum = 0
      let n = 0
      const x0 = cx * cell
      const y0 = cy * cell
      for (let y = y0; y < y0 + cell && y < height - 1; y++) {
        for (let x = x0; x < x0 + cell && x < width - 1; x++) {
          const at = y * width + x
          sum += Math.abs(gray[at + 1] - gray[at]) + Math.abs(gray[at + width] - gray[at])
          n += 1
        }
      }
      density[cy * cols + cx] = n === 0 ? 0 : sum / n
    }
  }

  let peak = 0
  for (const value of density) peak = Math.max(peak, value)
  if (peak < DETECT_MIN_PEAK) return null

  const floor = peak * DETECT_DENSITY_RATIO
  const mask = new Uint8Array(cols * rows)
  for (let at = 0; at < density.length; at++) mask[at] = density[at] >= floor ? 1 : 0

  // 4近傍の連結成分から最大のものを取る(走査はスタック。セル数は高々 32×32 程度)
  const seen = new Uint8Array(cols * rows)
  let best: number[] = []
  for (let seed = 0; seed < mask.length; seed++) {
    if (mask[seed] === 0 || seen[seed] === 1) continue
    const component: number[] = []
    const stack = [seed]
    seen[seed] = 1
    while (stack.length > 0) {
      const at = stack.pop()!
      component.push(at)
      const cx = at % cols
      const cy = Math.floor(at / cols)
      for (const next of [
        cx > 0 ? at - 1 : -1,
        cx < cols - 1 ? at + 1 : -1,
        cy > 0 ? at - cols : -1,
        cy < rows - 1 ? at + cols : -1,
      ]) {
        if (next >= 0 && mask[next] === 1 && seen[next] === 0) {
          seen[next] = 1
          stack.push(next)
        }
      }
    }
    if (component.length > best.length) best = component
  }
  if (best.length < DETECT_MIN_CELLS) return null

  let minX = cols
  let maxX = -1
  let minY = rows
  let maxY = -1
  for (const at of best) {
    const cx = at % cols
    const cy = Math.floor(at / cols)
    minX = Math.min(minX, cx)
    maxX = Math.max(maxX, cx)
    minY = Math.min(minY, cy)
    maxY = Math.max(maxY, cy)
  }

  // 1セルの余白(文字の端が枠に触れると読みが欠ける)
  const x = Math.max(0, (minX - 1) * cell) / width
  const y = Math.max(0, (minY - 1) * cell) / height
  const right = Math.min(width, (maxX + 2) * cell) / width
  const bottom = Math.min(height, (maxY + 2) * cell) / height
  const region: CropFraction = { x, y, w: right - x, h: bottom - y }
  if (region.w * region.h > DETECT_MAX_AREA) return null
  return region
}

/**
 * ファイルからラベルらしい範囲を探す。**失敗はすべて null**(自動の提案なので、
 * 出せないときは全体を読む従来の挙動に戻るだけ。エラーで読み取り自体を止めない)。
 */
export async function detectLabelRegion(file: Blob): Promise<CropFraction | null> {
  const decoded = await decodeOcrImage(file)
  if (decoded === null) return null
  try {
    const scale = Math.min(1, DETECT_MAX_EDGE / Math.max(decoded.width, decoded.height))
    const w = Math.max(1, Math.round(decoded.width * scale))
    const h = Math.max(1, Math.round(decoded.height * scale))
    let data: Uint8ClampedArray
    if (typeof OffscreenCanvas === 'function') {
      const canvas = new OffscreenCanvas(w, h)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (ctx === null) return null
      ctx.drawImage(decoded.source, 0, 0, w, h)
      data = ctx.getImageData(0, 0, w, h).data
    } else {
      if (typeof document === 'undefined') return null
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (ctx === null) return null
      ctx.drawImage(decoded.source, 0, 0, w, h)
      data = ctx.getImageData(0, 0, w, h).data
    }
    const gray = new Uint8Array(w * h)
    for (let at = 0, px = 0; at < gray.length; at++, px += 4) {
      gray[at] = (data[px] * 299 + data[px + 1] * 587 + data[px + 2] * 114) / 1000
    }
    return findTextRegion(gray, w, h)
  } catch {
    return null
  } finally {
    decoded.close()
  }
}
