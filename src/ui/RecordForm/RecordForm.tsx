// 記録の作成・編集フォーム。SPEC の見出し機能「**写真を選んで銘柄を選ぶだけで1本記録できる**」の
// 実体で、入力は最短にする(飲みながら使う)。
//
// ## 呼び側への要求: `<RecordForm key={editingId ?? 'new'}>`
//
// **同型のコンポーネントを三項で入れ替えると React は Fiber を再利用し、state が持ち越される。**
// このフォームは初期値を props から `useState` の初期化で1回だけ取るので、`key` が無いまま
// 別の記録に切り替えると**前の記録の入力がそのまま残り、別の記録に上書き保存される**
// (brain の既知事故。RecordForm.test.tsx がこの事故を再現して固定している)。
// props 変化を effect で state に流し込む「自動同期」は入れない — 本人が編集中の値を
// 黙って捨てる別の事故になるので、同一性は `key` で表明させるのが正しい。
// 取り違えたときに黙って壊れないよう、dev では mount 後の `record.id` 変化を console.error で言う。
//
// ## この画面が引き受けている決定
//
// 1. **銘柄が分からない記録も保存できる。** 銘柄欄が空なら `unknown`、書いたが候補から選んで
//    いなければ `unlinked`。**推定で紐付けない**(ルール9)。必須は日付だけ。
// 2. **紐付けの由来を偽らない。** 候補から選んだ紐付けは `manual`(本人の判断)。取り込み時に
//    機械が当てた `auto` / `alias` は、**銘柄欄に触っていない限り書き換えない** —
//    場所やメモを直しただけでバッジが `手動` に変わると、由来の記録が壊れる。
// 3. **表記を変えたら紐付けを外す。** `獺祭` と打ち直したのに `紀土` の紐付けが残ると、
//    銘柄名と紐付け先が食い違った行が黙って生まれる。外したことは画面に出す(無音で変えない)。
// 4. **写真の欄は `../PhotoPicker/PhotoPicker.tsx` に委ねる。** サムネイル生成・失敗文言・
//    プレビューの object URL の始末はあちらが持つ(HEIC 案内や「50KB に収まらない」の文言の唯一の
//    出所は `lib/image/resize.ts`)。ここが持つのは **生成中は保存を止める** ことだけ —
//    途中で保存が通ると写真なしで保存され、「付けたのに付いていない」という無音の失敗になる。
// 5. **バッジの対応表は `../Timeline/linkStatus.ts` から引く**(唯一の出所。ルール9)。
// 6. 入力があるまま閉じようとしたら自作の確認ダイアログを出す(OS の `confirm()` は使わない)。

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createSuggester, type SuggestHit, type SuggesterTables } from '../../domain/suggest.ts'
import type {
  FlavorAxisKey,
  FlavorChart,
  LinkStatus,
  Rating,
  SakeRecord,
} from '../../domain/types.ts'
import type { NewRecord } from '../../store/records.ts'
import { PhotoPicker, type PhotoResizer } from '../PhotoPicker/PhotoPicker.tsx'
import { LinkStatusBadge } from '../Timeline/LinkStatusBadge.tsx'
import { linkStatusBadge } from '../Timeline/linkStatus.ts'
import { ConfirmDialog } from '../common/ConfirmDialog.tsx'
import { Overlay } from '../common/Overlay.tsx'
import { describeError } from '../common/errors.ts'
import { BrandSuggest } from './BrandSuggest.tsx'
import { DateInput } from './DateInput.tsx'
import { RatingInput } from './RatingInput.tsx'

/**
 * サジェストと紐付け表示に要るテーブル束。`SakenowaTables` = `SuggesterTables` そのままで、
 * `DecodedTables` がこれを満たす(索引は要求しない — テストが数件のリテラルから組める)。
 */
export type RecordFormTables = SuggesterTables

/**
 * 保存する値。`sourceNo`(元ログの No.)だけは**この画面が触らない**ので外す:
 * 新規は `null`、編集は既存値を保つ、という判断は呼び側(store 呼び出し側)の関心。
 * `NewRecord` から導くので `SakeRecord` に項目が増えたらここがコンパイルエラーになる。
 */
export type RecordDraft = Omit<NewRecord, 'sourceNo'>

export type RecordFormProps = {
  /** 編集対象。`null` / 省略で新規。**呼び側は `key={editingId ?? 'new'}` を必ず渡す** */
  record?: SakeRecord | null
  tables: RecordFormTables
  /**
   * 保存。**閉じるかどうかは呼び側が決める**(この画面は開いたまま待つ)。
   * 拒否したらその理由をこの画面が出す(保存できたのかどうかを黙らせない)。
   */
  onSubmit: (draft: RecordDraft) => void | Promise<void>
  /** 取消 / 閉じる。入力があるときは確認を経てから呼ばれる */
  onCancel: () => void
  /** 「今日」`'YYYY-MM-DD'`。既定は端末のローカル日付。テストと時計ずれの検証のために注入できる */
  today?: string
  /**
   * 写真 → サムネイル。既定は `PhotoPicker` の既定(= `resizeToThumbnail`)。
   * canvas も `createImageBitmap` も jsdom に無いのでテストはここを差し替える。
   */
  resizePhoto?: PhotoResizer
}

/** いま紐付いている銘柄。`origin` は「本人が触ったか」= `linkStatus` を保つ根拠 */
type LinkState = {
  brandId: number
  /** 表示名。保存済みの名前を優先する(上流から銘柄が消えても表示が消えない) */
  brandName: string | null
  prefecture: string | null
  breweryName: string | null
  /** `initial` = 記録が既に持っていた紐付け(本人はまだ触っていない) */
  origin: 'initial' | 'picked'
}

type Resolved = {
  brandId: number | null
  brandName: string | null
  status: LinkStatus
  prefecture: string | null
}

/**
 * f1..f6 の日本語ラベル。**値の単位は 0-100 の整数**(さけのわ原値の 0.0-1.0 ではない)。
 *
 * 同じ表が `../RecordDetail/RecordDetail.tsx` にもある(あちらは export していない)。
 * 6軸ラベルの出所を1箇所にする整理は RecordDetail 側に手を入れる必要があるので、
 * ここでは同じ順・同じ語で持つに留める(ラベルが増減する類の表ではない)。
 */
const FLAVOR_AXES: readonly { key: FlavorAxisKey; label: string }[] = [
  { key: 'f1', label: '華やか' },
  { key: 'f2', label: '芳醇' },
  { key: 'f3', label: '重厚' },
  { key: 'f4', label: '穏やか' },
  { key: 'f5', label: 'ドライ' },
  { key: 'f6', label: '軽快' },
]

const TEXT_FIELD =
  'mt-1 w-full rounded border border-stone-700 bg-stone-900 px-2.5 py-1.5 text-sm text-stone-100 placeholder:text-stone-500'
const LABEL = 'text-xs text-stone-400'
const QUIET_BUTTON =
  'whitespace-nowrap rounded border border-stone-700 px-2.5 py-1 text-xs text-stone-200'

/**
 * 端末のローカル日付。**UTC で取らない** — 日本時間の朝9時前が前日になり、
 * 「今日」の既定値が1日ずれる(飲んだ日の記録では致命的)。
 */
function localToday(): string {
  const at = new Date()
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${String(at.getFullYear()).padStart(4, '0')}-${month}-${day}`
}

/**
 * 保存する紐付けを決める。**唯一の判断箇所**(バッジの表示と保存値を同じ関数から出す
 * — 別々に書くと「画面は未紐付けなのに `auto` で保存される」がありえる)。
 *
 * - 候補から選んだ → `manual`(本人の判断)。ただし**記録が元から持っていた紐付けに触っていない
 *   なら元の `linkStatus` を保つ**(auto/alias を編集のたびに手動へ書き換えない)
 * - 選んでいない & 表記も元のまま → 元の状態を保つ(ログ由来の `unlinked` / `unknown` と県を残す)
 * - 選んでいない & 表記が空 → `unknown`(記録時点で銘柄が判読できていない)
 * - 選んでいない & 表記あり → `unlinked`。**県は空にする**(別の銘柄名に前の県を残さない)
 */
function resolveLink(record: SakeRecord | null, link: LinkState | null, label: string): Resolved {
  // **保存済みの表記も trim して比べる。** `label` は入力欄を trim した値なので、生の
  // `record.brandLabel` と比べると**末尾に空白がある記録を開いただけで「触った」と判定される**
  // (開いた時点でバッジが `手動` に変わり、場所だけ直して保存すると由来が `manual` で潰れる /
  //  未紐付けの記録は県が消える)。ログのパーサは全セルを trim するが、バックアップ JSON の
  // 取り込みは型しか見ない(`domain/backupSchema.ts`)ので、空白付きの表記は実際に入り得る。
  const untouchedLabel = record !== null && label === record.brandLabel.trim()

  if (link !== null) {
    const keep =
      record !== null && link.origin === 'initial' && untouchedLabel ? record.linkStatus : null
    return {
      brandId: link.brandId,
      brandName: link.brandName,
      status: keep ?? 'manual',
      prefecture: link.prefecture,
    }
  }

  if (record !== null && untouchedLabel && record.sakenowaBrandId === null) {
    return {
      brandId: null,
      brandName: null,
      status: record.linkStatus,
      prefecture: record.prefecture,
    }
  }

  return {
    brandId: null,
    brandName: null,
    status: label === '' ? 'unknown' : 'unlinked',
    prefecture: null,
  }
}

export function RecordForm({
  record = null,
  tables,
  onSubmit,
  onCancel,
  today: todayProp,
  resizePhoto,
}: RecordFormProps) {
  // 「今日」は mount 時に1回だけ確定させる。日付をまたいだ瞬間に既定値が動くと、
  // 打ちかけの記録の日付が黙って変わる(前日/今日/翌日ボタンの基準もずれる)
  const [today] = useState(() => todayProp ?? localToday())

  // サジェスタと索引は**テーブル1つにつき1回だけ**組む。3264件の正規化をキーストロークごとに
  // やると日本語入力の変換中(1文字ごとに input が飛ぶ)に詰まる(domain/suggest.ts の設計)。
  const lookups = useMemo(() => {
    const brandById = new Map(tables.brands.map((brand) => [brand.id, brand]))
    const breweryById = new Map(tables.breweries.map((brewery) => [brewery.id, brewery]))
    // areaId 0 は「その他」で都道府県ではない。県名として引けるようにしない
    const areaNameById = new Map(
      tables.areas.filter((area) => area.id !== 0).map((area) => [area.id, area.name]),
    )
    const chartByBrandId = new Map<number, FlavorChart>(
      tables.flavorCharts.map((chart) => [chart.brandId, chart]),
    )
    return { suggest: createSuggester(tables), brandById, breweryById, areaNameById, chartByBrandId }
  }, [tables])

  /** 記録が既に持っている紐付け。**銘柄名は保存済みの値を優先**(上流から消えても表示が残る) */
  function initialLink(): LinkState | null {
    if (record === null || record.sakenowaBrandId === null) return null
    const brand = lookups.brandById.get(record.sakenowaBrandId)
    const brewery = brand === undefined ? undefined : lookups.breweryById.get(brand.breweryId)
    const breweryName = brewery?.name.trim() ?? ''
    return {
      brandId: record.sakenowaBrandId,
      brandName: record.brandName ?? brand?.name ?? null,
      // 記録の値が先。無いときだけ 銘柄 → 蔵 → エリア を辿る。**これは推定ではない** —
      // 紐付け先が確定している銘柄の県で、候補から選び直したときに入る値と同じ経路
      // (BrandSuggest 側も areaId 0 を県として扱わない)。辿れなければ null のまま。
      prefecture:
        record.prefecture ??
        (brewery === undefined ? null : (lookups.areaNameById.get(brewery.areaId) ?? null)),
      breweryName: breweryName === '' ? null : breweryName,
      origin: 'initial',
    }
  }

  // 初期値は mount 時に1回だけ確定させる。**props 変化を state に流し込む effect は作らない**
  // (呼び側が `key` で作り直す。ファイル冒頭の設計)
  const [initial] = useState(() => ({
    drankOn: record?.drankOn ?? today,
    brandLabel: record?.brandLabel ?? '',
    link: initialLink(),
    spec: record?.spec ?? '',
    rating: record?.rating ?? null,
    place: record?.place ?? '',
    note: record?.note ?? '',
    thumbnail: record?.thumbnail ?? null,
  }))

  const [drankOn, setDrankOn] = useState(initial.drankOn)
  const [brandLabel, setBrandLabel] = useState(initial.brandLabel)
  const [link, setLink] = useState<LinkState | null>(initial.link)
  const [linkCleared, setLinkCleared] = useState(false)
  const [spec, setSpec] = useState(initial.spec)
  const [rating, setRating] = useState<Rating | null>(initial.rating)
  const [place, setPlace] = useState(initial.place)
  const [note, setNote] = useState(initial.note)
  const [thumbnail, setThumbnail] = useState<Blob | null>(initial.thumbnail)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  /** 日付だけの検証結果。**日付欄の隣に出す**(画面の下だけに出すと入力箇所と結び付かない) */
  const [dateError, setDateError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)

  const specId = useId()
  const placeId = useId()
  const noteId = useId()

  // `key` の取り違えを黙らせない。dev で mount 後に record の id が変わったら言う
  // (この経路に入ったフォームは前の記録の入力を持ったまま別の記録を上書きする)
  const mountedRecordId = useRef<string | null>(record?.id ?? null)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    if ((record?.id ?? null) === mountedRecordId.current) return
    console.error(
      'RecordForm: mount 後に record の id が変わった。<RecordForm key={editingId ?? "new"}> で作り直すこと（前の記録の入力が残り、別の記録に上書き保存される）',
    )
  })

  const label = brandLabel.trim()
  const resolved = resolveLink(record, link, label)
  const badge = linkStatusBadge(resolved.status)
  const chart = link === null ? undefined : lookups.chartByBrandId.get(link.brandId)

  const dirty =
    drankOn !== initial.drankOn ||
    brandLabel !== initial.brandLabel ||
    (link?.brandId ?? null) !== (initial.link?.brandId ?? null) ||
    spec !== initial.spec ||
    rating !== initial.rating ||
    place !== initial.place ||
    note !== initial.note ||
    thumbnail !== initial.thumbnail

  function handleLabelChange(next: string) {
    setBrandLabel(next)
    // 表記を変えたら紐付けは外す。銘柄名と紐付け先が食い違った行を作らない
    if (link !== null) {
      setLink(null)
      setLinkCleared(true)
    }
  }

  function handlePick(hit: SuggestHit) {
    setLink({
      brandId: hit.brand.id,
      brandName: hit.brand.name,
      prefecture: hit.prefecture,
      breweryName: hit.breweryName,
      origin: 'picked',
    })
    setLinkCleared(false)
    // 入力欄は書き換えない(本人の表記が原本)。空のまま選んだときだけ銘柄名を入れる
    if (label === '') setBrandLabel(hit.brand.name)
  }

  function clearLink() {
    setLink(null)
    setLinkCleared(false)
  }

  function handleDateChange(next: string) {
    setDrankOn(next)
    // 直した瞬間に注意を下げる(直したのに赤いまま、を作らない)
    if (next !== '') setDateError(null)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    if (photoBusy) {
      // 生成中に保存すると写真なしで保存が通る(「付けたのに付いていない」の無音の失敗)
      setFormError('写真をサムネイルにしている途中。処理が終わってから保存する。')
      return
    }
    if (drankOn === '') {
      // 日付だけが必須。ここで「今日」に補正すると本人が意図しない日付が黙って入る
      setDateError('日付が成立していないので保存できない。年4桁・月・日を入れる。')
      setFormError(null)
      return
    }
    setDateError(null)
    setFormError(null)
    const draft: RecordDraft = {
      drankOn,
      brandLabel: label,
      sakenowaBrandId: resolved.brandId,
      brandName: resolved.brandName,
      linkStatus: resolved.status,
      prefecture: resolved.prefecture,
      spec: spec.trim(),
      rating,
      place: place.trim(),
      note: note.trim(),
      thumbnail,
    }
    setSubmitting(true)
    void Promise.resolve(onSubmit(draft)).then(
      () => {
        setSubmitting(false)
      },
      (cause: unknown) => {
        setSubmitting(false)
        setFormError(`保存できなかった — ${describeError(cause)}`)
      },
    )
  }

  function requestClose() {
    if (submitting) return
    // 入力があるまま閉じると打った内容が消える。OS の confirm() は使わない(ルール5)
    if (dirty) {
      setDiscarding(true)
      return
    }
    onCancel()
  }

  return (
    <Overlay title={record === null ? '記録を追加' : '記録を編集'} onClose={requestClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-4 py-4">
        <DateInput
          value={drankOn}
          onChange={handleDateChange}
          today={today}
          errorMessage={dateError}
        />

        <div className="min-w-0">
          <BrandSuggest
            value={brandLabel}
            onChange={handleLabelChange}
            onPick={handlePick}
            suggest={lookups.suggest}
          />

          {/* 保存したら何になるかを**先に**見せる。バッジと説明は linkStatus.ts の1箇所から引く */}
          <div className="mt-2 rounded border border-stone-800 bg-stone-900/40 px-2.5 py-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <LinkStatusBadge status={resolved.status} />
              <p className="min-w-0 text-xs leading-relaxed text-stone-400">{badge.help}</p>
            </div>

            {link === null ? (
              <p className="mt-1.5 text-xs leading-relaxed text-stone-500">
                候補から選ぶと都道府県・蔵元・フレーバー6軸が入る。選ばなくても保存できる（推定では埋めない）。
              </p>
            ) : (
              <>
                <dl className="mt-1.5 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                  <Field label="銘柄">
                    {link.brandName ?? (
                      <span className="text-amber-300">
                        さけのわのマスタに無い銘柄ID {link.brandId}
                      </span>
                    )}
                  </Field>
                  <Field label="都道府県">{link.prefecture ?? <Absent />}</Field>
                  <Field label="蔵元">{link.breweryName ?? <Absent />}</Field>
                </dl>
                <Flavor chart={chart} />
                <button type="button" onClick={clearLink} className={`mt-2 ${QUIET_BUTTON}`}>
                  紐付けを外す
                </button>
              </>
            )}

            {linkCleared && link === null && (
              <p className="mt-1.5 text-xs leading-relaxed text-amber-300">
                表記を変えたので紐付けを外した（都道府県も空になる）。候補から選び直すか、そのまま未紐付けで保存する。
              </p>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <label htmlFor={specId} className={LABEL}>
            スペック
          </label>
          <input
            id={specId}
            type="text"
            value={spec}
            onChange={(event) => setSpec(event.target.value)}
            placeholder="純米大吟醸 無濾過生原酒"
            className={TEXT_FIELD}
          />
        </div>

        <RatingInput value={rating} onChange={setRating} />

        <div className="min-w-0">
          <label htmlFor={placeId} className={LABEL}>
            場所・店名
          </label>
          <input
            id={placeId}
            type="text"
            value={place}
            onChange={(event) => setPlace(event.target.value)}
            placeholder="自宅"
            className={TEXT_FIELD}
          />
        </div>

        <div className="min-w-0">
          <label htmlFor={noteId} className={LABEL}>
            メモ
          </label>
          <textarea
            id={noteId}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={`${TEXT_FIELD} resize-y`}
          />
        </div>

        {/* 写真。生成・失敗案内・プレビューの始末は PhotoPicker が持つ(この画面に写しを作らない)。
            **`onBusyChange` を必ず受ける** — 生成中の保存を止めるのはフォーム側の責務。 */}
        <div className="min-w-0">
          <PhotoPicker
            value={thumbnail}
            onChange={setThumbnail}
            onBusyChange={setPhotoBusy}
            disabled={submitting}
            resize={resizePhoto}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-stone-800 pt-4">
          <button
            type="submit"
            disabled={submitting}
            className="whitespace-nowrap rounded border border-stone-600 bg-stone-800 px-3 py-1.5 text-sm text-stone-100 disabled:opacity-50"
          >
            {submitting ? '保存している' : '保存'}
          </button>
          <button
            type="button"
            onClick={requestClose}
            disabled={submitting}
            className="whitespace-nowrap rounded border border-stone-700 px-3 py-1.5 text-sm text-stone-300 disabled:opacity-50"
          >
            取消
          </button>
          <p className="min-w-0 text-xs text-stone-500">必須は日付だけ。</p>
        </div>

        {formError !== null && (
          <p role="alert" className="text-xs leading-relaxed text-amber-300">
            {formError}
          </p>
        )}
      </form>

      {discarding && (
        <ConfirmDialog
          title="入力を破棄する"
          message="この画面で入れた内容は保存されない。破棄して閉じる。"
          confirmLabel="破棄して閉じる"
          cancelLabel="入力に戻る"
          onConfirm={onCancel}
          onCancel={() => setDiscarding(false)}
        />
      )}
    </Overlay>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="whitespace-nowrap text-stone-500">{label}</dt>
      <dd className="min-w-0 break-words text-stone-200">{children}</dd>
    </>
  )
}

function Absent() {
  return <span className="text-stone-500">記録なし</span>
}

/**
 * 選んだ銘柄のフレーバー6軸。**紐付け済み ≠ フレーバー取得済み**(3264件のうちチャートを持つのは
 * 1344件)なので、無いときは 0 で埋めずに「未取得」と言う。この節に数値を1つも出さない
 * (「未取得」の隣の数字は軸の値と読める。RecordDetail と同じ規則)。
 */
function Flavor({ chart }: { chart: FlavorChart | undefined }) {
  if (chart === undefined) {
    return (
      <p className="mt-1.5 text-xs leading-relaxed text-stone-500">
        フレーバー未取得 — さけのわにこの銘柄のフレーバーデータが無い。紐付け自体は済んでいる。推定値では埋めない。
      </p>
    )
  }
  return (
    <>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {FLAVOR_AXES.map(({ key, label }) => (
          <li key={key} className="whitespace-nowrap">
            <span className="text-stone-500">{label}</span>{' '}
            <span className="text-stone-200">{chart[key]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs leading-relaxed text-stone-500">
        さけのわデータの6軸（各 0〜100）。銘柄に紐づく値で、本人の評価ではない。
      </p>
    </>
  )
}
