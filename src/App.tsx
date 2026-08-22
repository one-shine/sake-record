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
import { describeThumbnailMigration, ensureThumbnailsMigrated } from './store/migrateThumbnails.ts'
import { createRecord, deleteRecord, listRecords, updateRecord } from './store/records.ts'
import { loadFormDraft, type FormDraft } from './store/draft.ts'
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
import {
  deleteNote,
  indexNotes,
  listNotes,
  lookupNote,
  noteKey,
  putNote,
  type StoredNote,
} from './store/notes.ts'
import { RecordDetail } from './ui/RecordDetail/RecordDetail.tsx'
import { RecordForm, type RecordDraft } from './ui/RecordForm/RecordForm.tsx'
import { SyncPanel } from './ui/Sync/SyncPanel.tsx'
import { autoSyncNotice } from './ui/Sync/autoSyncNotice.ts'
import {
  Timeline,
  type FlavorTagSource,
  type TimelineCounts,
  type TimelineSeed,
} from './ui/Timeline/Timeline.tsx'
import type { FlavorTagState } from './ui/Timeline/flavorTagFacet.ts'
import { describeError } from './ui/common/errors.ts'
import { PlusIcon } from './ui/icons/icons.tsx'
import { browserUpdateEnvironment, shouldReloadNow, watchAppUpdate } from './lib/appUpdate.ts'

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
const QUIET_BUTTON =
  'whitespace-nowrap rounded border border-line-strong px-2.5 py-1 text-xs text-ink'
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
  /**
   * 銘柄・蔵元のメモ(B76)。**起動時に読む** — 記録の詳細を開いた瞬間に出したいので、
   * 味タグのような「要ると言われてから取る」形にすると開くたびに一瞬空になる
   * (件数が数十で、記録203件を読むのに比べて無視できる)。
   *
   * **読めなくても他を止めない。** メモは足すもので、記録の閲覧の前提ではない。
   */
  const [memos, setMemos] = useState<ReadonlyMap<string, StoredNote>>(new Map())
  const [panelOpen, setPanelOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  // 集計の3タブ(統計 / 味 / 産地)から記録タブへ飛ぶときに当てる絞り込み
  const [timelineSeed, setTimelineSeed] = useState<TimelineSeed>({})

  /**
   * 集計の3タブから記録タブへ移る唯一の入口。
   *
   * `Learn` と違って連番を持たない。**タブを切り替えると `TimelineTab` は外れて付け直される**ので、
   * 移ってきた時点で絞り込みが当たり直る(`Learn` の出典パネルはフッタから開くため
   * 既に「知る」タブに居るまま押せる。そちらは連番が要る)。
   */
  const openRecords = useCallback((seed: TimelineSeed) => {
    setTimelineSeed(seed)
    setTab('timeline')
  }, [])
  // 詳細・編集・紐付けはすべて id で持つ。記録そのものを持つと、取り込みや削除で一覧を
  // 読み直したあとに古いオブジェクトを表示し続ける(消えた記録の詳細が開いたまま残る)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<FormTarget | null>(null)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  /**
   * **自動同期(起動時・保存後)が言うべきこと**(B82)。`actionError` とは別のスロットにする —
   * あちらは保存や削除の成功経路が毎回 `null` に落とすので、通知は本人が読む前に消える。
   *
   * ここに載るのは「本人が押していないのに起きた、取り返しのつかないこと」だけ:
   * 競合(負けた側の内容はもう無い)と、再試行では直らない失敗(合言葉・版ずれ)。
   * 通信できないだけの失敗は載せない — 電波が戻れば直るものを毎回言うと読まれなくなる。
   */
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  /**
   * 新しい版に入れ替わったのに、まだリロードしていない(B87)。
   *
   * 何も開いていなければ下の effect が即リロードするので、ここが `true` になるのは
   * **本人が何かの途中のとき**だけ。打った内容を消さないためにリロードを本人に委ねる。
   */
  const [updateHeld, setUpdateHeld] = useState(false)
  /**
   * 端末に退避してある書きかけ(B88)。**起動時に1回だけ読む。**
   *
   * フォームを開くたびに読むと、開く操作が IndexedDB の往復を待つことになる(飲みながらの
   * 入力で一番短くしたい経路)。書きかけは1件しか持たないので、開いた対象と `editingId` が
   * 一致するときだけ渡す。
   */
  const [savedDraft, setSavedDraft] = useState<FormDraft | null>(null)

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

  const loadMemos = useCallback(() => {
    listNotes().then(
      (rows) => {
        setMemos(indexNotes(rows))
      },
      () => {
        // **空のまま進む。** メモが読めないことで記録の閲覧まで止めない
        setMemos(new Map())
      },
    )
  }, [])

  /**
   * **同期が変えうるものを読み直す唯一の場所。**
   *
   * 同期は記録だけでなく銘柄・蔵元のメモも降ろす。読み直す側を呼び出しごとに書いていると、
   * 同期に3つ目を足したときに**一部の入口だけが古い画面を出し続ける**(実際、メモを足した
   * ときに記録しか読み直しておらず、降りてきたメモが再読み込みまで画面に出なかった)。
   * 何を読み直すかはここ1箇所が決める。
   */
  const reloadSynced = useCallback(() => {
    loadRecords()
    loadMemos()
  }, [loadMemos, loadRecords])

  /**
   * **端末内に書いたあとに同期を試す唯一の場所。** `reloadSynced` と対にする。
   *
   * 待たない — 同期先に届かない場所で書いても端末内には残る(A27。次の同期で送られる)。
   * 設定していない端末では `sync()` が通信もせずに戻るので、呼び側に条件を足さない
   * (設定の読み方を2箇所に分けない)。**拒否ハンドラを必ず書く** — 同期の失敗が
   * 保存を止めてはいけない(A28)。多重起動は `sync()` 側が1本に畳む。
   *
   * 経路ごとに書くと足した日に1箇所だけ抜ける。**実際、メモを足したときに
   * 保存も削除も同期を蹴っておらず、書いたメモがアプリを開き直すまで端末から出なかった。**
   */
  const syncAfterWrite = useCallback(() => {
    void sync().then(
      (outcome) => {
        if (outcome.status === 'done') reloadSynced()
        const notice = autoSyncNotice(outcome)
        if (notice !== null) setSyncNotice(notice)
      },
      () => undefined,
    )
  }, [reloadSynced])

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
    loadMemos()
  }, [loadMemos, loadRecords, loadTables])

  // **保存形の版上げ(B72)で写真を読めなかったら、そう言う。**
  //
  // 移し替えそのものは `listRecords` / `sync` の中で済んでいる(呼ぶ側に判断を持たせない)。
  // ここが見るのは結果だけで、**移せたことは言わない** — 本人が頼んだ操作ではないので、
  // 成功を毎回報告すると次に本当の警告が出たときに読まれなくなる。
  useEffect(() => {
    let alive = true
    ensureThumbnailsMigrated().then(
      (result) => {
        const message = describeThumbnailMigration(result)
        if (alive && message !== null) setActionError(message)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [])

  // **起動時に1回だけ同期を試す。**
  //
  // 同期を設定していない端末では `sync()` が通信もせずに `not-configured` を返すので、
  // ここに条件を足さない(条件を足すと、設定の読み方が2箇所に分かれて必ずずれる)。
  //
  // **失敗しても記録の読み込みや作成は止めない**(A28)。`sync()` は投げない約束だが、
  // 拒否ハンドラは必ず書く。結果が `done` のときだけ一覧を読み直す。
  //
  // **ただし黙って捨てない**(B82)。前は `status === 'done'` しか見ておらず、競合も
  // 失敗も全部落としていた。落とすと (a) 負けた側の編集が画面に一言も出ないまま消え、
  // しかも成功時に位置が進むので**あとから手で押しても同じ競合は二度と出ない**(A26 が
  // 実運用の大半で破れる)、(b) 合言葉を変えた端末は毎回静かに失敗し続ける。
  // 詳しい控えは `store/sync.ts` が `meta` に残し、同期の画面が「前回の同期」として出す。
  useEffect(() => {
    let alive = true
    sync().then(
      (outcome) => {
        if (!alive) return
        if (outcome.status === 'done') reloadSynced()
        const notice = autoSyncNotice(outcome)
        if (notice !== null) setSyncNotice(notice)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [reloadSynced])

  /**
   * 新しい版に入れ替わったら知らせる(B87)。
   *
   * **ここではリロードしない。** リロードしてよいかは「いま何が開いているか」で決まり、
   * それを知っているのはこの層だけ。`main.tsx` が無条件にリロードしていたときは、
   * 記録の途中で写真アプリへ切り替えて戻った瞬間に入力が全損しうる形だった。
   *
   * 購読は**開いているものに依らず1回だけ**張る(依存に入れると、フォームを開くたびに
   * 張り直して `hadController` の判定が動く)。判断は知らせが来た時点の値で行う。
   */
  useEffect(() => {
    return watchAppUpdate(browserUpdateEnvironment(), () => {
      setUpdateHeld(true)
    })
  }, [])

  /**
   * 失うものが無ければ、知らせが来た時点で入れ替える。
   *
   * **保留を解除したときにリロードしない**(依存に開閉の状態を入れない)のが要点 —
   * 入れると「フォームを閉じた瞬間に画面が再読み込みされる」という別の驚きになる。
   * 保留したら、あとは本人が押すまで待つ。
   */
  useEffect(() => {
    if (!updateHeld) return
    const open = {
      form: form !== null,
      detail: selectedId !== null,
      linking: linkingId !== null,
      importExport: panelOpen,
      sync: syncOpen,
    }
    if (shouldReloadNow(open)) window.location.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 判断は知らせが来た時点の値で1回だけ行う(上の doc)
  }, [updateHeld])

  useEffect(() => {
    let alive = true
    loadFormDraft().then(
      (value) => {
        if (alive) setSavedDraft(value)
      },
      // 読めないなら勧めないだけ。**警告は出さない** — 退避は足すもので、
      // 読めなかったことを本人が打てる手は無い
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [])

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
    syncAfterWrite()
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
    syncAfterWrite()
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
          initialFilter={timelineSeed}
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
          syncNotice={syncNotice}
          updateHeld={updateHeld}
          onReloadForUpdate={() => {
            window.location.reload()
          }}
          onRetryRecords={retryRecords}
          onRetryTables={retryTables}
          onDismissActionError={() => setActionError(null)}
          onDismissSyncNotice={() => setSyncNotice(null)}
          onOpenSyncFromNotice={() => {
            setSyncNotice(null)
            setSyncOpen(true)
          }}
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
          onOpenRecords={openRecords}
        />
      )}

      {panelOpen && (
        <ImportExportPanel onClose={() => setPanelOpen(false)} onDataChanged={reloadSynced} />
      )}

      {syncOpen && <SyncPanel onClose={() => setSyncOpen(false)} onDataChanged={reloadSynced} />}

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
          notes={{
            textOf: (target, targetId) => lookupNote(memos, target, targetId)?.text,
            // **書いた後に読み直す。** 画面の写しを手で更新すると、保存に失敗したときや
            // 同期で降ってきたときに画面と保存が食い違う
            onSave: async (note) => {
              await putNote(note)
              loadMemos()
              syncAfterWrite()
            },
            onDelete: async (target, targetId) => {
              await deleteNote(noteKey(target, targetId))
              loadMemos()
              syncAfterWrite()
            },
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
          // **対象が一致するときだけ渡す。** 別の記録の書きかけを勧めると、
          // 開いた記録に他の記録の内容を入れる操作を差し出すことになる
          savedDraft={savedDraft?.editingId === (editingId ?? null) ? savedDraft : null}
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
          onChanged={() => {
            loadRecords()
            syncAfterWrite()
          }}
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
  /** 自動同期が言うべきこと(B82)。`actionError` と別枠なのは消され方が違うため */
  syncNotice: string | null
  /** 新しい版に入れ替わったが、何かが開いていたので保留した(B87) */
  updateHeld: boolean
  onReloadForUpdate: () => void
  onRetryRecords: () => void
  onRetryTables: () => void
  onDismissActionError: () => void
  onDismissSyncNotice: () => void
  onOpenSyncFromNotice: () => void
  onOpenImport: () => void
  onOpenSync: () => void
  onCreate: () => void
  /** 集計タブから飛んできたときに当てる絞り込み */
  initialFilter?: TimelineSeed
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
  syncNotice,
  updateHeld,
  onReloadForUpdate,
  onRetryRecords,
  onRetryTables,
  onDismissActionError,
  onDismissSyncNotice,
  onOpenSyncFromNotice,
  onOpenImport,
  onOpenSync,
  onCreate,
  initialFilter,
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

      {/* **`actionError` と別枠にする**(B82)。あちらは保存・削除・フォームを開くの成功経路が
          毎回 `null` に落とすので、本人が読む前に消える。ここに出るのは本人が押していない
          同期で起きた取り返しのつかないことなので、閉じるまで残す */}
      {syncNotice !== null && (
        <div className={`${CONTAINER} pt-3`}>
          <div className="rounded border border-notice-line bg-notice-surface px-3 py-2">
            <p role="alert" className="text-xs leading-relaxed text-notice-ink">
              {syncNotice}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={onOpenSyncFromNotice} className={QUIET_BUTTON}>
                同期を開く
              </button>
              <button type="button" onClick={onDismissSyncNotice} className={QUIET_BUTTON}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* **閉じるボタンを置かない**(B87)。これは知らせではなく「まだ入れ替わっていない」
          という状態そのもので、消しても状態は変わらない。押せる操作は再読み込みだけ。
          出るのは何かが開いていて保留したときだけなので、常時居座ることは無い */}
      {updateHeld && (
        <div className={`${CONTAINER} pt-3`}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded border border-line-strong bg-surface-raised px-3 py-2">
            <p role="status" className="min-w-0 text-xs leading-relaxed text-ink">
              新しい版がある。入力中のものがあるので、まだ入れ替えていない。
            </p>
            <button type="button" onClick={onReloadForUpdate} className={QUIET_BUTTON}>
              再読み込み
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
        initialFilter={initialFilter}
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
  /** 産地タブから記録タブへ飛ぶ。渡さなければ産地タブにボタンを出さない */
  onOpenRecords: (seed: TimelineSeed) => void
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
  onOpenRecords,
}: AggregateTabProps) {
  if (records.status === 'loading') return <RecordsLoading />
  if (records.status === 'error') {
    return <RecordsError message={records.message} onRetry={onRetryRecords} />
  }

  if (tab === 'stats') return <Dashboard stats={stats} onOpenRecords={onOpenRecords} />
  if (tab === 'area') {
    return (
      <AreaMap
        stats={stats}
        records={records.value}
        // 産地タブは県名を渡す。絞り込みの形に直すのはここ1箇所
        onOpenRecords={(prefectureName) => onOpenRecords({ prefecture: { value: prefectureName } })}
      />
    )
  }

  if (tables.status === 'loading') return <FlavorTablesLoading />
  if (tables.status === 'error') {
    return <FlavorTablesError message={tables.message} onRetry={onRetryTables} />
  }
  return (
    <FlavorMap
      records={records.value}
      flavorChartByBrandId={tables.value.flavorChartByBrandId}
      onOpenRecords={onOpenRecords}
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
        {/* **「ここにしか無い」とは言わない**(B83) — 同期を設定していれば同期先にもある。
            この面で言うべきなのは在り処ではなく「読めなかっただけで消えてはいない」のほう */}
        一覧はこの端末の中（IndexedDB）から読む。プライベートウィンドウや保存領域の制限で開けないことがある。読めなかっただけで、まだ何も消えていない
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
      <h2 className="text-sm font-semibold text-ink">フレーバーの元データを読み込めなかった</h2>
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
