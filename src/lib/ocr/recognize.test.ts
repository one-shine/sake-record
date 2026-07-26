// OCR(銘柄候補を絞るための補助)の検証。
//
// この層は WASM も Worker も要るが、**判断のほとんどは純関数と配線に落ちている**ので
// jsdom で固定できる。3つに分けて検証する:
//   1. 純関数 … 資産パス / 環境判定 / 正規化 / 合算 / 進捗の算術。網羅的に
//   2. `runOcrPasses` … worker の生成関数を引数で受けるので、2パスの回し方・諦め方・中断を全部固定
//   3. 実 worker + 実 WASM の往復 … **この環境では走らない**(下の notice で明示してスキップ)
//
// ここで固定している「壊してはいけない性質」:
//   - 資産のパスが `BASE_URL` 相対で、**CDN のホスト名を含まない**(既定値のままだと外を見に行く)
//   - 横書きは jpn + PSM '6'、縦書きは jpn_vert + PSM '3'(実測でこの2組だけが機能した)
//   - 1文字も読めなければ **候補を出さずに `empty` で投げる**(もっともらしい別銘柄を出さない)
//   - 中断されたら**結果を返さない**(写真を選び直したときに古い認識が後から入らない)
//   - 読めた文字は捨てない(合算は信頼度で門を作らない。正解の信頼度は実測で 31〜38 だった)
//   - ただし**照合に流すのは最良のパスの半分以上の信頼度を持つ分だけ**。等価に連結すると
//     conf 0 のゴミ1文字が本命と同じ重さで効いて、別銘柄を自信ありげに1位に出す(実測)
//
// 期待値は実装から import せずリテラルで書く(実装と同じ出所から取った期待値は恒真になる)。

import { describe, expect, it, vi } from 'vitest'
import {
  OCR_ASSET_DIR,
  OCR_CANDIDATE_NOTE,
  OCR_CORE_FILE,
  OCR_ENGINE_MODE,
  OCR_LANG_DIR,
  OCR_LANG_FILES,
  OCR_LANG_GZIP,
  OCR_MESSAGES,
  OCR_PASSES,
  OCR_PHASE_LABELS,
  OCR_WORKER_FILE,
  OcrError,
  classifyOcrStatus,
  isOcrError,
  loadOcrEngine,
  mergeOcrResults,
  normalizeOcrText,
  ocrSupportProblem,
  overallRatio,
  pickEngineExports,
  readBaseUrl,
  readOcrEnvironment,
  recognizeLabel,
  resolveOcrAssetPaths,
  runOcrPasses,
  selectMatchableResults,
  type OcrErrorKind,
  type OcrProgress,
  type OcrResult,
  type OcrWorkerFactory,
  type OcrWorkerOptions,
} from './recognize.ts'
import { notice } from '../../test/notice.ts'

/** 実 worker + 実 WASM が動く環境か。**stub を作る前に評価する**(偽物で true にしない) */
const OCR_ENV = readOcrEnvironment()
const OCR_READY = OCR_ENV.wasm && OCR_ENV.simd && OCR_ENV.worker

// スキップを無音にしない。「テストは緑なのに実写真は誰も通していない」状態を出力に残す。
// 出力の作り方(なぜ console では出ないか)は `src/test/notice.ts` の1箇所が持つ。
if (!OCR_READY) {
  const missing = [
    OCR_ENV.wasm ? '' : 'WebAssembly',
    OCR_ENV.simd ? '' : 'WebAssembly SIMD',
    OCR_ENV.worker ? '' : 'Worker',
  ].filter((name) => name !== '')
  notice(
    `[recognize.test] SKIP: ${missing.join(' / ')} が無い環境(jsdom)なので、` +
      '実 worker で WASM を走らせる往復テスト1件をスキップした。' +
      '実写真(横書き/縦書きのラベルから文字が出るか・数秒かかる体感)の確認はブラウザで行う' +
      `(public/${OCR_ASSET_DIR} に資産が同梱されていることが前提)。`,
  )
}

const IMAGE = new Blob(['jpeg-bytes'], { type: 'image/jpeg' })

// ---------------------------------------------------------------- 資産と組み合わせ(リテラルで固定)

describe('同梱する資産の契約', () => {
  it('置き場は ocr/(BASE_URL からの相対)', () => {
    expect(OCR_ASSET_DIR).toBe('ocr/')
  })

  it('worker と core のファイル名', () => {
    expect(OCR_WORKER_FILE).toBe('worker.min.js')
    // simd 版 lstm の単一ファイル。**ディレクトリを渡すと4変種を置く必要が出る**ので1本に固定する
    expect(OCR_CORE_FILE).toBe('tesseract-core-simd-lstm.wasm.js')
  })

  it('学習データは tessdata/ の下に gz のまま置く(jpn と jpn_vert の2つ)', () => {
    // 直下ではなく `tessdata/` の下。ここがずれると全部 404 で `assets` になる
    expect(OCR_LANG_FILES).toEqual([
      'tessdata/jpn.traineddata.gz',
      'tessdata/jpn_vert.traineddata.gz',
    ])
    expect(OCR_LANG_DIR).toBe('tessdata')
    // 置くのが `.gz` なので gzip: true。false だと `.traineddata` を取りに行って404
    expect(OCR_LANG_GZIP).toBe(true)
  })

  it('パスは横書き → 縦書きの2本', () => {
    expect(OCR_PASSES).toEqual([
      { source: 'horizontal', lang: 'jpn', psm: '6' },
      { source: 'vertical', lang: 'jpn_vert', psm: '3' },
    ])
  })

  it('パスの lang が同梱する学習データと対応している', () => {
    for (const pass of OCR_PASSES) {
      expect(OCR_LANG_FILES).toContain(`tessdata/${pass.lang}.traineddata.gz`)
    }
  })

  it('縦書きに SINGLE_LINE / SINGLE_WORD / SINGLE_CHAR を使わない(実測で空文字が返る)', () => {
    const vertical = OCR_PASSES.find((pass) => pass.source === 'vertical')
    expect(vertical?.psm).toBe('3')
    expect(['7', '8', '10']).not.toContain(vertical?.psm)
  })

  it('エンジンは LSTM_ONLY(=1)。学習データが fast/LSTM 版なので合わせる', () => {
    expect(OCR_ENGINE_MODE).toBe(1)
  })
})

// ---------------------------------------------------------------- 同梱物との突き合わせ

/**
 * `scripts/ocr-assets.mjs`(同梱物の単一の出所。生成 `npm run ocr:assets` と検査
 * `npm run ocr:check` が読む表)と、この層が実行時に渡すパスを突き合わせる。
 *
 * **これが無いと、置き場の変更が実機でしか露見しない。** この層のテストは全部スタブなので
 * 「langPath が1階層ずれている」「gz を置いたのに gzip: false」は全部緑のまま通り、
 * 実機では最初の1枚から `assets`(= 読み込めなかった)になる。実際に一度そうなっていた。
 *
 * `import` の指定子を変数にしているのは、`allowJs` を切った tsconfig で `.mjs` を
 * 静的に解決させないため(型は下の shape で受ける)。
 */
const ASSET_MANIFEST_PATH = '../../../scripts/ocr-assets.mjs'

/**
 * Node の組み込みモジュール。**このリポジトリには `@types/node` が無い**
 * (足すと本番 `src` に node のグローバルが漏れる。`src/test/notice.ts` の注記と同じ制約)ので、
 * 上の `.mjs` と同じ手で指定子を変数にして静的解決を避け、必要な形だけ自前で書く。
 */
const NODE_VM = 'node:vm'
const NODE_FS = 'node:fs'
interface NodeVm {
  runInNewContext: (code: string, sandbox: Record<string, unknown>) => void
}
interface NodeFs {
  readFileSync: (path: string, encoding: string) => string
}

interface AssetManifest {
  EXPECTED: string[]
  RUNTIME_PATHS: { corePath: string; workerPath: string; langPath: string; langs: string[] }
  CORE_QUIET_SHIM: string
  /** リポジトリの絶対パスと同梱先。同梱物の置き場を知っているのは表の側だけ */
  root: string
  OCR_DIR: string
}

describe('同梱物の表(scripts/ocr-assets.mjs)との突き合わせ', () => {
  it('worker / core / 学習データの置き場が同梱物の表と一致する', async () => {
    const manifest = (await import(/* @vite-ignore */ ASSET_MANIFEST_PATH)) as AssetManifest
    const paths = resolveOcrAssetPaths('/')

    // 表は base 抜きの相対(`ocr/...`)。この層は BASE_URL を前置する
    expect(paths.workerPath).toBe(`/${manifest.RUNTIME_PATHS.workerPath}`)
    expect(paths.corePath).toBe(`/${manifest.RUNTIME_PATHS.corePath}`)
    expect(paths.langPath).toBe(`/${manifest.RUNTIME_PATHS.langPath}`)
  })

  it('走らせるパスの lang が同梱されている学習データと一致する', async () => {
    const manifest = (await import(/* @vite-ignore */ ASSET_MANIFEST_PATH)) as AssetManifest
    expect([...manifest.RUNTIME_PATHS.langs].sort()).toEqual(
      [...OCR_PASSES.map((pass) => pass.lang)].sort(),
    )
  })

  it('実行時に取りに行くファイル名が public/ocr/ に実在する名前と一致する', async () => {
    const manifest = (await import(/* @vite-ignore */ ASSET_MANIFEST_PATH)) as AssetManifest
    // tesseract が組む URL は `${langPath}/${lang}.traineddata${gzip ? '.gz' : ''}`。
    // 同梱物の表は `public/ocr/` からの相対なので、`ocr/` を外して突き合わせる
    const dir = OCR_LANG_DIR
    for (const pass of OCR_PASSES) {
      const fetched = `${dir}/${pass.lang}.traineddata${OCR_LANG_GZIP ? '.gz' : ''}`
      expect(manifest.EXPECTED).toContain(fetched)
      expect(OCR_LANG_FILES).toContain(fetched)
    }
    for (const file of [OCR_WORKER_FILE, OCR_CORE_FILE]) {
      expect(manifest.EXPECTED).toContain(file)
    }
  })

  /**
   * 同梱するコアの末尾には**改変(シム)が付いている**。tesseract の C++ 側は警告を stderr に
   * 書き、emscripten の既定はそれを `console.error` に流すので、**OCR 1回で console error が
   * 20件**出ていた(ブラウザ実測。OCR を押さない操作では0件)。`createWorker({ errorHandler })`
   * は JS 層のハンドラでこの経路を塞げず、worker はコアに `printErr` を渡す口を持たない。
   *
   * ここで見るのは「シムが実際に `printErr` を差し込むか」と「同梱物にそれが載っているか」。
   * 上流のコアが `printErr` を受け取り続けているかは `npm run ocr:check` が見る。
   */
  it('同梱するコアは emscripten の出力を console に流さない(シムの契約)', async () => {
    const manifest = (await import(/* @vite-ignore */ ASSET_MANIFEST_PATH)) as AssetManifest
    const vm = (await import(/* @vite-ignore */ NODE_VM)) as unknown as NodeVm
    const fs = (await import(/* @vite-ignore */ NODE_FS)) as unknown as NodeFs

    // シムを**素の worker と同じ形**で走らせる: グローバルの `TesseractCore` を差し替える
    const seen: Record<string, unknown>[] = []
    const sandbox: Record<string, unknown> = {
      TesseractCore: (moduleArg: Record<string, unknown>) => {
        seen.push(moduleArg)
        return 'core-instance'
      },
    }
    vm.runInNewContext(manifest.CORE_QUIET_SHIM, sandbox)

    const progress = () => undefined
    const wrapped = sandbox.TesseractCore as (arg: Record<string, unknown>) => unknown
    expect(wrapped({ TesseractProgress: progress })).toBe('core-instance')
    expect(seen).toHaveLength(1)
    // 呼び出し側が渡した値は消さない(進捗が死ぬと画面の%が止まる)
    expect(seen[0].TesseractProgress).toBe(progress)
    // stdout / stderr の行き先を差し込む。**console ではない**
    const printErr = seen[0].printErr as (message: string) => void
    expect(typeof printErr).toBe('function')
    expect(typeof seen[0].print).toBe('function')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    printErr('Warning: Parameter not found: language_model_ngram_on')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()

    // 同梱物にそのシムが載っていること(`npm run ocr:assets` を通さずに手で置いたら落ちる)
    // 置き場は表(scripts/ocr-assets.mjs)が知っている。テスト側でパスを組み直さない
    const core = fs.readFileSync(`${manifest.root}/${manifest.OCR_DIR}/${OCR_CORE_FILE}`, 'utf8')
    expect(core.endsWith(manifest.CORE_QUIET_SHIM)).toBe(true)
  })
})

// ---------------------------------------------------------------- 資産のパス

describe('resolveOcrAssetPaths', () => {
  it('相対 base(本番の base は "./")', () => {
    expect(resolveOcrAssetPaths('./')).toEqual({
      workerPath: './ocr/worker.min.js',
      corePath: './ocr/tesseract-core-simd-lstm.wasm.js',
      langPath: './ocr/tessdata',
    })
  })

  it('ルート配信(開発サーバの BASE_URL は "/")', () => {
    expect(resolveOcrAssetPaths('/')).toEqual({
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/tesseract-core-simd-lstm.wasm.js',
      langPath: '/ocr/tessdata',
    })
  })

  it('langPath は学習データの実際の置き場を指す(直下だと404 — 回帰)', () => {
    // `public/ocr/tessdata/jpn.traineddata.gz` に置いてある。tesseract は
    // `${langPath}/${lang}.traineddata.gz` を組むので、langPath が `./ocr` だと1つ上を見る。
    // スタブ越しのテストは全部通るのに実機で必ず落ちる壊れ方なので、ここで名指しで縛る
    const { langPath } = resolveOcrAssetPaths('./')
    expect(langPath).toBe('./ocr/tessdata')
    expect(`${langPath}/jpn.traineddata.gz`).toBe('./ocr/tessdata/jpn.traineddata.gz')
  })

  it('サブパス配信(末尾スラッシュの有無で結果が変わらない)', () => {
    const withSlash = resolveOcrAssetPaths('/app/')
    expect(withSlash.workerPath).toBe('/app/ocr/worker.min.js')
    expect(withSlash.langPath).toBe('/app/ocr/tessdata')
    expect(resolveOcrAssetPaths('/app')).toEqual(withSlash)
  })

  it('空文字は "./" として扱う(絶対パスに落とさない)', () => {
    expect(resolveOcrAssetPaths('').workerPath).toBe('./ocr/worker.min.js')
  })

  it('スラッシュが二重にならない', () => {
    for (const base of ['./', '/', '/app/', '/app', '', 'ocr-base/']) {
      const paths = resolveOcrAssetPaths(base)
      for (const path of [paths.workerPath, paths.corePath, paths.langPath]) {
        expect(path).not.toContain('//')
      }
    }
  })

  it('CDN のホスト名を含まない(既定値のままだと jsdelivr を見に行く — 回帰)', () => {
    for (const base of ['./', '/', '/app/', '']) {
      const paths = resolveOcrAssetPaths(base)
      for (const path of [paths.workerPath, paths.corePath, paths.langPath]) {
        const lower = path.toLowerCase()
        expect(lower).not.toContain('jsdelivr')
        expect(lower).not.toContain('unpkg')
        expect(lower).not.toContain('cdn')
        expect(lower).not.toContain('http')
        // スキーム付き(= 別オリジン)にならない
        expect(path).not.toMatch(/^[a-z][a-z0-9+.-]*:/i)
      }
    }
  })

  it('絶対URLの base は投げる(資産を別オリジンから読ませない)', () => {
    expect(() => resolveOcrAssetPaths('https://cdn.jsdelivr.net/npm/')).toThrow(RangeError)
    expect(() => resolveOcrAssetPaths('//cdn.jsdelivr.net/npm/')).toThrow(RangeError)
    expect(() => resolveOcrAssetPaths('data:text/plain,')).toThrow(RangeError)
  })

  it('readBaseUrl はこの環境でも使える値を返す(絶対URLでない・空でない)', () => {
    const base = readBaseUrl()
    expect(base).not.toBe('')
    expect(() => resolveOcrAssetPaths(base)).not.toThrow()
  })
})

// ---------------------------------------------------------------- 環境判定

describe('ocrSupportProblem', () => {
  it('3つ揃っていれば null(= 動かせる)', () => {
    expect(ocrSupportProblem({ wasm: true, simd: true, worker: true })).toBeNull()
  })

  it('1つでも欠けたら unsupported(組み合わせを網羅)', () => {
    const missing = [
      { wasm: false, simd: false, worker: false },
      { wasm: false, simd: false, worker: true },
      { wasm: false, simd: true, worker: false },
      { wasm: false, simd: true, worker: true },
      { wasm: true, simd: false, worker: false },
      { wasm: true, simd: false, worker: true },
      { wasm: true, simd: true, worker: false },
    ]
    for (const env of missing) {
      expect(ocrSupportProblem(env)).toBe('unsupported')
    }
  })
})

describe('readOcrEnvironment', () => {
  it('WebAssembly と SIMD をこの環境で検出できる(プローブのバイト列の回帰)', () => {
    // ここが false になると全端末で unsupported になり、機能が黙って消える。
    // node / 近年のブラウザは両方 true。**プローブが壊れていたら気づけるようにする**
    expect(OCR_ENV.wasm).toBe(true)
    expect(OCR_ENV.simd).toBe(true)
  })

  it('Worker の有無を返す(jsdom には無い)', () => {
    expect(typeof OCR_ENV.worker).toBe('boolean')
    expect(OCR_ENV.worker).toBe(typeof Worker === 'function')
  })
})

// ---------------------------------------------------------------- 出力の正規化

describe('normalizeOcrText', () => {
  it('空白・改行・タブ・全角空白を落とす(日本語の OCR は語間に空白を撒く)', () => {
    expect(normalizeOcrText('獅 祭\n')).toBe('獅祭')
    expect(normalizeOcrText('純米\t大 吟醸')).toBe('純米大吟醸')
    expect(normalizeOcrText('獺　祭')).toBe('獺祭')
  })

  it('空白だけなら空文字(縦書きに SINGLE_LINE を使うとこれが返る)', () => {
    expect(normalizeOcrText('')).toBe('')
    expect(normalizeOcrText('   \n\n  ')).toBe('')
  })

  it('NFKC で全角英数と半角カナの揺れを畳む', () => {
    expect(normalizeOcrText('７２０ｍｌ')).toBe('720ml')
    expect(normalizeOcrText('ｼﾞｭﾝﾏｲ')).toBe('ジュンマイ')
  })

  it('漢字はそのまま(照合に使う文字を落とさない)', () => {
    expect(normalizeOcrText('新十津川')).toBe('新十津川')
  })
})

// ---------------------------------------------------------------- 合算

function result(text: string, confidence: number, source: OcrResult['source']): OcrResult {
  return { text, confidence, source }
}

describe('mergeOcrResults', () => {
  it('空配列は空配列', () => {
    expect(mergeOcrResults([])).toEqual([])
  })

  it('信頼度の降順に並べる', () => {
    expect(
      mergeOcrResults([result('猟祭', 31, 'vertical'), result('獅祭', 38, 'horizontal')]),
    ).toEqual([result('獅祭', 38, 'horizontal'), result('猟祭', 31, 'vertical')])
  })

  it('低い信頼度を捨てない(実測で正解は 31〜38 だった)', () => {
    const merged = mergeOcrResults([result('猟祭', 3, 'vertical')])
    expect(merged).toEqual([result('猟祭', 3, 'vertical')])
  })

  it('空文字と空白だけの結果を落とす', () => {
    expect(mergeOcrResults([result('', 90, 'vertical'), result('   ', 80, 'horizontal')])).toEqual(
      [],
    )
  })

  it('同じ文字列は畳んで、信頼度の高い側(と source)を残す', () => {
    expect(
      mergeOcrResults([result('獺祭', 20, 'horizontal'), result('獺 祭', 55, 'vertical')]),
    ).toEqual([result('獺祭', 55, 'vertical')])
    expect(
      mergeOcrResults([result('獺祭', 55, 'horizontal'), result('獺祭', 20, 'vertical')]),
    ).toEqual([result('獺祭', 55, 'horizontal')])
  })

  it('信頼度が同じなら入力順(= 横書きが先)を保つ', () => {
    expect(
      mergeOcrResults([result('獅祭', 40, 'horizontal'), result('猟祭', 40, 'vertical')]),
    ).toEqual([result('獅祭', 40, 'horizontal'), result('猟祭', 40, 'vertical')])
  })

  it('信頼度が非有限・範囲外なら 0〜100 に寄せる(文字は捨てない)', () => {
    expect(mergeOcrResults([result('祭', Number.NaN, 'horizontal')])).toEqual([
      result('祭', 0, 'horizontal'),
    ])
    expect(mergeOcrResults([result('祭', -5, 'horizontal')])).toEqual([result('祭', 0, 'horizontal')])
    expect(mergeOcrResults([result('祭', 120, 'horizontal')])).toEqual([
      result('祭', 100, 'horizontal'),
    ])
    expect(mergeOcrResults([result('祭', Number.POSITIVE_INFINITY, 'vertical')])).toEqual([
      result('祭', 0, 'vertical'),
    ])
  })

  it('正規化した文字列を返す(照合側が空白を気にしなくてよい)', () => {
    expect(mergeOcrResults([result(' 獺 祭 \n', 50, 'vertical')])[0].text).toBe('獺祭')
  })
})

// ---------------------------------------------------------------- 照合に流す分の選別

/**
 * **回帰の本体。** ブラウザで9枚を通したとき、2パスを等価に連結したせいで
 * conf 0〜15 のゴミ1文字が conf 41〜53 の本命と同じ重さで照合に効き、
 * **正解が候補に無いまま別銘柄を自信ありげに1位に出した**(v2 → 花垣 / shichiken → 一品)。
 *
 * 期待値はすべてリテラル。比 0.5 を変えたらここが落ちるのが正しい。
 */
describe('selectMatchableResults', () => {
  it('実測9枚: 落ちるのは常にゴミ側で、本命は1枚も落ちない', () => {
    // ブラウザ実測の [横書きパス, 縦書きパス]。空文字のパスは mergeOcrResults が先に落とすので
    // ここには来ない(jikon の縦書き conf 95 の空文字がそれ)
    const measured: readonly (readonly [string, OcrResult[], string[]])[] = [
      ['h', [result('獅祭', 38, 'horizontal'), result('メ、.六獲', 0, 'vertical')], ['獅祭']],
      ['v', [result('獅多Xノブ', 14, 'horizontal'), result('猟祭', 31, 'vertical')], ['猟祭']],
      [
        'v2',
        [result('mが*垣', 15, 'horizontal'), result('新十純米大吟醒', 41, 'vertical')],
        ['新十純米大吟醒'],
      ],
      ['shichiken', [result('七覧', 53, 'horizontal'), result('品洛', 0, 'vertical')], ['七覧']],
      [
        'kariho',
        [result('[wu上導%ま梗の', 26, 'horizontal'), result('山廃絢米精米歩合六〇', 71, 'vertical')],
        ['山廃絢米精米歩合六〇'],
      ],
      [
        'denshu',
        [result('』中%。酒酒', 29, 'horizontal'), result('田酒特別純米酒', 62, 'vertical')],
        ['田酒特別純米酒'],
      ],
      // 両方が近い信頼度なら**両方使う**(片方を捨てるための機構ではない)
      [
        'oyama',
        [result('。大山', 83, 'horizontal'), result('大山特別純米', 72, 'vertical')],
        ['。大山', '大山特別純米'],
      ],
      ['jikon', [result('gw田>今', 38, 'horizontal')], ['gw田>今']],
      ['hakutsuru', [result('日稚', 26, 'horizontal'), result('滞', 0, 'vertical')], ['日稚']],
    ]
    for (const [name, results, matchable] of measured) {
      const selection = selectMatchableResults(results)
      expect(selection.matchable.map((r) => r.text), name).toEqual(matchable)
      // 落とした分も**返す**(画面には出す。読めた文字を黙って消さない)
      expect(
        [...selection.matchable, ...selection.ignored].map((r) => r.text).sort(),
        name,
      ).toEqual(results.map((r) => r.text).sort())
    }
  })

  it('比で切る(絶対値の床ではない) — 全体が低調でも最良のパスは残る', () => {
    // 実測で正解が出たときの信頼度は 31〜38。20 や 30 に固定の床を置くと本命が消える
    const low = [result('猟祭', 12, 'vertical'), result('ノブ', 5, 'horizontal')]
    expect(selectMatchableResults(low).matchable.map((r) => r.text)).toEqual(['猟祭'])
    // 12 の半分は 6。5 は届かず 6 は届く(境界を含む)
    expect(
      selectMatchableResults([result('猟祭', 12, 'vertical'), result('ノブ', 6, 'horizontal')])
        .matchable.map((r) => r.text),
    ).toEqual(['猟祭', 'ノブ'])
  })

  it('信頼度 0 は最良が 0 でも証拠にしない(全部 0 なら照合に何も流さない)', () => {
    // 比だけだと「最良が 0 → 床も 0 → 全部通る」になり、ゴミがそのまま照合に流れる
    const selection = selectMatchableResults([
      result('メ、.六獲', 0, 'vertical'),
      result('滞', 0, 'horizontal'),
    ])
    expect(selection.matchable).toEqual([])
    expect(selection.ignored.map((r) => r.text)).toEqual(['メ、.六獲', '滞'])
  })

  it('空配列は両方空(呼び出し側が空文字を照合に渡して tooWeak になる)', () => {
    expect(selectMatchableResults([])).toEqual({ matchable: [], ignored: [] })
  })

  it('1パスしか無ければそれを使う(自分自身との比は必ず 1)', () => {
    const only = [result('獅祭', 3, 'horizontal')]
    expect(selectMatchableResults(only).matchable).toEqual(only)
  })
})

// ---------------------------------------------------------------- 進捗

describe('classifyOcrStatus', () => {
  it('recognizing を含むものだけ認識中(tesseract の status は英語)', () => {
    expect(classifyOcrStatus('recognizing text')).toBe('recognizing')
    expect(classifyOcrStatus('Recognizing Text')).toBe('recognizing')
  })

  it('それ以外は準備中に寄せる(未知の status で進捗を進めない)', () => {
    expect(classifyOcrStatus('loading tesseract core')).toBe('loading')
    expect(classifyOcrStatus('loading language traineddata')).toBe('loading')
    expect(classifyOcrStatus('initializing api')).toBe('loading')
    expect(classifyOcrStatus('')).toBe('loading')
  })

  it('段階の文言は常体で、絵文字を含まない', () => {
    for (const label of Object.values(OCR_PHASE_LABELS)) {
      expect(label).not.toBe('')
      expect(label).not.toMatch(/ください|しましょう/)
      expect(label).not.toMatch(/\p{Extended_Pictographic}/u)
    }
  })
})

describe('overallRatio', () => {
  it('2パスなら1本目の途中は前半に入る', () => {
    expect(overallRatio(0, 2, 0)).toBe(0)
    expect(overallRatio(0, 2, 0.5)).toBe(0.25)
    expect(overallRatio(0, 2, 1)).toBe(0.5)
    expect(overallRatio(1, 2, 0.5)).toBe(0.75)
    expect(overallRatio(1, 2, 1)).toBe(1)
  })

  it('1パスならそのまま', () => {
    expect(overallRatio(0, 1, 0.4)).toBe(0.4)
  })

  it('範囲外の進捗は詰める(tesseract の progress は稀に 1 を超える)', () => {
    expect(overallRatio(0, 2, 1.5)).toBe(0.5)
    expect(overallRatio(0, 2, -1)).toBe(0)
    expect(overallRatio(0, 2, Number.NaN)).toBe(0)
  })

  it('パス数や添字が定義域外でも 0〜1 に収まる', () => {
    expect(overallRatio(0, 0, 0.5)).toBe(0)
    expect(overallRatio(5, 2, 1)).toBe(1)
    expect(overallRatio(-1, 2, 0)).toBe(0)
    expect(overallRatio(Number.NaN, 2, 1)).toBe(0.5)
  })
})

// ---------------------------------------------------------------- 失敗の文言

describe('OcrError', () => {
  const kinds: OcrErrorKind[] = ['unsupported', 'assets', 'decode', 'empty', 'aborted']

  it('kind ごとに違う文言を持つ(UI が出し分けられる)', () => {
    const messages = kinds.map((kind) => OCR_MESSAGES[kind])
    expect(new Set(messages).size).toBe(kinds.length)
    for (const message of messages) expect(message).not.toBe('')
  })

  it('中断以外は「手で選ぶ」で終わる(手動の経路を毎回示す)', () => {
    for (const kind of kinds) {
      if (kind === 'aborted') continue
      expect(OCR_MESSAGES[kind]).toContain('手で選ぶ')
    }
  })

  it('文言は常体で、絵文字を含まない', () => {
    for (const kind of kinds) {
      expect(OCR_MESSAGES[kind]).not.toMatch(/ください|ませ|しましょう/)
      expect(OCR_MESSAGES[kind]).not.toMatch(/\p{Extended_Pictographic}/u)
    }
  })

  it('候補の前置きは「候補」であることと手動の経路を言う', () => {
    expect(OCR_CANDIDATE_NOTE).toContain('候補')
    expect(OCR_CANDIDATE_NOTE).toContain('手で選ぶ')
  })

  it('message は kind の文言、name は OcrError、isOcrError で拾える', () => {
    const error = new OcrError('empty')
    expect(error.message).toBe(OCR_MESSAGES.empty)
    expect(error.name).toBe('OcrError')
    expect(error.kind).toBe('empty')
    expect(isOcrError(error)).toBe(true)
    expect(isOcrError(new Error('別物'))).toBe(false)
    expect(isOcrError(null)).toBe(false)
  })

  it('cause を落とさない(原因を追える)', () => {
    const cause = new Error('fetch failed')
    expect(new OcrError('assets', { cause }).cause).toBe(cause)
  })
})

// ---------------------------------------------------------------- ライブラリの定数との対応

describe('tesseract.js の定数との対応(worker は起こさない)', () => {
  it('OCR_ENGINE_MODE と PSM の生値がライブラリ側の名前と一致する', async () => {
    // このモジュールは PSM/OEM を生値で持っている(実測の組み合わせをリテラルで固定したいので)。
    // 生値がライブラリの定数からずれたら、**別のモードで走って静かに精度が落ちる**のでここで縛る。
    const { OEM, PSM } = await import('tesseract.js')
    expect(OCR_ENGINE_MODE).toBe(OEM.LSTM_ONLY)
    expect(OCR_PASSES.find((pass) => pass.source === 'horizontal')?.psm).toBe(PSM.SINGLE_BLOCK)
    expect(OCR_PASSES.find((pass) => pass.source === 'vertical')?.psm).toBe(PSM.AUTO)
  })

  it('loadOcrEngine は実モジュールを動的に読んで createWorker を包める(worker は起こさない)', async () => {
    // 静的 import に戻すと初期バンドルに 1.3MB 入る。**動的 import が生きていること**の検査。
    // 呼ぶところまではやらない(Worker が無い環境なので起こせない)
    const engine = await loadOcrEngine()
    expect(typeof engine.createWorker).toBe('function')
  })
})

// ---------------------------------------------------------------- エンジンの取り出し

describe('pickEngineExports', () => {
  const createWorker = () => undefined
  type FakeModule = { createWorker: () => undefined }

  it('名前付き export に createWorker があればそれを使う', () => {
    const mod: FakeModule = { createWorker }
    expect(pickEngineExports<FakeModule>(mod)).toBe(mod)
  })

  it('default 側にあれば default を使う(CJS を ESM から読んだとき)', () => {
    const inner: FakeModule = { createWorker }
    expect(pickEngineExports<FakeModule>({ default: inner })).toBe(inner)
  })

  it('どちらにも無ければ unsupported(黙って機能を消さない)', () => {
    expect(() => pickEngineExports<FakeModule>({})).toThrow(OcrError)
    expect(() => pickEngineExports<FakeModule>(undefined)).toThrow(OcrError)
    try {
      pickEngineExports<FakeModule>({ default: {} })
      expect.unreachable('createWorker が無いのに投げなかった')
    } catch (cause) {
      expect(isOcrError(cause) && cause.kind).toBe('unsupported')
    }
  })
})

// ---------------------------------------------------------------- 2パスの配線

type PassOutcome = { text: string; confidence: number } | Error

interface StubLog {
  created: { lang: string; options: OcrWorkerOptions }[]
  reinitialized: { lang: string; oem: number }[]
  params: Record<string, string>[]
  images: Blob[]
  terminated: number
}

interface StubConfig {
  outcomes?: readonly PassOutcome[]
  createError?: Error
  reinitError?: Error
  /** 認識が**永久に解決しない**(= worker を terminate した後の実物の振る舞い) */
  recognizeHangs?: boolean
  /** 学習データの差し替えが永久に解決しない(取得中に落とされた状況) */
  reinitHangs?: boolean
  onReinitialize?: () => void
  /** 認識に入る直前に呼ぶ(中断を割り込ませるため) */
  beforeRecognize?: (index: number) => void
  /** 認識中に tesseract が logger を叩くのを模す */
  emit?: (logger: OcrWorkerOptions['logger'], index: number) => void
}

function makeStub(config: StubConfig = {}): { factory: OcrWorkerFactory; log: StubLog } {
  const log: StubLog = { created: [], reinitialized: [], params: [], images: [], terminated: 0 }
  const factory: OcrWorkerFactory = async (lang, options) => {
    log.created.push({ lang, options })
    if (config.createError !== undefined) throw config.createError
    return {
      reinitialize: async (nextLang, oem) => {
        log.reinitialized.push({ lang: nextLang, oem })
        config.onReinitialize?.()
        if (config.reinitHangs === true) return new Promise(() => {})
        if (config.reinitError !== undefined) throw config.reinitError
      },
      setParameters: async (params) => {
        log.params.push(params)
      },
      recognize: async (image) => {
        const index = log.images.length
        log.images.push(image)
        config.beforeRecognize?.(index)
        config.emit?.(options.logger, index)
        if (config.recognizeHangs === true) return new Promise(() => {})
        const outcome = config.outcomes?.[index] ?? { text: '', confidence: 0 }
        if (outcome instanceof Error) throw outcome
        return { data: outcome }
      },
      terminate: async () => {
        log.terminated += 1
      },
    }
  }
  return { factory, log }
}

const BOTH: readonly PassOutcome[] = [
  { text: '獅祭', confidence: 38 },
  { text: '猟祭', confidence: 31 },
]

describe('runOcrPasses', () => {
  it('横書きと縦書きの両方を走らせて合算する(どちらが当たるか事前に分からない)', async () => {
    const { factory } = makeStub({ outcomes: BOTH })
    await expect(runOcrPasses(IMAGE, factory, { base: './' })).resolves.toEqual([
      { text: '獅祭', confidence: 38, source: 'horizontal' },
      { text: '猟祭', confidence: 31, source: 'vertical' },
    ])
  })

  it('worker は1つを使い回し、2本目は reinitialize で学習データを差し替える', async () => {
    const { factory, log } = makeStub({ outcomes: BOTH })
    await runOcrPasses(IMAGE, factory, { base: './' })
    expect(log.created).toHaveLength(1)
    expect(log.created[0].lang).toBe('jpn')
    expect(log.reinitialized).toEqual([{ lang: 'jpn_vert', oem: 1 }])
  })

  it('パスごとに実測の PSM を渡す(横書き 6 / 縦書き 3)', async () => {
    const { factory, log } = makeStub({ outcomes: BOTH })
    await runOcrPasses(IMAGE, factory, { base: './' })
    expect(log.params).toEqual([
      { tessedit_pageseg_mode: '6' },
      { tessedit_pageseg_mode: '3' },
    ])
  })

  it('原寸の元ファイルをそのまま渡す(サムネイルに差し替えない)', async () => {
    const { factory, log } = makeStub({ outcomes: BOTH })
    await runOcrPasses(IMAGE, factory, { base: './' })
    expect(log.images).toEqual([IMAGE, IMAGE])
    expect(log.images[0]).toBe(IMAGE)
  })

  it('資産のパスは BASE_URL 相対で、CDN のホスト名を含まない(回帰)', async () => {
    const { factory, log } = makeStub({ outcomes: BOTH })
    await runOcrPasses(IMAGE, factory, { base: './' })
    const options = log.created[0].options
    expect(options.workerPath).toBe('./ocr/worker.min.js')
    expect(options.corePath).toBe('./ocr/tesseract-core-simd-lstm.wasm.js')
    expect(options.langPath).toBe('./ocr/tessdata')
    for (const path of [options.workerPath, options.corePath, options.langPath]) {
      expect(path.toLowerCase()).not.toContain('jsdelivr')
      expect(path.toLowerCase()).not.toContain('cdn')
      expect(path).not.toMatch(/^[a-z][a-z0-9+.-]*:/i)
    }
  })

  it('gz の学習データを読み、worker は実ファイルから起こし、学習データは端末に残す', async () => {
    const { factory, log } = makeStub({ outcomes: BOTH })
    await runOcrPasses(IMAGE, factory, { base: './' })
    const options = log.created[0].options
    // `.traineddata.gz` を同梱するので true。false だと `.traineddata` を取りに行って404になる
    expect(options.gzip).toBe(true)
    // Blob URL の worker は SW に挟まれない経路になり得るので実ファイルから起こす
    expect(options.workerBlobURL).toBe(false)
    // 一度読んだ学習データを IndexedDB に持つ → 2回目以降はオフラインでも読める
    expect(options.cacheMethod).toBe('write')
  })

  it('成功しても worker を必ず落とす(wasm のヒープを抱えたままにしない)', async () => {
    const { factory, log } = makeStub({ outcomes: BOTH })
    await runOcrPasses(IMAGE, factory, { base: './' })
    expect(log.terminated).toBeGreaterThanOrEqual(1)
  })

  it('1文字も読めなければ empty で投げる(もっともらしい別銘柄を出さない)', async () => {
    const { factory } = makeStub({
      outcomes: [
        { text: '', confidence: 0 },
        { text: '  \n ', confidence: 0 },
      ],
    })
    await expect(runOcrPasses(IMAGE, factory, { base: './' })).rejects.toMatchObject({
      kind: 'empty',
      message: OCR_MESSAGES.empty,
    })
  })

  it('片方のパスが落ちても、もう片方の結果は捨てない', async () => {
    const { factory } = makeStub({
      outcomes: [new Error('leptonica: unsupported format'), { text: '猟祭', confidence: 31 }],
    })
    await expect(runOcrPasses(IMAGE, factory, { base: './' })).resolves.toEqual([
      { text: '猟祭', confidence: 31, source: 'vertical' },
    ])
  })

  it('両方の認識が落ちたら decode(画像として読めなかった)', async () => {
    const { factory, log } = makeStub({
      outcomes: [new Error('bad image'), new Error('bad image')],
    })
    await expect(runOcrPasses(IMAGE, factory, { base: './' })).rejects.toMatchObject({
      kind: 'decode',
    })
    expect(log.terminated).toBeGreaterThanOrEqual(1)
  })

  it('worker を作れなければ assets(オフラインで未キャッシュ)', async () => {
    const { factory, log } = makeStub({ createError: new Error('failed to fetch worker.min.js') })
    await expect(runOcrPasses(IMAGE, factory, { base: './' })).rejects.toMatchObject({
      kind: 'assets',
      message: OCR_MESSAGES.assets,
    })
    expect(log.created).toHaveLength(1)
    expect(log.images).toHaveLength(0)
  })

  it('学習データを差し替えられず、他のパスも読めなければ assets', async () => {
    const { factory } = makeStub({
      outcomes: [{ text: '', confidence: 0 }],
      reinitError: new Error('failed to fetch jpn_vert.traineddata'),
    })
    await expect(runOcrPasses(IMAGE, factory, { base: './' })).rejects.toMatchObject({
      kind: 'assets',
    })
  })

  it('失敗の cause を落とさない', async () => {
    const cause = new Error('failed to fetch')
    const { factory } = makeStub({ createError: cause })
    await expect(runOcrPasses(IMAGE, factory, { base: './' })).rejects.toMatchObject({ cause })
  })

  it('パスを指定できる(1本だけ走らせると reinitialize は起きない)', async () => {
    const { factory, log } = makeStub({ outcomes: [{ text: '獺祭', confidence: 70 }] })
    await expect(
      runOcrPasses(IMAGE, factory, {
        base: './',
        passes: [{ source: 'vertical', lang: 'jpn_vert', psm: '3' }],
      }),
    ).resolves.toEqual([{ text: '獺祭', confidence: 70, source: 'vertical' }])
    expect(log.created[0].lang).toBe('jpn_vert')
    expect(log.reinitialized).toEqual([])
  })

  it('パスが空なら投げる(認識が0回になる)', async () => {
    const { factory } = makeStub()
    await expect(runOcrPasses(IMAGE, factory, { base: './', passes: [] })).rejects.toThrow(
      RangeError,
    )
  })

  it('base が絶対URLなら投げる(worker を作る前に止める)', async () => {
    const { factory, log } = makeStub({ outcomes: BOTH })
    await expect(
      runOcrPasses(IMAGE, factory, { base: 'https://cdn.jsdelivr.net/npm/' }),
    ).rejects.toThrow(RangeError)
    expect(log.created).toHaveLength(0)
  })

  it('進捗を全パス通しの 0〜1 で返す', async () => {
    const seen: OcrProgress[] = []
    const { factory } = makeStub({
      outcomes: BOTH,
      emit: (logger) => {
        logger({ status: 'recognizing text', progress: 0.5 })
      },
    })
    await runOcrPasses(IMAGE, factory, {
      base: './',
      onProgress: (progress) => seen.push(progress),
    })
    expect(seen).toEqual([
      { source: 'horizontal', phase: 'recognizing', ratio: 0.25 },
      { source: 'vertical', phase: 'recognizing', ratio: 0.75 },
    ])
  })

  it('status も progress も無い logger 呼び出しでも壊れない', async () => {
    const seen: OcrProgress[] = []
    const { factory } = makeStub({
      outcomes: BOTH,
      emit: (logger) => {
        logger({})
      },
    })
    await runOcrPasses(IMAGE, factory, {
      base: './',
      onProgress: (progress) => seen.push(progress),
    })
    expect(seen).toEqual([
      { source: 'horizontal', phase: 'loading', ratio: 0 },
      { source: 'vertical', phase: 'loading', ratio: 0.5 },
    ])
  })
})

describe('runOcrPasses の中断(写真を選び直したとき)', () => {
  it('中断済みの signal なら worker を作らずに aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { factory, log } = makeStub({ outcomes: BOTH })
    await expect(
      runOcrPasses(IMAGE, factory, { base: './', signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'aborted' })
    // **資産を取りに行かせない。**数MBを読んでから捨てるのは無駄
    expect(log.created).toHaveLength(0)
  })

  it('認識中に中断されたら結果を返さず aborted(古い結果が後から入らない)', async () => {
    const controller = new AbortController()
    const { factory, log } = makeStub({
      outcomes: [{ text: '獺祭', confidence: 90 }],
      beforeRecognize: () => {
        controller.abort()
      },
    })
    await expect(
      runOcrPasses(IMAGE, factory, { base: './', signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'aborted' })
    // 1本目で止まる(2本目は走らない)
    expect(log.images).toHaveLength(1)
    expect(log.terminated).toBeGreaterThanOrEqual(1)
  })

  it('中断後は進捗を出さない(捨てる run の進捗を画面に出さない)', async () => {
    const controller = new AbortController()
    const seen: OcrProgress[] = []
    const { factory } = makeStub({
      outcomes: BOTH,
      emit: (logger) => {
        controller.abort()
        logger({ status: 'recognizing text', progress: 0.5 })
      },
    })
    await expect(
      runOcrPasses(IMAGE, factory, {
        base: './',
        signal: controller.signal,
        onProgress: (progress) => seen.push(progress),
      }),
    ).rejects.toMatchObject({ kind: 'aborted' })
    expect(seen).toEqual([])
  })

  it('worker を落としても認識の promise は解決しない。それでも aborted で返る(永久に待たない)', async () => {
    // 実物の振る舞い: `terminate()` は Worker を捨てるだけで、待っている promise を
    // reject しない(tesseract.js は `promises` に積んだまま)。**中断と競わせていないと
    // ここで永久に止まる** — スタブが素直に解決する限りテストは緑のままなので、
    // 宙に浮く promise をわざと作って固定する。タイムアウトで落ちたら回帰
    const controller = new AbortController()
    const { factory, log } = makeStub({
      recognizeHangs: true,
      beforeRecognize: () => {
        // 認識に入ったあと(= worker が動き出したあと)に写真を選び直した状況
        setTimeout(() => controller.abort(), 0)
      },
    })
    await expect(
      runOcrPasses(IMAGE, factory, { base: './', signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'aborted' })
    expect(log.images).toHaveLength(1)
    expect(log.terminated).toBeGreaterThanOrEqual(1)
  }, 3000)

  it('学習データの取得中に中断されても待たずに aborted で返る', async () => {
    const controller = new AbortController()
    const { factory } = makeStub({
      outcomes: [{ text: '獅祭', confidence: 38 }],
      // 2本目の reinitialize が返らないまま中断される(数MBの取得中に選び直した状況)
      reinitHangs: true,
      onReinitialize: () => {
        setTimeout(() => controller.abort(), 0)
      },
    })
    await expect(
      runOcrPasses(IMAGE, factory, { base: './', signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'aborted' })
  }, 3000)

  it('認識が中断で落ちた場合も decode ではなく aborted', async () => {
    const controller = new AbortController()
    const { factory } = makeStub({
      outcomes: [new Error('worker terminated')],
      beforeRecognize: () => {
        controller.abort()
      },
    })
    await expect(
      runOcrPasses(IMAGE, factory, { base: './', signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'aborted' })
  })
})

// ---------------------------------------------------------------- 入口(環境判定)

describe('recognizeLabel の門番', () => {
  it('環境が足りなければエンジンを読み込まずに unsupported', async () => {
    let loaded = 0
    await expect(
      recognizeLabel(IMAGE, {
        environment: { wasm: true, simd: false, worker: true },
        loadEngine: async () => {
          loaded += 1
          return { createWorker: makeStub().factory }
        },
      }),
    ).rejects.toMatchObject({ kind: 'unsupported' })
    // **1.3MB の遅延チャンクも 3.9MB の wasm も取りに行かせない**
    expect(loaded).toBe(0)
  })

  it('中断済みならエンジンを読み込まずに aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let loaded = 0
    await expect(
      recognizeLabel(IMAGE, {
        environment: { wasm: true, simd: true, worker: true },
        signal: controller.signal,
        loadEngine: async () => {
          loaded += 1
          return { createWorker: makeStub().factory }
        },
      }),
    ).rejects.toMatchObject({ kind: 'aborted' })
    expect(loaded).toBe(0)
  })

  it('環境が揃っていればエンジンを読み込んで2パス走らせる', async () => {
    const { factory, log } = makeStub({ outcomes: BOTH })
    await expect(
      recognizeLabel(IMAGE, {
        environment: { wasm: true, simd: true, worker: true },
        base: './',
        loadEngine: async () => ({ createWorker: factory }),
      }),
    ).resolves.toEqual([
      { text: '獅祭', confidence: 38, source: 'horizontal' },
      { text: '猟祭', confidence: 31, source: 'vertical' },
    ])
    expect(log.params).toHaveLength(2)
  })
})

// ---------------------------------------------------------------- 実 worker + 実 WASM(この環境では走らない)

describe.skipIf(!OCR_READY)('実 worker で WASM を走らせる往復(jsdom では走らない)', () => {
  it('canvas に描いた文字をラベル代わりに読み、1文字以上拾える', async () => {
    // 実写真は fixture としてリポジトリに置かない(更新されない fixture は嘘になる)。
    // ブラウザでは canvas に描いた合成ラベルで往復できる。
    //
    // **オーケストレーターの実測ではこの程度しか読めない**(合成の明朝体で 期待文字 1/2、
    // 信頼度 31〜38)。だから完全一致は期待しない — 期待するのは
    // 「候補を絞る材料が1つ以上出る」ことだけ。実写真の確認は手でブラウザで行う。
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 300
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('2D コンテキストが取れない')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#000000'
    ctx.font = '180px serif'
    ctx.textBaseline = 'top'
    ctx.fillText('獺祭', 40, 40)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (blob === null) throw new Error('canvas から PNG を書き出せない')

    const results = await recognizeLabel(blob)
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((r) => r.text.includes('獺') || r.text.includes('祭'))).toBe(true)
  }, 120_000)
})
