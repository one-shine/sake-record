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

import { useEffect, useState, type ReactNode } from 'react'
import type { BreweryArticle, BreweryArticles } from '../../domain/breweryNote.ts'
import { rankFlavorTagsByRarity } from '../../domain/flavorProfile.ts'
import { normalizePrefecture } from '../../domain/prefecture.ts'
import type {
  FlavorAxisKey,
  FlavorChart,
  SakeRecord,
  SakenowaBrand,
  SakenowaBrewery,
} from '../../domain/types.ts'
import type { BrandNote, NoteTarget } from '../../domain/types.ts'
import { WIKIPEDIA_LICENSE_URL } from '../../config/app.ts'
import { ConfirmDialog } from '../common/ConfirmDialog.tsx'
import { canShowThumbnail, useThumbnailImageRef } from '../common/thumbnailUrl.ts'
import { Overlay } from '../common/Overlay.tsx'
import { LinkStatusBadge } from '../Timeline/LinkStatusBadge.tsx'
import type { FlavorTagSource } from '../Timeline/flavorTagFacet.ts'
import { isLinkedStatus } from '../Timeline/linkStatus.ts'
import { NoteEditor } from './NoteEditor.tsx'

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
  /**
   * 蔵元の説明(B78)。**任意ではなく必須の項目にして、空の Map を渡させる。**
   * 省略できる形にすると「渡し忘れ」と「確定した行が無い」が同じ見た目になり、
   * 配線の抜けが画面から読めなくなる(不確実性は Map の中身で表す)。
   */
  breweryArticles: BreweryArticles
}

export type RecordDetailProps = {
  record: SakeRecord
  tables: RecordDetailTables
  /**
   * 味タグ。**絞り込みと同じ入手経路を使う**(取得を2箇所に書かない)。
   *
   * 渡さなければ味タグの節を描かない — 味タグは起動時に取らない資源なので、
   * 呼び側が「この画面でも要る」と決めたときだけ渡す。
   */
  flavorTags?: FlavorTagSource
  /**
   * 銘柄・蔵元のメモ(B76)。**渡さなければ節ごと描かない**(味タグと同じ扱い)。
   *
   * 紐付いていない記録には出ない — 宛先の銘柄IDが決まらないので、書いても行き場が無い
   * (表記の文字列を鍵にすると鍵の名前空間が増え、後で紐付いたときに移送が要る)。
   */
  notes?: NoteSource
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

/**
 * メモの入手経路と書き込み口。**状態と2つの導線を1つのオブジェクトで渡す**
 * (`FlavorTagSource` と同じ理由 — 状態だけ渡せる形にすると書けない配線が作れる)。
 */
export type NoteSource = {
  /** 宛先 → 本文。無い宛先は `undefined` */
  textOf: (target: NoteTarget, targetId: number) => string | undefined
  onSave: (note: BrandNote) => Promise<void>
  onDelete: (target: NoteTarget, targetId: number) => Promise<void>
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
  flavorTags,
  notes,
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
  // 蔵元が決まったときだけ引く。**紐付いていない記録には出ない**(宛先が無い)
  const breweryArticle =
    brewery === undefined ? undefined : tables.breweryArticles.get(brewery.id)
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

        <Thumbnail bytes={record.thumbnail} label={title} />

        <dl className="mt-4 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
          {/* `?? ` だけで見ると `''`(バックアップ JSON 由来)で**この欄だけが空欄**になる。
              他の欄は未記入を「記録なし」と書くので、黙るのはここだけの不整合 */}
          <Field label="都道府県">{normalizePrefecture(record.prefecture) ?? <Absent />}</Field>
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
                さけのわデータの6軸（各 0〜100）。<strong className="font-medium">銘柄に紐づく値</strong>で、本人の評価ではない。
                スペック（純米大吟醸・本醸造など）は見ていないので、同じ銘柄なら別のスペックでも同じ値が出る。
              </p>
            </>
          )}
        </section>

        {flavorTags !== undefined && (
          <FlavorTags brandId={record.sakenowaBrandId} source={flavorTags} />
        )}

        {breweryArticle !== undefined && (
          <BreweryAbout brewery={brewery} article={breweryArticle} />
        )}

        {notes !== undefined && <Notes brand={brand} brewery={brewery} source={notes} />}

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
 * 味タグ。**絞り込みで使っている語をそのまま出す。**
 *
 * これが無いと、「香り高い」で絞り込んで出てきた記録を開いても、なぜ当たったのかが
 * どこにも書いていない状態になる(実機で指摘された)。絞る根拠は絞られた側に見えていること。
 *
 * **6軸とは別のデータ**で、対象の銘柄も違う(6軸 1344件 / 味タグ 2136件)。
 * 片方しか無い銘柄が 894件あるので、**どちらか一方だけが出る記録は普通に起きる**。
 * 無いものを無いと言うために、節そのものは常に描く。
 */
function FlavorTags({ brandId, source }: { brandId: number | null; source: FlavorTagSource }) {
  const { state, onNeeded, onRetry } = source

  // **開いたときに要ると言う。** 起動時には取らない資源なので、ここが取得の起点になる
  useEffect(() => {
    onNeeded()
    // `onNeeded` は呼び側で毎描画作られ得るので依存に入れない(入れると取得が繰り返される)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section className="mt-6 border-t border-line pt-4">
      <h3 className="text-xs font-semibold text-ink-muted">味タグ</h3>
      <FlavorTagBody brandId={brandId} state={state} onRetry={onRetry} />
    </section>
  )
}

function FlavorTagBody({
  brandId,
  state,
  onRetry,
}: {
  brandId: number | null
  state: FlavorTagSource['state']
  onRetry: () => void
}) {
  if (brandId === null) {
    return (
      <p className="mt-2 text-xs leading-relaxed text-ink-faint">
        銘柄が決まっていないので味タグは引けない。紐付けると出る。
      </p>
    )
  }
  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <p role="status" className="mt-2 text-xs text-ink-muted">
        味タグを読み込んでいる
      </p>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="mt-2">
        <p className="text-xs leading-relaxed text-ink-muted">味タグを読み込めなかった。{state.message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 whitespace-nowrap rounded border border-line-strong px-2.5 py-1 text-xs text-ink"
        >
          再試行
        </button>
      </div>
    )
  }

  // **希少な順に並べ替える。** さけのわの並びのままだと、どの銘柄も先頭が
  // 酸味・辛口・旨味 になって銘柄を区別しない(半数以上の銘柄に付いている語なので)
  const tagIds = state.value.tagIdsByBrandId.get(brandId) ?? []
  const tags = rankFlavorTagsByRarity(tagIds, state.value.brandCountByTagId).flatMap((ranked) => {
    const tag = state.value.tagNameById.get(ranked.id)
    return tag === undefined ? [] : [{ tag, brandCount: ranked.brandCount }]
  })

  if (tags.length === 0) {
    // **0 件と「読めていない」を同じ見た目にしない**(推定で埋めないのと同じ規律)
    return (
      <p className="mt-2 text-xs leading-relaxed text-ink-faint">
        さけのわにこの銘柄の味タグが無い。絞り込みの「味」でも当たらない。
      </p>
    )
  }

  return (
    <>
      {/* 日本語ラベルは語中で折れる。行は flex-wrap + gap-y、語は whitespace-nowrap で受ける */}
      <ul className="mt-2 flex flex-wrap gap-x-1.5 gap-y-1.5">
        {tags.map(({ tag, brandCount }) => (
          <li
            key={tag}
            className="flex items-baseline gap-1 whitespace-nowrap rounded-full border border-line-strong px-2 py-0.5 text-xs text-ink"
          >
            {tag}
            {/* 件数を添えて**並びの理由を読めるようにする**。数えられなかった語は出さない
                (0 を書くと「どの銘柄にも付いていない語」に見える) */}
            {brandCount === null ? null : (
              <span className="text-[11px] text-ink-faint">{brandCount}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-xs leading-relaxed text-ink-faint">
        さけのわデータの味タグ。<strong className="font-medium">銘柄に紐づく語</strong>で、本人が付けたものではない。
        添えた数は<strong className="font-medium">その語が付く銘柄数</strong>（全{state.value.tagIdsByBrandId.size}銘柄中）で、
        少ない順に並べてある。前のほうがこの銘柄らしい語になる。絞り込みの「味」はこの語で絞る。
      </p>
    </>
  )
}

/**
 * 蔵元の説明(B78)。**出典を本文と同じ場所に出す。**
 *
 * CC BY-SA 4.0 の表示義務は記事URLとライセンスURIで、これは**この画面にしか無い** —
 * フッタの1行(さけのわ)と違い、ライセンスの対象は蔵ごとに別の記事なので、
 * 使用箇所ごとに書く以外に満たしようがない(産地マップの CC-BY 4項目と同じ判断)。
 *
 * **本文は一字も変えずに出す。** 要約・言い換えをした時点で Adapted Material になり、
 * 継承(§3(b))が発生する。長さの調整は取得スクリプトが文の切れ目で行っている。
 */
function BreweryAbout({
  brewery,
  article,
}: {
  brewery: SakenowaBrewery | undefined
  article: BreweryArticle
}) {
  return (
    <section className="mt-6 border-t border-line pt-4">
      <h3 className="text-xs font-semibold text-ink-muted">
        {brewery === undefined ? '蔵元について' : `${brewery.name}について`}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-ink">{article.extract}</p>
      {/* 出典の1行。**語中で折らせない原子**(記事名・ライセンス名)を nowrap で守り、行側で受ける */}
      <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-ink-faint">
        <span>出典:</span>
        <a
          href={article.url}
          target="_blank"
          rel="noreferrer"
          className="whitespace-nowrap underline underline-offset-2"
        >
          ウィキペディア「{article.title}」
        </a>
        <a
          href={WIKIPEDIA_LICENSE_URL}
          target="_blank"
          rel="noreferrer"
          className="whitespace-nowrap underline underline-offset-2"
        >
          CC BY-SA 4.0
        </a>
      </p>
    </section>
  )
}

/**
 * 銘柄・蔵元のメモ。**記録1件のメモ(`SakeRecord.note`)とは別の節にする** —
 * 同じ「メモ」でも宛先が違い、同じ銘柄の203本で共有されるかどうかが正反対。
 */
function Notes({
  brand,
  brewery,
  source,
}: {
  brand: SakenowaBrand | undefined
  brewery: SakenowaBrewery | undefined
  source: NoteSource
}) {
  return (
    <section className="mt-6 border-t border-line pt-4">
      <h3 className="text-xs font-semibold text-ink-muted">銘柄・蔵元のメモ</h3>
      {brand === undefined ? (
        <p className="mt-2 text-xs leading-relaxed text-ink-faint">
          銘柄が決まっていないのでメモの置き場が無い。紐付けると書ける。
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
            この記録だけでなく<strong className="font-medium">同じ銘柄・同じ蔵元の記録すべて</strong>に出る。
            1本ごとのメモは上の「メモ」に書く。
          </p>
          <NoteEditor
            key={`brand-${String(brand.id)}`}
            targetLabel={brand.name}
            kindLabel="銘柄"
            value={source.textOf('brand', brand.id) ?? null}
            onSave={(text) => source.onSave({ target: 'brand', targetId: brand.id, text })}
            onDelete={() => source.onDelete('brand', brand.id)}
          />
          {brewery === undefined ? (
            // 蔵元が引けないのは表が読めていないときだけ。**銘柄側だけ書ける状態にする**
            <p className="mt-3 text-xs leading-relaxed text-ink-faint">
              蔵元が引けないので蔵元のメモは書けない。
            </p>
          ) : (
            <NoteEditor
              key={`brewery-${String(brewery.id)}`}
              targetLabel={brewery.name}
              kindLabel="蔵元"
              value={source.textOf('brewery', brewery.id) ?? null}
              onSave={(text) => source.onSave({ target: 'brewery', targetId: brewery.id, text })}
              onDelete={() => source.onDelete('brewery', brewery.id)}
            />
          )}
        </>
      )}
    </section>
  )
}

/**
 * 保存された写真。**読めなかったことを壊れた画像の印で済ませない。**
 *
 * `<img>` が読めなかったとき、既定では壊れた画像の印が出るだけで、本人には「消えた」としか
 * 見えない。同期先に複製が残っていることが多いので、**何が起きたかと打てる手を書く**。
 * B72 で保存形を Blob から ArrayBuffer に変えて実体が失われる経路は塞いだが、
 * **デコードできない写真は依然あり得る**ので受け皿は残す。
 *
 * object URL の生成と revoke は `../common/thumbnailUrl.ts` が対で持つ(理由はそちら)。
 */
function Thumbnail({ bytes, label }: { bytes: ArrayBuffer | null; label: string }) {
  const imgRef = useThumbnailImageRef(bytes)
  // **「壊れた」を真偽値で持たない。** 写真を差し替えたときに前の失敗が残り、
  // 読めている新しい写真が隠れる(reset のための effect も要らなくなる)
  const [brokenBytes, setBrokenBytes] = useState<ArrayBuffer | null>(null)
  const broken = bytes !== null && brokenBytes === bytes

  if (bytes === null || !canShowThumbnail()) return null

  // width/height 属性は付けない。原本の縦横比が分からないので比率を属性で縛れず、
  // 属性を付けると CSS の height:auto(src/index.css)頼みで縦横比が崩れる。
  // 高さは max-h-72 で抑え、幅は成り行きに任せる。
  return (
    <>
      <img
        ref={imgRef}
        alt={`${label} のラベル写真`}
        onError={() => setBrokenBytes(bytes)}
        hidden={broken}
        className="mt-4 max-h-72 rounded border border-line"
      />
      {broken && (
        <p className="mt-4 rounded border border-notice-line bg-notice-surface px-3 py-2 text-xs leading-relaxed text-notice-ink">
          この端末に保存された写真を読めなかった。同期を設定していれば、次の同期で同期先から取り直す。
        </p>
      )}
    </>
  )
}
