// 手動紐付けの画面。SPEC が中核と宣言した e2e手順12(A6)の窓口。
//
// ## この画面が引き受けている約束
//
// 1. **候補が0件でも全件検索に到達できる。** 表記一致の候補と全件検索(3264件)は同じ画面に
//    並べて常に出す。候補0件を「該当なし」と書いて全件に広げない。
// 2. **アプリが決めない。** 候補が1件しかなくても自動では選ばない。`Beau Michelle` は
//    さけのわに同名(長野)があるが記録は神奈川で、別物の可能性が高い。SPEC は「代替紐付けするかは
//    本人判断に委ねる」と書いているので、**未紐付けのまま残す導線**を同じ重みで置く。
// 3. **無音で一括変更しない。** 確定の前に「同じ表記の他N本にも適用する」を確認ダイアログに出し、
//    実行後は**実際に適用できた件数**を報告する。件数の計算と文言は `./applyManualLink.ts`。
// 4. **戻せる。** 解除で `unlinked` に戻し、保存した別名も消す。
// 5. **推定で埋めない。** 選ぶ前に「フレーバー無し」を行に出す(紐付け済み ≠ フレーバー取得済み)。
//    記録の都道府県と選んだ銘柄の都道府県が食い違うときは、揃えずに食い違いを見せる。
//
// ## 持たないもの
//
// - **紐付けの照合ロジック**。候補は `createLinker`、検索は `createSuggester` に聞く(写さない)。
// - **別名のマージ規則**(runtime > 組み込み8件)。`store/aliases.ts` の `mergeAliases` が持つ。
// - **バッジの対応表**。`../Timeline/linkStatus.ts` の1箇所から `LinkStatusBadge` 経由で引く。
// - **オーバーレイと確認 UI の機構**。`../common/Overlay.tsx` / `ConfirmDialog.tsx` を借りる
//    (OS 既定の `confirm()` は使わない)。

import { useId, useMemo, useState } from 'react'
import { createLinker } from '../../domain/linkBrand.ts'
import { createSuggester, type SuggesterTables } from '../../domain/suggest.ts'
import type { SakenowaBrand } from '../../domain/types.ts'
import { ConfirmDialog } from '../common/ConfirmDialog.tsx'
import { Overlay } from '../common/Overlay.tsx'
import { describeError } from '../common/errors.ts'
import { LinkStatusBadge } from '../Timeline/LinkStatusBadge.tsx'
import { CandidateList } from './CandidateList.tsx'
import { candidateRows, suggestRows, type CandidateTables } from './candidateRows.ts'
import {
  applyManualLink,
  applyUnlink,
  defaultManualLinkActions,
  isLinked,
  linkAppliedMessage,
  linkPlanLines,
  planManualLink,
  planUnlink,
  scopeOf,
  unlinkAppliedMessage,
  type LinkableRecord,
  type ManualLinkActions,
  type ManualLinkResult,
  type UnlinkResult,
} from './applyManualLink.ts'

/** この画面が要求するテーブル。`DecodedTables` がそのまま満たす */
export type LinkBrandTables = SuggesterTables & CandidateTables

export type LinkBrandPanelProps = {
  /** 紐付けの起点になる記録 */
  record: LinkableRecord
  /** 波及件数の計算に使う全記録。**空配列でも起点1本には紐付けられる** */
  records: readonly LinkableRecord[]
  tables: LinkBrandTables
  /**
   * `LinkResult.candidates`(親が linker から得た候補)。**省略時はこの画面が
   * `createLinker` に聞いて組む** — 候補の作り方を写して2箇所に持たないため。
   */
  candidates?: readonly SakenowaBrand[]
  onClose: () => void
  /** 記録 / 別名が変わったことを親に知らせる(一覧と集計の読み直し) */
  onChanged?: () => void
  /** 副作用の差し替え(テスト)。既定は store への配線 */
  actions?: Partial<ManualLinkActions>
}

/**
 * 検索結果の上限。**上限+1件を引いて「切ったか」を事実として知る**
 * (ちょうど上限件だったときに「まだあるかもしれない」と嘘をつかない)。
 */
const SEARCH_LIMIT = 20

const SECTION = 'border-t border-stone-800 px-4 py-4'
const HEADING = 'text-sm font-semibold text-stone-100'
const BODY = 'mt-1.5 text-xs leading-relaxed text-stone-400'
/** 副操作(解除 / 紐付けない)のボタン。**主操作の色を持たせない** — どちらも本人が選ぶ道で、
 * 画面が片方に誘導しない(SPEC「代替紐付けするかは本人判断に委ねる」) */
const QUIET_BUTTON =
  'whitespace-nowrap rounded border border-stone-700 px-3 py-1.5 text-sm text-stone-300 disabled:opacity-50'

/**
 * この画面で起きた変更を記録に写す。**親が渡す `records` は再読込まで古いまま**なので、
 * 適用直後の解除や2回目の計画がずれないようにローカルで畳む。
 * `applied` と `reverted` は同時に非 null にならない(実行時に相手を落としている)。
 *
 * 都道府県も `linkPatchFor` と同じ規則で写す(空だった県だけ埋め、入っている県は残す)。
 * 写さないと画面が「記録なし」と言い続ける一方で DB には県が入っている状態になる。
 * 解除では県を消さない(紐付けで埋めた値と元の値を区別できないので、こちらも同じ)。
 */
function withLocalChanges(
  record: LinkableRecord,
  applied: ManualLinkResult | null,
  reverted: UnlinkResult | null,
): LinkableRecord {
  if (reverted?.appliedIds.includes(record.id) === true) {
    return { ...record, sakenowaBrandId: null, brandName: null, linkStatus: 'unlinked' }
  }
  if (applied?.appliedIds.includes(record.id) === true) {
    const filled =
      scopeOf(record.prefecture) === null && applied.brandPrefecture !== null
        ? applied.brandPrefecture
        : record.prefecture
    return {
      ...record,
      sakenowaBrandId: applied.brandId,
      brandName: applied.brandName,
      linkStatus: 'manual',
      prefecture: filled,
    }
  }
  return record
}

export function LinkBrandPanel({
  record,
  records,
  tables,
  candidates,
  onClose,
  onChanged,
  actions,
}: LinkBrandPanelProps) {
  const act: ManualLinkActions = { ...defaultManualLinkActions, ...actions }
  const searchId = useId()

  const [query, setQuery] = useState('')
  // IME の変換中は「該当なし」を出さない(`domain/suggest.ts` が UI 側の責務としている)
  const [composing, setComposing] = useState(false)
  const [choice, setChoice] = useState<SakenowaBrand | null>(null)
  const [confirmingUnlink, setConfirmingUnlink] = useState(false)
  const [busy, setBusy] = useState<'link' | 'unlink' | null>(null)
  const [applied, setApplied] = useState<ManualLinkResult | null>(null)
  const [reverted, setReverted] = useState<UnlinkResult | null>(null)
  const [rejected, setRejected] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const origin = useMemo(
    () => withLocalChanges(record, applied, reverted),
    [record, applied, reverted],
  )
  const localRecords = useMemo(
    () => records.map((row) => withLocalChanges(row, applied, reverted)),
    [records, applied, reverted],
  )

  // 索引はテーブルごとに1回だけ張る(キーストロークごとに 3264件を正規化しない)
  const suggest = useMemo(() => createSuggester(tables), [tables])

  // 候補は `createLinker` の戻りをそのまま使う。別名は注入しない(いま紐付いていない理由を
  // 見せる場面なので、別名で解決してしまうと候補が消える)
  const shownCandidates = useMemo(() => {
    if (candidates !== undefined) return candidates
    const link = createLinker({
      brands: tables.brands,
      breweries: tables.breweries,
      areas: tables.areas,
      aliases: [],
    })
    return link(record.brandLabel, record.prefecture).candidates
  }, [candidates, tables, record.brandLabel, record.prefecture])

  const candidateList = useMemo(
    () => candidateRows(shownCandidates, tables, origin.prefecture),
    [shownCandidates, tables, origin.prefecture],
  )

  const hits = useMemo(
    () => (query.trim() === '' ? [] : suggest(query, SEARCH_LIMIT + 1)),
    [suggest, query],
  )
  const truncated = hits.length > SEARCH_LIMIT
  const searchList = useMemo(
    () => suggestRows(hits.slice(0, SEARCH_LIMIT), origin.prefecture),
    [hits, origin.prefecture],
  )

  const plan = useMemo(
    () =>
      choice === null
        ? null
        : planManualLink({
            records: localRecords,
            origin,
            brand: choice,
            brandPrefecture: tables.prefectureOfBrand(choice.id),
          }),
    [choice, localRecords, origin, tables],
  )

  async function handleLink() {
    if (plan === null) return
    setBusy('link')
    setFailure(null)
    try {
      const result = await applyManualLink(plan, act)
      setApplied(result)
      setReverted(null)
      setRejected(false)
      setChoice(null)
      setQuery('')
      onChanged?.()
    } catch (cause) {
      // 別名の保存で落ちたときは記録を1件も触っていない(applyManualLink の順序)
      setChoice(null)
      setFailure(`紐付けに失敗した — ${describeError(cause)}。記録は変えていない。`)
    } finally {
      setBusy(null)
    }
  }

  async function handleUnlink() {
    setBusy('unlink')
    setFailure(null)
    try {
      // 消す別名は**保存済みの行から見つける**(記録の県から組み立てない。applyManualLink.ts の約束5)
      const aliases = await act.loadAliases()
      const result = await applyUnlink(planUnlink({ records: localRecords, origin, aliases }), act)
      setReverted(result)
      setApplied(null)
      setConfirmingUnlink(false)
      onChanged?.()
    } catch (cause) {
      setConfirmingUnlink(false)
      setFailure(`解除に失敗した — ${describeError(cause)}`)
    } finally {
      setBusy(null)
    }
  }

  const linked = isLinked(origin.linkStatus)

  return (
    <Overlay title="手動で紐付ける" onClose={onClose}>
      <section className="px-4 py-4">
        <h3 className={HEADING}>この記録</h3>
        {/* 日本語ラベルは語中で折れる。表記(長い)とバッジ(短い原子)は行側で折り返しを受ける */}
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-stone-100">
          <span>{origin.brandLabel}</span>
          <LinkStatusBadge status={origin.linkStatus} />
        </p>
        <p className={BODY}>
          記録の都道府県: {origin.prefecture ?? '記録なし'}
          {origin.brandName !== null && ` / 紐付け先: ${origin.brandName}`}
        </p>
        <p className={BODY}>
          選んだ銘柄は別名として保存し、同じ表記の記録にも適用する。適用する本数は確定する前に出す。
        </p>
      </section>

      {(applied !== null || reverted !== null || rejected) && (
        <div className="mx-4 mb-4 rounded border border-stone-700 bg-stone-950/60 px-3 py-2.5">
          <p role="status" className="text-xs leading-relaxed text-stone-100">
            {applied !== null
              ? linkAppliedMessage(applied)
              : reverted !== null
                ? unlinkAppliedMessage(reverted)
                : '未紐付けのまま残した。別名は保存していない。判断は後から変えられる。'}
          </p>
          {applied !== null && applied.aliasBlocked !== null && (
            <p className="mt-1.5 text-xs leading-relaxed text-amber-200">{applied.aliasBlocked}</p>
          )}
          {applied !== null && applied.keptLinked > 0 && (
            <p className="mt-1.5 text-xs leading-relaxed text-stone-400">
              同じ表記でも既に紐付いている{applied.keptLinked}本は変えていない。
            </p>
          )}
          {[...(applied?.failures ?? []), ...(reverted?.failures ?? [])].map((message) => (
            <p key={message} className="mt-1.5 text-xs leading-relaxed text-amber-200">
              {message}
            </p>
          ))}
        </div>
      )}

      {failure && (
        <p
          role="alert"
          className="mx-4 mb-4 rounded border border-red-900 bg-red-950/50 px-3 py-2 text-xs leading-relaxed text-red-100"
        >
          {failure}
        </p>
      )}

      {/* 解除は `auto` / `alias` の記録でも押せる(本人が「別物だ」と判断できる)。ただし
          **否定の別名は持たない**ので、名称一致で紐付いた記録は再取り込みで `auto` に戻る。
          手動紐付けを消した場合は別名も消えるので戻らない。**この非対称は docs/BACKLOG.md の
          B30 に起票してある**(正典は BACKLOG なので、コードのコメントだけで宣言して終わらせない) */}
      {linked ? (
        <section className={SECTION}>
          <h3 className={HEADING}>紐付けを解除する</h3>
          <p className={BODY}>
            この記録を未紐付けに戻し、保存した別名も消す。同じ判断で変わった記録もまとめて戻す。
            都道府県は紐付けたときの値が残る。
          </p>
          <p className={BODY}>別の銘柄にするなら、解除してから選び直す。</p>
          <div className="mt-3 flex flex-wrap gap-x-2 gap-y-2">
            <button
              type="button"
              onClick={() => {
                setConfirmingUnlink(true)
              }}
              disabled={busy !== null}
              className={QUIET_BUTTON}
            >
              紐付けを解除する
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className={SECTION}>
            <h3 className={HEADING}>表記が一致する候補</h3>
            <p className={BODY}>
              記録の表記と同じ名前の銘柄。都道府県が一致するものを先に出す。都道府県が違う同名は
              別の蔵のことがあるので、落とさずに並べるだけにしている。
            </p>
            <CandidateList
              rows={candidateList}
              onChoose={setChoice}
              disabled={busy !== null}
              emptyNote="表記が一致する銘柄は無い。下の「すべての銘柄から探す」で探す。"
            />
          </section>

          <section className={SECTION}>
            <h3 className={HEADING}>すべての銘柄から探す</h3>
            <label htmlFor={searchId} className="mt-1.5 block text-xs text-stone-300">
              銘柄名（3264件から前方一致・部分一致で探す。読みでは引けない）
            </label>
            <input
              id={searchId}
              type="text"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
              }}
              onCompositionStart={() => {
                setComposing(true)
              }}
              onCompositionEnd={() => {
                setComposing(false)
              }}
              autoComplete="off"
              disabled={busy !== null}
              className="mt-1.5 block w-full rounded border border-stone-700 bg-stone-950 px-2.5 py-1.5 text-sm text-stone-100 disabled:opacity-50"
            />
            <CandidateList
              rows={searchList}
              onChoose={setChoice}
              disabled={busy !== null}
              emptyNote={
                query.trim() === ''
                  ? '銘柄名を入力すると候補が出る。'
                  : composing
                    ? '変換中。'
                    : '該当なし。表記を変えて探す（読み・蔵元名では引けない）。'
              }
              truncatedNote={
                truncated ? `上限${SEARCH_LIMIT}件まで出している。文字を足して絞る。` : undefined
              }
            />
          </section>

          <section className={SECTION}>
            <h3 className={HEADING}>紐付けない</h3>
            <p className={BODY}>
              同名の銘柄があっても別の蔵の別物のことがある。決められないなら未紐付けのまま残す。
              未紐付けの記録はフレーバーの集計の分母から外れる（推定値では埋めない）。
            </p>
            <div className="mt-3 flex flex-wrap gap-x-2 gap-y-2">
              <button
                type="button"
                onClick={() => {
                  setRejected(true)
                  setFailure(null)
                }}
                disabled={busy !== null}
                className={QUIET_BUTTON}
              >
                別物として紐付けない
              </button>
            </div>
          </section>
        </>
      )}

      {plan !== null && (
        <ConfirmDialog
          title="この銘柄に紐付ける"
          message={
            <>
              {linkPlanLines(plan).map((line, index) => (
                <span key={line} className={index === 0 ? 'block' : 'mt-1.5 block'}>
                  {line}
                </span>
              ))}
            </>
          }
          confirmLabel="紐付ける"
          busy={busy === 'link'}
          onConfirm={handleLink}
          onCancel={() => {
            setChoice(null)
          }}
        />
      )}

      {confirmingUnlink && (
        <ConfirmDialog
          title="紐付けを解除する"
          message={`「${origin.brandLabel}」を未紐付けに戻す。保存した別名も消すので、同じ表記の記録にも以後は適用されない。`}
          confirmLabel="解除する"
          busy={busy === 'unlink'}
          onConfirm={handleUnlink}
          onCancel={() => {
            setConfirmingUnlink(false)
          }}
        />
      )}
    </Overlay>
  )
}
