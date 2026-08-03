// 写真リサイズ(A8)の検証。
//
// canvas はブラウザにしか無いので、この層は3つに割って別々に固定する:
//   1. `computeTargetSize` … 純関数。網羅的に(丸めの向きまで固定する)
//   2. `selectThumbnail`   … encode を引数で受けるので、ラダーの歩き方と諦め方を jsdom で全部固定できる
//   3. `resizeToThumbnail` … デコードの経路選択とエラー分類だけを、globals を*外して*検証する。
//      **画素(実写真の回転・見た目)はここでは検証できない。実写真の確認はブラウザで行う**
//
// 期待値は実装から import せずリテラルで書く(B15: 実装と同じ出所から取った期待値は恒真になる)。

import {
  computeTargetSize,
  EDGE_LADDER,
  HEIC_ADVICE,
  isLikelyHeic,
  isThumbnailError,
  MAX_THUMBNAIL_BYTES,
  QUALITY_LADDER,
  resizeToThumbnail,
  selectThumbnail,
  ThumbnailError,
  type ThumbnailAttempt,
} from './resize.ts'
import { notice } from '../../test/notice.ts'

/**
 * 実物の canvas / createImageBitmap がこの環境にあるか。**stub を張る前に評価する**
 * (テスト内で stub した偽 canvas でこのフラグが true になると、実経路を検証したつもりになる)。
 */
const CANVAS_READY = typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function'

// スキップを無音にしない。「テストは緑なのに実写真は誰も通していない」状態を出力に残す。
// 出力の作り方(なぜ console では出ないか)は `src/test/notice.ts` の1箇所が持つ。
if (!CANVAS_READY) {
  notice(
    '[resize.test] SKIP: OffscreenCanvas / createImageBitmap が無い環境(jsdom)なので、' +
      '実 canvas を通す往復テスト3件をスキップした。' +
      '実写真(縦持ちJPEG の回転 / 12MB級で品質ラダー / HEIC の案内)の確認はブラウザで行う。',
  )
}

// ---------------------------------------------------------------- 定数

describe('ラダーと上限(リテラルで固定する)', () => {
  it('MAX_THUMBNAIL_BYTES は 51200', () => {
    expect(MAX_THUMBNAIL_BYTES).toBe(51200)
  })

  it('QUALITY_LADDER は [0.82, 0.7, 0.6, 0.5, 0.4]', () => {
    expect(QUALITY_LADDER).toEqual([0.82, 0.7, 0.6, 0.5, 0.4])
  })

  it('EDGE_LADDER は [400, 320, 256]', () => {
    expect(EDGE_LADDER).toEqual([400, 320, 256])
  })

  it('両ラダーが降順(順番が意味を持つ。昇順だと最初に採るものが最低品質になる)', () => {
    for (let i = 1; i < QUALITY_LADDER.length; i += 1) {
      expect(QUALITY_LADDER[i]).toBeLessThan(QUALITY_LADDER[i - 1]!)
    }
    for (let i = 1; i < EDGE_LADDER.length; i += 1) {
      expect(EDGE_LADDER[i]).toBeLessThan(EDGE_LADDER[i - 1]!)
    }
  })

  it('品質は (0, 1] の範囲・長辺は 1px 以上の整数', () => {
    for (const quality of QUALITY_LADDER) {
      expect(quality).toBeGreaterThan(0)
      expect(quality).toBeLessThanOrEqual(1)
    }
    for (const edge of EDGE_LADDER) {
      expect(Number.isInteger(edge)).toBe(true)
      expect(edge).toBeGreaterThanOrEqual(1)
    }
  })

  it('先頭の長辺は 400(SPEC A8 の「長辺400px」)', () => {
    expect(EDGE_LADDER[0]).toBe(400)
  })
})

// ---------------------------------------------------------------- computeTargetSize

describe('computeTargetSize', () => {
  it('横長を縮める(長辺がちょうど maxEdge になる)', () => {
    expect(computeTargetSize(4032, 3024, 400)).toEqual({ width: 400, height: 300 })
    expect(computeTargetSize(800, 600, 400)).toEqual({ width: 400, height: 300 })
  })

  it('縦長を縮める(iPhone の縦持ち。長辺は高さ側)', () => {
    expect(computeTargetSize(3024, 4032, 400)).toEqual({ width: 300, height: 400 })
    expect(computeTargetSize(3024, 4032, 320)).toEqual({ width: 240, height: 320 })
    expect(computeTargetSize(3024, 4032, 256)).toEqual({ width: 192, height: 256 })
  })

  it('正方形は両辺が maxEdge', () => {
    expect(computeTargetSize(1000, 1000, 400)).toEqual({ width: 400, height: 400 })
  })

  it('元が小さければ拡大しない(そのまま返す)', () => {
    expect(computeTargetSize(320, 240, 400)).toEqual({ width: 320, height: 240 })
    expect(computeTargetSize(100, 50, 400)).toEqual({ width: 100, height: 50 })
    expect(computeTargetSize(200, 150, 256)).toEqual({ width: 200, height: 150 })
  })

  it('長辺がちょうど maxEdge のときは丸めを通さずそのまま', () => {
    expect(computeTargetSize(400, 300, 400)).toEqual({ width: 400, height: 300 })
    expect(computeTargetSize(300, 400, 400)).toEqual({ width: 300, height: 400 })
    expect(computeTargetSize(400, 400, 400)).toEqual({ width: 400, height: 400 })
  })

  it('maxEdge を 1px 超えた境界で縮小に切り替わる', () => {
    // 401 → 400 に縮む。短辺 300 * 400/401 = 299.25 → 299(四捨五入)
    expect(computeTargetSize(401, 300, 400)).toEqual({ width: 400, height: 299 })
  })

  it('丸めは四捨五入で固定する(1px ずれの出所を1箇所にする)', () => {
    // 667 * 400/1000 = 266.8 → 267
    expect(computeTargetSize(1000, 667, 400)).toEqual({ width: 400, height: 267 })
    // 501 * 400/800 = 250.5 → 251(ちょうど .5 は上へ)
    expect(computeTargetSize(800, 501, 400)).toEqual({ width: 400, height: 251 })
    // 1499 * 400/3000 = 199.866… → 200
    expect(computeTargetSize(3000, 1499, 400)).toEqual({ width: 400, height: 200 })
  })

  it('極端なアスペクト比でも短辺が 0 にならない(最低 1px)', () => {
    expect(computeTargetSize(4000, 3, 400)).toEqual({ width: 400, height: 1 })
    expect(computeTargetSize(3, 4000, 400)).toEqual({ width: 1, height: 400 })
    expect(computeTargetSize(10000, 1, 256)).toEqual({ width: 256, height: 1 })
  })

  it('1px の画像', () => {
    expect(computeTargetSize(1, 1, 400)).toEqual({ width: 1, height: 1 })
    expect(computeTargetSize(1, 1, 1)).toEqual({ width: 1, height: 1 })
    expect(computeTargetSize(1000, 1000, 1)).toEqual({ width: 1, height: 1 })
  })

  it('小数の寸法が来ても整数を返す(canvas の width/height に渡すので)', () => {
    expect(computeTargetSize(320.6, 240.2, 400)).toEqual({ width: 321, height: 240 })
    expect(computeTargetSize(1000.5, 750.5, 400)).toEqual({ width: 400, height: 300 })
  })

  it('出力は常に 1 以上の整数で、長辺は maxEdge を超えない', () => {
    const sizes: readonly (readonly [number, number])[] = [
      [4032, 3024],
      [3024, 4032],
      [1, 1],
      [1, 5000],
      [5000, 1],
      [640, 640],
      [399, 401],
      [12000, 9000],
    ]
    for (const [width, height] of sizes) {
      for (const edge of [400, 320, 256, 1]) {
        const target = computeTargetSize(width, height, edge)
        expect(Number.isInteger(target.width)).toBe(true)
        expect(Number.isInteger(target.height)).toBe(true)
        expect(target.width).toBeGreaterThanOrEqual(1)
        expect(target.height).toBeGreaterThanOrEqual(1)
        expect(Math.max(target.width, target.height)).toBeLessThanOrEqual(Math.max(edge, 1))
        // 縮小したときは長辺がちょうど maxEdge に一致する
        if (Math.max(width, height) > edge) {
          expect(Math.max(target.width, target.height)).toBe(edge)
        }
      }
    }
  })

  it('アスペクト比を保つ(丸めの 1px 以内)', () => {
    const sizes: readonly (readonly [number, number])[] = [
      [4032, 3024],
      [3024, 4032],
      [1920, 1080],
      [1000, 667],
      [640, 641],
    ]
    for (const [width, height] of sizes) {
      const target = computeTargetSize(width, height, 400)
      const expected = (height * target.width) / width
      expect(Math.abs(target.height - expected)).toBeLessThanOrEqual(1)
    }
  })

  it('寸法が定義域外なら投げる(0・負・NaN・Infinity)', () => {
    expect(() => computeTargetSize(0, 100, 400)).toThrow(RangeError)
    expect(() => computeTargetSize(100, 0, 400)).toThrow(RangeError)
    expect(() => computeTargetSize(-10, 100, 400)).toThrow(RangeError)
    expect(() => computeTargetSize(Number.NaN, 100, 400)).toThrow(RangeError)
    expect(() => computeTargetSize(100, Number.POSITIVE_INFINITY, 400)).toThrow(RangeError)
    expect(() => computeTargetSize(100, 100, 0)).toThrow(RangeError)
    expect(() => computeTargetSize(100, 100, -1)).toThrow(RangeError)
    expect(() => computeTargetSize(100, 100, Number.NaN)).toThrow(RangeError)
  })
})

// ---------------------------------------------------------------- selectThumbnail

/**
 * 指定バイト数の Blob。**`arrayBuffer()` を自分で足す。**
 *
 * jsdom の Blob はこれを実装していないが、ブラウザ(Safari 14+ / Chrome)は持っており、
 * `selectThumbnail` は採用した1枚をここからバイト列に起こす(B72)。足さないと
 * 「jsdom に無い」だけの理由で実装を歪めることになる。
 */
function fakeJpeg(byteLength: number, type = 'image/jpeg'): Blob {
  const bytes = new Uint8Array(byteLength)
  return Object.assign(new Blob([bytes], { type }), {
    arrayBuffer: () => Promise.resolve(bytes.buffer),
  })
}

/** 指定バイト数の JPEG を返す偽 encoder。呼ばれた順を記録する */
function recordingEncoder(bytesFor: (attempt: ThumbnailAttempt) => number, mime = 'image/jpeg') {
  const calls: ThumbnailAttempt[] = []
  const encode = (attempt: ThumbnailAttempt) => {
    calls.push(attempt)
    return Promise.resolve(fakeJpeg(bytesFor(attempt), mime))
  }
  return { calls, encode }
}

describe('selectThumbnail(品質ラダー → 寸法ラダー)', () => {
  const source = { width: 4032, height: 3024 } // 400 → 320 → 256 で寸法が全部変わる

  it('最初の品質で収まればそれを採る(余計に encode しない)', async () => {
    const { calls, encode } = recordingEncoder(() => 30_000)
    const result = await selectThumbnail(source, encode)
    expect(result).toMatchObject({ width: 400, height: 300, bytes: 30_000, quality: 0.82 })
    // **Blob を返さない(B72)。** Blob のまま IndexedDB に入ると iOS で実体だけが失われる
    expect(result.data).toBeInstanceOf(ArrayBuffer)
    expect(result.data.byteLength).toBe(30_000)
    expect(calls).toEqual([{ width: 400, height: 300, quality: 0.82 }])
  })

  it('収まるまで品質を順に下げる', async () => {
    const { calls, encode } = recordingEncoder((a) => (a.quality > 0.6 ? 60_000 : 40_000))
    const result = await selectThumbnail(source, encode)
    expect(result.quality).toBe(0.6)
    expect(result.bytes).toBe(40_000)
    expect(calls.map((a) => a.quality)).toEqual([0.82, 0.7, 0.6])
    expect(calls.every((a) => a.width === 400 && a.height === 300)).toBe(true)
  })

  it('品質を使い切ったら長辺を 320 に落として再走する', async () => {
    const { calls, encode } = recordingEncoder((a) => (a.width === 400 ? 60_000 : 45_000))
    const result = await selectThumbnail(source, encode)
    expect(result).toMatchObject({ width: 320, height: 240, quality: 0.82, bytes: 45_000 })
    expect(calls).toEqual([
      { width: 400, height: 300, quality: 0.82 },
      { width: 400, height: 300, quality: 0.7 },
      { width: 400, height: 300, quality: 0.6 },
      { width: 400, height: 300, quality: 0.5 },
      { width: 400, height: 300, quality: 0.4 },
      { width: 320, height: 240, quality: 0.82 },
    ])
  })

  it('320 でも収まらなければ 256 まで落とす', async () => {
    const { calls, encode } = recordingEncoder((a) => (a.width > 256 ? 60_000 : 50_000))
    const result = await selectThumbnail(source, encode)
    expect(result).toMatchObject({ width: 256, height: 192, quality: 0.82 })
    expect(calls).toHaveLength(11) // 400 で5回 + 320 で5回 + 256 で1回
  })

  it('ちょうど 51200 バイトは採用し、1バイト超は採用しない', async () => {
    const exact = recordingEncoder(() => 51_200)
    await expect(selectThumbnail(source, exact.encode)).resolves.toMatchObject({ bytes: 51_200 })

    const over = recordingEncoder((a) => (a.quality === 0.82 ? 51_201 : 51_200))
    const result = await selectThumbnail(source, over.encode)
    expect(result.quality).toBe(0.7)
  })

  it('全部尽きたら投げる(巨大な Blob を無音で返さない)', async () => {
    const { calls, encode } = recordingEncoder(() => 90_000)
    const error = await selectThumbnail(source, encode).catch((cause: unknown) => cause)
    expect(isThumbnailError(error)).toBe(true)
    expect((error as ThumbnailError).kind).toBe('too-large')
    expect((error as ThumbnailError).name).toBe('ThumbnailError')
    // 何をどこまで試したかを文言に残す(50KB = 51200 バイト)
    expect((error as ThumbnailError).message).toContain('50KB')
    expect((error as ThumbnailError).message).toContain('256')
    expect(calls).toHaveLength(15) // 3寸法 × 5品質を出し切っている
  })

  it('image/jpeg 以外が返ってきたら投げる(PNG のまま保存しない)', async () => {
    const { encode } = recordingEncoder(() => 10_000, 'image/png')
    const error = await selectThumbnail(source, encode).catch((cause: unknown) => cause)
    expect(isThumbnailError(error)).toBe(true)
    expect((error as ThumbnailError).kind).toBe('encode')
    expect((error as ThumbnailError).message).toContain('image/png')
  })

  it('型に charset などが付いた image/jpeg は受ける', async () => {
    const { encode } = recordingEncoder(() => 10_000, 'IMAGE/JPEG')
    await expect(selectThumbnail(source, encode)).resolves.toMatchObject({ bytes: 10_000 })
  })

  it('元が小さくて全ラダーが同寸になるときは重複して encode しない', async () => {
    // 200×150 は 400/320/256 のどれでも縮小されないので、同じ寸法を3回焼くのは無駄
    const { calls, encode } = recordingEncoder(() => 90_000)
    await selectThumbnail({ width: 200, height: 150 }, encode).catch(() => undefined)
    expect(calls).toHaveLength(5)
    expect(calls.every((a) => a.width === 200 && a.height === 150)).toBe(true)
  })

  it('opts でラダーと上限を差し替えられる', async () => {
    const { calls, encode } = recordingEncoder((a) => (a.quality === 0.9 ? 5_000 : 1_000))
    const result = await selectThumbnail(source, encode, {
      maxBytes: 2_000,
      qualityLadder: [0.9, 0.3],
      edgeLadder: [100],
    })
    expect(result).toMatchObject({ width: 100, height: 75, quality: 0.3, bytes: 1_000 })
    expect(calls.map((a) => a.quality)).toEqual([0.9, 0.3])
  })

  it('ラダーが空・上限が不正なら投げる(黙って0件のラダーを歩かない)', async () => {
    const { encode } = recordingEncoder(() => 1_000)
    await expect(selectThumbnail(source, encode, { qualityLadder: [] })).rejects.toThrow(RangeError)
    await expect(selectThumbnail(source, encode, { edgeLadder: [] })).rejects.toThrow(RangeError)
    await expect(selectThumbnail(source, encode, { maxBytes: 0 })).rejects.toThrow(RangeError)
  })
})

// ---------------------------------------------------------------- HEIC 判定

describe('isLikelyHeic(事前拒否には使わない。デコード失敗後の文言選択だけに使う)', () => {
  it('HEIC/HEIF の mime を拾う(大文字・パラメータ付きも)', () => {
    for (const type of [
      'image/heic',
      'image/heif',
      'image/heic-sequence',
      'image/heif-sequence',
      'IMAGE/HEIC',
      'image/heic; codecs=hvc1',
    ]) {
      expect(isLikelyHeic(new Blob([], { type }))).toBe(true)
    }
  })

  it('mime が空でも拡張子で拾う', () => {
    expect(isLikelyHeic(new File([], 'IMG_0001.HEIC'))).toBe(true)
    expect(isLikelyHeic(new File([], 'photo.heif', { type: '' }))).toBe(true)
  })

  it('JPEG / PNG / 型なしの Blob は HEIC ではない', () => {
    expect(isLikelyHeic(new Blob([], { type: 'image/jpeg' }))).toBe(false)
    expect(isLikelyHeic(new Blob([], { type: 'image/png' }))).toBe(false)
    expect(isLikelyHeic(new Blob([]))).toBe(false)
    expect(isLikelyHeic(new File([], 'photo.jpg', { type: 'image/jpeg' }))).toBe(false)
    // 拡張子が語中にあるだけの名前は拾わない
    expect(isLikelyHeic(new File([], 'heic-sample.jpg', { type: 'image/jpeg' }))).toBe(false)
  })
})

// ---------------------------------------------------------------- resizeToThumbnail の配線

/**
 * 偽 canvas 一式。**画素は一切検証していない**(fake が返すバイト数だけを見ている)。
 * ここで固定したいのは「どの global をどんな引数で呼ぶか」= EXIF 回転の指定と JPEG 指定の配線。
 */
type ConvertCall = { width: number; height: number; quality: number | undefined; type: string | undefined }

describe('resizeToThumbnail の配線(デコード経路とエラー分類)', () => {
  const originalCreateObjectURL = URL.createObjectURL

  let convertCalls: ConvertCall[]
  let bitmapCalls: { type: string; options: unknown }[]
  let contextCalls: string[]
  let closedBitmaps: number
  let bytesFor: (call: ConvertCall) => number

  function installFakeCanvas(): void {
    const context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      fillStyle: '',
      fillRect: (...args: number[]) => {
        contextCalls.push(`fillRect(${args.join(',')}) fillStyle=${context.fillStyle}`)
      },
      drawImage: (_source: unknown, ...args: number[]) => {
        contextCalls.push(`drawImage(${args.join(',')})`)
      },
    }
    class FakeOffscreenCanvas {
      width: number
      height: number
      constructor(width: number, height: number) {
        this.width = width
        this.height = height
      }
      getContext(kind: string): unknown {
        return kind === '2d' ? context : null
      }
      convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob> {
        const call = {
          width: this.width,
          height: this.height,
          quality: options?.quality,
          type: options?.type,
        }
        convertCalls.push(call)
        return Promise.resolve(fakeJpeg(bytesFor(call), options?.type ?? ''))
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
  }

  function installFakeDecoder(width: number, height: number): void {
    vi.stubGlobal('createImageBitmap', (blob: Blob, options?: unknown) => {
      bitmapCalls.push({ type: blob.type, options })
      return Promise.resolve({
        width,
        height,
        close: () => {
          closedBitmaps += 1
        },
      })
    })
  }

  /** <img> 経路を確実に閉じる(jsdom は画像を読み込まないので、経路が開いていると宙吊りになる) */
  function disableImageElementPath(): void {
    ;(URL as { createObjectURL?: typeof URL.createObjectURL }).createObjectURL = undefined
  }

  beforeEach(() => {
    convertCalls = []
    bitmapCalls = []
    contextCalls = []
    closedBitmaps = 0
    bytesFor = () => 20_000
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    ;(URL as { createObjectURL?: typeof URL.createObjectURL }).createObjectURL =
      originalCreateObjectURL
  })

  it('createImageBitmap を imageOrientation: from-image 付きで呼ぶ(EXIF 回転)', async () => {
    installFakeDecoder(3024, 4032)
    installFakeCanvas()
    const result = await resizeToThumbnail(new File([new Uint8Array(9)], 'a.jpg', { type: 'image/jpeg' }))
    expect(bitmapCalls).toEqual([{ type: 'image/jpeg', options: { imageOrientation: 'from-image' } }])
    expect(result).toMatchObject({ width: 300, height: 400, quality: 0.82, bytes: 20_000 })
    expect(closedBitmaps).toBe(1) // ImageBitmap を解放している
  })

  it('JPEG で書き出し、透過が黒く沈まないよう白で塗ってから描く', async () => {
    installFakeDecoder(1200, 900)
    installFakeCanvas()
    await resizeToThumbnail(new Blob([new Uint8Array(9)], { type: 'image/png' }))
    expect(convertCalls).toEqual([{ width: 400, height: 300, quality: 0.82, type: 'image/jpeg' }])
    expect(contextCalls).toEqual(['fillRect(0,0,400,300) fillStyle=#ffffff', 'drawImage(0,0,400,300)'])
  })

  it('同じ寸法で品質だけ変えるときは描き直さず encode だけ繰り返す', async () => {
    installFakeDecoder(1200, 900)
    installFakeCanvas()
    bytesFor = (call) => (call.quality! > 0.6 ? 60_000 : 40_000)
    const result = await resizeToThumbnail(new Blob([new Uint8Array(9)], { type: 'image/jpeg' }))
    expect(result.quality).toBe(0.6)
    expect(convertCalls).toHaveLength(3)
    // 400×300 の描画は1回だけ(fillRect + drawImage の2件)
    expect(contextCalls).toHaveLength(2)
  })

  it('HEIC を mime で事前拒否しない(デコードできる環境では通す)', async () => {
    installFakeDecoder(4032, 3024)
    installFakeCanvas()
    const heic = new File([new Uint8Array(9)], 'IMG_0001.HEIC', { type: 'image/heic' })
    const result = await resizeToThumbnail(heic)
    expect(bitmapCalls).toHaveLength(1) // デコードを試している
    expect(result.data).toBeInstanceOf(ArrayBuffer)
  })

  it('HEIC のデコードに失敗したら kind: heic で常体の案内を返す', async () => {
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('unsupported format')))
    installFakeCanvas()
    disableImageElementPath()
    const heic = new File([new Uint8Array(9)], 'IMG_0001.HEIC', { type: 'image/heic' })
    const error = await resizeToThumbnail(heic).catch((cause: unknown) => cause)
    expect(isThumbnailError(error)).toBe(true)
    expect((error as ThumbnailError).kind).toBe('heic')
    expect((error as ThumbnailError).message).toBe(
      'この写真の形式(HEIC)はこのブラウザで読み込めない。iPhone の設定→カメラ→フォーマットを『互換性優先』にするか、JPEG に変換した写真を選ぶ。',
    )
    expect((error as ThumbnailError).cause).toBeInstanceOf(Error)
  })

  it('HEIC の案内文はエラーとは別に export されている(UI が同じ1文を使う)', () => {
    expect(HEIC_ADVICE).toBe(
      'この写真の形式(HEIC)はこのブラウザで読み込めない。iPhone の設定→カメラ→フォーマットを『互換性優先』にするか、JPEG に変換した写真を選ぶ。',
    )
  })

  it('HEIC 以外のデコード失敗は kind: decode(HEIC の案内を出さない)', async () => {
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('broken file')))
    installFakeCanvas()
    disableImageElementPath()
    const error = await resizeToThumbnail(
      new File([new Uint8Array(9)], 'broken.jpg', { type: 'image/jpeg' }),
    ).catch((cause: unknown) => cause)
    expect(isThumbnailError(error)).toBe(true)
    expect((error as ThumbnailError).kind).toBe('decode')
    expect((error as ThumbnailError).message).not.toContain('HEIC')
  })

  it('デコードできても寸法が 0 なら kind: decode(0px の canvas を作らない)', async () => {
    installFakeDecoder(0, 0)
    installFakeCanvas()
    const error = await resizeToThumbnail(new Blob([new Uint8Array(9)], { type: 'image/jpeg' })).catch(
      (cause: unknown) => cause,
    )
    expect(isThumbnailError(error)).toBe(true)
    expect((error as ThumbnailError).kind).toBe('decode')
    expect(convertCalls).toHaveLength(0)
  })

  it('デコード手段が1つも無い環境は kind: unsupported(黙って null を返さない)', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    installFakeCanvas()
    disableImageElementPath()
    const error = await resizeToThumbnail(new Blob([new Uint8Array(9)], { type: 'image/jpeg' })).catch(
      (cause: unknown) => cause,
    )
    expect(isThumbnailError(error)).toBe(true)
    expect((error as ThumbnailError).kind).toBe('unsupported')
  })

  it('canvas が無い環境は kind: unsupported', async () => {
    installFakeDecoder(1200, 900)
    vi.stubGlobal('OffscreenCanvas', undefined)
    vi.stubGlobal('document', undefined)
    const error = await resizeToThumbnail(new Blob([new Uint8Array(9)], { type: 'image/jpeg' })).catch(
      (cause: unknown) => cause,
    )
    expect(isThumbnailError(error)).toBe(true)
    expect((error as ThumbnailError).kind).toBe('unsupported')
    expect(closedBitmaps).toBe(1) // 失敗しても ImageBitmap を解放する
  })

  it('縮小しても 51200 バイトに収まらなければ投げる(無音で巨大保存しない)', async () => {
    installFakeDecoder(4032, 3024)
    installFakeCanvas()
    bytesFor = () => 120_000
    const error = await resizeToThumbnail(new Blob([new Uint8Array(9)], { type: 'image/jpeg' })).catch(
      (cause: unknown) => cause,
    )
    expect(isThumbnailError(error)).toBe(true)
    expect((error as ThumbnailError).kind).toBe('too-large')
    expect(convertCalls).toHaveLength(15)
  })
})

// ---------------------------------------------------------------- 実 canvas(ブラウザだけ)

describe.skipIf(!CANVAS_READY)('実 canvas での往復(この環境に canvas が無ければスキップ)', () => {
  /** 一様な色だと JPEG が極小になってラダーが動かないので、ノイズを描いた画像を作る */
  async function makeNoisyJpeg(width: number, height: number): Promise<Blob> {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')!
    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 4) {
        ctx.fillStyle = `rgb(${(x * 7) % 256},${(y * 13) % 256},${(x * y) % 256})`
        ctx.fillRect(x, y, 4, 4)
      }
    }
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 })
  }

  it('1200×900 の JPEG が 400×300 / JPEG / 51200 バイト以下になる', async () => {
    const result = await resizeToThumbnail(await makeNoisyJpeg(1200, 900))
    expect(result.width).toBe(400)
    expect(result.height).toBe(300)
    expect(result.data).toBeInstanceOf(ArrayBuffer)
    expect(result.bytes).toBe(result.data.byteLength)
    expect(result.bytes).toBeLessThanOrEqual(51200)
    expect(QUALITY_LADDER).toContain(result.quality)
  })

  it('元が小さい画像は拡大されない', async () => {
    const result = await resizeToThumbnail(await makeNoisyJpeg(120, 90))
    expect(result).toMatchObject({ width: 120, height: 90 })
  })

  it('画像でないファイルは kind: decode で拒否する', async () => {
    const error = await resizeToThumbnail(
      new File([new Uint8Array([1, 2, 3, 4])], 'note.txt', { type: 'text/plain' }),
    ).catch((cause: unknown) => cause)
    expect(isThumbnailError(error)).toBe(true)
    expect((error as ThumbnailError).kind).toBe('decode')
  })
})
