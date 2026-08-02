// 画面の配線。状態はここに集約し、ライブラリを入れずに `useState` で持つ(5タブなら足りる)。
//
// ## 3つの非同期資源を独立に扱う
//
// - **記録**(IndexedDB) … 一覧に必要。失敗したら理由と再試行を出す。**無音で空リストを出さない**
//   (0本と「読めなかった」を同じ見た目にすると、台帳が消えたのか読めないのか区別できない)
// - **さけのわの同梱テーブル**(fetch) … 詳細のフレーバー6軸・蔵元、銘柄サジェスト、手動紐付けの
//   候補に必要。記録は `brandName` を非正規化保存してあるので**テーブル未着でも一覧は描ける**
// - **味タグ**(fetch) … 時系列タブの絞り込み1軸だけが使う。**起動時には取らない**(`idle`)。
//   本人が絞り込みパネルを開いたときに初めて要求する。**これを上のテーブルに畳まない** —
//   畳むと、任意のファセット1つの取得失敗で記録フォーム・詳細・手動紐付けが開けなくなる
//   (`openWithTables` の条件が増える = robustness の後退)
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
//
// ## 集計はここで**1回だけ**導出する
//
// `computeStats()` の呼び出しはこのファイルの1箇所で、統計(`Dashboard`)と産地(`AreaMap`)が
// **同じ `Stats` を共有する**。画面ごとに呼ぶと、渡す入力を取り違えた日に統計の「福島県22本」と
// 産地の塗りが静かに食い違う(どちらも例外を出さないので誰も気付けない)。
// `computeFlavor()` も呼ぶのは1箇所 — こちらは `FlavorMap` の中で、あの画面だけが使うため
// (ここに引き上げると、味タブを開いていない間も 203本 × 6軸を回すことになる)。
//
// ## 集計に「読めていない」を渡さない
//
// 記録が `loading` / `error` のあいだ `recordList` は空配列だが、**それを集計画面に渡さない**。
// 空から作った集計は「記録が0本」の空状態になり、読めなかっただけなのに台帳が空だと嘘をつく
// (時系列タブが最初からそうしているのと同じ作法)。味タブはさらに同梱テーブルも要る —
// 空の `flavorChartByBrandId` を渡すと紐付いた記録が全部「チャート無し」に数えられ、
// 「さけのわにフレーバーが無い」と嘘になる。統計と産地は記録だけで描けるので、
// **テーブルの失敗でそちらを止めない**(落ちた側だけを名指しする方針の続き)。
//
// ## 書き込みの後は必ず `listRecords()` を読み直す
//
// 作成・編集・削除・手動紐付けはすべて IndexedDB を直接触るので、**画面の state を自分で
// 継ぎ足さない**(継ぎ足すと、保存が一部失敗したときに画面だけが成功したように見える)。
// 詳細も編集も紐付けも `id` で持ち、表示する記録は毎回**読み直した一覧から引き当てる**。
//
// ## 同型のオーバーレイには `key` を付ける
//
// `RecordForm` は `key={editingId ?? 'new'}`、`LinkBrandPanel` は `key={record.id}`。
// 同型のコンポーネントを別の対象に差し替えると React が Fiber を再利用して**前の対象の
// 入力や結果表示が残る**(brain の既知事故)。論理的な同一性を `key` で表明する。

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DecodedTables } from './data/tables.ts'
import { computeStats, type Stats } from './domain/stats.ts'
import type { SakeRecord } from './domain/types.ts'
import {
  getFlavorTags,
  getTables,
  invalidateFlavorTags,
  invalidateTables,
} from './store/linking.ts'
import { requestPersistentStorage } from './store/meta.ts'
import { createRecord, deleteRecord, listRecords, updateRecord } from './store/records.ts'
import { sync } from './store/sync.ts'
import { AppShell } from './ui/AppShell/AppShell.tsx'
import type { TabId } from './ui/AppShell/tabs.ts'
import { AreaMap } from './ui/AreaMap/AreaMap.tsx'
import { Dashboard } from './ui/Dashboard/Dashboard.tsx'
import { FlavorMap } from './ui/FlavorMap/FlavorMap.tsx'
import { ImportExportPanel } from './ui/ImportExport/ImportExportPanel.tsx'
import { recentBrands } from './domain/recentBrands.ts'
import { Learn } from './ui/Learn/Learn.tsx'
import { LEARN_DEFAULT_PANEL, LEARN_SOURCES_PANEL, type LearnPanelId } from './ui/Learn/outline.ts'
import { LinkBrandPanel } from './ui/LinkBrand/LinkBrandPanel.tsx'
import { RecordDetail } from './ui/RecordDetail/RecordDetail.tsx'
import { RecordForm, type RecordDraft } from './ui/RecordForm/RecordForm.tsx'
import { SyncPanel } from './ui/Sync/SyncPanel.tsx'
import { Timeline, type FlavorTagSource, type TimelineCounts } from './ui/Timeline/Timeline.tsx'
import type { FlavorTagState } from './ui/Timeline/flavorTagFacet.ts'
import { describeError } from './ui/common/errors.ts'
import { PlusIcon } from './ui/icons/icons.tsx'

type Async<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; message: string }

/**
 * 開いているフォームの対象。`editingId === null` が新規。**真偽値と id の2つに分けない** —
 * 分けると「開いているが対象が消えている」状態を型で作れてしまい、`key` の値も揺れる。
 */
type FormTarget = { editingId: string | null }

/**
 * 記録が読めていないときに集計へ渡す空列。**モジュール定数にして同一性を固定する** —
 * 描画ごとに `[]` を作ると `useMemo` の依存が毎回変わり、集計が毎描画で走る。
 */
const NO_RECORDS: readonly SakeRecord[] = []

const BUTTON =
  'whitespace-nowrap rounded border border-line-strong bg-surface-raised px-3 py-1.5 text-sm text-ink'
const PRIMARY_BUTTON =
  'flex items-center gap-1.5 whitespace-nowrap rounded border border-ink bg-ink px-3 py-1.5 text-sm font-medium text-ink-inverted'
const QUIET_BUTTON = 'whitespace-nowrap rounded border border-line-strong px-2.5 py-1 text-xs text-ink'
/** Timeline / EmptyState と同じ器。1280px でも本文が左端に張り付かない(B16) */
const CONTAINER = 'mx-auto w-full max-w-3xl px-4'

/**
 * テーブル未着のまま記録フォーム / 手動紐付けを開かない理由。**空のテーブルで開くと
 * サジェストが何を打っても0件を返し、「さけのわにその銘柄が無い」と嘘をつく**
 * (紐付いていない記録が黙って増える)。開けないことと打てる手を言う。
 */
const TABLES_REQUIRED =
  '銘柄の元データを読み込めていないので、この操作は開けない。開くと銘柄サジェストが何を打っても0件になり「さけのわに無い銘柄」と嘘をつくことになる。元データを再試行してからにする。'

export default function App() {
  const [tab, setTab] = useState<TabId>('timeline')
  // 「知る」をどの下位タブで開くか。**押すたびに作り直す**ために連番を持つ(`key`)。
  // 連番が無いと、既に「知る」に居るときにフッタの「出典とライセンス」を押しても
  // `Learn` が再生成されず、開いている下位タブが変わらない(押した意味が消える)。
  const [learnRequest, setLearnRequest] = useState<{ panel: LearnPanelId; seq: number }>({
    panel: LEARN_DEFAULT_PANEL,
    seq: 0,
  })
  const [records, setRecords] = useState<Async<SakeRecord[]>>({ status: 'loading' })
  const [tables, setTables] = useState<Async<DecodedTables>>({ status: 'loading' })
  // **`idle` から始まる**(起動時に取らない)。要求するのは絞り込みパネルを開いたときだけ
  const [flavorTags, setFlavorTags] = useState<FlavorTagState>({ status: 'idle' })
  const [panelOpen, setPanelOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  // 詳細・編集・紐付けはすべて id で持つ。記録そのものを持つと、取り込みや削除で一覧を
  // 読み直したあとに古いオブジェクトを表示し続ける(消えた記録の詳細が開いたまま残る)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<FormTarget | null>(null)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

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

  // **味タグはここで読まない。** 起動時に要る資源ではないので `ensureFlavorTags` に任せる
  const loadFlavorTags = useCallback(() => {
    getFlavorTags().then(
      (value) => {
        setFlavorTags({ status: 'ready', value })
      },
      (cause: unknown) => {
        setFlavorTags({ status: 'error', message: describeError(cause) })
      },
    )
  }, [])

  useEffect(() => {
    loadRecords()
    loadTables()
  }, [loadRecords, loadTables])

  // **起動時に1回だけ同期を試す。**
  //
  // 同期を設定していない端末では `sync()` が通信もせずに `not-configured` を返すので、
  // ここに条件を足さない(条件を足すと、設定の読み方が2箇所に分かれて必ずずれる)。
  //
  // **失敗しても何もしない。** `sync()` は投げない約束だが、拒否ハンドラは必ず書く —
  // 同期の失敗が記録の読み込みや作成を止めてはいけない(A28)。理由は同期の画面で言う。
  // 結果が `done` のときだけ一覧を読み直す(サーバから降りてきた分を画面に出す)。
  useEffect(() => {
    let alive = true
    sync().then(
      (outcome) => {
        if (alive && outcome.status === 'done') loadRecords()
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [loadRecords])

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

  /**
   * 味タグを要求する(絞り込みパネルを開いた合図)。**`idle` のときだけ動く。**
   *
   * 何度開いても取得は1回で、**失敗した状態では黙って再試行しない** — パネルの開閉で
   * 「読み込めなかった」が勝手に「読み込んでいる」へ戻ると、本人が押した再試行の結果と
   * 区別できなくなる(再試行は下の `retryFlavorTags` が明示的に行う)。
   */
  function ensureFlavorTags() {
    if (flavorTags.status !== 'idle') return
    setFlavorTags({ status: 'loading' })
    loadFlavorTags()
  }

  function retryFlavorTags() {
    invalidateFlavorTags()
    setFlavorTags({ status: 'loading' })
    loadFlavorTags()
  }

  const recordList = useMemo(
    () => (records.status === 'ready' ? records.value : NO_RECORDS),
    [records],
  )
  // **集計の唯一の呼び出し。** 統計と産地が同じ戻り値を読む(2箇所で数えない)。
  // 203本 × 11語の部分一致をタブの切り替えごとに回さないよう、記録の同一性で memo する
  const stats = useMemo(() => computeStats(recordList), [recordList])

  const byId = (id: string) => recordList.find((record) => record.id === id) ?? null
  // 最近飲んだ銘柄（記録フォームの「もう一度」チップ）。**紐付いた記録だけ**が対象で、
  // 並びは最後に飲んだ日の降順（`domain/recentBrands.ts`）
  const recent = useMemo(
    () => (records.status === 'ready' ? recentBrands(records.value) : []),
    [records],
  )

  const selected = selectedId === null ? null : byId(selectedId)
  const editingId = form?.editingId ?? null
  const editing = editingId === null ? null : byId(editingId)
  const linking = linkingId === null ? null : byId(linkingId)

  /**
   * 保存。**閉じるのは成功したときだけ**で、失敗は投げ返してフォーム側に理由を出させる
   * (ここで catch すると「保存できなかったのに閉じた」になる)。
   */
  async function handleSubmit(draft: RecordDraft): Promise<void> {
    setActionError(null)
    if (editingId === null) {
      // **この端末で最初にデータが入る地点かどうか**を書き込む前に決める(B7 / PHASE_7 の
      // 「初回書き込み時に `persist()` を要求」)。取り込み経路は `ImportExportPanel` が
      // 自分で要求するが、フォームから1本目を作る人は取り込み画面を一度も開かない。
      // **`recordList` ではなく `records.status === 'ready'` を見る** — 読めていない
      // (loading / error)ときの空配列を「0本だった」と読むと、既に記録がある端末で
      // 保存のたびに要求を出すことになる。
      const firstWrite = records.status === 'ready' && records.value.length === 0
      // `sourceNo` は元ログの No. なので、アプリで作った記録は null(records.ts の約束)
      await createRecord({ ...draft, sourceNo: null })
      if (firstWrite) {
        // **待たない。** 許可を尋ねるブラウザ(Firefox 等)では `persist()` が本人の応答まで
        // 解決しない。await すると「保存したのにフォームが閉じない」になる。
        // 失敗しても保存は成功しているので、理由を出さず握る(得られなかった事実は
        // `BackupNag` が「永続化を得られなかった」として書き出し画面で言う)。
        void requestPersistentStorage().catch(() => undefined)
      }
    } else {
      await updateRecord(editingId, draft)
    }
    setForm(null)
    loadRecords()
    // **保存のあとに同期を試す。** 待たない — 同期先に届かない場所で保存しても
    // フォームは閉じるし記録は端末内に残る(A27。通信が戻った次の同期で送られる)。
    // 設定していない端末では `sync()` が通信もせずに戻る
    void sync().then(
      (outcome) => {
        if (outcome.status === 'done') loadRecords()
      },
      () => undefined,
    )
  }

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

  /** テーブルが要る操作の共通の入口。開けないときは**理由を出して開かない** */
  function openWithTables(open: () => void) {
    if (tables.status !== 'ready') {
      setActionError(TABLES_REQUIRED)
      return
    }
    setActionError(null)
    open()
  }

  return (
    <AppShell
      tab={tab}
      onTabChange={setTab}
      onOpenSources={() => {
        setTab('learn')
        setLearnRequest((request) => ({ panel: LEARN_SOURCES_PANEL, seq: request.seq + 1 }))
      }}
    >
      {tab === 'timeline' ? (
        <TimelineTab
          records={records}
          // **時系列タブのピルの件数もこの `stats` から出す**(絞り込みの件数を Timeline 側で
          // 数え直すと、統計タブのスタイル分布・評価分布と同じ数字が2箇所で数えられる = A10 違反。
          // `Stats` をそのまま渡せるのは `TimelineCounts` が `Stats` の部分型だから)
          counts={stats}
          // 味タグは**この1軸だけの資源**。状態と2つの導線を1つのオブジェクトで渡す
          // (状態だけ渡せる形にすると再試行の無い配線が作れてしまう)
          flavorTags={{
            state: flavorTags,
            onNeeded: ensureFlavorTags,
            onRetry: retryFlavorTags,
          }}
          tablesStatus={tables.status}
          tablesMessage={tables.status === 'error' ? tables.message : null}
          actionError={actionError}
          onRetryRecords={retryRecords}
          onRetryTables={retryTables}
          onDismissActionError={() => setActionError(null)}
          onOpenImport={() => setPanelOpen(true)}
          onOpenSync={() => setSyncOpen(true)}
          onCreate={() => {
            openWithTables(() => setForm({ editingId: null }))
          }}
          onSelect={
            // テーブルが未着だと蔵元もフレーバーも引けない。**押しても何も起きない行を作らない**
            // (ここで空のテーブルを渡すと「上流にデータが無い」と嘘をつくことになる)
            tables.status === 'ready' ? (record) => setSelectedId(record.id) : undefined
          }
          onLink={tables.status === 'ready' ? (record) => setLinkingId(record.id) : undefined}
        />
      ) : tab === 'learn' ? (
        // **どの非同期資源も要らない唯一のタブ。** 中身は実装から引いた凡例(紐付けの5値・6軸・
        // スペック欄の11語)と告示の逐語なので、記録も同梱テーブルも読まずに描ける。
        // だから記録の loading / error の面を通さない — 通すと、IndexedDB が開けない端末で
        // 「なぜ開けないのか」を説明したページ自体が読めなくなる。
        <Learn key={learnRequest.seq} initialPanel={learnRequest.panel} />
      ) : (
        <AggregateTab
          tab={tab}
          records={records}
          tables={tables}
          stats={stats}
          onRetryRecords={retryRecords}
          onRetryTables={retryTables}
        />
      )}

      {panelOpen && (
        <ImportExportPanel
          onClose={() => setPanelOpen(false)}
          onDataChanged={loadRecords}
        />
      )}

      {syncOpen && <SyncPanel onClose={() => setSyncOpen(false)} onDataChanged={loadRecords} />}

      {selected !== null && tables.status === 'ready' && (
        <RecordDetail
          record={selected}
          tables={tables.value}
          // 絞り込みと**同じ入手経路**を渡す(取得を2箇所に書かない)。
          // 詳細を開くのは明示の操作なので、ここが起動時に取らない資源の取得の起点になる
          flavorTags={{
            state: flavorTags,
            onNeeded: ensureFlavorTags,
            onRetry: retryFlavorTags,
          }}
          onClose={() => setSelectedId(null)}
          onEdit={(record) => setForm({ editingId: record.id })}
          onDelete={(record) => void handleDelete(record)}
          onLink={(record) => setLinkingId(record.id)}
        />
      )}

      {/* 編集対象が消えている(別経路で削除された)ときは開かない。**新規として開くと
          打った内容が「どこにも属さない新しい記録」として保存される** */}
      {form !== null && tables.status === 'ready' && (editingId === null || editing !== null) && (
        <RecordForm
          key={editingId ?? 'new'}
          record={editing}
          tables={tables.value}
          recentBrands={recent}
          onSubmit={handleSubmit}
          onCancel={() => setForm(null)}
        />
      )}

      {/* 適用後も開いたままにする。「他N本にも適用した」は**この画面にしか出ない実績値**なので、
          閉じてしまうと波及した件数を本人が見られない */}
      {linking !== null && tables.status === 'ready' && (
        <LinkBrandPanel
          key={linking.id}
          record={linking}
          records={recordList}
          tables={tables.value}
          onClose={() => setLinkingId(null)}
          onChanged={loadRecords}
        />
      )}
    </AppShell>
  )
}

type TimelineTabProps = {
  records: Async<SakeRecord[]>
  /** 絞り込みピルの件数。**`records` と同じ集合から数えた `Stats`**(取り違えると件数が嘘になる) */
  counts: TimelineCounts
  /** 味タグの絞り込み。取得は本人がパネルを開いてから(`Timeline` の `FlavorTagSource`) */
  flavorTags: FlavorTagSource
  tablesStatus: Async<DecodedTables>['status']
  tablesMessage: string | null
  actionError: string | null
  onRetryRecords: () => void
  onRetryTables: () => void
  onDismissActionError: () => void
  onOpenImport: () => void
  onOpenSync: () => void
  onCreate: () => void
  onSelect?: (record: SakeRecord) => void
  onLink?: (record: SakeRecord) => void
}

function TimelineTab({
  records,
  counts,
  flavorTags,
  tablesStatus,
  tablesMessage,
  actionError,
  onRetryRecords,
  onRetryTables,
  onDismissActionError,
  onOpenImport,
  onOpenSync,
  onCreate,
  onSelect,
  onLink,
}: TimelineTabProps) {
  if (records.status === 'loading') return <RecordsLoading />
  if (records.status === 'error') {
    return <RecordsError message={records.message} onRetry={onRetryRecords} />
  }

  return (
    <>
      {/* 記録を作るのは主画面の主操作なので**一覧があるときも常に出す**
          (0本のときの導線は EmptyState 側にもある)。行側は flex-wrap + gap-y で受ける */}
      <div
        className={`${CONTAINER} flex flex-wrap items-center justify-between gap-x-2 gap-y-2 pt-4`}
      >
        <button type="button" onClick={onCreate} className={PRIMARY_BUTTON}>
          <PlusIcon className="h-4 w-4" />
          記録する
        </button>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <button type="button" onClick={onOpenSync} className={QUIET_BUTTON}>
            同期
          </button>
          <button type="button" onClick={onOpenImport} className={QUIET_BUTTON}>
            取り込み / 書き出し
          </button>
        </div>
      </div>

      {actionError !== null && (
        <div className={`${CONTAINER} pt-3`}>
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 rounded border border-notice-line bg-notice-surface px-3 py-2">
            <p role="alert" className="min-w-0 text-xs leading-relaxed text-notice-ink">
              {actionError}
            </p>
            <button type="button" onClick={onDismissActionError} className={QUIET_BUTTON}>
              閉じる
            </button>
          </div>
        </div>
      )}

      {tablesStatus !== 'ready' && (
        <div className={`${CONTAINER} pt-3`}>
          {tablesStatus === 'loading' ? (
            <p role="status" className="text-xs text-ink-faint">
              銘柄・フレーバーの元データを読み込んでいる。読み終わるまで記録の詳細は開けない。
            </p>
          ) : (
            <div className="rounded border border-notice-line bg-notice-surface px-3 py-2">
              <p className="text-xs font-medium text-notice-ink">
                銘柄・フレーバーの元データを読み込めなかった
              </p>
              <p className="mt-1 text-xs leading-relaxed text-notice-ink">{tablesMessage}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                下の一覧はこの端末に保存された値なので影響しない。読めるまでは記録の詳細（蔵元とフレーバー6軸）と記録の作成・手動紐付けができず、取り込んだ記録も銘柄に紐付かない。
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
        counts={counts}
        flavorTags={flavorTags}
        onImport={onOpenImport}
        onCreate={onCreate}
        onSelect={onSelect}
        onLink={onLink}
      />
    </>
  )
}

type AggregateTabProps = {
  tab: Exclude<TabId, 'timeline' | 'learn'>
  records: Async<SakeRecord[]>
  tables: Async<DecodedTables>
  /** App が1回だけ導出した集計。統計と産地が**同じ値**を読む */
  stats: Stats
  onRetryRecords: () => void
  onRetryTables: () => void
}

/**
 * 集計の3タブ(統計 / 味 / 産地)。**この関数の役目は「渡してよい状態か」の判定だけ**で、
 * 数えるのも描くのも下の3画面がやる。
 *
 * 判定の順序に意味がある:
 *  1. **記録が読めていないなら3タブとも出さない。** 空の集計は「記録が0本」の空状態になり、
 *     読めなかったことが画面から消える(時系列タブと同じ文言・同じ再試行を出す)
 *  2. 統計と産地は**記録だけで描ける**。同梱テーブル(fetch)が落ちていても止めない —
 *     県名は `domain/prefecture.ts` 側にあり、銘柄マスタを要らない
 *  3. 味だけがテーブルを要る。**空の Map で描かない**(紐付いた記録が全部「チャート無し」に
 *     数えられ、「さけのわにフレーバーが無い」と嘘をつく)
 */
function AggregateTab({
  tab,
  records,
  tables,
  stats,
  onRetryRecords,
  onRetryTables,
}: AggregateTabProps) {
  if (records.status === 'loading') return <RecordsLoading />
  if (records.status === 'error') {
    return <RecordsError message={records.message} onRetry={onRetryRecords} />
  }

  if (tab === 'stats') return <Dashboard stats={stats} />
  if (tab === 'area') return <AreaMap stats={stats} />

  if (tables.status === 'loading') return <FlavorTablesLoading />
  if (tables.status === 'error') {
    return <FlavorTablesError message={tables.message} onRetry={onRetryTables} />
  }
  return (
    <FlavorMap
      records={records.value}
      flavorChartByBrandId={tables.value.flavorChartByBrandId}
    />
  )
}

/**
 * 記録(IndexedDB)が読めていないときの面。**記録を要る4タブが同じ文言を通る** —
 * 文言を画面ごとに書くと、集計タブだけ「0本」の空状態に退化しても文面が違うので気付けない。
 * (「知る」は記録を読まないのでここを通らない。上の分岐を参照)
 */
function RecordsLoading() {
  return (
    <section className={`${CONTAINER} py-6`}>
      <p role="status" className="text-sm text-ink-muted">
        記録を読み込んでいる
      </p>
    </section>
  )
}

function RecordsError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className={`${CONTAINER} py-6`}>
      <h2 className="text-sm font-semibold text-ink">記録を読み込めなかった</h2>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{message}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
        記録はこの端末の中（IndexedDB）にしか無い。プライベートウィンドウや保存領域の制限で開けないことがある。読めなかっただけで、まだ何も消えていない
        — 取り込みや全消去をする前に再試行する。
      </p>
      <button type="button" onClick={onRetry} className={`mt-3 ${BUTTON}`}>
        再試行
      </button>
    </section>
  )
}

/**
 * 味タブだけの前提。フレーバー6軸の値は記録に持っていない(さけのわの銘柄マスタ側にある)ので、
 * **テーブルが読めるまではこの画面を出さない**。統計と産地は止めない。
 */
function FlavorTablesLoading() {
  return (
    <section className={`${CONTAINER} py-6`}>
      <p role="status" className="text-sm text-ink-muted">
        フレーバーの元データを読み込んでいる
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
        6軸の値は記録ではなく、さけのわの銘柄データ側にある。統計と産地のタブは記録だけで出せるので、この待ちの影響を受けない。
      </p>
    </section>
  )
}

function FlavorTablesError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className={`${CONTAINER} py-6`}>
      <h2 className="text-sm font-semibold text-ink">
        フレーバーの元データを読み込めなかった
      </h2>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{message}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
        読めていない表を空として集計すると、銘柄に紐付いている記録まで「フレーバーが取れていない」に数えられ、分母が実際より小さく出る。それは「さけのわにデータが無い」という別の意味になるので、数字を出さずに再試行を出す。統計と産地のタブは記録だけで出せるので、そちらは今も読める。
      </p>
      <button type="button" onClick={onRetry} className={`mt-3 ${BUTTON}`}>
        再試行
      </button>
    </section>
  )
}
