// ラベルの写真から文字を読み、銘柄の**候補を絞るためだけ**の材料を返す層(OCR)。
//
// ## この層が引き受けていない決定(ここを間違えると要望と逆のものになる)
//
// **銘柄を決めるのは人。**この層は「読めた文字列」しか返さない。銘柄マスタとの照合も、
// 候補を出すかどうかの判断も持たない(照合は純関数として domain 側にあり、文字の希少性で
// 重み付けして閾値未満なら候補を出さない)。ここが銘柄名を返し始めたら、`linkBrand` が
// unlinked に推定値を埋めないという規律と矛盾する。
//
// ## なぜ src/lib/ に置くか
//
// Worker / WebAssembly / fetch に依存するのでブラウザでしか動かない。`src/domain/` は React も
// window も持たない純TS(eslint が強制)なので置けない。逆に照合ロジックは domain に置く —
// この層と照合を同じファイルに混ぜると、照合の単体テストが WASM を要求するようになる。
//
// ## 写真は端末外に出さない
//
// クラウド OCR は使わない。理由は3つあってどれも単独で決定的:
// SPEC の「データは端末内に閉じる」/ API キーを public な静的サイトに置けない / オフラインで動かない。
// 資産(worker / wasm / 学習データ)も**同一オリジンから読む**。tesseract.js の既定値は
// jsdelivr の CDN なので、`workerPath` / `corePath` / `langPath` を明示しないと黙って外を見に行く。
// `resolveOcrAssetPaths` が唯一の出所で、絶対URL(= 別オリジン)を渡されたら投げる。
//
// ## 3つに割ってある(resize.ts と同じ作法。ブラウザを要求するのは最後の1本だけ)
//
//   - 純関数 … 資産パスの組み立て / 環境判定 / 出力の正規化 / 合算・重複除去 / 進捗の算術。
//     ここに判断のほとんどが入っている
//   - `runOcrPasses` … 横書き/縦書きの2パスの回し方と諦め方。**worker の生成関数を引数で受ける**ので
//     WASM 無しで配線を全部検証できる
//   - `recognizeLabel` … 環境判定 → tesseract.js の遅延読み込み → 上を呼ぶ。**ブラウザでしか動かない**
//
// ## 実測(合成ラベル9枚をブラウザで通した計測。これに基づいて2パス構成にしている)
//
//   画像            横書きパス(jpn/PSM6)      縦書きパス(jpn_vert/PSM3)
//   h(獺祭)         "獅祭"        conf 38    "メ、.六獲"          conf  0
//   v(獺祭)         "獅多Xノブ"   conf 14    "猟祭"               conf 31
//   v2(紀土)        "mが*垣"      conf 15    "新十純米大吟醒"     conf 41
//   shichiken(七賢) "七覧"        conf 53    "品洛"               conf  0
//   kariho(刈穂)    "[wu上導%ま梗の" conf 26  "山廃絢米精米歩合六〇" conf 71
//   denshu(田酒)    "』中%。酒酒"  conf 29    "田酒特別純米酒"     conf 62
//   oyama(大山)     "。大山"      conf 83    "大山特別純米"       conf 72
//   jikon(而今)     "gw田>今"     conf 38    ""                   conf 95(空)
//
// **1画像1パスで測っていたときには見えなかった失敗がここにある**: 2パスを等価に連結すると
// conf 0〜15 のゴミ1文字が照合に混ざり、v2 は「垣」だけで花垣/高垣/八重垣を、
// shichiken は「品」だけで一品を、**正解が候補に無いまま自信ありげに1位**に出した。
// 落とすべきは絶対値ではなく**最良パスとの相対**で、上の表では 0.5 倍が全9枚を綺麗に分ける。
//
// 落としてはいけない点:
//   - **横書きと縦書きの両方を走らせて合算する。** どちらが当たるかは事前に分からない。
//     PSM AUTO は横書きで崩れ、縦書きに SINGLE_LINE / SINGLE_WORD を使うと**空文字が返る**。
//     組み合わせは `OCR_PASSES` が持つ(実測でこの2つだけが機能した)
//   - **信頼度の絶対値で門を作らない。** 正解が出たときの信頼度が 31〜38 だった。
//     20 や 30 に固定の床を置くと、実測で当たったケースが消える。
//     ただし**パスどうしの相対**は見る(`selectMatchableResults`) — 下の実測を参照
//   - **長辺2000pxに縮めて渡す。** 長辺400pxのサムネイルでは解像度が足りず、**原寸(4000px前後)は
//     大きすぎて逆に読めない**(2026-07-28 の実測: 3/9 → 6/9、3,934ms → 1,134ms)。
//     縮小は `prepareImage.ts` の担当で、**サムネイル生成の仕様(長辺400px / 50KB以下)は不変**
//   - **静的 import しない。** tesseract.js は 1.3MB。初期バンドルに入れるとアプリの初期表示と
//     オフライン起動が重くなる。`loadOcrEngine` の動的 import 1箇所だけが入口
//   - **失敗しても手動の経路を塞がない。** 文言はすべて「銘柄は手で選ぶ」で終わる。
//     もっともらしい別銘柄を上位に出すのが最悪の挙動なので、読めなければ読めないと言う
//
// ## HEIC は読めない(既知の限界)
//
// 画像のデコードは tesseract 内の Leptonica が行う(JPEG/PNG/BMP/TIFF/WebP)。ブラウザの
// デコーダは通らないので、**HEIC の元ファイルは `decode` で失敗する**。iOS Safari は
// `<input type="file">` で写真を選ぶとき JPEG に変換して渡すのが通常なので実害は限定的だが、
// ファイルアプリ経由などで HEIC がそのまま来たら読めない。文言でその可能性に触れている。

import { prepareOcrImage } from './prepareImage.ts'

/** 資産の置き場。`import.meta.env.BASE_URL` からの相対。**同梱担当はここに合わせる** */
export const OCR_ASSET_DIR = 'ocr/'

/** node_modules/tesseract.js/dist/worker.min.js (111KB) */
export const OCR_WORKER_FILE = 'worker.min.js'

/**
 * node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js (3.9MB)。
 *
 * `.wasm.js` は wasm を埋め込んだ単一ファイル(隣の `.wasm` は使わない)。
 * **1変種だけ同梱する。** corePath が `js` で終わっていると tesseract はその1本を読み、
 * ディレクトリを渡したときの SIMD 判定(= 変種を4つ置く必要)を通らない。
 * SIMD 非対応の端末は `ocrSupportProblem` が先に止める。
 */
export const OCR_CORE_FILE = 'tesseract-core-simd-lstm.wasm.js'

/**
 * 学習データの置き場。**`OCR_ASSET_DIR` の直下ではなく `tessdata/` の下**
 * (`scripts/ocr-assets.mjs` の `RUNTIME_PATHS.langPath` が単一の出所。`npm run ocr:check` が印字する)。
 *
 * ここが `ocr/` のままだと `ocr/jpn.traineddata.gz` を取りに行って**404 になり、
 * 何を撮っても `assets` で落ちる**。テストは全部スタブなので気づけない。
 */
export const OCR_LANG_DIR = 'tessdata'

/**
 * 同梱する学習データ(`OCR_ASSET_DIR` からの相対)。**gz のまま置く。**
 *
 * 中身は tesseract.js 既定の `4.0.0_best_int`(tessdata_fast ではない)。
 * 資産担当が同じ合成ラベルで両方を測った結果、**横書きは fast だと空文字を返した**
 * (best_int は "獅祭" conf 38 / fast は "" conf 0)。惜しい誤読が出ることを前提に候補を
 * 絞る設計なので、空を返す方を採ると前提が崩れる。しかも `.gz` の実寸も best_int の方が小さい。
 *
 * `jpn_vert` は縦書き用。日本酒のラベルは縦書きが多いので必須。
 */
export const OCR_LANG_FILES: readonly string[] = [
  'tessdata/jpn.traineddata.gz',
  'tessdata/jpn_vert.traineddata.gz',
]

/**
 * `.traineddata.gz` を置くので **true**(= tesseract の既定)。
 * false にすると `${langPath}/${lang}.traineddata` を取りに行って404になる。
 * 取得後は先頭バイト(1f 8b)を見て worker が自前で展開するので、配信側の設定は要らない。
 */
export const OCR_LANG_GZIP = true

/** どちらの組み合わせで読めたか。候補の出所を人に見せるために返す */
export type OcrSource = 'horizontal' | 'vertical'

/** 1パスの設定。`psm` は tesseract の Page Segmentation Mode の生値 */
export interface OcrPass {
  readonly source: OcrSource
  /** 学習データ名。`OCR_LANG_FILES` の `tessdata/` と `.traineddata.gz` を外したもの */
  readonly lang: string
  /** tesseract の `tessedit_pageseg_mode` に渡す値 */
  readonly psm: string
}

/**
 * 走らせるパス。**全部走らせて合算する**(どれが当たるかは事前に分からない)。
 *
 * `psm` は tesseract の PSM 定数の生値: `SINGLE_BLOCK = '6'` / `SINGLE_BLOCK_VERT_TEXT = '5'` /
 * `AUTO = '3'`。横書きに AUTO を使うと崩れ、縦書きに SINGLE_LINE や SINGLE_WORD を使うと
 * 空文字が返る。**組み合わせを変えるときは実写真ふうの画像で測り直す。**
 *
 * ## 縦書きを2本にしてある理由(2026-07-28 の実測)
 *
 * 合成した**写真ふう**のラベル9枚(縦書き・背景あり・傾き・ぼけ・JPEG劣化)で測ると、
 * **`AUTO` の縦書きパスは9枚すべて空文字**だった(ラベルが画面の一部だと行を見つけられない)。
 * 縦書き専用の `SINGLE_BLOCK_VERT_TEXT`(=5) を足すと 4/9 → **6/9**。
 * 一方、**背景の無い綺麗なラベルでは `AUTO` の方が当たる**(7/9。5 だけにすると 5/9 に落ちる)。
 * どちらか一方では両方の状況を拾えないので、**2本とも残して合算する**。
 * 追加コストは1パスぶんの時間だけで、資産は同じ `jpn_vert` を使い回す(再初期化も起きない)。
 */
export const OCR_PASSES: readonly OcrPass[] = [
  { source: 'horizontal', lang: 'jpn', psm: '6' },
  { source: 'vertical', lang: 'jpn_vert', psm: '5' },
  { source: 'vertical', lang: 'jpn_vert', psm: '3' },
]

/**
 * OCR エンジンの動作モード。1 = LSTM_ONLY(tesseract.js の既定)。
 * 同梱する core も学習データも LSTM 専用版なので、ここを変えると**同梱していないものを
 * CDN から取りに行く**(legacy のコアと legacy 込みの学習データ)。
 */
export const OCR_ENGINE_MODE = 1

/** 読めた1件。**銘柄ではない。**照合の材料 */
export interface OcrResult {
  /** 空白を落として正規化した文字列。空文字は返らない(`mergeOcrResults` が落とす) */
  text: string
  /** 0〜100。**並べ替えにだけ使う。**門にしない(実測で正解が 31〜38 だった) */
  confidence: number
  source: OcrSource
}

// ---------------------------------------------------------------- 失敗の分類

/**
 * 失敗の種類。呼び出し側は `kind` で文言を出し分ける(`instanceof` の分岐を UI に書かせない)。
 *
 * - `unsupported` … この環境では動かせない(WebAssembly / SIMD / Worker が無い)
 * - `assets`      … 資産(worker / wasm / 学習データ)を取得できない。オフラインで未キャッシュが主
 * - `decode`      … 画像として読めなかった(HEIC・壊れている・画像でない)
 * - `empty`       … 動いたが1文字も読めなかった。**もっともらしい別銘柄を出さずにここで止める**
 * - `aborted`     … 呼び出し側が中断した(写真を選び直した)。UI は何も出さなくてよい
 */
export type OcrErrorKind = 'unsupported' | 'assets' | 'decode' | 'empty' | 'aborted'

/**
 * 画面に出す文言。**出所はここ1箇所**(UI に写しを持たせるとドリフトする)。常体。
 *
 * `aborted` 以外は必ず「銘柄は手で選ぶ」で終わる — OCR が外れたときのコストをゼロにするのは
 * 「手動サジェストの経路が常に残っている」ことを毎回言うこと。
 */
export const OCR_MESSAGES: Record<OcrErrorKind, string> = {
  unsupported:
    'このブラウザでは写真から文字を読み取れない(WebAssembly に対応していない)。銘柄は手で選ぶ。',
  assets:
    '文字認識のデータを読み込めなかった。初回だけオンラインで一度読み込む必要がある。銘柄は手で選ぶ。',
  decode:
    'この写真は文字認識が読める形式ではなかった(JPEG か PNG なら読める)。銘柄は手で選ぶ。',
  empty: 'この写真からは文字を読み取れなかった。銘柄は手で選ぶ。',
  aborted: '文字の読み取りを中止した。',
}

/**
 * 候補を人に見せるときの前置き。**候補は候補**だと毎回言うためにここに置く
 * (OCR の位置づけを説明する文言なので、出所をこのモジュールに集める)。
 */
export const OCR_CANDIDATE_NOTE = '写真から読めた文字で絞った候補。合っていなければ手で選ぶ。'

export class OcrError extends Error {
  readonly kind: OcrErrorKind

  constructor(kind: OcrErrorKind, options?: ErrorOptions) {
    super(OCR_MESSAGES[kind], options)
    this.name = 'OcrError'
    this.kind = kind
  }
}

export function isOcrError(value: unknown): value is OcrError {
  return value instanceof OcrError
}

// ---------------------------------------------------------------- 資産のパス(純関数)

export interface OcrAssetPaths {
  workerPath: string
  corePath: string
  langPath: string
}

/** 絶対URL(= 別オリジン)らしいか。`https://…` と `//cdn…` の両方を見る */
function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')
}

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

/**
 * `import.meta.env.BASE_URL`。ビルドの base は `'./'`(完全相対)なので、**絶対パス決め打ちは
 * 本番で404になる**。ここを読むのは `recognizeLabel` / `runOcrPasses` の既定値のときだけで、
 * 純関数側は base を引数で受け取る。
 */
export function readBaseUrl(): string {
  const base: unknown = import.meta.env.BASE_URL
  return typeof base === 'string' && base !== '' ? base : './'
}

/**
 * 資産の3つのパスを組み立てる。**tesseract.js の CDN 既定値を上書きするための唯一の出所。**
 *
 * 相対のまま返してよい。tesseract.js は `createWorker` の中で
 * `new URL(path, window.location.href)` を通す(`src/utils/resolvePaths.js`)ので、
 * worker を起こす前にメインスレッド側で絶対URLになる。**worker の中で相対解決されることはない**
 * (もしそうなら worker 自身の URL 基準になって `ocr/ocr/…` に化ける)。
 *
 * `base` が絶対URLなら投げる — 資産を別オリジンから読むのは「端末内に閉じる」に反するし、
 * オフライン動作も壊れる。**同一オリジンであることをこの1箇所で保証する**(呼び出し側は
 * `import.meta.env.BASE_URL` を渡すだけ)。空文字は `'./'` として扱う。
 */
export function resolveOcrAssetPaths(base: string): OcrAssetPaths {
  if (isAbsoluteUrl(base)) {
    throw new RangeError(
      `OCR の資産は同一オリジンから読む(base に絶対URLを渡せない: ${base})。CDN を見に行かせない。`,
    )
  }
  const dir = withTrailingSlash(base === '' ? './' : base) + OCR_ASSET_DIR
  return {
    workerPath: dir + OCR_WORKER_FILE,
    corePath: dir + OCR_CORE_FILE,
    // langPath は**ディレクトリ**。tesseract が `${langPath}/${lang}.traineddata.gz` を組む。
    // 末尾スラッシュは付けない(付けても replace(/\/$/,'') されるが、組み立てを見えるようにする)
    langPath: dir + OCR_LANG_DIR,
  }
}

// ---------------------------------------------------------------- 環境判定(純関数)

/** OCR に必要な能力。globals を直に見ないので、判定を網羅的に検証できる */
export interface OcrEnvironment {
  wasm: boolean
  /** WebAssembly SIMD。同梱する core が simd 版1本だけなので必須 */
  simd: boolean
  /** 認識は Worker の中で走る(メインスレッドを数秒止めない) */
  worker: boolean
}

/**
 * SIMD 対応を判定するための最小の wasm モジュール(`v128.const` を含む)。
 * `WebAssembly.validate` が受け付ければ SIMD が使える。wasm-feature-detect と同じ手口。
 */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
])

/** この環境の能力を測る。**globals に触るのはここだけ** */
export function readOcrEnvironment(): OcrEnvironment {
  const wasm = typeof WebAssembly === 'object' && typeof WebAssembly.validate === 'function'
  return {
    wasm,
    simd: wasm && WebAssembly.validate(SIMD_PROBE),
    worker: typeof Worker === 'function',
  }
}

/**
 * 動かせない理由を返す(動かせるなら `null`)。**推測で動かして途中で落とさない** —
 * 資産を数MB取りに行ってから失敗するより、先に「この端末では無理」と言う方が安い。
 */
export function ocrSupportProblem(env: OcrEnvironment): OcrErrorKind | null {
  if (!env.wasm || !env.simd || !env.worker) return 'unsupported'
  return null
}

// ---------------------------------------------------------------- 出力の正規化と合算(純関数)

/**
 * OCR の生出力を照合に渡せる形にする。**空白を全部落とす**(日本語の OCR は語間に空白と改行を
 * 撒くだけで、レイアウトの情報は照合に使わない)。NFKC で全角英数や合成文字の揺れも畳む。
 *
 * 銘柄マスタ側の正規化は照合側が持つ。ここでやるのは「OCR 由来のゴミを落とす」ところまで。
 * スペック語彙(純米大吟醸など)の除外も**ここではやらない** — 除外は照合の仕事で、
 * domain の `STYLE_TERMS` を再利用する(語彙を二重に持たない)。
 */
export function normalizeOcrText(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/gu, '')
}

/** 0〜100 に収める。非有限や範囲外は捨てずに寄せる(**文字は残す**。信頼度は並べ替えの材料) */
function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/**
 * 複数パスの結果を1本にする。**空を落とし、同じ文字列を畳み、信頼度の降順にする。**
 *
 * 同じ文字列が複数パスから出たら信頼度の高い方を残す(source もその側になる)。
 * 信頼度が同じものは入力順のまま(`OCR_PASSES` の順 = 横書きが先)。
 *
 * **ここでは低信頼度を捨てない。** 読めた文字は画面に出すし、どのパスを照合に流すかは
 * この関数の関心ではない(`selectMatchableResults` が分ける)。ここで落とすと
 * 「何が読めたのか」まで画面から消える。
 */
export function mergeOcrResults(results: readonly OcrResult[]): OcrResult[] {
  const best = new Map<string, OcrResult>()
  for (const result of results) {
    const text = normalizeOcrText(result.text)
    if (text === '') continue
    const confidence = clampConfidence(result.confidence)
    const previous = best.get(text)
    if (previous !== undefined && previous.confidence >= confidence) continue
    best.set(text, { text, confidence, source: result.source })
  }
  // sort は安定なので、信頼度が同じものは Map の挿入順(= パスの順)が残る
  return [...best.values()].sort((a, b) => b.confidence - a.confidence)
}

/**
 * 照合に流す読み取りの下限を、**最良のパスの信頼度に対する比**で決める。
 *
 * 絶対値の床にしないのは、正解が出たときの信頼度が 31〜38 だったから(床を 30 に置くと
 * 実測で当たった `猟祭` conf 31 が消える)。**比なら「今回の読みの中で相対的に信用できないもの」**
 * を落とせるので、全体が低調な写真でも最良のパスは残る。
 *
 * 0.5 は実測から。9枚の内訳は上の表のとおりで、落ちるのは 38対0 / 31対14 / 41対15 / 53対0 /
 * 71対26 / 62対29 の低い側だけ。**残す側の最小比は 72/83 = 0.87** なので境界に余裕がある。
 */
export const OCR_MATCH_CONFIDENCE_RATIO = 0.5

/**
 * 読み取りを「照合に流すもの」と「画面には出すが照合には流さないもの」に分ける。**純関数**。
 *
 * ### なぜ分けるのか(捨てるのではなく分ける)
 * 2つのパスの出力を等価に連結して照合に渡すと、**エンジン自身が信用していない読み**の1文字が
 * 信用している読みと同じ重さで効く。実測では conf 15 の "mが*垣" の `垣`(3264件中4件 = 稀)
 * だけで候補が4件でき、正解「紀土」が候補に無いまま花垣が1位に出た。希少性の重み付けは
 * ここでは助けにならない — **OCR のゴミ文字はまさに稀な字**だから。
 *
 * 一方で**読めた文字は全部画面に出す**。「何が読めて絞れなかったのか」は手で選ぶときの
 * 手がかりで、黙って落とすと利用者から見て候補が出ない理由が消える。だから捨てずに返す。
 *
 * ### 規則は2つだけ
 *   - 信頼度 0 は証拠にしない。エンジンが「何も信用していない」と言っている読み
 *     (実測の "メ、.六獲" / "品洛" / "滞" はすべて conf 0 のゴミだった)
 *   - 最良のパスの `OCR_MATCH_CONFIDENCE_RATIO` 倍に満たないものは証拠にしない
 *
 * 全パスが 0 なら `matchable` は空になる。呼び出し側は空文字を照合に渡すことになり、
 * 結果は `tooWeak` = 手動へ誘導 — **もっともらしい候補を作らない**方向に倒れる。
 */
export interface OcrSelection {
  /** 照合に流す読み取り。入力の順序(信頼度の降順)を保つ */
  matchable: OcrResult[]
  /** 照合には流さないが**画面には出す**読み取り。空になり得る */
  ignored: OcrResult[]
}

export function selectMatchableResults(results: readonly OcrResult[]): OcrSelection {
  const best = results.reduce((max, result) => Math.max(max, result.confidence), 0)
  const floor = best * OCR_MATCH_CONFIDENCE_RATIO
  const matchable: OcrResult[] = []
  const ignored: OcrResult[] = []
  for (const result of results) {
    // `> 0` と `>= floor` の両方。best が 0 のとき floor も 0 になるので、前者が無いと
    // 「全パスが信頼度 0」のゴミがそのまま照合に流れる
    if (result.confidence > 0 && result.confidence >= floor) matchable.push(result)
    else ignored.push(result)
  }
  return { matchable, ignored }
}

// ---------------------------------------------------------------- 進捗(純関数)

/** 進捗の段階。tesseract の英語の status をそのまま UI に出させない */
export type OcrPhase = 'loading' | 'recognizing'

/** 段階の表示文言。**出所はここ1箇所**(常体) */
export const OCR_PHASE_LABELS: Record<OcrPhase, string> = {
  loading: '文字認識の準備をしている',
  recognizing: '文字を読み取っている',
}

export interface OcrProgress {
  source: OcrSource
  phase: OcrPhase
  /** 全パスを通した 0〜1 */
  ratio: number
}

/** tesseract の status 文字列を段階に畳む。未知の status は準備側に寄せる(進捗を進めない) */
export function classifyOcrStatus(status: string): OcrPhase {
  return status.toLowerCase().includes('recognizing') ? 'recognizing' : 'loading'
}

/**
 * パス内の進捗(0〜1)を全体の進捗に直す。2パスなら1本目の 0.5 は全体の 0.25。
 * 範囲外の入力は詰める(tesseract の progress は稀に 1 を超える)。
 */
export function overallRatio(passIndex: number, passCount: number, progress: number): number {
  if (!Number.isFinite(passCount) || passCount < 1) return 0
  const index = Number.isFinite(passIndex) ? Math.min(Math.max(passIndex, 0), passCount - 1) : 0
  const inner = Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0
  return (index + inner) / passCount
}

// ---------------------------------------------------------------- エンジンの継ぎ目

/** tesseract の worker のうち、この層が使う分だけ。**型はこちらが決める**(テストが偽物を作れる) */
export interface OcrWorker {
  /** 学習データを差し替える。既に読んだデータは再取得されない */
  reinitialize(lang: string, oem: number): Promise<unknown>
  setParameters(params: Record<string, string>): Promise<unknown>
  recognize(image: Blob): Promise<{ data: { text: string; confidence: number } }>
  terminate(): Promise<unknown>
}

/** `createWorker` に渡す設定。**既定値のままだと CDN を見に行く**ので全部埋める */
export interface OcrWorkerOptions {
  workerPath: string
  corePath: string
  langPath: string
  /** `.traineddata.gz` を置くので true(`OCR_LANG_GZIP`)。false だと `.traineddata` を取りに行って404 */
  gzip: boolean
  /** worker を Blob 経由で起こさない(同一オリジンの実ファイルから起こす → SW が挟める) */
  workerBlobURL: boolean
  /** 学習データを IndexedDB に持つ。**一度オンラインで動かせば以降はオフラインでも読める** */
  cacheMethod: string
  logger: (message: { status?: string; progress?: number }) => void
  errorHandler: (error: unknown) => void
}

export type OcrWorkerFactory = (lang: string, options: OcrWorkerOptions) => Promise<OcrWorker>

export interface OcrEngine {
  createWorker: OcrWorkerFactory
}

function hasCreateWorker(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { createWorker?: unknown }).createWorker === 'function'
  )
}

/**
 * CJS のモジュールを ESM から読むと、束ね方によって名前付き export が `default` 側に来る。
 * どちらの形でも拾う(ここが静かに壊れると「機能が無い」状態になるので、形を確かめて投げる)。
 *
 * 入口が `unknown` なのは、これが**型の付いていない境界**を渡る唯一の場所だから。
 * 返り値の型は呼び出し側が指定し、そこから先(`createWorker` の引数)は tesseract の
 * 型定義で検査される。
 */
export function pickEngineExports<T extends object>(imported: unknown): T {
  if (hasCreateWorker(imported)) return imported as T
  const fallback = (imported as { default?: unknown } | null | undefined)?.default
  if (hasCreateWorker(fallback)) return fallback as T
  throw new OcrError('unsupported', {
    cause: new Error('tesseract.js が createWorker を公開していない'),
  })
}

/**
 * tesseract.js を**遅延読み込み**して、この層の型に合わせて包む。
 *
 * `await import(...)` にしているのが要点で、静的 import にすると 1.3MB が初期バンドルに入って
 * 初期表示とオフライン起動が重くなる。**ここがこのモジュールで唯一 tesseract.js に触る場所。**
 */
export async function loadOcrEngine(): Promise<OcrEngine> {
  type Module = typeof import('tesseract.js')
  let imported: unknown
  try {
    imported = await import('tesseract.js')
  } catch (cause) {
    // 動的 import の失敗 = チャンクが取れない(オフラインで未キャッシュ)
    throw new OcrError('assets', { cause })
  }
  const engine = pickEngineExports<Module>(imported)
  const createWorker: OcrWorkerFactory = async (lang, options) => {
    const worker = await engine.createWorker(lang, OCR_ENGINE_MODE, options)
    return {
      reinitialize: (nextLang, oem) => worker.reinitialize(nextLang, oem),
      // `tessedit_pageseg_mode` の型は tesseract 側の PSM(文字列 enum)。生値は OCR_PASSES が
      // 持っているので、ここでは型だけ合わせる(値の正しさは OCR_PASSES のテストで固定する)
      setParameters: (params) =>
        worker.setParameters(params as Parameters<typeof worker.setParameters>[0]),
      recognize: (image) => worker.recognize(image),
      terminate: () => worker.terminate(),
    }
  }
  return { createWorker }
}

// ---------------------------------------------------------------- 2パスの回し方

export interface OcrOptions {
  /** 資産の基準。既定は `import.meta.env.BASE_URL` */
  base?: string
  /** 走らせるパス。既定は `OCR_PASSES`(横書き → 縦書き) */
  passes?: readonly OcrPass[]
  /** 中断。**写真を選び直したら中断する**(古い結果が後から新しい選択を上書きしないため) */
  signal?: AbortSignal
  onProgress?: (progress: OcrProgress) => void
}

function abortedError(signal: AbortSignal | undefined): OcrError | null {
  return signal?.aborted === true ? new OcrError('aborted', { cause: signal.reason }) : null
}

/**
 * worker への1回の呼び出しを中断と競わせる。**中断したら待たずに抜ける。**
 *
 * これが無いと中断が「永久に待つ」になる: 中断時に `worker.terminate()` を呼ぶが、
 * tesseract.js は Worker を捨てるだけで**待っている promise を reject しない**
 * (`createWorker.js` の `promises` に積まれたまま誰も解決しない)。認識中や学習データの
 * 取得中に写真を選び直すと、その run の promise が宙に浮いて `finally` すら走らなくなる。
 *
 * 宙に浮いた側の失敗は握り潰す(呼び出し側にはもう `aborted` を返しているので、
 * 後から届く reject は未処理の rejection になるだけで意味を持たない)。
 */
async function raceAbort<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return work
  // 置き去りにした側が後から落ちても未処理の rejection にしない(下の race とは別に握る)
  void work.catch(() => {})
  // 既に中断済みなら `abort` イベントはもう飛ばない。addEventListener では拾えないので先に見る
  const already = abortedError(signal)
  if (already !== null) throw already
  // executor は同期に走るので、try に入る時点で必ず本物が入っている(既定値は型のため)
  let onAbort: () => void = () => {}
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => {
      reject(new OcrError('aborted', { cause: signal.reason }))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([work, interrupted])
  } finally {
    // パスは2本ある。外さないと1本目の listener が signal に残り続ける
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * 横書きと縦書きを順に走らせて、読めた文字列を合算して返す。
 * **`createWorker` を引数で受ける**ので、WASM 無しで配線を全部検証できる。
 *
 * 諦め方:
 *   - 1つでも読めたら返す(片方のパスが落ちても、もう片方の結果は捨てない)
 *   - 1つも読めなかったら投げる。**最初に起きた失敗の種類**で投げ、何も起きていなければ `empty`
 *   - 中断されたら `aborted` を投げる。**結果は返さない**(呼び出し側が古い結果を掴まない)
 *
 * worker は1つを使い回して `reinitialize` で学習データを差し替える。2つ立てると wasm の
 * ヒープが2重に載って端末のメモリを圧迫する(数MBの画像を抱えたまま数百MB になる)。
 */
export async function runOcrPasses(
  image: Blob,
  createWorker: OcrWorkerFactory,
  opts: OcrOptions = {},
): Promise<OcrResult[]> {
  const passes = opts.passes ?? OCR_PASSES
  if (passes.length === 0) throw new RangeError('passes が空だと認識が0回になる')
  const { signal, onProgress } = opts
  const paths = resolveOcrAssetPaths(opts.base ?? readBaseUrl())

  const preAbort = abortedError(signal)
  // **worker を起こす前に見る。**起こしてから捨てると数MBを無駄に読む
  if (preAbort !== null) throw preAbort

  let current = 0
  const options: OcrWorkerOptions = {
    ...paths,
    gzip: OCR_LANG_GZIP,
    // worker を blob: URL から起こさない。同一オリジンの実ファイルから起こすと Service Worker が
    // 経路に入る(= 2回目以降はオフラインでも起こせる)
    workerBlobURL: false,
    cacheMethod: 'write',
    logger: (message) => {
      // 中断後は進捗を出さない(捨てる予定の run の進捗を画面に出さない)
      if (signal?.aborted === true || onProgress === undefined) return
      onProgress({
        source: passes[current].source,
        phase: classifyOcrStatus(message.status ?? ''),
        ratio: overallRatio(current, passes.length, message.progress ?? 0),
      })
    },
    // 既定の errorHandler は console に吐く。失敗は promise の reject で受けて分類するので、
    // ここは黙らせる(同じ失敗を2箇所から出さない)
    errorHandler: () => {},
  }

  let worker: OcrWorker
  try {
    worker = await createWorker(passes[0].lang, options)
  } catch (cause) {
    throw abortedError(signal) ?? new OcrError('assets', { cause })
  }

  const stop = () => {
    void worker.terminate()
  }
  // 中断されたら認識の途中でも worker を落とす(WASM のループは自分では止まらない)
  signal?.addEventListener('abort', stop, { once: true })

  const collected: OcrResult[] = []
  let firstFailure: OcrErrorKind | null = null
  let firstCause: unknown = null

  try {
    for (let index = 0; index < passes.length; index += 1) {
      const pass = passes[index]
      current = index
      const aborted = abortedError(signal)
      if (aborted !== null) throw aborted

      try {
        // 学習データの取得は数MB。**中断と競わせる**(terminate しただけでは promise が宙に浮く)。
        // **`lang` が前のパスと同じなら再初期化しない** — 同じ学習データを読み直すだけで、
        // 縦書き2本(psm 5 と 3)のたびに数MBの取得と初期化を挟むことになる
        const previousLang = index === 0 ? passes[0].lang : passes[index - 1].lang
        if (index > 0 && pass.lang !== previousLang) {
          await raceAbort(worker.reinitialize(pass.lang, OCR_ENGINE_MODE), signal)
        }
        await raceAbort(worker.setParameters({ tessedit_pageseg_mode: pass.psm }), signal)
      } catch (cause) {
        if (isOcrError(cause) && cause.kind === 'aborted') throw cause
        const aborted2 = abortedError(signal)
        if (aborted2 !== null) throw aborted2
        // 学習データが取れない / 初期化できない。次のパスも同じ資産を要るので続けても同じだが、
        // 学習データはパスごとに別ファイルなので、片方だけ落ちている可能性は残す
        if (firstFailure === null) {
          firstFailure = 'assets'
          firstCause = cause
        }
        continue
      }

      try {
        // 認識は数秒。中断されたら `stop` が worker を落とすが、**落としても
        // この promise は解決しない**ので競わせないと永久に待つことになる
        const { data } = await raceAbort(worker.recognize(image), signal)
        const aborted3 = abortedError(signal)
        if (aborted3 !== null) throw aborted3
        collected.push({
          text: data.text,
          confidence: data.confidence,
          source: pass.source,
        })
      } catch (cause) {
        if (isOcrError(cause) && cause.kind === 'aborted') throw cause
        const aborted4 = abortedError(signal)
        if (aborted4 !== null) throw aborted4
        if (firstFailure === null) {
          firstFailure = 'decode'
          firstCause = cause
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', stop)
    // terminate の失敗で本来の失敗を隠さない(wasm のヒープを解放したいだけ)
    try {
      await worker.terminate()
    } catch {
      /* 解放できなくても呼び出し側にできることは無い */
    }
  }

  const merged = mergeOcrResults(collected)
  if (merged.length === 0) {
    // **もっともらしい候補で埋めない。**読めなかったと言って手動へ返す
    throw new OcrError(firstFailure ?? 'empty', firstCause === null ? undefined : { cause: firstCause })
  }
  return merged
}

// ---------------------------------------------------------------- 入口(ブラウザ専用)

export interface RecognizeLabelOptions extends OcrOptions {
  /** 能力判定の差し替え(既定は `readOcrEnvironment()`)。テストが実環境に依存しないため */
  environment?: OcrEnvironment
  /** エンジンの差し替え(既定は `loadOcrEngine`) */
  loadEngine?: () => Promise<OcrEngine>
  /**
   * OCR に渡す画像の作り方(既定は `prepareOcrImage` = 長辺2000pxへ縮小)。
   * **差し替え可能にしてあるのは、縮小を通していることをテストで固定するため** —
   * 直接 import して呼ぶだけだと、外しても単体テストが緑のままだった(実測)。
   */
  prepare?: (file: Blob) => Promise<{ blob: Blob }>
}

/**
 * ラベルの写真から**候補の材料**を読む。信頼度の降順で返る。
 *
 * 渡すのは**元のファイル**(サムネイルでは解像度が足りない)。この関数が
 * **長辺2000pxへ縮めてから**エンジンに渡す(原寸のままは精度も速度も落ちる。`prepareImage.ts`)。
 * 失敗は必ず `OcrError`(kind 付き)で投げる。**無音で空配列を返す経路は無い** —
 * 空配列は「候補が無い」と「読み取りが失敗した」を区別できず、UI が文言を選べなくなる。
 */
export async function recognizeLabel(
  file: File | Blob,
  opts: RecognizeLabelOptions = {},
): Promise<OcrResult[]> {
  const problem = ocrSupportProblem(opts.environment ?? readOcrEnvironment())
  if (problem !== null) throw new OcrError(problem)

  const aborted = abortedError(opts.signal)
  if (aborted !== null) throw aborted

  const engine = await (opts.loadEngine ?? loadOcrEngine)()
  // **原寸のままは渡さない**(実測で精度も速度も落ちる)。`prepareOcrImage` の頭注を参照。
  // 失敗しても元のファイルが返るので、ここで分岐は要らない
  const prepared = await (opts.prepare ?? prepareOcrImage)(file)
  return runOcrPasses(prepared.blob, engine.createWorker, opts)
}
