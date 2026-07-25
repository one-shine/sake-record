// 端末で選んだ写真を「長辺400px / JPEG / 51200バイト以下」のサムネイルに落とす(SPEC A8)。
// **原本は保存しない**(原本はカメラロールに残す)ので、アプリに入る画像はすべてここを通る。
//
// 3つに割ってある。canvas を要求するのは最後の1本だけで、判断はすべて canvas 無しで検証できる:
//   - `computeTargetSize` … 寸法の算術。純関数。**丸め方をここ1箇所で決める**(1px ずれの出所を1つにする)
//   - `selectThumbnail`   … 品質ラダー/寸法ラダーの歩き方と諦め方。encode を引数で受ける
//   - `resizeToThumbnail` … デコード(createImageBitmap)と描画(canvas)。**ブラウザでしか動かない**
//
// 手順は「デコード → 長辺400pxへ縮小 → 品質を 0.82 から順に試して 51200 バイト以下の最初を採用 →
// まだ超えるなら長辺 320 → 256 で再走 → それでも超えたら投げる」。
//
// 落としてはいけない点:
//   - **EXIF 回転**: `createImageBitmap(file, { imageOrientation: 'from-image' })` を第一経路にする。
//     指定を省くと縦持ちの写真が横倒しのまま焼き込まれ、原本を持たないので後から直せない
//   - **HEIC を mime で事前拒否しない**: iOS Safari は HEIC をデコードできる。事前に弾くと動く環境を壊す。
//     `isLikelyHeic` は「デコードが失敗したあと、案内の文言を選ぶため」だけに使う
//   - **収まらなければ投げる**: 無音で巨大な Blob を IndexedDB に入れると、バックアップの JSON も
//     data URL で膨らむ(1件あたり 50KB という上限はそこまで含めた約束)
//   - **出力は必ず image/jpeg**: `canvas.toBlob` は未対応の型を渡すと黙って PNG を返すので書き出しを検品する
//   - **エラーは kind で区別できる**: 呼び出し側(RecordForm)が HEIC 案内 / 大きすぎ / 非対応環境で
//     別の文言を出せるようにする。UI で `instanceof` の分岐を書かせない

/** 1件あたりのサムネイル上限。SPEC の「50KB以下」= 50KiB */
export const MAX_THUMBNAIL_BYTES = 51200

/** JPEG の品質を上から試す。降順であることに意味がある(最初に収まったものを採る) */
export const QUALITY_LADDER: readonly number[] = [0.82, 0.7, 0.6, 0.5, 0.4]

/** 品質を使い切っても収まらないときに落とす長辺。先頭の 400 が SPEC の既定値 */
export const EDGE_LADDER: readonly number[] = [400, 320, 256]

/** サムネイルの型。**PNG のまま返さない**(透過が無いのにサイズだけ出る) */
export const THUMBNAIL_MIME = 'image/jpeg'

/**
 * HEIC がデコードできなかったときの案内。常体。
 * UI と共有するために export する(文言を2箇所に書くとドリフトする)。
 */
export const HEIC_ADVICE =
  'この写真の形式(HEIC)はこのブラウザで読み込めない。iPhone の設定→カメラ→フォーマットを『互換性優先』にするか、JPEG に変換した写真を選ぶ。'

/**
 * 失敗の種類。呼び出し側は `kind` で文言を出し分ける。
 *
 * - `unsupported` … この環境にデコード手段か canvas が無い(古いブラウザ・テスト環境)
 * - `decode` … 画像として読めなかった(壊れている・画像でない)
 * - `heic` … 読めなかった & HEIC/HEIF らしい → `HEIC_ADVICE` を出す
 * - `encode` … JPEG を書き出せなかった
 * - `too-large` … ラダーを尽くしても上限に収まらなかった
 */
export type ThumbnailErrorKind = 'unsupported' | 'decode' | 'heic' | 'encode' | 'too-large'

export class ThumbnailError extends Error {
  readonly kind: ThumbnailErrorKind

  constructor(kind: ThumbnailErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ThumbnailError'
    this.kind = kind
  }
}

export function isThumbnailError(value: unknown): value is ThumbnailError {
  return value instanceof ThumbnailError
}

export interface ImageSize {
  width: number
  height: number
}

/** encode に渡す1回の試行 */
export interface ThumbnailAttempt extends ImageSize {
  quality: number
}

/** 寸法と品質を受けて JPEG を返す。canvas を隠すための継ぎ目 */
export type ThumbnailEncoder = (attempt: ThumbnailAttempt) => Promise<Blob>

export interface ThumbnailResult extends ImageSize {
  blob: Blob
  /** `blob.size`。表示(「サムネイル 38KB / 400×533」)に使う */
  bytes: number
  /** 採用した JPEG 品質。どこまで落ちたかを画面に出せるようにする */
  quality: number
}

export interface ThumbnailOptions {
  maxBytes?: number
  qualityLadder?: readonly number[]
  edgeLadder?: readonly number[]
}

// ---------------------------------------------------------------- 寸法

function assertUsableLength(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError(`${label} が寸法として使えない(${String(value)})`)
  }
}

/** 1px 未満に潰さず整数にする(canvas の width/height は整数しか意味を持たない) */
function toPixels(value: number): number {
  return Math.max(1, Math.round(value))
}

/**
 * 長辺を `maxEdge` に合わせた寸法を返す。**元が小さければ拡大しない。**
 *
 * 丸めは四捨五入(`Math.round`)で固定する。長辺は丸めを通さず `maxEdge` にぴったり合わせるので、
 * 「400 を狙って 399 になる」ことはない。短辺は最低 1px まで潰れる(極端なアスペクト比の写真で 0 にしない)。
 *
 * 寸法が定義域外(0・負・NaN・Infinity)なら `RangeError`。ここで黙って既定値に落とすと、
 * デコードが壊れていることを 1px のサムネイルで隠すことになる。
 */
export function computeTargetSize(width: number, height: number, maxEdge: number): ImageSize {
  assertUsableLength(width, '幅')
  assertUsableLength(height, '高さ')
  assertUsableLength(maxEdge, 'maxEdge')

  const longEdge = Math.max(width, height)
  if (longEdge <= maxEdge) return { width: toPixels(width), height: toPixels(height) }

  const scale = maxEdge / longEdge
  const edge = toPixels(maxEdge)
  return width >= height
    ? { width: edge, height: toPixels(height * scale) }
    : { width: toPixels(width * scale), height: edge }
}

// ---------------------------------------------------------------- ラダー

function mimeOf(blob: Blob): string {
  return (blob.type.split(';')[0] ?? '').trim().toLowerCase()
}

function formatKb(bytes: number): string {
  return `${Math.round(bytes / 1024)}KB`
}

/**
 * 寸法ラダー × 品質ラダーを歩いて、**`maxBytes` 以下になった最初の JPEG** を返す。
 * 尽きたら `too-large` で投げる(どこまで落としたかを文言に載せる)。
 *
 * `encode` を引数で受けるので canvas 無しで検証できる。ここが「いつ諦めるか」の唯一の実装。
 */
export async function selectThumbnail(
  source: ImageSize,
  encode: ThumbnailEncoder,
  opts: ThumbnailOptions = {},
): Promise<ThumbnailResult> {
  const maxBytes = opts.maxBytes ?? MAX_THUMBNAIL_BYTES
  const qualities = opts.qualityLadder ?? QUALITY_LADDER
  const edges = opts.edgeLadder ?? EDGE_LADDER

  if (!Number.isFinite(maxBytes) || maxBytes < 1) {
    throw new RangeError(`maxBytes が上限として使えない(${String(maxBytes)})`)
  }
  if (qualities.length === 0) throw new RangeError('qualityLadder が空だと試行が0回になる')
  if (edges.length === 0) throw new RangeError('edgeLadder が空だと試行が0回になる')

  const tried = new Set<string>()
  // 諦めるときの文言に「どこまで落としたか」を載せるため、最後の試行を持ち回る。
  // 最小バイトではなく最後の試行にするのは、`400×300 で 88KB` と言うと 256 まで下げたことが
  // 文言から消えて「もっと縮められるのでは」と読めてしまうため
  let last: { attempt: ThumbnailAttempt; bytes: number } | null = null

  for (const edge of edges) {
    const size = computeTargetSize(source.width, source.height, edge)
    const key = `${size.width}x${size.height}`
    // 元が小さいと 400/320/256 が同じ寸法に落ちる。同じ絵を焼き直しても結果は同じなので飛ばす
    if (tried.has(key)) continue
    tried.add(key)

    for (const quality of qualities) {
      const attempt: ThumbnailAttempt = { ...size, quality }
      const blob = await encode(attempt)
      if (mimeOf(blob) !== THUMBNAIL_MIME) {
        // toBlob は未対応の型を黙って PNG に落とす。ここで止めないと PNG が保存される
        throw new ThumbnailError(
          'encode',
          `サムネイルを JPEG で書き出せない(${blob.type || '型なし'} が返った)。別のブラウザで試す。`,
        )
      }
      const bytes = blob.size
      if (bytes <= maxBytes) return { blob, width: size.width, height: size.height, bytes, quality }
      last = { attempt, bytes }
    }
  }

  // ここに来るのは全試行が上限超え。**巨大な Blob を返さずに投げる**。
  // 上のガードで最低1回は試しているので last は必ず埋まっているが、型のために分岐を残す
  const detail =
    last === null
      ? ''
      : `${last.attempt.width}×${last.attempt.height}・品質${last.attempt.quality}まで落としても${formatKb(last.bytes)}あり、`
  throw new ThumbnailError(
    'too-large',
    `この写真は${detail}${formatKb(maxBytes)}以下にならない。別の写真を選ぶか、あらかじめ縮小した写真を使う。`,
  )
}

// ---------------------------------------------------------------- デコードと描画(ブラウザ専用)

/**
 * HEIC/HEIF らしいか。**事前拒否には使わない**(iOS Safari はデコードできるので弾くと動く環境を壊す)。
 * デコードが失敗したあと、案内を HEIC 向けに差し替えるためだけの判定。
 *
 * mime が空の共有経路もあるので拡張子も見る。逆に mime も拡張子も嘘の場合は一般の
 * `decode` 文言になる(バイト先頭の `ftyp` ブランドまでは見ていない)。
 */
export function isLikelyHeic(file: File | Blob): boolean {
  const mime = mimeOf(file)
  if (mime === 'image/heic' || mime === 'image/heif') return true
  if (mime === 'image/heic-sequence' || mime === 'image/heif-sequence') return true
  const name: unknown = (file as File).name
  return typeof name === 'string' && /\.(?:heic|heif)$/i.test(name)
}

function decodeFailure(file: File | Blob, cause: unknown): ThumbnailError {
  if (isLikelyHeic(file)) return new ThumbnailError('heic', HEIC_ADVICE, { cause })
  return new ThumbnailError(
    'decode',
    'この写真を画像として読み込めない(形式が違うか壊れている)。別の写真を選ぶ。',
    { cause },
  )
}

interface DecodedImage extends ImageSize {
  source: CanvasImageSource
  close: () => void
}

function canUseImageElement(): boolean {
  return (
    typeof Image === 'function' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  )
}

function loadImageElement(img: HTMLImageElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () =>
      reject(new Error('<img> が読み込みに失敗した(この形式をデコードできない)'))
    img.src = url
  })
}

/**
 * `createImageBitmap` が使えないときの経路。`<img>` の EXIF 回転は
 * `image-orientation: from-image` が既定値なので、この経路でも縦持ちは立ったまま描かれる。
 */
async function decodeViaImageElement(file: File | Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(file)
  const close = () => {
    URL.revokeObjectURL(url)
  }
  const img = new Image()
  try {
    await loadImageElement(img, url)
  } catch (cause) {
    close()
    throw cause
  }
  return {
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
    source: img,
    close,
  }
}

async function decodeImage(file: File | Blob): Promise<DecodedImage> {
  let firstCause: unknown = null

  if (typeof createImageBitmap === 'function') {
    try {
      // **EXIF 回転はここで焼き込む。** 'from-image' を省くと縦持ちの写真が横倒しになる
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        close: () => bitmap.close?.(),
      }
    } catch (cause) {
      // 「形式が読めない」と「options ごと落ちる古い実装」を区別できないので、
      // 後者を救うために <img> 経路も試す(どちらの経路も EXIF 回転は残る)
      firstCause = cause
    }
  }

  if (canUseImageElement()) {
    try {
      return await decodeViaImageElement(file)
    } catch (cause) {
      throw decodeFailure(file, cause)
    }
  }

  if (firstCause !== null) throw decodeFailure(file, firstCause)
  throw new ThumbnailError(
    'unsupported',
    'このブラウザは写真の読み込みに対応していない。写真なしで記録するか、別のブラウザを使う。',
  )
}

type Painter = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

function paint(ctx: Painter, source: CanvasImageSource, width: number, height: number): void {
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // JPEG は透過を持てない。塗らないと PNG の透過部が黒く沈む
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, 0, 0, width, height)
}

/** 指定寸法で1回だけ描き、品質を変えて何度も書き出せる関数を返す */
function drawToCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
): (quality: number) => Promise<Blob> {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (ctx === null) {
      throw new ThumbnailError('unsupported', 'canvas の 2D コンテキストが取れない。')
    }
    paint(ctx, source, width, height)
    return (quality) => canvas.convertToBlob({ type: THUMBNAIL_MIME, quality })
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx === null) {
      throw new ThumbnailError('unsupported', 'canvas の 2D コンテキストが取れない。')
    }
    paint(ctx, source, width, height)
    return (quality) =>
      new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob === null) {
              reject(new ThumbnailError('encode', 'サムネイルの書き出しに失敗した。'))
              return
            }
            resolve(blob)
          },
          THUMBNAIL_MIME,
          quality,
        )
      })
  }

  throw new ThumbnailError(
    'unsupported',
    'この環境には canvas が無いのでサムネイルを作れない。別のブラウザを使う。',
  )
}

/** 寸法が変わるまで canvas を作り直さない(同じ絵を5回描くのは無駄) */
function createCanvasEncoder(image: DecodedImage): ThumbnailEncoder {
  let drawn: { width: number; height: number; encode: (quality: number) => Promise<Blob> } | null =
    null
  return (attempt) => {
    if (drawn === null || drawn.width !== attempt.width || drawn.height !== attempt.height) {
      drawn = {
        width: attempt.width,
        height: attempt.height,
        encode: drawToCanvas(image.source, attempt.width, attempt.height),
      }
    }
    return drawn.encode(attempt.quality)
  }
}

/**
 * 写真を長辺400px・JPEG・51200バイト以下のサムネイルにする。
 *
 * 失敗は必ず `ThumbnailError`(kind 付き)で投げる。**無音で巨大なまま保存する経路は無い。**
 */
export async function resizeToThumbnail(
  file: File | Blob,
  opts: ThumbnailOptions = {},
): Promise<ThumbnailResult> {
  const image = await decodeImage(file)
  try {
    if (!Number.isFinite(image.width) || !Number.isFinite(image.height)) {
      throw decodeFailure(file, new Error('デコード結果の寸法が数値でない'))
    }
    if (image.width < 1 || image.height < 1) {
      throw decodeFailure(file, new Error(`デコード結果が ${image.width}×${image.height}`))
    }
    return await selectThumbnail({ width: image.width, height: image.height }, createCanvasEncoder(image), opts)
  } finally {
    // ImageBitmap は明示的に閉じないと GC まで数MBの生ビットマップを抱える
    image.close()
  }
}
