// 画面の配線。状態はここに集約し、ライブラリを入れずに `useState` で持つ(4タブなら足りる)。
//
// ## 2つの非同期資源を独立に扱う
//
// - **記録**(IndexedDB) … 一覧に必要。失敗したら理由と再試行を出す。**無音で空リストを出さない**
//   (0本と「読めなかった」を同じ見た目にすると、台帳が消えたのか読めないのか区別できない)
// - **さけのわの同梱テーブル**(fetch) … 詳細のフレーバー6軸・蔵元と、取り込み時の紐付けに必要。
//   記録は `brandName` を非正規化保存してあるので**テーブル未着でも一覧は描ける**(PLAN の設計)
//
// 束ねて1つのローディングにすると、テーブルの取得に失敗しただけで「記録が1本も無い」画面に
// なってしまう。片方が落ちても他方は使えるように別々に持ち、落ちた側だけを名指しで出す。
//
// **Linker はここで持たない。** `buildLinker()` は呼ぶたびに組み直す約束で(手動紐付けや
// バックアップ復元で aliases が増えるため)、起動時に1本作って使い回すと本人が紐付けた直後の
// 1件が古い表で `unlinked` のまま入る。紐付けが要る取り込み画面がその場で組む。
//
// オーバーレイ(戻るボタン / Escape / フォーカストラップ)の機構は `ui/common/Overlay.tsx` の
// 1箇所だけが持ち、ここは開閉の状態を持つだけにする。

import { useCallback, useEffect, useState } from 'react'
import type { DecodedTables } from './data/tables.ts'
import type { SakeRecord } from './domain/types.ts'
import { getTables, invalidateTables } from './store/linking.ts'
import { deleteRecord, listRecords } from './store/records.ts'
import { AppShell } from './ui/AppShell/AppShell.tsx'
import type { TabId } from './ui/AppShell/tabs.ts'
import { ImportExportPanel } from './ui/ImportExport/ImportExportPanel.tsx'
import { RecordDetail } from './ui/RecordDetail/RecordDetail.tsx'
import { Timeline } from './ui/Timeline/Timeline.tsx'
import { Overlay } from './ui/common/Overlay.tsx'
import { describeError } from './ui/common/errors.ts'

type Async<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; message: string }

/**
 * まだ無い画面の説明。**開発フェーズ名(Phase n)を UI に出さない** — 利用者には意味が無く、
 * 「実装されていない」だけ書くのは brain 品質バーが禁じるプレースホルダの残骸になる。
 * ここでは「何が見えるようになるか」と「そのために今できること」を書く。
 */
const UPCOMING: Record<Exclude<TabId, 'timeline'>, { title: string; body: string }> = {
  stats: {
    title: '統計',
    body: '本数・年別・都道府県別・スペックの分布を出す。スペックは「大吟醸」が「純米大吟醸」を含むように重ねて数えるので、合計は本数を超える。',
  },
  flavor: {
    title: 'フレーバー分布',
    body: '6軸のレーダーと散布図で、なぞっている味の領域と空白地帯を出す。分母はフレーバーが取れている記録だけで、その件数も併記する（取れていない記録を推定値で埋めない）。',
  },
  area: {
    title: '産地マップ',
    body: '都道府県を本数で塗り分けて、まだ飲んでいない県を空白で見せる。小さい県はタップしづらいので一覧表も併置する。',
  },
}

const BUTTON =
  'whitespace-nowrap rounded border border-stone-600 bg-stone-800 px-3 py-1.5 text-sm text-stone-100'
const QUIET_BUTTON = 'whitespace-nowrap rounded border border-stone-700 px-2.5 py-1 text-xs text-stone-200'
/** Timeline / EmptyState と同じ器。1280px でも本文が左端に張り付かない(B16) */
const CONTAINER = 'mx-auto w-full max-w-3xl px-4'

export default function App() {
  const [tab, setTab] = useState<TabId>('timeline')
  const [records, setRecords] = useState<Async<SakeRecord[]>>({ status: 'loading' })
  const [tables, setTables] = useState<Async<DecodedTables>>({ status: 'loading' })
  const [panelOpen, setPanelOpen] = useState(false)
  // 詳細は id で持つ。記録そのものを持つと、取り込みや削除で一覧を読み直したあとに
  // 古いオブジェクトを表示し続ける(消えた記録の詳細が開いたまま残る)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // 読み込みは **`.then` の解決/拒否ハンドラで setState する**形に揃える。`loading` はここで
  // 立てない(初期値が `loading` で、再試行のときは押した側 = イベントハンドラが立てる)。
  // effect から同期的に setState する形にすると起動直後の1描画が無駄に走り、
  // react-hooks の set-state-in-effect が実際に error を出す。
  // **拒否ハンドラを必ず書く**のがこの層の要点: 落とすと理由の無い空リストが黙って出る。
  const loadRecords = useCallback(() => {
    listRecords().then(
      (value) => {
        setRecords({ status: 'ready', value })
      },
      (cause: unknown) => {
        setRecords({ status: 'error', message: describeError(cause) })
      },
    )
  }, [])

  const loadTables = useCallback(() => {
    getTables().then(
      (value) => {
        setTables({ status: 'ready', value })
      },
      (cause: unknown) => {
        setTables({ status: 'error', message: describeError(cause) })
      },
    )
  }, [])

  useEffect(() => {
    loadRecords()
    loadTables()
  }, [loadRecords, loadTables])

  function retryRecords() {
    setRecords({ status: 'loading' })
    loadRecords()
  }

  function retryTables() {
    // 失敗した Promise は linking.ts が掴んでいないが、成功をキャッシュしている場合は明示的に
    // 捨ててから読み直す(サイトデータ削除 → 再取得の経路もこれで通る)
    invalidateTables()
    setTables({ status: 'loading' })
    loadTables()
  }

  const recordList = records.status === 'ready' ? records.value : []
  const selected =
    selectedId === null ? null : (recordList.find((record) => record.id === selectedId) ?? null)

  async function handleDelete(record: SakeRecord) {
    // 先に閉じる。消した記録の詳細が残ると「消えていない」ように見える
    setSelectedId(null)
    setActionError(null)
    try {
      await deleteRecord(record.id)
    } catch (cause) {
      // 一覧は消さずに理由だけ出す(画面から記録を消して驚かせない)
      setActionError(`記録を削除できなかった — ${describeError(cause)}`)
      return
    }
    loadRecords()
  }

  return (
    <AppShell tab={tab} onTabChange={setTab}>
      {tab === 'timeline' ? (
        <TimelineTab
          records={records}
          tablesStatus={tables.status}
          tablesMessage={tables.status === 'error' ? tables.message : null}
          actionError={actionError}
          onRetryRecords={retryRecords}
          onRetryTables={retryTables}
          onDismissActionError={() => setActionError(null)}
          onOpenImport={() => setPanelOpen(true)}
          onCreate={() =>
            setNotice(
              '写真から1本を記録するフォームはまだ用意できていない。いまは「取り込み / 書き出し」から JSON を読み込んで記録を入れる。',
            )
          }
          onSelect={
            // テーブルが未着だと蔵元もフレーバーも引けない。**押しても何も起きない行を作らない**
            // (ここで空のテーブルを渡すと「上流にデータが無い」と嘘をつくことになる)
            tables.status === 'ready' ? (record) => setSelectedId(record.id) : undefined
          }
        />
      ) : (
        <UpcomingTab tab={tab} records={records} />
      )}

      {panelOpen && (
        <ImportExportPanel
          onClose={() => setPanelOpen(false)}
          onDataChanged={loadRecords}
        />
      )}

      {selected !== null && tables.status === 'ready' && (
        <RecordDetail
          record={selected}
          tables={tables.value}
          onClose={() => setSelectedId(null)}
          onEdit={() =>
            setNotice('記録の編集フォームはまだ用意できていない。削除と取り込みは今できる。')
          }
          onDelete={(record) => void handleDelete(record)}
        />
      )}

      {/* まだ無い操作を押されたときの返事。押しても無反応にはしない(何が無いのかを言う) */}
      {notice !== null && (
        <Overlay title="この操作はまだ使えない" onClose={() => setNotice(null)}>
          <p className="px-4 py-4 text-sm leading-relaxed text-stone-300">{notice}</p>
        </Overlay>
      )}
    </AppShell>
  )
}

type TimelineTabProps = {
  records: Async<SakeRecord[]>
  tablesStatus: Async<DecodedTables>['status']
  tablesMessage: string | null
  actionError: string | null
  onRetryRecords: () => void
  onRetryTables: () => void
  onDismissActionError: () => void
  onOpenImport: () => void
  onCreate: () => void
  onSelect?: (record: SakeRecord) => void
}

function TimelineTab({
  records,
  tablesStatus,
  tablesMessage,
  actionError,
  onRetryRecords,
  onRetryTables,
  onDismissActionError,
  onOpenImport,
  onCreate,
  onSelect,
}: TimelineTabProps) {
  if (records.status === 'loading') {
    return (
      <section className={`${CONTAINER} py-6`}>
        <p role="status" className="text-sm text-stone-400">
          記録を読み込んでいる
        </p>
      </section>
    )
  }

  if (records.status === 'error') {
    return (
      <section className={`${CONTAINER} py-6`}>
        <h2 className="text-sm font-semibold text-stone-100">記録を読み込めなかった</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-stone-400">{records.message}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-stone-500">
          記録はこの端末の中（IndexedDB）にしか無い。プライベートウィンドウや保存領域の制限で開けないことがある。読めなかっただけで、まだ何も消えていない
          — 取り込みや全消去をする前に再試行する。
        </p>
        <button type="button" onClick={onRetryRecords} className={`mt-3 ${BUTTON}`}>
          再試行
        </button>
      </section>
    )
  }

  return (
    <>
      <div className={`${CONTAINER} flex flex-wrap items-center justify-end gap-x-2 gap-y-2 pt-4`}>
        <button type="button" onClick={onOpenImport} className={QUIET_BUTTON}>
          取り込み / 書き出し
        </button>
      </div>

      {actionError !== null && (
        <div className={`${CONTAINER} pt-3`}>
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 rounded border border-amber-900 bg-amber-950/40 px-3 py-2">
            <p className="min-w-0 text-xs leading-relaxed text-amber-200">{actionError}</p>
            <button type="button" onClick={onDismissActionError} className={QUIET_BUTTON}>
              閉じる
            </button>
          </div>
        </div>
      )}

      {tablesStatus !== 'ready' && (
        <div className={`${CONTAINER} pt-3`}>
          {tablesStatus === 'loading' ? (
            <p role="status" className="text-xs text-stone-500">
              銘柄・フレーバーの元データを読み込んでいる。読み終わるまで記録の詳細は開けない。
            </p>
          ) : (
            <div className="rounded border border-amber-900 bg-amber-950/40 px-3 py-2">
              <p className="text-xs font-medium text-amber-200">
                銘柄・フレーバーの元データを読み込めなかった
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-200/80">{tablesMessage}</p>
              <p className="mt-1 text-xs leading-relaxed text-stone-400">
                下の一覧はこの端末に保存された値なので影響しない。読めるまでは記録の詳細（蔵元とフレーバー6軸）を開けず、取り込んだ記録も銘柄に紐付かない。
              </p>
              <button type="button" onClick={onRetryTables} className={`mt-2 ${QUIET_BUTTON}`}>
                再試行
              </button>
            </div>
          )}
        </div>
      )}

      <Timeline
        records={records.value}
        onImport={onOpenImport}
        onCreate={onCreate}
        onSelect={onSelect}
      />
    </>
  )
}

/**
 * まだ無い3画面。**「実装されていない」で終わらせない** — 何が見えるようになるかと、
 * そのために今できること(取り込み)を出す。件数は読めているならそのまま出す。
 */
function UpcomingTab({
  tab,
  records,
}: {
  tab: Exclude<TabId, 'timeline'>
  records: Async<SakeRecord[]>
}) {
  const { title, body } = UPCOMING[tab]
  return (
    <section className={`${CONTAINER} py-6`}>
      <h2 className="text-sm font-semibold text-stone-100">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-stone-400">{body}</p>
      <p className="mt-3 text-xs leading-relaxed text-stone-500">
        この画面はまだ用意できていない。
        {records.status === 'ready'
          ? records.value.length === 0
            ? '記録タブから JSON を取り込むと、ここに出す元になるデータがそろう。'
            : `記録タブに ${String(records.value.length)}本ある。この画面ができ次第、同じデータから集計する。`
          : ''}
      </p>
    </section>
  )
}
