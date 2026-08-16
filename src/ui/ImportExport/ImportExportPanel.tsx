// インポート / エクスポート画面。SPEC スコープ5 と A11 の窓口。
//
// ## この画面が負っている約束
//
// 1. **無音で成功も失敗もさせない。** 取り込みは件数・内訳・飛ばした行(`errors`)・反映先
//    (`applied`)を全部画面に出す。書き出しはファイル名とサイズを出す。
// 2. **不確実性を隠さない。** 内訳は「紐付け / 未紐付け / 銘柄不明」を分けて出し、
//    さらに**フレーバー取得済みを別に数える**(紐付け済み 186 ≠ フレーバー取得済み 185)。
// 3. **取り消せない操作の前に必ず一手挟む。** 取り込みは「読んだ内容を見せてから実行」の2段、
//    全消去は自作の ConfirmDialog。OS 既定の `confirm()` は使わない。
// 4. **保存先の制約を伝える。** 記録は IndexedDB にしか無く、サイトデータ削除で消える。
//    書き出した JSON が唯一のバックアップ手段。**最終書き出しからの経過日数**と
//    **永続化が得られていないこと**は `BackupNag` が上端で言う(材料は `loadBackupState`)。
//
// バッジの5値対応表はここに持たない。内訳は `LINK_STATUSES` から数えた `byStatus` を
// 「紐付け / 未紐付け / 銘柄不明」の3群に畳んだ**集計の分類**で、`linkStatus` の表示名は
// Timeline 側のバッジ1箇所に任せる(表を2つ作らない)。**表示名を写して持たない** —
// 1状態に対応する2群(`unlinked` / `unknown`)のラベルはバッジ表から引く。写すと、
// 片方を改名したときに同じ状態が画面ごとに別語になり、テストも両方リテラルなので気付けない。

import { useEffect, useId, useState, type ChangeEvent } from 'react'
import type { LinkStatus } from '../../domain/types.ts'
import { LINK_STATUS_BADGES } from '../Timeline/linkStatus.ts'
import { ConfirmDialog } from '../common/ConfirmDialog.tsx'
import { Overlay } from '../common/Overlay.tsx'
import { describeError } from '../common/errors.ts'
import { BackupNag } from './BackupNag.tsx'
import { detectImportFile, type DetectedFile } from './detectImportFile.ts'
import {
  defaultActions,
  type ApplyOutcome,
  type BackupState,
  type ImportExportActions,
  type ImportSummary,
} from './importActions.ts'

type Props = {
  onClose: () => void
  /** 記録が変わったことを親に知らせる(Timeline の読み直し) */
  onDataChanged?: () => void
  /** 副作用の差し替え(テスト / 将来の経路変更)。既定は store への配線 */
  actions?: Partial<ImportExportActions>
}

/**
 * 内訳の3群。**`Record<LinkStatus, ...>` で書くので5値のどれかを書き忘れると
 * コンパイルエラーになる**(型に6値目が増えたときも同じ)。
 * `manual` を「紐付け」に入れるのは、本人が判断した紐付けも紐付けとして数えるため
 * (由来の区別はバッジが担う)。
 */
type SummaryGroup = 'linked' | 'unlinked' | 'unknown'

const GROUP_OF: Record<LinkStatus, SummaryGroup> = {
  auto: 'linked',
  alias: 'linked',
  manual: 'linked',
  unlinked: 'unlinked',
  unknown: 'unknown',
}

/** 出す順。確信の高い順(バッジの並びと同じ向き) */
const SUMMARY_GROUPS: readonly SummaryGroup[] = ['linked', 'unlinked', 'unknown']

/**
 * 群のラベル。**1つの `linkStatus` に対応する群はバッジ表から引く**(文字列を写さない)。
 * `linked` だけは auto / alias / manual を畳んだ集計の分類で対応する状態が無いため、
 * ここが唯一の出所になる。
 */
const GROUP_LABEL: Record<SummaryGroup, string> = {
  linked: '紐付け',
  unlinked: LINK_STATUS_BADGES.unlinked.label,
  unknown: LINK_STATUS_BADGES.unknown.label,
}

function groupCounts(byStatus: Record<LinkStatus, number>): Record<SummaryGroup, number> {
  const counts: Record<SummaryGroup, number> = { linked: 0, unlinked: 0, unknown: 0 }
  for (const [status, group] of Object.entries(GROUP_OF) as [LinkStatus, SummaryGroup][]) {
    counts[group] += byStatus[status]
  }
  return counts
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} バイト`
  return `${(bytes / 1024).toFixed(1)} KB`
}

/**
 * バックアップの書き出し時刻。端末のローカル時刻で「YYYY-MM-DD HH:mm」にする。
 * **読めない値は加工せずそのまま出す**(整形できないことを勝手に隠して別の日付に見せない)。
 */
function formatExportedAt(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * 選ばれたファイルを文字列にする。**`Blob.text()` が無い実行環境がある**
 * (jsdom の File は text() を持たないので、この関数が無いとテストが本番と別の経路になる)ので
 * FileReader に落ちる道を持つ。store/backup.ts の Blob → data URL と同じ形の2経路。
 */
async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error('ファイルの読み取り結果が文字列ではない'))
    }
    reader.onerror = () => {
      reject(new Error(describeError(reader.error)))
    }
    reader.readAsText(file)
  })
}

const SECTION = 'border-t border-line px-4 py-4'
const HEADING = 'text-sm font-semibold text-ink'
const BODY = 'mt-1.5 text-xs leading-relaxed text-ink-muted'
const BUTTON =
  'whitespace-nowrap rounded border border-line-strong bg-surface-raised px-3 py-1.5 text-sm text-ink disabled:opacity-50'
const QUIET_BUTTON =
  'whitespace-nowrap rounded border border-line-strong px-3 py-1.5 text-sm text-ink-muted disabled:opacity-50'
const DANGER_BUTTON =
  'whitespace-nowrap rounded border border-danger-line bg-danger-surface px-3 py-1.5 text-sm text-danger-ink disabled:opacity-50'
/** 短い原子ラベルは語中で折らせない。折り返しは容器側の flex-wrap + gap-y が受ける */
const PILL = 'whitespace-nowrap rounded border border-line-strong px-2 py-0.5'

export function ImportExportPanel({ onClose, onDataChanged, actions }: Props) {
  const act: ImportExportActions = { ...defaultActions, ...actions }
  const fileInputId = useId()

  const [picked, setPicked] = useState<{ fileName: string; detected: DetectedFile } | null>(null)
  const [busy, setBusy] = useState<'import' | 'export' | 'clear' | null>(null)
  const [outcome, setOutcome] = useState<{ kind: 'seed' | 'backup'; result: ApplyOutcome } | null>(
    null,
  )
  const [exported, setExported] = useState<{
    fileName: string
    bytes: number
    /** 督促の起点を進められなかった理由。`null` = 進められた */
    markFailed: string | null
  } | null>(null)
  const [cleared, setCleared] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  /** 督促の材料。`null` = まだ読めていない / 読めなかった(その場合は督促を出さない) */
  const [backup, setBackup] = useState<BackupState | null>(null)

  // 開いたときに1回読む。**`act` ではなく取り出した関数を dep に置く** —
  // `act` は毎レンダで作る新しいオブジェクトなので、それを dep にすると
  // 「読む → setState → 再レンダ → また読む」で回り続ける
  const loadBackupState = act.loadBackupState
  useEffect(() => {
    let alive = true
    loadBackupState().then(
      (state) => {
        if (alive) setBackup(state)
      },
      () => {
        // 読めないなら督促を出さない(**読めなかったことを警告として出さない** —
        // ここが読めない状況では記録一覧自体が開けておらず、App 側が既に理由を出している)
        if (alive) setBackup(null)
      },
    )
    return () => {
      alive = false
    }
  }, [loadBackupState])

  /** 書き込み後に材料を読み直す。**失敗しても呼び元の成否には影響させない** */
  async function reloadBackup() {
    try {
      setBackup(await act.loadBackupState())
    } catch {
      /* 督促の材料が読めないだけ。書き込み自体の成否は呼び元が既に表示している */
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // 同じファイルを選び直しても change が起きるように空にする
    event.target.value = ''
    if (!file) return
    setOutcome(null)
    setCleared(false)
    setFailure(null)
    let text: string
    try {
      text = await readFileText(file)
    } catch (cause) {
      setPicked({
        fileName: file.name,
        detected: { kind: 'rejected', reason: `ファイルを読み取れない — ${describeError(cause)}` },
      })
      return
    }
    // ここでは判定だけ。**書き込みは「取り込む」を押してから**
    setPicked({ fileName: file.name, detected: detectImportFile(text) })
  }

  async function applyImport() {
    const current = picked
    if (!current || current.detected.kind === 'rejected') return
    const detected = current.detected
    setBusy('import')
    setFailure(null)
    try {
      const result =
        detected.kind === 'seed'
          ? await act.importSeed(detected.rows)
          : await act.importBackup(detected.text)
      setOutcome({ kind: detected.kind, result })
      setPicked(null)
      if (result.ok) {
        onDataChanged?.()
        await afterFirstWrite()
      }
    } catch (cause) {
      setFailure(`取り込みに失敗した — ${describeError(cause)}`)
    } finally {
      setBusy(null)
    }
  }

  /**
   * **初回書き込み時のストレージ永続化要求(B7 / PHASE_7 の完了条件)。**
   *
   * 「初回書き込み」を**取り込みの成功**と決めた。この画面の取り込みは、このアプリで初めて
   * データが入る経路(203件の台帳 or 他端末のバックアップ)で、ここで永続化を得られなければ
   * 直後に `BackupNag` が「ホーム画面に追加すると消えにくい」を出せる = 案内と原因が同じ操作の
   * 中で繋がる。**記録を1本作る経路(App の保存)にも同じ1行が要る**が、そこはこの担当の
   * 変更範囲外なので申し送りにする(要求は何度呼んでも安全 — 既に永続化されていれば
   * `requestPersistentStorage` は `persist()` を呼ばない)。
   *
   * **例外を外に出さない。** 永続化の要求が失敗しても取り込みは成功しており、
   * 「取り込みに失敗した」と言ってはならない。得られなかった事実は督促の再読込で画面に出る。
   */
  async function afterFirstWrite() {
    try {
      await act.requestPersistence()
    } catch {
      /* 要求できなかった = 永続化されていない。状態は下の再読込が読み直す */
    }
    await reloadBackup()
  }

  async function handleExport() {
    setBusy('export')
    setFailure(null)
    setExported(null)
    try {
      const blob = await act.exportBackup()
      const fileName = act.exportFileName()
      act.saveBlob(blob, fileName)
      // **ここが唯一「書き出した」と言える地点**なので督促の起点をここで進める
      // (`exportAll` は DB を読むだけで meta を書かない = Phase 3 の申し送り)。
      // 起点を書けなくても書き出し自体は成功しているので**失敗にはしない** —
      // 代わりに「督促が更新されない」ことを言う(黙って次回また督促が出る状態にしない)。
      let markFailed: string | null = null
      try {
        await act.markExported()
      } catch (cause) {
        markFailed = describeError(cause)
      }
      setExported({ fileName, bytes: blob.size, markFailed })
      await reloadBackup()
    } catch (cause) {
      setFailure(`書き出しに失敗した — ${describeError(cause)}`)
    } finally {
      setBusy(null)
    }
  }

  async function handleClear() {
    setBusy('clear')
    setFailure(null)
    try {
      await act.clearAllData()
      setConfirmingClear(false)
      setOutcome(null)
      setPicked(null)
      setCleared(true)
      onDataChanged?.()
      // **消したあとの督促は嘘になる**(「記録は203件」と言い続ける)。件数を読み直して黙らせる
      await reloadBackup()
    } catch (cause) {
      setConfirmingClear(false)
      setFailure(`消去に失敗した — ${describeError(cause)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Overlay title="インポート / エクスポート" onClose={onClose}>
      {/* 督促は上端。**記録が0件のとき / 期間が短いときは自分で何も描かない**(BackupNag 側の判断) */}
      {backup !== null && (
        <BackupNag
          recordCount={backup.recordCount}
          lastExportedAt={backup.lastExportedAt}
          persistence={backup.persistence}
          synced={backup.synced}
        />
      )}

      {/* 保存先の制約。SPEC が「受け入れるトレードオフ」と書いている2点をこの画面で伝える */}
      <section className="px-4 py-4">
        <h3 className={HEADING}>記録はこの端末にしか無い</h3>
        <p className={BODY}>
          記録はブラウザ内（IndexedDB）に保存している。端末間の同期は無く、ブラウザのサイトデータを削除すると消える。
        </p>
        <p className={BODY}>
          書き出した JSON が唯一のバックアップ手段。端末を移すときもこのファイルで運ぶ。
        </p>
      </section>

      <section className={SECTION}>
        <h3 className={HEADING}>書き出す</h3>
        <p className={BODY}>
          記録とエイリアス（手動紐付け）を1つの JSON にまとめる。写真（サムネイル）も含む。
        </p>
        <div className="mt-3 flex flex-wrap gap-x-2 gap-y-2">
          <button type="button" onClick={handleExport} disabled={busy !== null} className={BUTTON}>
            書き出す
          </button>
        </div>
        {exported && (
          <>
            <p className="mt-2.5 text-xs leading-relaxed text-ink-muted">
              {exported.fileName} を書き出した（{formatBytes(exported.bytes)}）。
            </p>
            {exported.markFailed !== null && (
              <p className="mt-1.5 text-xs leading-relaxed text-notice-ink">
                最終書き出し日時を記録できなかったので、経過日数の督促は更新されない（ファイルは書き出せている） —{' '}
                {exported.markFailed}
              </p>
            )}
          </>
        )}
      </section>

      <section className={SECTION}>
        <h3 className={HEADING}>取り込む</h3>
        <p className={BODY}>
          読めるのは2種類。(1) この画面で書き出したバックアップ JSON。(2) 記録の元データ（
          <code className="text-ink-muted">{'[{ no, drankOn, brandLabel, ... }]'}</code>
          の行の配列）。元データは銘柄をさけのわデータに照合して紐付ける。
        </p>
        <div className="mt-3">
          <label htmlFor={fileInputId} className="block text-xs text-ink-muted">
            取り込む JSON ファイル
          </label>
          <input
            id={fileInputId}
            type="file"
            accept="application/json,.json"
            onChange={handleFile}
            disabled={busy !== null}
            className="mt-1.5 block w-full text-xs text-ink-muted file:mr-3 file:rounded file:border file:border-line-strong file:bg-surface-raised file:px-2.5 file:py-1 file:text-sm file:text-ink"
          />
        </div>

        {picked?.detected.kind === 'rejected' && (
          <p className="mt-3 rounded border border-notice-line bg-notice-surface px-3 py-2 text-xs leading-relaxed text-notice-ink">
            {picked.fileName} は取り込めない: {picked.detected.reason}
          </p>
        )}

        {picked && picked.detected.kind !== 'rejected' && (
          <div className="mt-3 rounded border border-line-strong bg-canvas px-3 py-2.5">
            {picked.detected.kind === 'backup' ? (
              <>
                <p className="text-xs leading-relaxed text-ink">
                  {picked.fileName} をバックアップとして読んだ。記録 {picked.detected.records}件 /
                  エイリアス {picked.detected.aliases}件（書き出し{' '}
                  {formatExportedAt(picked.detected.exportedAt)}）。
                </p>
                {picked.detected.records === 0 && (
                  <p className="mt-1.5 text-xs leading-relaxed text-notice-ink">
                    このファイルには記録が0件。取り込むと記録はすべて消える。
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs leading-relaxed text-ink">
                {picked.fileName} を記録の元データとして読んだ。{picked.detected.rows.length}行。
                エイリアス（手動紐付け）はそのまま残す。
              </p>
            )}
            <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
              取り込むと既存の記録は置き換わる。この操作は取り消せない。先に書き出しておく。
            </p>
            <div className="mt-3 flex flex-wrap gap-x-2 gap-y-2">
              <button type="button" onClick={applyImport} disabled={busy !== null} className={BUTTON}>
                取り込む
              </button>
              <button
                type="button"
                onClick={() => {
                  setPicked(null)
                }}
                disabled={busy !== null}
                className={QUIET_BUTTON}
              >
                やめる
              </button>
            </div>
          </div>
        )}

        {outcome && <ImportOutcomeView kind={outcome.kind} result={outcome.result} />}
      </section>

      <section className={SECTION}>
        <h3 className={HEADING}>すべて消す</h3>
        <p className={BODY}>
          この端末の記録とエイリアス（手動紐付け）を消す。ブラウザのサイトデータを削除したのと同じ状態になる。
        </p>
        <div className="mt-3 flex flex-wrap gap-x-2 gap-y-2">
          <button
            type="button"
            onClick={() => {
              setConfirmingClear(true)
            }}
            disabled={busy !== null}
            className={DANGER_BUTTON}
          >
            すべて消す
          </button>
        </div>
        {cleared && (
          <p className="mt-2.5 text-xs leading-relaxed text-ink-muted">
            記録とエイリアスをすべて消した。
          </p>
        )}
      </section>

      {failure && (
        <p
          role="alert"
          className="mx-4 mb-4 rounded border border-danger-line bg-danger-surface px-3 py-2 text-xs leading-relaxed text-danger-ink"
        >
          {failure}
        </p>
      )}

      {confirmingClear && (
        <ConfirmDialog
          title="すべて消す"
          message="記録とエイリアス（手動紐付け）をこの端末から消す。この操作は取り消せない。先にエクスポートすることを推奨。"
          confirmLabel="消す"
          busy={busy === 'clear'}
          onConfirm={handleClear}
          onCancel={() => {
            setConfirmingClear(false)
          }}
        />
      )}
    </Overlay>
  )
}

/** 取り込み結果。件数・内訳・飛ばした行・反映先を全部出す(1つでも省くと無音になる) */
function ImportOutcomeView({ kind, result }: { kind: 'seed' | 'backup'; result: ApplyOutcome }) {
  return (
    <div className="mt-3 rounded border border-line-strong bg-canvas px-3 py-2.5">
      <p className="text-xs leading-relaxed text-ink">
        {kind === 'seed'
          ? `記録 ${String(result.imported.records)}件を取り込んだ。`
          : `記録 ${String(result.imported.records)}件 / エイリアス ${String(result.imported.aliases)}件を取り込んだ。`}
      </p>
      {result.summary && <SummaryView summary={result.summary} />}
      {result.applied.length > 0 && (
        <p className="mt-2 text-xs text-ink-muted">反映: {result.applied.join(' / ')}</p>
      )}
      {!result.ok && (
        <p className="mt-2 text-xs leading-relaxed text-notice-ink">
          1件も反映できなかった。既存の記録には触っていない。
        </p>
      )}
      {result.errors.length > 0 && (
        <>
          <p className="mt-2 text-xs text-notice-ink">取り込めなかったもの</p>
          <ul className="mt-1 list-disc pl-5 text-xs leading-relaxed text-notice-ink">
            {result.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/** 内訳。**紐付け済みとフレーバー取得済みを別の数として出す**(推定で埋めない) */
function SummaryView({ summary }: { summary: ImportSummary }) {
  const counts = groupCounts(summary.byStatus)
  return (
    <>
      <p className="mt-2 text-xs text-ink-muted">
        取り込み後の記録 {summary.total}件の内訳
      </p>
      {/* 容器で折り返しを受け、ピル側は語中で折らせない(日本語ラベルは対で直す) */}
      <ul className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-xs text-ink-muted">
        {SUMMARY_GROUPS.map((group) => (
          <li key={group} className={PILL}>
            {GROUP_LABEL[group]} {counts[group]}
          </li>
        ))}
        <li className={PILL}>
          {summary.withFlavor === null
            ? 'フレーバー取得済み 数えられない'
            : `フレーバー取得済み ${summary.withFlavor}`}
        </li>
      </ul>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
        紐付いてもフレーバーチャートが無い銘柄はある。味の集計の分母はフレーバー取得済みの件数。
      </p>
    </>
  )
}
