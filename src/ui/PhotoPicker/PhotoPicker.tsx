// 写真の選択とサムネイル生成(SPEC A8)。RecordForm の1フィールドとして置かれる。
//
// ## この部品が引き受けている決定
//
// 1. **`capture` を付けない。** SPEC は「端末の写真アプリで撮影済みのものを選択」。`capture` を
//    付けるとカメラが直に起動してカメラロールから選べなくなり、見出し機能の入口が狭まる。
// 2. **結果を数字で出す。**「サムネイル 38KB / 400×533」を画面に出す。これが A8(50KB以下)の
//    証拠になり、同時に情報密度としても意味がある。品質が既定から落ちたときはそれも書く
//    (絵が甘くなったことを黙って隠さない)。
// 3. **無音で失敗させない。** 失敗は必ず `role="alert"` で理由を出す。文言は
//    `ThumbnailError.message` をそのまま使う — HEIC の案内文と「50KB以下にならない」の文言の
//    出所は `src/lib/image/resize.ts` の1箇所で、ここに写しを持たない(写すとドリフトする)。
//    UI が足すのは `kind` の分類ラベルだけ。
// 4. **失敗しても付いている写真を落とさない。** 編集中の記録に写真があるとき、HEIC を選んで
//    失敗したからといって既存のサムネイルを消すのはデータの静かな喪失になる。`onChange` は
//    成功したときだけ呼ぶ。
// 5. **生成中も選び直せる。** 12MB 級の写真は数秒かかる。その間入力を止めると待たされるだけなので
//    受け付け続け、**追い越された古い結果は捨てる**(世代カウンタ)。捨てないと後から届いた
//    古い結果が新しい選択を上書きする。
// 6. **寸法を推測で埋めない。** 保存済みの写真(編集で読み込んだもの)は寸法が分からないので
//    バイト数だけ出す。デコードして測り直すことはしない(ルール: 不確実性を隠さない)。
// 7. **原本は渡すだけで保存しない。** OCR は長辺400pxのサムネイルでは解像度が足りないので、
//    選ばれた**原寸の元ファイル**を `onSourceChange` で親に出す(記録に入るのは今までどおり
//    サムネイルだけ)。この部品は原本を持ち続けない — サムネイル生成の挙動は何も変えていない。
//
// プレビューの object URL は `../common/thumbnailUrl.ts` が生成と revoke を対で持つ。

import { useId, useRef, useState, type ChangeEvent } from 'react'
import {
  MAX_THUMBNAIL_BYTES,
  QUALITY_LADDER,
  isThumbnailError,
  resizeToThumbnail,
  type ThumbnailErrorKind,
  type ThumbnailResult,
} from '../../lib/image/resize.ts'
import { describeError } from '../common/errors.ts'
import { canShowThumbnail, useThumbnailImageRef } from '../common/thumbnailUrl.ts'

/** リサイズの差し替え口。既定は本番の `resizeToThumbnail`(テストはここをスタブする) */
export type PhotoResizer = (file: File | Blob) => Promise<ThumbnailResult>

export type PhotoPickerProps = {
  /**
   * いま記録に付いているサムネイルのバイト列。**親が持つ**(RecordForm の下書きの一部)。
   * `onChange` で渡したものをそのまま戻してくれる前提で、同一性が保たれている間だけ
   * 寸法や品質を併記する。
   */
  value: ArrayBuffer | null
  /** サムネイルが決まったとき / 外されたとき。**成功時と除去時だけ呼ぶ** */
  onChange: (thumbnail: ArrayBuffer | null) => void
  /**
   * 生成中かどうか。**親はこれを見て保存を止める** — 生成中に保存されると写真なしで
   * 保存が通ってしまい、「付けたのに付いていない」という無音の失敗になる。
   */
  onBusyChange?: (busy: boolean) => void
  /**
   * **原寸の元ファイル**が変わった。長辺400pxのサムネイルでは OCR に解像度が足りないので、
   * 「写真から銘柄を探す」に渡す原本をここから親へ出す。**記録には保存しない**
   * (親が state に持つだけ。保存されるのは `onChange` のサムネイル)。
   *
   * 呼ぶのは `onChange` と対のときだけ — 生成に失敗したときは付いている写真も原本も替えない
   * (決定4と揃える。片方だけ差し替えると「サムネイルと原本が別の写真」になる)。
   */
  onSourceChange?: (file: File | null) => void
  /** 親が入力全体を止めているとき(保存中など) */
  disabled?: boolean
  resize?: PhotoResizer
}

/** 失敗の分類ラベル。**理由と対処は `message` 側にある**ので、ここには書かない(写しを作らない) */
const FAILURE_LABEL: Record<ThumbnailErrorKind | 'unexpected', string> = {
  heic: '対応していない形式',
  decode: '読み込めない写真',
  unsupported: '未対応のブラウザ',
  encode: '書き出しに失敗',
  'too-large': '小さくできない',
  unexpected: '想定外のエラー',
}

type Failure = {
  kind: ThumbnailErrorKind | 'unexpected'
  message: string
  fileName: string
}

/** 既定のラダーの先頭。ここより下がったときだけ「品質を落とした」と書く */
const TOP_QUALITY = QUALITY_LADDER[0]

/** 1024 未満で `0KB` と出すと「空のファイルでは」と読めるのでバイトで出す */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)}バイト`
  return `${String(Math.round(bytes / 1024))}KB`
}

/**
 * A8 の証拠になる1行。**JSX の中で組み立てない** — 式とテキストを並べると
 * 改行位置で空白が入るかどうかが変わり、「400× 533」のような表示揺れが起きる。
 */
function describeThumbnail(result: ThumbnailResult): string {
  return `サムネイル ${formatBytes(result.bytes)} / ${String(result.width)}×${String(result.height)}`
}

function toFailure(cause: unknown, fileName: string): Failure {
  // `kind` を持つのは基盤が投げた既知の失敗。文言はそのまま出せる形で来る
  if (isThumbnailError(cause)) return { kind: cause.kind, message: cause.message, fileName }
  return { kind: 'unexpected', message: describeError(cause), fileName }
}

const HINT = 'mt-1 text-xs leading-relaxed text-ink-faint'
const QUIET_BUTTON =
  'whitespace-nowrap rounded border border-line-strong px-3 py-1.5 text-sm text-ink-muted disabled:opacity-50'

export function PhotoPicker({
  value,
  onChange,
  onBusyChange,
  onSourceChange,
  disabled = false,
  resize = resizeToThumbnail,
}: PhotoPickerProps) {
  const inputId = useId()
  const [made, setMade] = useState<ThumbnailResult | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  /** 世代。生成中に選び直されたとき、古い結果を捨てるために使う */
  const runRef = useRef(0)

  // 寸法・品質は「この画面で作ったサムネイルが、いま付いているものと同一」のときだけ意味を持つ。
  // 親が別の写真に差し替えたら黙って古い数字を見せない
  const known = made !== null && made.data === value ? made : null
  const previewRef = useThumbnailImageRef(value)

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // 同じ写真を選び直しても change が起きるように空にする
    event.target.value = ''
    if (!file) return

    const run = runRef.current + 1
    runRef.current = run
    setFailure(null)
    setWorking(file.name === '' ? '選んだ写真' : file.name)
    onBusyChange?.(true)

    try {
      const result = await resize(file)
      if (runRef.current !== run) return
      setMade(result)
      onChange(result.data)
      // サムネイルと同じ写真の原本を出す(OCR は原寸に対して走る)。**順序は onChange の後** —
      // 親が「原本が来た = 写真が確定した」と読んでも下書きが古いままにならない
      onSourceChange?.(file)
    } catch (cause) {
      if (runRef.current !== run) return
      // **付いている写真は消さない。** `onChange` を呼ばないので親の下書きは無傷のまま
      setFailure(toFailure(cause, file.name === '' ? '選んだ写真' : file.name))
    } finally {
      // 追い越された世代は working / busy の持ち主ではない(新しい世代が畳む)
      if (runRef.current === run) {
        setWorking(null)
        onBusyChange?.(false)
      }
    }
  }

  function handleRemove() {
    // 生成中の結果が後から入ってこないように世代を進める
    runRef.current += 1
    setMade(null)
    setWorking(null)
    setFailure(null)
    onBusyChange?.(false)
    onChange(null)
    // 原本も落とす。残すと写真を外したのに OCR の導線だけが残る
    onSourceChange?.(null)
  }

  return (
    <div aria-busy={working !== null || undefined}>
      <label htmlFor={inputId} className="block text-xs text-ink-muted">
        写真
      </label>
      {/*
        日本語の文中で改行すると JSX が改行を半角空白1つに畳んで「原本は カメラロールに」と
        空白が入る。文はソースでも1行に置く(語中で折るかは CSS 側の話)。
      */}
      <p className={HINT}>
        端末に保存済みの写真から選ぶ。長辺400pxの JPEG に縮小して保存し、原本は取り込まない（原本はカメラロールに残る）。
      </p>
      {/*
        accept は image/* まで。**HEIC を mime で事前に弾かない** — iOS Safari はデコードできるので、
        弾くと動く環境を壊す。読めなかったときに案内を出す方針(resize.ts と対)。
        capture は付けない(カメラ直起動を強制しない)。
      */}
      <input
        id={inputId}
        type="file"
        accept="image/*"
        onChange={handleFile}
        disabled={disabled}
        className="mt-2 block w-full text-xs text-ink-muted file:mr-3 file:rounded file:border file:border-line-strong file:bg-surface-raised file:px-2.5 file:py-1 file:text-sm file:text-ink"
      />

      {working !== null && (
        <p role="status" className="mt-2.5 text-xs leading-relaxed text-ink-muted">
          {working} からサムネイルを作っている。大きい写真だと数秒かかる。
        </p>
      )}

      {value !== null && (
        <div className="mt-3 flex flex-wrap items-start gap-x-3 gap-y-2">
          {canShowThumbnail() && (
            /*
              width/height 属性は寸法が分かっているときだけ付ける(読み込み前に場所を確保できる)。
              属性を付けたときは CSS の height:auto が要る — src/index.css がグローバルに当てている。
              w-auto と組で使うことで max-h に合わせて幅が比例して縮む(片側だけ固定だと潰れる)。
            */
            <img
              ref={previewRef}
              alt="選んだ写真のサムネイル"
              width={known?.width}
              height={known?.height}
              className="max-h-48 w-auto rounded border border-line bg-surface"
            />
          )}
          {/*
            `basis-48` は「この幅が取れないなら写真の下に回る」の宣言。flex の行分けは縮める前に
            起きるので、横向きの写真(幅256px)で 390px 幅に収まらないときは丸ごと次の行へ落ちる。
            grow だけ付けて基準幅を与えないと、`whitespace-nowrap` の数字が容器からはみ出す。
          */}
          <div className="min-w-0 basis-48 grow">
            {/* 「サムネイル 38KB / 400×533」は1つの原子。語中(サムネ|イル)で折らせない */}
            <p className="whitespace-nowrap text-xs text-ink">
              {known === null
                ? `保存済みの写真 ${formatBytes(value.byteLength)}`
                : describeThumbnail(known)}
            </p>
            {known !== null && known.quality < TOP_QUALITY && (
              <p className={HINT}>
                {formatBytes(MAX_THUMBNAIL_BYTES)}以下に収めるため JPEG の品質を{' '}
                {String(known.quality)} まで落とした。
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-x-2 gap-y-2">
              <button type="button" onClick={handleRemove} disabled={disabled} className={QUIET_BUTTON}>
                写真を外す
              </button>
            </div>
          </div>
        </div>
      )}

      {failure !== null && (
        <div
          role="alert"
          className="mt-3 rounded border border-danger-line bg-danger-surface px-3 py-2 text-xs leading-relaxed text-danger-ink"
        >
          <p className="font-medium">
            {failure.fileName} — {FAILURE_LABEL[failure.kind]}
          </p>
          {/* 理由と対処は resize.ts が持つ文言をそのまま出す(ここで言い換えない) */}
          <p className="mt-1">{failure.message}</p>
          {value !== null && (
            <p className="mt-1 text-danger-ink">いま付いている写真はそのまま残っている。</p>
          )}
        </div>
      )}
    </div>
  )
}
