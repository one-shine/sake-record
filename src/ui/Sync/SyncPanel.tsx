// 端末間同期の画面(B69 / PHASE 8)。
//
// **バックアップ(JSON の書き出し)とは別のパネルにしてある。** どちらもデータの出し入れだが、
// 守っているものが違う: バックアップは「この端末が壊れたときの唯一の避難先」、同期は
// 「別の端末で同じ一覧を見るための利便」。同じ場所に並べると、片方が動いていないときに
// 何が失われるのかを言い分けられない。
//
// ## この画面が負っている約束
//
// 1. **無音で成功も失敗もさせない。** 受け取った / 送った / 消した件数と、断った理由を全部出す。
// 2. **競合を必ず見せる(A26)。** どちらを採ったかと、負けた側が何だったかを言う。
//    採否を黙って決めるのは `unlinked` に推定値を埋めるのと同じ。
// 3. **失敗の理由を言い分ける(A29)。** 「通信できない」と「パスワードが違う」を同じ顔にすると、
//    パスワードを間違えている本人が延々と再試行することになる。
// 4. **設定していない端末では何も起きない(A28)。** 開くと「同期先が無い」とだけ言う。
//
// パスワードは**本人が決めた合言葉**で、端末ごとに1回だけ入れる。生成も読み取り(カメラ)も
// 作らない — 経路を増やすほど「どこかに控えが残る」場所が増える。
//
// **隠したままでは日本語を打てない。** iOS は `type="password"` の欄で日本語入力を無効にする
// (実機で踏んだ。コピペしか手が無くなる)。既定は隠したままにして、**切り替えを1つ置く** —
// 合言葉を打つ瞬間だけ見えていればよく、肩越しに見られる場面では隠したまま貼り付けられる。
//
// **覚えられる長さを許す代わりに、サーバ側で回数制限をかけている**(15分に10回間違えると断る)。
// ここが無いと、覚えられる長さの言葉は機械で総当たりされる。

import { useEffect, useId, useState } from 'react'
import { MIN_PASSWORD_BYTES } from '../../domain/syncWire.ts'
import type { SyncFailureKind } from '../../store/sync.ts'
import { Overlay } from '../common/Overlay.tsx'
import { describeError } from '../common/errors.ts'
import {
  defaultSyncActions,
  type SyncActions,
  type SyncConflictView,
  type SyncRunResult,
  type SyncViewState,
} from './syncActions.ts'

type Props = {
  onClose: () => void
  /** 記録が変わったことを親に知らせる(一覧の読み直し) */
  onDataChanged?: () => void
  /** 副作用の差し替え(テスト)。既定は store への配線 */
  actions?: Partial<SyncActions>
}

const BUTTON =
  'whitespace-nowrap rounded border border-line-strong bg-surface-raised px-3 py-1.5 text-sm text-ink disabled:opacity-50'
const PRIMARY_BUTTON =
  'whitespace-nowrap rounded border border-ink bg-ink px-3 py-1.5 text-sm font-medium text-ink-inverted disabled:opacity-50'
const FIELD =
  'w-full rounded border border-line-strong bg-canvas px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint'

/**
 * 失敗の種類ごとに**打てる手**を書く。理由だけ出しても本人は次に何をすればいいか分からない。
 * `Record<SyncFailureKind, string>` なので、種類を増やしたらここがコンパイルエラーになる。
 */
const FAILURE_ADVICE: Record<SyncFailureKind, string> = {
  offline:
    '同期先に届いていない。電波を確かめてもう一度試す。それでも駄目なら同期先がまだ動いていないか、URL の設定が違う。',
  unauthorized:
    'パスワードが合っていない。同期先に設定したのと同じ合言葉を入れ直す(前後の空白や改行が混ざっていないか確かめる)。10回続けて間違えると15分ほど断られ、そのあいだは正しく入れても通らない。',
  server: '同期先が処理に失敗した。しばらく置いてもう一度試す。続くなら同期先のログを見る。',
  schema:
    'この端末のアプリと同期先の版が合っていない。両方を最新にしてから試す(片方だけ古いと形が読めない)。',
  local:
    'この端末の保存領域を読めなかった。記録はまだ消えていない。プライベートウィンドウや保存領域の制限が原因のことがある。',
}

const FAILURE_LABEL: Record<SyncFailureKind, string> = {
  offline: '同期先に届かなかった',
  unauthorized: 'パスワードが違う',
  server: '同期先が処理に失敗した',
  schema: '版が合っていない',
  local: 'この端末の保存領域を読めなかった',
}

/** ISO8601 を「2026-08-01 19:03」にする。**秒は出さない**(同期の頻度に対して細かすぎる) */
function formatAt(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

export function SyncPanel({ onClose, onDataChanged, actions }: Props) {
  const wired: SyncActions = { ...defaultSyncActions, ...actions }
  const passwordId = useId()
  const [state, setState] = useState<SyncViewState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  // 打っている間だけ見せる。**既定は隠す**(開いた画面に合言葉が出ていると肩越しに読まれる)
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [result, setResult] = useState<SyncRunResult | null>(null)

  useEffect(() => {
    wired.loadState().then(setState, (cause: unknown) => {
      setLoadError(describeError(cause))
    })
    // 開いたときに1回だけ読む(依存に wired を入れると毎描画で読み直す)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function reload() {
    try {
      setState(await wired.loadState())
    } catch (cause) {
      setLoadError(describeError(cause))
    }
  }

  async function handleSavePassword() {
    if (password.trim() === '') return
    // **保存する前に長さを見る。** 短いと同期先が受け付けないが、返るのは 401 だけなので
    // 「パスワードが違う」としか見えず、短いのが原因だと本人には分からない
    const bytes = new TextEncoder().encode(password.trim()).length
    if (bytes < MIN_PASSWORD_BYTES) {
      setLoadError(
        `合言葉が短い(${String(bytes)}バイト)。日本語なら8文字以上、英数字なら${String(MIN_PASSWORD_BYTES)}文字以上にする。`,
      )
      return
    }
    setLoadError(null)
    setBusy(true)
    try {
      await wired.savePassword(password)
      setPassword('')
      setSaved(true)
      await reload()
    } catch (cause) {
      setLoadError(describeError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function handleClearPassword() {
    setBusy(true)
    try {
      await wired.clearPassword()
      setSaved(false)
      setResult(null)
      await reload()
    } catch (cause) {
      setLoadError(describeError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function handleSync() {
    setBusy(true)
    setResult(null)
    try {
      const next = await wired.runSync()
      setResult(next)
      await reload()
      // **同期は記録を書き換える。** 呼び側に読み直させないと画面だけが古いまま残る
      if (next.outcome.status === 'done') onDataChanged?.()
    } catch (cause) {
      setLoadError(describeError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Overlay title="同期" onClose={onClose}>
      <div className="space-y-5 px-4 py-4">
        {loadError !== null && (
          <p role="alert" className="rounded border border-notice-line bg-notice-surface px-3 py-2 text-xs leading-relaxed text-notice-ink">
            {loadError}
          </p>
        )}

        <section>
          <h3 className="text-sm font-semibold text-ink">同期先</h3>
          {state === null ? (
            <p role="status" className="mt-1 text-xs text-ink-muted">
              設定を読み込んでいる
            </p>
          ) : state.endpoint === '' ? (
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              同期先がまだ用意されていない。この端末の記録はこれまでどおりこの端末の中だけにあり、別の端末へは書き出した
              JSON で移す。
            </p>
          ) : (
            <p className="mt-1 break-all text-xs text-ink-muted">{state.endpoint}</p>
          )}
        </section>

        {state !== null && state.endpoint !== '' && (
          <>
            <section>
              <h3 className="text-sm font-semibold text-ink">パスワード</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-faint">
                同期先に設定したのと同じ合言葉を入れる。<strong className="font-medium">変換の要らない文字にする</strong>（ひらがなだけ、または英数字）。漢字を混ぜると別の端末で同じ文字列を打ち直せない。長さはひらがな8文字以上、英数字24文字以上。記録を守っているのはこれ1つだけなので、他で使っている言葉にしない。
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2">
                <input
                  id={passwordId}
                  type={visible ? 'text' : 'password'}
                  value={password}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={state.hasPassword ? '入れ直す' : 'ここに入れる'}
                  aria-label="同期のパスワード"
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setSaved(false)
                  }}
                  className={`${FIELD} sm:max-w-xs`}
                />
                <button
                  type="button"
                  onClick={() => setVisible((shown) => !shown)}
                  aria-pressed={visible}
                  className={BUTTON}
                >
                  {visible ? '隠す' : '見せる'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSavePassword()}
                  disabled={busy || password.trim() === ''}
                  className={BUTTON}
                >
                  保存する
                </button>
                {state.hasPassword && (
                  <button
                    type="button"
                    onClick={() => void handleClearPassword()}
                    disabled={busy}
                    className={BUTTON}
                  >
                    消す
                  </button>
                )}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
                iPhone では隠したままだと日本語を打てない（この欄が日本語入力を受け付けないため）。「見せる」を押してから打つ。
              </p>
              <p className="mt-1.5 text-xs text-ink-muted">
                {saved
                  ? 'パスワードを保存した'
                  : state.hasPassword
                    ? 'パスワードは保存されている'
                    : 'パスワードが未設定なので、まだ同期しない'}
              </p>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-ink">同期する</h3>
              <p className="mt-1 text-xs text-ink-muted">
                {state.lastSyncedAt === null
                  ? 'まだ一度も同期していない'
                  : `最後に同期したのは ${formatAt(state.lastSyncedAt)}`}
              </p>
              <button
                type="button"
                onClick={() => void handleSync()}
                disabled={busy || !state.hasPassword}
                className={`mt-2 ${PRIMARY_BUTTON}`}
              >
                {busy ? '同期している' : 'いま同期する'}
              </button>
            </section>
          </>
        )}

        {result !== null && <SyncReport result={result} />}
      </div>
    </Overlay>
  )
}

/** 同期の結果。**件数が0でも出す**(「何も起きなかった」も結果) */
function SyncReport({ result }: { result: SyncRunResult }) {
  const { outcome, conflicts } = result

  if (outcome.status === 'not-configured') {
    return (
      <section>
        <h3 className="text-sm font-semibold text-ink">結果</h3>
        <p className="mt-1 text-xs text-ink-muted">同期先かパスワードが未設定なので、何もしていない。</p>
      </section>
    )
  }

  if (outcome.status === 'failed') {
    return (
      <section>
        <h3 className="text-sm font-semibold text-ink">同期できなかった</h3>
        <div className="mt-1.5 rounded border border-notice-line bg-notice-surface px-3 py-2">
          <p role="alert" className="text-xs font-medium text-notice-ink">
            {FAILURE_LABEL[outcome.kind]}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-notice-ink">{outcome.message}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">{FAILURE_ADVICE[outcome.kind]}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-faint">
            この端末の記録は何も変わっていない。送れなかった変更は次の同期でもう一度送られる。
          </p>
        </div>
      </section>
    )
  }

  const { applied, removed, pushed, localRecords, notes } = outcome.result
  return (
    <section>
      <h3 className="text-sm font-semibold text-ink">結果</h3>
      <ul className="mt-1.5 space-y-0.5 text-xs text-ink">
        <li>受け取って反映した記録 {applied} 件</li>
        <li>別の端末で消されたので消した記録 {removed} 件</li>
        <li>同期先へ送った変更 {pushed} 件</li>
      </ul>
      {/* **0件の理由を言い分ける。** 「送るものが無かった」と「既に送り終えていた」は
          同じ0件だが、打てる手が違う(前者は記録の入っている端末を開く) */}
      <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
        {localRecords === 0
          ? 'この端末には記録が1件も入っていないので、送るものが無かった。203本が入っているブラウザで同期する。'
          : pushed === 0
            ? `この端末の記録 ${localRecords} 件は、前回までに送り終えている(変わった分だけを送るので0件になる)。`
            : `この端末の記録 ${localRecords} 件のうち、前回から変わった分を送った。`}
      </p>

      {conflicts.length > 0 && (
        <div className="mt-3 rounded border border-notice-line bg-notice-surface px-3 py-2">
          <p className="text-xs font-medium text-notice-ink">
            両方の端末で変わっていた記録 {conflicts.length} 件
          </p>
          <p className="mt-1 text-xs leading-relaxed text-notice-ink">
            新しいほうを採った。採らなかった側の内容は残っていない。
          </p>
          <ul className="mt-1.5 space-y-1">
            {conflicts.map((conflict) => (
              <ConflictRow key={conflict.id} conflict={conflict} />
            ))}
          </ul>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="mt-3 space-y-1">
          {notes.map((note) => (
            <li key={note} className="text-xs leading-relaxed text-ink-muted">
              {note}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ConflictRow({ conflict }: { conflict: SyncConflictView }) {
  // 「編集したのに消えた」と「別端末の編集が残った」は別のことなので言い分ける
  const what = conflict.winnerDeleted
    ? '別の端末で消されていたので消した'
    : conflict.winner === 'remote'
      ? '別の端末の変更のほうが新しかったので、そちらを採った'
      : 'この端末の変更のほうが新しかったので、そちらを残した'
  return (
    <li className="text-xs leading-relaxed text-notice-ink">
      <span className="font-medium">{conflict.label ?? conflict.id}</span> — {what}
    </li>
  )
}
