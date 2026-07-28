// 写真から銘柄の**候補を絞る**補助(OCR)。RecordForm の写真欄の直下に置かれる。
//
// ## この部品が引き受けている決定
//
// 1. **銘柄を自動確定しない。** ここが出すのは候補と「絞れなかった」という事実だけで、
//    決めるのは人。候補を押したときに走るのは `BrandSuggest` と**同じ `onPick` 経路**
//    (県・蔵元・6軸が埋まる仕組みをここに再実装しない)。
// 2. **押されるまで走らせない。** 数秒かかり電池も食う。写真を選んだ時点で自動起動すると、
//    OCR を求めていない人にまで数MBの取得と数秒の計算を負わせる。
// 3. **原寸の元ファイルに対して走らせる。** 保存するサムネイル(長辺400px)では解像度が足りない。
//    原本は `PhotoPicker` の `onSourceChange` から親経由で渡ってくる**だけ**で、記録には残らない。
// 4. **写真が変われば古い結果を捨てる。** `file` が変わったら走っている読み取りを中断して
//    候補も消す。捨てないと、後から届いた古い写真の候補が新しい写真の候補として出る。
// 5. **外したときのコストをゼロにする。** 絞れなければ「読み取れなかった。手で選ぶ」と言い、
//    **もっともらしい別銘柄を上位に出さない**(`tooWeak` のとき候補は空)。文言の出所は
//    `lib/ocr/recognize.ts` の `OCR_MESSAGES` / `OCR_PHASE_LABELS` / `OCR_CANDIDATE_NOTE`
//    1箇所で、ここに写しを持たない。
// 6. **なぜこの候補なのかを読めるようにする。** 行に「当たった文字」と**何字中何字か**を出す
//    (照合が返す `matchedChars` は稀な順)。読み取った文字そのものも出す — 当てずっぽうに
//    見せない。全字読めた候補と1字だけの候補が同じ見た目だと、当たりと外れを見分ける手がかりが
//    無くなる(実測で「当たった文字 祭」と「当たった文字 垣」が完全に同じ見た目で並んだ)。
// 6.5 **エンジンが信用していない読みは照合に流さない。** 2パスの出力を等価に連結すると、
//    conf 0〜15 のゴミ1文字が conf 41 の本命と同じ重さで効いて、正解が候補に無いまま
//    別銘柄を1位に出す(実測で9枚中3枚)。振り分けは `selectMatchableResults`(純関数)。
//    **落とした分も画面には出す** — 読めているのに候補が出ない理由が消えるので。
// 7. **スペック語は自動で書き込まない。** ボタンを押したときだけスペック欄に入れる
//    (自由文なので誤っても銘柄を間違える損失は無いが、書き込みは本人の操作にする)。

import { useEffect, useRef, useState } from 'react'
import {
  createBrandMatcher,
  createCharNarrower,
  type BrandMatchResult,
  type BrandMatcher,
  type BrandMatcherTables,
  type CharNarrower,
  type NarrowChar,
} from '../../domain/brandFromText.ts'
import { DEFAULT_SUGGEST_LIMIT, type SuggestHit, type Suggester } from '../../domain/suggest.ts'
import {
  OCR_CANDIDATE_NOTE,
  OCR_MESSAGES,
  OCR_PHASE_LABELS,
  isOcrError,
  recognizeLabel,
  selectMatchableResults,
  type OcrErrorKind,
  type OcrProgress,
  type OcrResult,
  type RecognizeLabelOptions,
} from '../../lib/ocr/recognize.ts'
import { describeError } from '../common/errors.ts'
import type { PickedBrand } from '../common/pickedBrand.ts'

/**
 * 認識の差し替え口。既定は `recognizeLabel`(tesseract.js を遅延読み込みする本物)。
 * jsdom には WebAssembly の SIMD も Worker も無いので、テストはここを差し替える。
 */
export type LabelRecognizer = (
  file: File | Blob,
  options: RecognizeLabelOptions,
) => Promise<OcrResult[]>

export type OcrAssistProps = {
  /**
   * **原寸の元ファイル。** `null` なら導線ごと出さない(サムネイルには走らせない)。
   * 参照が変わったら「別の写真」として扱い、走っている読み取りを捨てる。
   */
  file: File | Blob | null
  /** 照合に使う銘柄マスタ。**照合器はボタンが押されたときに1回だけ組む**(下の `matchText`) */
  tables: BrandMatcherTables
  /**
   * 候補を選んだ。**`BrandSuggest` の `onPick` と同じ受け口**に流すこと
   * (県・蔵元・6軸を埋める経路を2つ持たない)。候補行からも「読めた字で絞る」の一覧からも
   * ここに入る — 後者は `SuggestHit` なので、型は共通部分の `PickedBrand` で受ける。
   */
  onPick: (picked: PickedBrand) => void
  /** スペック語をスペック欄に入れる。**押されたときだけ**呼ぶ */
  onApplySpec: (text: string) => void
  /**
   * 銘柄名の検索(`createSuggester` の戻り)。**「読めた字で絞る」はこれをそのまま引く** —
   * 写真から来た絞り込みのために別の検索を実装しない(手で打つ経路と同じ並び・同じ上限)。
   * 親が `useMemo` で1回だけ作ったものを渡す。
   */
  suggest: Suggester
  /** いま銘柄欄に紐付いている銘柄ID。候補行に「入れた」印を出すためだけに使う */
  pickedBrandId?: number | null
  /** 写真は付いているが原本が無い(保存済みの記録を開いた)。理由を1行で言う */
  savedPhotoOnly?: boolean
  /** 親が入力全体を止めているとき(保存中など) */
  disabled?: boolean
  recognize?: LabelRecognizer
}

/**
 * 読み取りの段階。
 * - `read` は**成功して照合まで終わった**状態。候補が0件でも `read`(= `tooWeak`)で、
 *   これは「読めなかった(`failed`)」とは別の事実なので畳まない。
 */
type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; progress: OcrProgress | null }
  | {
      kind: 'read'
      /** 照合に流した文字(`selectMatchableResults` が通した分) */
      text: string
      /** 読めたが照合には流さなかった文字。空文字なら無し */
      ignoredText: string
      match: BrandMatchResult
      /**
       * 絞り込みの鍵に使える字。**信頼度で落とした分も含めた「読めた全部」から作る** —
       * 押すのは人なので、低信頼のパスの字が混ざっても勝手に1位が出ることはない
       * (実測では `七賢` の `賢` と `黒龍` の `龍` は信頼度0のパスからしか出ていない)。
       */
      narrowChars: NarrowChar[]
    }
  | { kind: 'failed'; error: OcrErrorKind | null; message: string }

/**
 * 段階は**どの写真のものか**とセットで持つ。`owner !== file` なら描かない = 写真を選び直した
 * 瞬間に前の写真の候補が消える。
 *
 * 「`file` が変わったら effect で state を戻す」ようには書かない — effect の中の `setState` は
 * 描画を2回走らせるうえ、**戻す前の1フレームで古い候補が新しい写真の候補として描かれる**。
 * 持ち主を state に入れておけば、それは派生値の計算だけで決まる(React の `key` に頼らずに済む
 * ので、この部品は親の書き方に依存しない)。
 */
type Stage = { owner: File | Blob | null; phase: Phase }

const IDLE: Phase = { kind: 'idle' }

const HINT = 'mt-1 text-xs leading-relaxed text-ink-faint'
const NOTE = 'text-xs leading-relaxed text-ink-muted'
const QUIET_BUTTON =
  'whitespace-nowrap rounded border border-line-strong px-3 py-1.5 text-sm text-ink-muted disabled:opacity-50'
const ACTION_BUTTON =
  'whitespace-nowrap rounded border border-line-strong bg-surface-raised px-3 py-1.5 text-sm text-ink disabled:opacity-50'
const PILL = 'whitespace-nowrap rounded border border-line-strong px-1.5 py-px text-[11px] leading-4'

/** 0〜1 を「45%」に。進捗は数字で出す(「しばらく待つ」だけだと止まっているか分からない) */
function percent(ratio: number): string {
  return `${String(Math.round(Math.min(1, Math.max(0, ratio)) * 100))}%`
}

export function OcrAssist({
  file,
  tables,
  onPick,
  onApplySpec,
  suggest,
  pickedBrandId = null,
  savedPhotoOnly = false,
  disabled = false,
  recognize = recognizeLabel,
}: OcrAssistProps) {
  const [stage, setStage] = useState<Stage>({ owner: null, phase: IDLE })
  /** 世代。中断した run / 追い越された run の結果を捨てる(PhotoPicker と同じ手口) */
  const runRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  /** 照合器は3264件の索引を作る。**押されるまで作らない**(記録画面を開くたびの負担にしない) */
  const matcherRef = useRef<{ tables: BrandMatcherTables; matcher: BrandMatcher } | null>(null)
  const narrowerRef = useRef<{ tables: BrandMatcherTables; narrow: CharNarrower } | null>(null)
  /**
   * 「読めた字で絞る」で押されている字。**読み取りをやり直したら畳む**(前の写真の字で
   * 絞ったままの一覧が、新しい写真の結果として残らないように)。
   */
  const [narrowChar, setNarrowChar] = useState<string | null>(null)

  /** **いま画面に出る段階。**別の写真の結果は最初から存在しないものとして扱う */
  const phase = stage.owner === file ? stage.phase : IDLE

  // 写真が変わったら(画面が閉じたら)走っている読み取りを止める。**結果を捨てるだけでは
  // 足りない** — WASM のループは自分では止まらないので、中断を伝えないと数秒回り続ける。
  useEffect(() => {
    return () => {
      runRef.current += 1
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [file])

  function matchText(text: string): BrandMatchResult {
    if (matcherRef.current === null || matcherRef.current.tables !== tables) {
      matcherRef.current = { tables, matcher: createBrandMatcher(tables) }
    }
    return matcherRef.current.matcher(text)
  }

  function narrowText(text: string): NarrowChar[] {
    if (narrowerRef.current === null || narrowerRef.current.tables !== tables) {
      narrowerRef.current = { tables, narrow: createCharNarrower(tables.brands) }
    }
    return narrowerRef.current.narrow(text)
  }

  function start() {
    if (file === null) return
    const run = runRef.current + 1
    runRef.current = run
    const controller = new AbortController()
    abortRef.current = controller
    setNarrowChar(null)
    // 段階には**この写真**を持ち主として刻む(後から届いた結果が別の写真の欄に出ない)
    const to = (next: Phase) => {
      setStage({ owner: file, phase: next })
    }
    to({ kind: 'running', progress: null })

    void recognize(file, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (runRef.current !== run) return
        to({ kind: 'running', progress })
      },
    }).then(
      (results) => {
        if (runRef.current !== run) return
        abortRef.current = null
        // **エンジンが信用していないパスの文字を照合に流さない。** 等価に連結すると、
        // conf 0〜15 のゴミ1文字が conf 41 の読みと同じ重さで効いて、正解が候補に無いまま
        // 別銘柄を1位に出す(実測)。落とした分も画面には出すので、読めた文字は隠れない。
        const { matchable, ignored } = selectMatchableResults(results)
        // 複数パスの結果は改行で繋いで渡してよい(照合は文字集合で見るので行区切りは無視される)
        const text = matchable.map((result) => result.text).join('\n')
        const ignoredText = ignored.map((result) => result.text).join('\n')
        to({
          kind: 'read',
          text,
          ignoredText,
          match: matchText(text),
          // **鍵は「読めた全部」から作る。** 候補を作らない(押すのは人)ので、
          // 照合に流さなかった分をここで捨てると、絞り込める字まで一緒に消える
          narrowChars: narrowText(`${text}\n${ignoredText}`),
        })
      },
      (cause: unknown) => {
        if (runRef.current !== run) return
        abortRef.current = null
        if (isOcrError(cause)) {
          // 中断は本人の操作なので何も言わない(押した本人が結果を待っていない)
          if (cause.kind === 'aborted') {
            to(IDLE)
            return
          }
          to({ kind: 'failed', error: cause.kind, message: OCR_MESSAGES[cause.kind] })
          return
        }
        // 想定外でも黙らない。理由を出したうえで手動へ返す
        to({
          kind: 'failed',
          error: null,
          message: `文字の読み取りに失敗した — ${describeError(cause)}。銘柄は手で選ぶ。`,
        })
      },
    )
  }

  function abortRun() {
    setNarrowChar(null)
    runRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    setStage({ owner: file, phase: IDLE })
  }

  if (file === null) {
    if (!savedPhotoOnly) return null
    return (
      <p className={`mt-3 ${NOTE}`}>
        保存済みの写真は縮小済みなので文字を読み取れない。写真を選び直すと「写真から銘柄を探す」が使える。
      </p>
    )
  }

  return (
    <div className="mt-3 rounded border border-line bg-surface px-2.5 py-2">
      {phase.kind === 'running' ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <p role="status" className={`min-w-0 ${NOTE}`}>
            {phase.progress === null
              ? OCR_PHASE_LABELS.loading
              : `${OCR_PHASE_LABELS[phase.progress.phase]} ${percent(phase.progress.ratio)}`}
          </p>
          <button type="button" onClick={abortRun} className={QUIET_BUTTON}>
            読み取りを中止
          </button>
        </div>
      ) : (
        <button type="button" onClick={start} disabled={disabled} className={ACTION_BUTTON}>
          {phase.kind === 'idle' ? '写真から銘柄を探す' : 'もう一度読み取る'}
        </button>
      )}

      {phase.kind === 'idle' && (
        <p className={HINT}>
          写真の文字を読み取って銘柄の候補を絞る。読み取りは端末の中だけで行い、写真はどこにも送らない。銘柄を決めるのは本人で、候補から選ばなければ何も入らない。
        </p>
      )}

      {phase.kind === 'failed' && (
        <div
          role="alert"
          className="mt-2 rounded border border-notice-line bg-notice-surface px-2.5 py-2 text-xs leading-relaxed text-notice-ink"
        >
          {/* 文言の出所は lib/ocr/recognize.ts の OCR_MESSAGES(ここで言い換えない) */}
          <p>{phase.message}</p>
          {phase.error === 'assets' && (
            <p className="mt-1">
              読み取り用のデータがまだ端末に無いだけ。オンラインで一度読み込めば、以降はオフラインでも使える。記録の保存・検索・バックアップはこの失敗の影響を受けない。
            </p>
          )}
        </div>
      )}

      {phase.kind === 'read' && (
        <Read
          text={phase.text}
          ignoredText={phase.ignoredText}
          match={phase.match}
          narrowChars={phase.narrowChars}
          narrowChar={narrowChar}
          onNarrow={setNarrowChar}
          suggest={suggest}
          pickedBrandId={pickedBrandId}
          disabled={disabled}
          onPick={onPick}
          onApplySpec={onApplySpec}
        />
      )}
    </div>
  )
}

function Read({
  text,
  ignoredText,
  match,
  narrowChars,
  narrowChar,
  onNarrow,
  suggest,
  pickedBrandId,
  disabled,
  onPick,
  onApplySpec,
}: {
  text: string
  ignoredText: string
  match: BrandMatchResult
  narrowChars: NarrowChar[]
  narrowChar: string | null
  onNarrow: (char: string | null) => void
  suggest: Suggester
  pickedBrandId: number | null
  disabled: boolean
  onPick: (picked: PickedBrand) => void
  onApplySpec: (text: string) => void
}) {
  const specText = match.specTerms.join(' ')

  return (
    <>
      {/* 読めた文字をそのまま見せる。候補の理由が読めるようにするための材料で、
          `tooWeak` のときは「何が読めて絞れなかったのか」の唯一の手がかりになる */}
      <div className="mt-2">
        <p className="text-xs text-ink-faint">読み取った文字</p>
        <p className="mt-0.5 max-h-20 overflow-y-auto break-words text-xs leading-relaxed text-ink">
          {text === '' ? '（なし）' : text}
        </p>
      </div>

      {/* 信頼度の低いパスの読みは照合に流していない。**捨てずに出す** — 出さないと
          「読めているのに候補が出ない」理由が利用者から見えなくなる */}
      {ignoredText !== '' && (
        <div className="mt-1.5">
          <p className="text-xs text-ink-faint">読み取れたが銘柄の照合に使わなかった文字</p>
          <p className="mt-0.5 max-h-20 overflow-y-auto break-words text-xs leading-relaxed text-ink-muted">
            {ignoredText}
          </p>
          <p className={HINT}>
            読み取りの確信度が他より低かった分。混ぜると当てずっぽうの候補が増えるので銘柄の照合には使わない。
          </p>
        </div>
      )}

      {match.tooWeak ? (
        <div
          role="status"
          className="mt-2 rounded border border-line-strong bg-canvas px-2.5 py-2 text-xs leading-relaxed"
        >
          <p className="text-ink">銘柄を読み取れなかった。手で選ぶ。</p>
          {/* **もっともらしい別銘柄を出さない**ことを明示する(黙って0件にしない) */}
          <p className="mt-1 text-ink-muted">
            読めた文字では銘柄を絞れなかった。近そうな別の銘柄は出さない。
            {narrowChars.length > 0
              ? '下の「読めた字で絞る」から字を押すか、銘柄欄に打って候補から選ぶ。'
              : '銘柄欄に打って候補から選ぶ。'}
          </p>
        </div>
      ) : (
        <>
          <p className={`mt-2 ${NOTE}`}>{OCR_CANDIDATE_NOTE}</p>
          <ul className="mt-2 space-y-1.5">
            {match.candidates.map((candidate) => (
              <li key={candidate.brand.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(candidate)
                  }}
                  disabled={disabled}
                  aria-label={`${candidate.brand.name} を銘柄にする`}
                  className="block w-full rounded border border-line-strong bg-canvas px-3 py-2 text-left disabled:opacity-50"
                >
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-ink">{candidate.brand.name}</span>
                    {candidate.brand.id === pickedBrandId && (
                      <span className={`${PILL} border-ok-line text-ok-ink`}>銘柄欄に入れた</span>
                    )}
                  </span>
                  {/* 同名の銘柄は県と蔵元でしか選び分けられない。引けないときは言い切る */}
                  <span className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-ink-muted">
                    <span className="whitespace-nowrap">
                      {candidate.prefecture ?? '都道府県がデータに無い'}
                    </span>
                    <span className="whitespace-nowrap">
                      {candidate.breweryName ?? '蔵元名がデータに無い'}
                    </span>
                  </span>
                  {/* なぜこの候補なのか。稀な順に並んだ「当たった文字」がその答えそのもの。
                      **何字中何字かも出す** — 全字読めた候補と1字だけの候補が同じ見た目だと、
                      当たっている候補と外れている候補を人が見分ける手がかりが1つも無くなる */}
                  <span className="mt-1 block text-xs text-ink-faint">
                    当たった文字 {candidate.matchedChars.join('・')}（銘柄名
                    {candidate.brandCharCount}字のうち{candidate.matchedChars.length}字）
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* **読めた字で絞る。** 候補の門(希少性 + 被覆率)は厳しくしてあるので、写真ふうのラベルでは
          9枚中2〜3枚しか候補が出ない。門を緩めると「正解が候補に無いまま別銘柄を1位に出す」が
          増えるだけなので、緩めるのは**人が押す道**の側にする。実測ではこの1タップで
          9枚中5枚の正解が上位20件に出た(獺祭 #1 / 七賢 #1 / 刈穂 #2 / 紀土 #6 / 黒龍 #18)。
          押した先に出るのは**手で打つときと同じ `createSuggester` の一覧**で、ここは候補を作らない。 */}
      {narrowChars.length > 0 && (
        <div className="mt-2 border-t border-line pt-2">
          <p className={NOTE}>読めた字で絞る</p>
          {/* 対で折り返しを直す: 行に flex-wrap + gap-y、原子ラベル(字と件数)に nowrap */}
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1.5">
            {narrowChars.map(({ char, brandCount }) => (
              <button
                key={char}
                type="button"
                // 押し直しで畳む。開きっぱなしにすると一覧が候補欄のように見え続ける
                onClick={() => {
                  onNarrow(narrowChar === char ? null : char)
                }}
                disabled={disabled}
                aria-pressed={narrowChar === char}
                aria-label={`${char} を含む銘柄を出す（${String(brandCount)}件）`}
                className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs disabled:opacity-50 ${
                  narrowChar === char
                    ? 'border-line-strong bg-surface-raised text-ink'
                    : 'border-line-strong bg-canvas text-ink-muted'
                }`}
              >
                {char}
                <span className="ml-1 text-ink-faint">{brandCount}件</span>
              </button>
            ))}
          </div>
          <p className={HINT}>
            押すとその字を含む銘柄を並べる。候補を出す条件に届かなかった字でも絞り込みには使えるので、確信度の低い読みの字も並べている。
          </p>
          {narrowChar !== null && (
            <NarrowList
              char={narrowChar}
              suggest={suggest}
              pickedBrandId={pickedBrandId}
              disabled={disabled}
              onPick={onPick}
            />
          )}
        </div>
      )}

      {specText !== '' && (
        <div className="mt-2 border-t border-line pt-2">
          <p className={NOTE}>スペックとして読んだ語 {specText}</p>
          <button
            type="button"
            onClick={() => {
              onApplySpec(specText)
            }}
            disabled={disabled}
            className={`mt-1.5 ${QUIET_BUTTON}`}
          >
            スペック欄に入れる
          </button>
          <p className={HINT}>押すまでスペック欄には書き込まない。銘柄の照合には使っていない語。</p>
        </div>
      )}

      {match.labelTerms.length > 0 && (
        <p className={`mt-2 ${HINT}`}>
          ラベルの語として読んだ {match.labelTerms.join(' ')}（銘柄の照合には使っていない）
        </p>
      )}
    </>
  )
}

/**
 * 一覧に出す上限。`BrandSuggest` の既定と揃える(絞り込みの一覧だけ別の長さにしない)。
 * 上限に届いたら断りを出す — チップの件数と行数が食い違ったまま黙らない。
 */
const NARROW_LIST_LIMIT = DEFAULT_SUGGEST_LIMIT

/**
 * 押された字を含む銘柄の一覧。**手で打つ経路と同じ `Suggester` を引くだけ**で、
 * 並び(前方一致 → 含む一致 → 名前が短い順)も上限も domain 側の既定に従う。
 *
 * ここは**候補ではない**ので「候補」と書かない。写真から絞ったという事実は前置きで言い、
 * 行は `BrandSuggest` と同じ情報(銘柄名・都道府県・蔵元)を出す — 同名の銘柄は県と蔵元でしか
 * 選び分けられないし、引けないときは空白にせず言い切る。
 */
function NarrowList({
  char,
  suggest,
  pickedBrandId,
  disabled,
  onPick,
}: {
  char: string
  suggest: Suggester
  pickedBrandId: number | null
  disabled: boolean
  onPick: (picked: PickedBrand) => void
}) {
  const hits: SuggestHit[] = suggest(char, NARROW_LIST_LIMIT)

  // 0件は起きない想定(マスタに無い字は `createCharNarrower` が鍵に選ばない)。それでも
  // 黙って空欄にしない — 月次更新で銘柄が消えれば起き得るし、押して何も出ないのが一番困る
  if (hits.length === 0) {
    return <p className={`mt-2 ${NOTE}`}>{char} を含む銘柄はマスタに無かった。銘柄欄に打って探す。</p>
  }

  return (
    <>
    <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
      {hits.map((hit) => (
        <li key={hit.brand.id}>
          <button
            type="button"
            onClick={() => {
              onPick(hit)
            }}
            disabled={disabled}
            aria-label={`${hit.brand.name} を銘柄にする`}
            className="block w-full rounded border border-line-strong bg-canvas px-3 py-2 text-left disabled:opacity-50"
          >
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm font-medium text-ink">{hit.brand.name}</span>
              {hit.brand.id === pickedBrandId && (
                <span className={`${PILL} border-ok-line text-ok-ink`}>銘柄欄に入れた</span>
              )}
            </span>
            <span className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-ink-muted">
              <span className="whitespace-nowrap">{hit.prefecture ?? '都道府県がデータに無い'}</span>
              <span className="whitespace-nowrap">{hit.breweryName ?? '蔵元名がデータに無い'}</span>
              {/* 紐付け済み ≠ フレーバー取得済み。選ぶ前に分かるようにする(`BrandSuggest` と同じ) */}
              {!hit.hasFlavorChart && <span className="whitespace-nowrap">フレーバーなし</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
    {/* チップには「41件」と書いてあるのに20行しか出ない、を黙って起こさない
        (`BrandSuggest` が上限に達したときに出すのと同じ断り) */}
    {hits.length >= NARROW_LIST_LIMIT && (
      <p className={HINT}>上位{NARROW_LIST_LIMIT}件まで出している。続きは銘柄欄に打って絞る。</p>
    )}
    </>
  )
}
