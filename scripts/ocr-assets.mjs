/**
 * 端末内 OCR(tesseract.js)の同梱物の**単一の出所**。
 *
 * 生成する側(`scripts/fetch-ocr-assets.mjs` = `npm run ocr:assets`)と
 * 検査する側(`scripts/check-ocr-assets.mjs` = `npm run ocr:check`)が同じ表を読む。
 * 2箇所に列挙するとドリフトして「生成できるが検査に落ちる」状態になるため、ここだけに書く。
 *
 * ## なぜ CDN ではなく同梱するのか
 * 写真を端末外に出さない前提(SPEC「データは端末内に閉じる」)なので OCR も端末内で動かす。
 * 同一オリジンに置けば第三者の実行時依存が無くなり、Service Worker の cache-first が
 * 一度取得したものを保持するのでオフラインでも動く(= 機内モードで記録できる不変条件を壊さない)。
 *
 * ## なぜ wasm 変種が1つだけなのか
 * tesseract.js-core は wasm 変種を6つ持ち、合計 29MB ある(node_modules 実測)。
 * ブラウザ側の読み込みは `tesseract.js/src/worker-script/browser/getCore.js` にあり、
 *   - corePath が "js" で終わる → **そのファイルだけを importScripts する**(特徴検出しない)
 *   - corePath がディレクトリ  → simd / relaxedsimd を実行時検出して変種を選ぶ
 * なので**1ファイルを名指しする**ことにして、simd-lstm(下記)だけを同梱する。
 *
 * ## なぜ `.wasm.js`(単一ファイル版)で、`.js` + `.wasm` の分割版ではないのか
 * tesseract.js は既定で worker を **blob: URL** として起こす(`worker/browser/spawnWorker.js`)。
 * blob: worker の中では `self.location.href` が blob: URL になるため、emscripten の
 * glue(`tesseract-core-simd-lstm.js`)が兄弟の `.wasm` を相対解決できない。
 * `.wasm.js` は wasm を base64 で内包した単一ファイル(依存 0)で、これが上流の CDN 既定でもある。
 * 分割版より 1MB 大きいが、部分キャッシュ(glue はあるが wasm が無い)という壊れ方も無くなる。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 同梱先。`public/data/sakenowa/` とは別の門にする(さけのわの gzip 200KB 予算を食わない) */
export const OCR_DIR = 'public/ocr'

/**
 * `public/ocr/` の**生の合計サイズ**の上限。
 * 初回だけ取得され SW がキャッシュするが、その初回は写真を撮った直後のモバイル回線で起きる。
 * 現状 7.7MB で、非 SIMD の予備コア(3.7MB)を足しても収まる幅として 12MB を置く。
 */
export const LIMIT_BYTES = 12 * 1024 * 1024

/**
 * 同梱物のバージョン。`docs/THIRD_PARTY.md` の記載と node_modules の実体の両方を
 * これに突き合わせる(依存を上げたのに同梱物と出典表が古いままになるのを防ぐ)。
 */
export const PINS = {
  'tesseract.js': '7.0.0',
  'tesseract.js-core': '7.0.0',
  '@tesseract.js-data/jpn': '1.0.0',
  '@tesseract.js-data/jpn_vert': '1.0.0',
}

/**
 * コアの末尾に足すシム。**emscripten の stdout/stderr を console に流させない。**
 *
 * ## なぜ要るか
 * tesseract の C++ 側は警告を stderr に書く(`Warning: Parameter not found: …` /
 * `Estimating resolution as 1153`)。emscripten の既定はこれを `console.error` に流すので、
 * **OCR を1回走らせるだけで console error が 20件出る**(ブラウザで実測)。
 * 「OCR を押さない操作では0件」だったので、これは OCR が持ち込んだ新規のノイズ。
 *
 * ## なぜここでしか塞げないか
 * `createWorker({ errorHandler })` は tesseract.js の**JS 層**のハンドラで、wasm の
 * stderr はそこを通らない。worker(`worker.min.js`)はコアを
 * `TesseractCore({ TesseractProgress })` として呼ぶだけで、`printErr` を渡す口が無い。
 * コア側は `e.printErr&&(ka=e.printErr)` と**受け取る用意がある**(コアの実体で確認、
 * `check-ocr-assets.mjs` が上流にこの受け口が残っていることを毎回検査する)ので、
 * **呼ばれる直前に差し込む**のがいちばん短い経路になる。
 *
 * ## 何を失うか
 * wasm の stderr に出る警告が見えなくなる。**失敗は握り潰していない** — 認識の失敗は
 * promise の reject で `runOcrPasses` が受けて `OcrError` に分類する(stderr は警告専用)。
 *
 * ## 効くことの確認
 * Node で実際に OCR を回して確かめた(このシムを当てた前後で `Estimating resolution as 1153` が
 * stderr に出る → 出ない。認識結果は "獅祭" / "猟祭" で不変)。
 *
 * ブラウザは `var TesseractCore` をグローバルに置く経路、Node は `module.exports` 経路を使う。
 * **両方差し替える**(上流の UMD の末尾と同じ形)。Apache-2.0 §4(b) の「改変の告知」として
 * 追記の先頭にコメントを置き、`docs/THIRD_PARTY.md` にも書く。
 */
export const CORE_QUIET_SHIM = `
/* 改変あり(同梱時の追記。上流のコードは1バイトも書き換えていない):
   emscripten の stdout/stderr を console に流させない。理由は docs/THIRD_PARTY.md */
(function () {
  if (typeof TesseractCore !== "function") return;
  var original = TesseractCore;
  var quiet = function () {};
  TesseractCore = function (moduleArg) {
    return original(Object.assign({ print: quiet, printErr: quiet }, moduleArg || {}));
  };
  if (typeof exports === "object" && typeof module === "object") {
    module.exports = TesseractCore;
    module.exports.default = TesseractCore;
  }
})();
`

/** 上流のコアに `printErr` の受け口が残っているか(消えたらシムが黙って効かなくなる) */
export const CORE_PRINT_ERR_HOOK = 'printErr&&('

/** 複製時に当てる改変。**生成する側と検査する側が同じ関数を通す**(でないと毎回不一致になる) */
export function patchCore(buf) {
  return Buffer.concat([buf, Buffer.from(CORE_QUIET_SHIM, 'utf8')])
}

/** node_modules から複製する成果物(出所が package-lock で固定される = 再現できる) */
export const VENDORED = [
  {
    dest: 'tesseract-core-simd-lstm.wasm.js',
    from: 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
    pkg: 'tesseract.js-core',
    why: 'wasm SIMD 版の LSTM 専用コア(wasm を base64 で内包した単一ファイル)',
    patch: patchCore,
    requires: CORE_PRINT_ERR_HOOK,
  },
  {
    dest: 'worker.min.js',
    from: 'node_modules/tesseract.js/dist/worker.min.js',
    pkg: 'tesseract.js',
    why: 'worker 本体。workerPath を同一オリジンに向けるために置く',
  },
  {
    dest: 'worker.min.js.LICENSE.txt',
    from: 'node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt',
    pkg: 'tesseract.js',
    why: 'worker.min.js 先頭の "For license information please see ..." が指す先(MIT/BSD の告知)',
  },
  {
    dest: 'LICENSE-Apache-2.0.txt',
    from: 'node_modules/tesseract.js/LICENSE.md',
    pkg: 'tesseract.js',
    why: 'Apache-2.0 §4(a): 再配布する成果物にライセンス全文を添える(core も同一文面)',
  },
]

/**
 * 学習データ。**tessdata_fast ではなく tesseract.js 既定の `4.0.0_best_int`** を使う。
 * 合成ラベルで両方を実測して比べた結果(同じ画像・同じ PSM・同じコア):
 *   横書き「獺祭」 best_int → "獅祭" conf 38 / **fast → "" conf 0(何も返さない)**
 *   縦書き「獺祭」 best_int → "猟祭" conf 31 / fast → "猟祭" conf 31
 * 候補絞りの設計は「獅祭」「猟祭」のような**惜しい誤読**が出ることを前提にしているので、
 * 横書きで空を返す fast にすると前提そのものが崩れる。しかも .gz 実寸は best_int の方が小さい
 * (jpn: 1.94MB vs fast 生 2.36MB)。精度もサイズも best_int が勝ったのでこちらを採る。
 *
 * ファイル名は `<lang>.traineddata.gz`。tesseract.js の既定は `gzip: true` で
 * `${langPath}/${lang}.traineddata.gz` を取りに来る(`worker-script/index.js`)。
 * 取得後に magic number(1f 8b)を見て自前で展開するので、サーバ側の設定は要らない。
 */
export const DOWNLOADED = [
  {
    dest: 'tessdata/jpn.traineddata.gz',
    url: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/jpn@1.0.0/4.0.0_best_int/jpn.traineddata.gz',
    pkg: '@tesseract.js-data/jpn',
    sha256: '2b63ebfbf1484de4a08ce53b29ef98a1c17658a93cbd38acb665d7d316d0be88',
    why: '横書きモデル',
  },
  {
    dest: 'tessdata/jpn_vert.traineddata.gz',
    url: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/jpn_vert@1.0.0/4.0.0_best_int/jpn_vert.traineddata.gz',
    pkg: '@tesseract.js-data/jpn_vert',
    sha256: '3a4f4df8df8f50f3389fe0da10502effced38faef763d8e540142bdc9b770308',
    why: '縦書きモデル。日本酒ラベルは縦書きが多いので必須',
  },
]

/** 同梱物の一覧(この4+2ファイル以外が public/ocr/ にあってはいけない) */
export const EXPECTED = [...VENDORED.map(v => v.dest), ...DOWNLOADED.map(d => d.dest)]

/**
 * src/ 側が createWorker に渡すパス。ここを出所にして、検査の出力にも印字する
 * (「どの名前で読むか」を実装者が推測しなくて済むようにする)。
 * base は相対(`vite.config.ts`)なので、実装側では `import.meta.env.BASE_URL` を前置する。
 */
export const RUNTIME_PATHS = {
  corePath: 'ocr/tesseract-core-simd-lstm.wasm.js',
  workerPath: 'ocr/worker.min.js',
  langPath: 'ocr/tessdata',
  langs: ['jpn', 'jpn_vert'],
}

export const sha256 = buf => createHash('sha256').update(buf).digest('hex')

export const kb = n => (n / 1024).toFixed(1) + 'KB'
export const mb = n => (n / 1024 / 1024).toFixed(2) + 'MB'

/** node_modules に実際に入っているバージョン。無ければ null(呼び手が理由を出して落とす) */
export function installedVersion(pkg) {
  try {
    return JSON.parse(readFileSync(resolve(root, 'node_modules', pkg, 'package.json'), 'utf8')).version
  } catch {
    return null
  }
}
