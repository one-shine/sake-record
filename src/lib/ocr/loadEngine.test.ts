// tesseract.js との**配線**の検証。ファイルを分けているのは、ここだけ `vi.mock` で
// tesseract.js を差し替えるから(同じファイルで実モジュールの定数も読むことはできない。
// 実モジュール側の検査 — OEM/PSM の生値の対応と動的 import が生きていること — は
// recognize.test.ts が持つ)。
//
// ここで固定している性質:
//   - `loadOcrEngine` が tesseract.js の `createWorker` に (lang, OEM=1, options) を渡す
//   - 包んだ worker が `reinitialize` / `setParameters` / `recognize` / `terminate` を素通しする
//   - `recognizeLabel` を既定のまま呼んだとき、**CDN ではなく同一オリジンのパス**で worker が作られる
//     (これが破れると、写真は端末外に出ないままでも資産の取得で外部通信が起きてオフラインが壊れる)

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OCR_ASSET_DIR, loadOcrEngine, recognizeLabel, type OcrWorkerOptions } from './recognize.ts'

/** `vi.mock` の factory はホイストされるので、参照する値も `vi.hoisted` に置く */
const stub = vi.hoisted(() => {
  const calls: { lang: unknown; oem: unknown; options: unknown }[] = []
  const worker = {
    reinitialize: vi.fn(async () => ({ jobId: 'job', data: null })),
    setParameters: vi.fn(async () => ({ jobId: 'job', data: null })),
    // 実測の生出力を模す(空白入り・信頼度38)
    recognize: vi.fn(async () => ({ jobId: 'job', data: { text: '獅 祭\n', confidence: 38 } })),
    terminate: vi.fn(async () => ({ jobId: 'job', data: null })),
  }
  const createWorker = vi.fn(async (lang: unknown, oem: unknown, options: unknown) => {
    calls.push({ lang, oem, options })
    return worker
  })
  return { calls, worker, createWorker }
})

vi.mock('tesseract.js', () => ({ createWorker: stub.createWorker }))

beforeEach(() => {
  vi.clearAllMocks()
  stub.calls.length = 0
})

const IMAGE = new Blob(['jpeg-bytes'], { type: 'image/jpeg' })
const FULL_ENV = { wasm: true, simd: true, worker: true }

const PATHS: OcrWorkerOptions = {
  workerPath: './x/worker.min.js',
  corePath: './x/core.wasm.js',
  langPath: './x',
  gzip: false,
  workerBlobURL: false,
  cacheMethod: 'write',
  logger: () => {},
  errorHandler: () => {},
}

describe('loadOcrEngine(tesseract.js をスタブして配線を見る)', () => {
  it('createWorker に lang と OEM=1(LSTM_ONLY)と設定をそのまま渡す', async () => {
    const engine = await loadOcrEngine()
    await engine.createWorker('jpn', PATHS)
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0].lang).toBe('jpn')
    expect(stub.calls[0].oem).toBe(1)
    expect(stub.calls[0].options).toEqual(PATHS)
  })

  it('包んだ worker は素の worker に素通しする', async () => {
    const engine = await loadOcrEngine()
    const worker = await engine.createWorker('jpn', PATHS)

    await worker.reinitialize('jpn_vert', 1)
    expect(stub.worker.reinitialize).toHaveBeenCalledWith('jpn_vert', 1)

    await worker.setParameters({ tessedit_pageseg_mode: '3' })
    expect(stub.worker.setParameters).toHaveBeenCalledWith({ tessedit_pageseg_mode: '3' })

    const recognized = await worker.recognize(IMAGE)
    expect(stub.worker.recognize).toHaveBeenCalledWith(IMAGE)
    expect(recognized.data.confidence).toBe(38)

    await worker.terminate()
    expect(stub.worker.terminate).toHaveBeenCalled()
  })
})

describe('recognizeLabel(既定のエンジン読み込み経路)', () => {
  it('同一オリジンの資産パスで worker を作る(CDN を見に行かせない — 回帰)', async () => {
    await recognizeLabel(IMAGE, { environment: FULL_ENV, base: './' })

    expect(stub.calls).toHaveLength(1)
    const options = stub.calls[0].options as OcrWorkerOptions
    expect(options.workerPath).toBe(`./${OCR_ASSET_DIR}worker.min.js`)
    expect(options.corePath).toBe(`./${OCR_ASSET_DIR}tesseract-core-simd-lstm.wasm.js`)
    expect(options.langPath).toBe('./ocr/tessdata')
    for (const path of [options.workerPath, options.corePath, options.langPath]) {
      expect(path.toLowerCase()).not.toContain('jsdelivr')
      expect(path.toLowerCase()).not.toContain('cdn')
      expect(path).not.toMatch(/^[a-z][a-z0-9+.-]*:/i)
    }
  })

  // ★ **同じ学習データのパスでは reinitialize しない**。縦書きは psm 5 と 3 の2本あるが
  // どちらも `jpn_vert` なので、再初期化(数MBの取得と初期化)は1回で足りる
  it('worker は1つで、学習データが変わるときだけ reinitialize する', async () => {
    await recognizeLabel(IMAGE, { environment: FULL_ENV, base: './' })
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0].lang).toBe('jpn')
    expect(stub.worker.reinitialize).toHaveBeenCalledTimes(1)
    expect(stub.worker.reinitialize).toHaveBeenCalledWith('jpn_vert', 1)
    expect(stub.worker.setParameters).toHaveBeenNthCalledWith(1, { tessedit_pageseg_mode: '6' })
    expect(stub.worker.setParameters).toHaveBeenNthCalledWith(2, { tessedit_pageseg_mode: '5' })
    expect(stub.worker.setParameters).toHaveBeenNthCalledWith(3, { tessedit_pageseg_mode: '3' })
    expect(stub.worker.terminate).toHaveBeenCalled()
  })

  it('生出力を正規化し、縦横で同じ読みなら1件に畳む(候補欄を同じ文字で埋めない)', async () => {
    const results = await recognizeLabel(IMAGE, { environment: FULL_ENV, base: './' })
    expect(results).toEqual([{ text: '獅祭', confidence: 38, source: 'horizontal' }])
  })
})
