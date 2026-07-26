// 記録1件の詳細。
//
// ## この画面が引き受けている不変条件: フレーバーを推定で埋めない
//
// 紐付いていない記録(`unlinked` / `unknown`)にも、紐付いてはいるが上流にチャートが無い記録
// (`ビキニ娘` id2020)にも、6軸の数値を1つも出さない。0 で埋めると「穏やかで軽快な酒」に見え、
// しかも画面上は正常なので誰も気付けない。**紐付け済み(186) ≠ フレーバー取得済み(185)。**
//
// ## 持たないもの
//
// - **`linkStatus` の対応表**。表は `../Timeline/linkStatus.ts` の1箇所だけが持ち、ここは
//   `LinkStatusBadge` を描くだけ(2箇所に持つと片方だけ直したとき同じ状態が別の見た目で出る)。
// - **オーバーレイの機構**。`history.pushState` / `popstate` / フォーカストラップは
//   `../common/Overlay.tsx` に閉じている(ConfirmDialog と同じく土台を借りる側)。
// - **削除の確認 UI**。`../common/ConfirmDialog.tsx` を使う(OS 既定の `confirm()` は使わない)。
// - **編集フォームと手動紐付けの画面**。押されたことを親に渡すだけ。

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  FlavorAxisKey,
  FlavorChart,
  SakeRecord,
  SakenowaBrand,
  SakenowaBrewery,
} from '../../domain/types.ts'
import { ConfirmDialog } from '../common/ConfirmDialog.tsx'
import { Overlay } from '../common/Overlay.tsx'
import { LinkStatusBadge } from '../Timeline/LinkStatusBadge.tsx'
import { isLinkedStatus } from '../Timeline/linkStatus.ts'

/**
 * 詳細表示が引く索引だけを要求する最小の面。`DecodedTables` がそのまま満たす。
 *
 * **`Map.get` が `undefined` を返したら「無い」で通す。** 全件から適当な1件を選ぶ・0 で埋める、
 * といったフォールバックを入れない(定義域外のキーで全件に落ちてはならない)。
 */
export type RecordDetailTables = {
  brandById: ReadonlyMap<number, SakenowaBrand>
  breweryById: ReadonlyMap<number, SakenowaBrewery>
  /** 1344件しかない。**紐付け済み ≠ フレーバー取得済み** なので欠けを 0 で埋めない */
  flavorChartByBrandId: ReadonlyMap<number, FlavorChart>
}

export type RecordDetailProps = {
  record: SakeRecord
  tables: RecordDetailTables
  /** 戻る / Escape / 背景クリック / 見出しの「閉じる」から呼ばれる(機構は Overlay 側) */
  onClose: () => void
  /** 編集フォーム本体はこの画面の責務ではない。押されたことだけを親に渡す */
  onEdit: (record: SakeRecord) => void
  /** 確認ダイアログで「削除する」を押したときだけ呼ぶ */
  onDelete: (record: SakeRecord) => void
  /**
   * 手動紐付けを開く。**未紐付けの記録だけでなく紐付け済みの記録でも出す** —
   * 紐付けの解除は手動紐付けの画面が持っているので、ここを未紐付け限定にすると
   * 本人が下した判断を取り消す入口が1つも無くなる(文言だけを状態で変える)。
   */
  onLink?: (record: SakeRecord) => void
}

/** f1..f6 の日本語ラベル。**値の単位は 0-100 の整数**(さけのわ原値の 0.0-1.0 ではない) */
const FLAVOR_AXES: readonly { key: FlavorAxisKey; label: string }[] = [
  { key: 'f1', label: '華やか' },
  { key: 'f2', label: '芳醇' },
  { key: 'f3', label: '重厚' },
  { key: 'f4', label: '穏やか' },
  { key: 'f5', label: 'ドライ' },
  { key: 'f6', label: '軽快' },
]

/** 未記入・不明を1つの文言に寄せる(項目ごとに「なし」「未設定」と揺れると読み手が意味を探す) */
const NOT_RECORDED = '記録なし'

export function RecordDetail({
  record,
  tables,
  onClose,
  onEdit,
  onDelete,
  onLink,
}: RecordDetailProps) {
  // 確認は**どの記録に対する確認か**を持つ。真偽値 + effect で畳むと
  // 「別の記録に切り替わった瞬間だけ前の記録の確認が開いている」1フレームが作れてしまう。
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const confirmingDelete = confirmingId === record.id

  // 表示名は紐付け時点で非正規化保存した銘柄名を優先し、無ければ本人が書いた生の表記に落ちる。
  // brandId から毎回逆引きしないのは、テーブル未着でも描けるようにするため(types.ts の設計)。
  const title = record.brandName ?? record.brandLabel
  // 紐付いた銘柄名と本人の表記が違うとき(`荷札酒` → `加茂錦` 等)は原本も併記する。
  // 記録は本人の表記が原本で、さけのわ名はそれに当てた解釈にすぎない(RecordCard と同じ規則)。
  const showRawLabel = record.brandName !== null && record.brandName !== record.brandLabel

  const brand =
    record.sakenowaBrandId === null ? undefined : tables.brandById.get(record.sakenowaBrandId)
  const brewery = brand === undefined ? undefined : tables.breweryById.get(brand.breweryId)
  const chart =
    record.sakenowaBrandId === null
      ? undefined
      : tables.flavorChartByBrandId.get(record.sakenowaBrandId)

  return (
    <Overlay title="記録の詳細" onClose={onClose}>
      <article className="px-4 py-4">
        {/* 日付は等幅数字(index.css の font-variant-numeric)で縦に揃う */}
        <time dateTime={record.drankOn} className="text-xs text-ink-muted">
          {formatDrankOn(record.drankOn)}
        </time>

        {/* 日本語ラベルは語中で折れる。銘柄名(長い)とバッジ(短い原子)を同じ行に並べるので
            コンテナは flex-wrap + gap-y、バッジ側の whitespace-nowrap は LinkStatusBadge が持つ。 */}
        <header className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
          <h2 className="text-lg font-semibold leading-snug tracking-tight text-ink">
            {title}
          </h2>
          <LinkStatusBadge status={record.linkStatus} />
        </header>
        {showRawLabel ? (
          <p className="mt-1 text-xs text-ink-faint">記録の表記: {record.brandLabel}</p>
        ) : null}

        <Thumbnail blob={record.thumbnail} label={title} />

        <dl className="mt-4 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
          <Field label="都道府県">{record.prefecture ?? <Absent />}</Field>
          <Field label="蔵元">{brewery?.name ?? <Absent />}</Field>
          <Field label="スペック">{record.spec === '' ? <Absent /> : record.spec}</Field>
          <Field label="評価">
            {record.rating === null ? <Absent label="未評価" /> : `${String(record.rating)} / 5`}
          </Field>
          <Field label="場所">{record.place === '' ? <Absent /> : record.place}</Field>
          <Field label="メモ">
            {record.note === '' ? (
              <Absent />
            ) : (
              <span className="whitespace-pre-wrap">{record.note}</span>
            )}
          </Field>
        </dl>

        <section className="mt-6 border-t border-line pt-4">
          <h3 className="text-xs font-semibold text-ink-muted">フレーバー</h3>
          {chart === undefined ? (
            <MissingFlavor record={record} />
          ) : (
            <>
              <ul className="mt-2.5 space-y-2">
                {FLAVOR_AXES.map(({ key, label }) => (
                  <li key={key} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="w-14 shrink-0 whitespace-nowrap text-xs text-ink-muted">
                      {label}
                    </span>
                    <span className="h-1.5 min-w-24 flex-1 rounded-full bg-surface-raised">
                      <span
                        className="block h-1.5 rounded-full bg-plot-ink"
                        // 単位は 0-100 の整数。上流が範囲外を返しても幅は clamp する
                        style={{ width: `${String(clampPercent(chart[key]))}%` }}
                      />
                    </span>
                    <span className="w-8 shrink-0 whitespace-nowrap text-right text-xs text-ink-muted">
                      {chart[key]}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-xs leading-relaxed text-ink-faint">
                さけのわデータの6軸（各 0〜100）。銘柄に紐づく値で、本人の評価ではない。
              </p>
            </>
          )}
        </section>

        {/* 短いボタン文言は語中で折らせない。行側は flex-wrap + gap-y で受ける */}
        <div className="mt-6 flex flex-wrap gap-x-2 gap-y-2 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => onEdit(record)}
            className="whitespace-nowrap rounded border border-line-strong px-3 py-1.5 text-xs text-ink"
          >
            編集
          </button>
          {onLink !== undefined && (
            <button
              type="button"
              onClick={() => onLink(record)}
              className="whitespace-nowrap rounded border border-line-strong px-3 py-1.5 text-xs text-ink"
            >
              {isLinkedStatus(record.linkStatus) ? '紐付けを見直す' : '手動で紐付ける'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmingId(record.id)}
            className="whitespace-nowrap rounded border border-line-strong px-3 py-1.5 text-xs text-ink-muted"
          >
            削除
          </button>
        </div>
      </article>

      {confirmingDelete && (
        <ConfirmDialog
          title="記録を削除する"
          message={`${formatDrankOn(record.drankOn)}の「${title}」を削除する。取り消せない。`}
          confirmLabel="削除する"
          onConfirm={() => onDelete(record)}
          onCancel={() => setConfirmingId(null)}
        />
      )}
    </Overlay>
  )
}

/**
 * フレーバーが出せない2ケース。**見出しは同じ「フレーバー未取得」、理由文だけを分ける。**
 *
 * 見出しを分けない理由: 集計(分母 = フレーバー取得済み件数)から外れる点で両者は同一で、
 * ここで「未取得」と「データ無し」に割ると、利用者は分母の外に2種類の状態があると読む。
 * 語彙は Timeline・統計・フレーバー分布で1つに保つ(バッジ側も同じく1つの表から引いている)。
 *
 * 理由文を分ける理由: 打てる手が違う。紐付いていないものは手動紐付けで入り得るが、
 * 上流にチャートが無いものは紐付けを直しても永久に入らない。
 * ここを同じ文にすると「紐付けを直せば出る」と誤読させる。
 */
function MissingFlavor({ record }: { record: Pick<SakeRecord, 'linkStatus' | 'sakenowaBrandId'> }) {
  const reason =
    record.sakenowaBrandId !== null
      ? 'さけのわにこの銘柄のフレーバーデータが無い。紐付け自体は済んでいる。'
      : record.linkStatus === 'unknown'
        ? '記録した時点で銘柄が判読できていないため、さけのわの銘柄に紐付いていない。'
        : 'この表記はさけのわの銘柄に紐付いていない（未登録、または候補が絞れていない）。'
  return (
    <>
      <p className="mt-2 text-sm text-ink">フレーバー未取得</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-faint">{reason}</p>
      {/* この節に数字を1つも書かない。「フレーバー未取得」の隣に数値があると、
          説明のための数字でも軸の値と読める(テストは節に数字が無いことを見張っている)。 */}
      <p className="mt-1 text-xs leading-relaxed text-ink-faint">
        推定値では埋めない。フレーバーの集計の分母からも外す。
      </p>
    </>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="whitespace-nowrap text-ink-faint">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </>
  )
}

function Absent({ label = NOT_RECORDED }: { label?: string }) {
  return <span className="text-ink-faint">{label}</span>
}

/** `YYYY-MM-DD` を和文に。**形が違う値は加工せずそのまま出す**(勝手に補正して隠さない) */
function formatDrankOn(drankOn: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(drankOn)
  if (parts === null) return drankOn
  return `${String(Number(parts[1]))}年${String(Number(parts[2]))}月${String(Number(parts[3]))}日`
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/**
 * ラベル写真。**`src` を state に持たず effect から `img.src` に直接書く** —
 * 生成と `revoke` を対で書ける唯一の置き場が effect の後始末で、state 経由にすると
 * effect 内の同期 setState になり、`useMemo` で作ると StrictMode の二重呼び出しで1本 leak する。
 * 理由の詳細は `../Timeline/RecordCard.tsx` の同名関数に書いてある(意図的に同じ手を使う)。
 *
 * `createObjectURL` が無い環境(テストの jsdom)では何も描かない。203本は全て
 * `thumbnail: null` なので、いまの実データではこの節はまだ一度も描かれない。
 */
function Thumbnail({ blob, label }: { blob: Blob | null; label: string }) {
  const imgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const img = imgRef.current
    if (img === null || blob === null) return
    const objectUrl = URL.createObjectURL(blob)
    img.src = objectUrl
    return () => {
      img.removeAttribute('src')
      URL.revokeObjectURL(objectUrl)
    }
  }, [blob])

  if (blob === null || typeof URL.createObjectURL !== 'function') return null
  // width/height 属性は付けない。原本の縦横比が分からないので比率を属性で縛れず、
  // 属性を付けると CSS の height:auto(src/index.css)頼みで縦横比が崩れる。
  // 高さは max-h-72 で抑え、幅は成り行きに任せる。
  return (
    <img ref={imgRef} alt={`${label} のラベル写真`} className="mt-4 max-h-72 rounded border border-line" />
  )
}
