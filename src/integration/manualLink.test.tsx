// 手動紐付けの**通し**のテスト。SPEC が中核と宣言した e2e手順12(受け入れ基準 A6)を、
// 実データ203本に対して画面から動かして固定する。
//
// 層ごとの単体テストは全部緑でも、この経路は境界にしか無い:
//
//   時系列の行の導線 → LinkBrandPanel → applyManualLink(別名を保存 → 記録を更新)
//   → onChanged → App が listRecords() を読み直す → 一覧が `manual` バッジで描き替わる
//
// **`App` を実物のまま描く**(store も紐付けもモックしない)。差し替えるのは同梱テーブルの
// `fetch` だけで、これはブラウザと同じ経路(loadTables → decodeTables)を通すための stub。
//
// ## 固定する実測値
//
// - `寫楽` は5本あり、取り込み直後は全て `auto` で `冩楽`(1616 / 宮泉銘醸)に付く。
//   **かつては未紐付けだった** — 読みを入れたとき(B68)に `normalize` が `寫`/`冩` を畳むように
//   なって自動で付くようになった。ここは同じ蔵の正しい銘柄なので、改善であって回帰ではない
// - 本人がそれを別の銘柄(`宮泉` 2401)へ**付け替える**と他4本にも適用され、5本とも `manual` になる
// - 紐付けの内訳は auto 173 / alias 13 / manual 5 / unlinked 7 / unknown 5 になり、
//   **`manual` バッジと5値目の絞り込みピルが実データの画面に出る**(BACKLOG B28 の回収)
// - **フレーバー取得済みは 190 のまま動かない**(1616 も 2401 もチャートを持つ)。
//   「手動紐付けで分母が増える」筋書きはこのデータでは作れなくなった(B70)
//
// ## seed が無い環境では丸ごと skip される
//
// `data/seed/sake-log-rows.json` は gitignore なので CI には存在しない。**skip されている
// 環境では上の実測値は未検証**で、それが分かるように要約の `skipped` に加えて
// モジュール読み込み時に1行出す(無音の緑にしない)。seedImport.test.tsx と同じ構造の制約。
//
// **実台帳の日付をこのファイルに1文字も書かない。** 銘柄名 `寫楽` / `宮泉` と brandId 2401 は
// さけのわの公開マスタ側の値なので書ける。期待値は件数だけにし、assert に記録の配列を渡さない
// (失敗時の差分に台帳が出ないよう `.length` を比べる)。

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { indexedDB as fakeIndexedDB, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb'
import areasJson from '../../public/data/sakenowa/areas.json'
import brandsJson from '../../public/data/sakenowa/brands.json'
import breweriesJson from '../../public/data/sakenowa/breweries.json'
import flavorChartsJson from '../../public/data/sakenowa/flavorCharts.json'
import App from '../App.tsx'
import type { SakeLogRow } from '../domain/parseSakeLog.ts'
import type {
  AreasFile,
  BrandsFile,
  BreweriesFile,
  FlavorChartsFile,
  SakeRecord,
} from '../domain/types.ts'
import { listAliases } from '../store/aliases.ts'
import { clearAll, closeDb } from '../store/db.ts'
import { getTables, invalidateTables } from '../store/linking.ts'
import { checkImportRows, listRecords } from '../store/records.ts'
import { notice } from '../test/notice.ts'
import { defaultActions, summarize } from '../ui/ImportExport/importActions.ts'

function installFakeIndexedDb(): void {
  Object.defineProperty(globalThis, 'indexedDB', {
    value: fakeIndexedDB,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'IDBKeyRange', {
    value: FakeIDBKeyRange,
    configurable: true,
    writable: true,
  })
}
installFakeIndexedDb()

/** 記録の生の表記(さけのわに登録が無い)。**紐付け先はさけのわの銘柄** */
const LABEL = '寫楽'
/** 蔵元 宮泉銘醸 の銘柄。さけのわで `宮泉` は1件だけなので検索結果も1行になる */
const BRAND_NAME = '宮泉'
const BRAND_ID = 2401
/** 取り込み直後に自動で付く銘柄(`冩楽`。`寫楽` と同じ蔵で、正規化が両者を畳む) */
const AUTO_BRAND_ID = 1616

/**
 * `data/seed/sake-log-rows.json`(gitignore 済み・203件)。**無ければ空オブジェクト**が返るので
 * 解決時エラーにならず skip 判定に使える(seedImport.test.tsx と同じ手)。
 */
const seedGlob: Record<string, unknown> = import.meta.glob('../../data/seed/sake-log-rows.json', {
  eager: true,
  import: 'default',
})
const seedFile: unknown = Object.values(seedGlob)[0] ?? null
const hasSeed = seedFile !== null

if (!hasSeed) {
  // **skip を無音にしない。** 要約の `skipped` と合わせて、何が未検証かを名指しで残す
  // (出力の作り方 = なぜ console では出ないかは `src/test/notice.ts` の1箇所が持つ)
  notice(
    '[manualLink.test] SKIP: data/seed/sake-log-rows.json が無いので、実データの手動紐付け' +
      '(寫楽5本 → 宮泉2401 / フレーバー 185→190 / manual バッジと5値目の絞り込みピル / ' +
      '解除で別名も消える)を検証していない。',
  )
}

/** 同梱データは `public/` に常にあるので静的 import で読み、fetch だけ差し替える */
const SAKENOWA_FILES: Record<string, unknown> = {
  'areas.json': areasJson as AreasFile,
  'breweries.json': breweriesJson as unknown as BreweriesFile,
  'brands.json': brandsJson as unknown as BrandsFile,
  'flavorCharts.json': flavorChartsJson as unknown as FlavorChartsFile,
}

function stubSakenowaFetch(): void {
  vi.stubGlobal('fetch', (input: unknown) => {
    const url = String(input)
    const name = url.slice(url.lastIndexOf('/') + 1)
    const body = SAKENOWA_FILES[name]
    if (body === undefined) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  })
}

/** 検証を通った行だけを返す。壊れていたら理由を言って落ちる(理由に台帳の値は入らない) */
function mustRows(value: unknown): SakeLogRow[] {
  const check = checkImportRows(value)
  if (!check.ok) throw new Error(`data/seed/sake-log-rows.json を取り込めない: ${check.reason}`)
  return check.rows
}

/** ストアの状態を内訳にする。**取り込みパネルが使うのと同じ関数**(数え方を二重実装しない) */
async function storeSummary() {
  const [records, tables] = await Promise.all([listRecords(), getTables()])
  return { records, summary: summarize(records, tables.flavorChartByBrandId) }
}

function countBy(records: readonly SakeRecord[], predicate: (record: SakeRecord) => boolean) {
  return records.filter(predicate).length
}

/** 絞り込みピルの文字列(`手動5` のように ラベル + 件数)。**紐付けの5値だけを拾う** */
const STATUS_PILL_RE = /^(自動|別名|手動|未紐付け|銘柄不明)\d+$/

/** 紐付いている記録はパネルへ**詳細から**入る(行の導線は未紐付け/銘柄不明にしか出ない) */
async function openLinkPanel(user: ReturnType<typeof userEvent.setup>) {
  const row = screen.getAllByRole('listitem').find((item) => item.textContent?.includes(LABEL))
  if (row === undefined) throw new Error(`${LABEL} の行が無い`)
  await user.click(within(row).getByRole('button'))
  await screen.findByRole('dialog', { name: '記録の詳細' })
  await user.click(screen.getByRole('button', { name: '紐付けを見直す' }))
}

function statusPills(): string[] {
  return screen
    .queryAllByRole('button')
    .map((button) => button.textContent ?? '')
    .filter((text) => STATUS_PILL_RE.test(text))
}

describe.skipIf(!hasSeed)('実データ203本: 寫楽を宮泉(2401)に手動で付け替える(A6 / e2e手順12)', () => {
  beforeAll(async () => {
    invalidateTables()
    stubSakenowaFetch()
    await clearAll(['records', 'aliases'])
    // UI の「取り込む」が呼ぶのと同じ経路(検証 → テーブル取得 → clear → 保存 → 集計)
    const outcome = await defaultActions.importSeed(mustRows(seedFile))
    expect(outcome.ok).toBe(true)
    expect(outcome.errors).toEqual([])
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    invalidateTables()
    closeDb()
  })

  beforeEach(() => {
    // Overlay は閉じるときに history.back() を予約する。実際に戻すとテスト間で popstate が飛ぶ
    vi.spyOn(window.history, 'back').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('取り込み直後: 寫楽5本は auto で冩楽(1616)に付き、フレーバー取得済みは190・manual は0', async () => {
    const { records, summary } = await storeSummary()

    expect(records.length).toBe(203)
    expect(countBy(records, (record) => record.brandLabel === LABEL)).toBe(5)
    expect(
      countBy(
        records,
        (record) =>
          record.brandLabel === LABEL &&
          record.linkStatus === 'auto' &&
          record.sakenowaBrandId === AUTO_BRAND_ID,
      ),
    ).toBe(5)
    expect(summary.withFlavor).toBe(190)
    expect(summary.byStatus.manual).toBe(0)
  })

  // 紐付いている記録は**解除してから選び直す**(パネルがそう言う)。
  //
  // **解除は別名が無ければその1本だけに効く**(波及は「保存した別名を消す」ことで起きるので、
  // 自動で付いた紐付けには波及するものが無い)。その1本ぶんフレーバー取得済みが 190 → 189 に
  // 動くので、**分母が画面の値から導かれている**ことが分かる(固定値ならここで動かない)
  it('解除するとその1本が未紐付けに戻り、フレーバー取得済みが 190 → 189 になる', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('全 203本')).toBeInTheDocument()

    // **紐付いている行には行の導線が出ない。** 出るのは未紐付け(7) + 銘柄不明(5) の12本だけ
    const entries = await screen.findAllByRole('button', { name: '手動で紐付ける' })
    expect(entries.length).toBe(12)
    expect(entries.some((button) => button.closest('li')?.textContent?.includes(LABEL))).toBe(false)

    await openLinkPanel(user)
    const panel = await screen.findByRole('dialog', { name: '手動で紐付ける' })
    // 自動で付いた紐付け先が画面から読める
    expect(within(panel).getByText(/冩楽/)).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: '紐付けを解除する' }))
    const confirm = await screen.findByRole('dialog', { name: '紐付けを解除する' })
    await user.click(within(confirm).getByRole('button', { name: '解除する' }))
    // 自動で付いた紐付けには消す別名が無い。**「消した」と嘘をつかない**
    expect(await within(panel).findByText(/消す別名は残っていなかった/)).toBeInTheDocument()

    const { summary } = await storeSummary()
    expect(summary.byStatus).toEqual({
      auto: 177,
      alias: 13,
      manual: 0,
      unlinked: 8,
      unknown: 5,
    })
    // **推定値で埋めない**ので、外した1本はそのまま分母から抜ける
    expect(summary.withFlavor).toBe(189)
  })

  // **紐付けは未紐付けの記録にだけ効く**(既に紐付いている同表記の4本は変えない)。
  // 自動で付くようになった今、同じ表記が丸ごと未紐付けで並ぶ状況がこのデータには無いので、
  // 「他N本にまとめて適用する」経路はここでは踏めない(→ B70。単体テストでは踏んでいる)
  it('続けて宮泉(2401)に紐付けるとその1本が manual になり、分母が 189 → 190 に戻る', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('全 203本')).toBeInTheDocument()

    // 解除した1本が導線に戻っている(未紐付け8 + 銘柄不明5)
    const entries = await screen.findAllByRole('button', { name: '手動で紐付ける' })
    expect(entries.length).toBe(13)
    const target = entries.find((button) => button.closest('li')?.textContent?.includes(LABEL))
    if (target === undefined) throw new Error(`${LABEL} の行に手動紐付けの導線が無い`)
    await user.click(target)

    const panel = await screen.findByRole('dialog', { name: '手動で紐付ける' })
    expect(within(panel).getByText(LABEL)).toBeInTheDocument()

    await user.type(within(panel).getByLabelText(/銘柄名/), BRAND_NAME)
    await user.click(await within(panel).findByRole('button', { name: `${BRAND_NAME} を選ぶ` }))

    // **確定する前に適用範囲を言う**(無音で一括変更しない)。
    // 既に紐付いている同表記の記録を勝手に書き換えないことも、その場で言う
    const confirm = await screen.findByRole('dialog', { name: 'この銘柄に紐付ける' })
    expect(confirm.textContent).toMatch(/適用するのはこの1本だけ/)
    expect(confirm.textContent).toMatch(/既に紐付いている4本は変えない/)
    await user.click(within(confirm).getByRole('button', { name: '紐付ける' }))

    const { records, summary } = await storeSummary()
    expect(records.length).toBe(203)
    expect(summary.byStatus).toEqual({
      auto: 177,
      alias: 13,
      manual: 1,
      unlinked: 7,
      unknown: 5,
    })
    expect(summary.withFlavor).toBe(190)
    expect(
      countBy(
        records,
        (record) =>
          record.brandLabel === LABEL &&
          record.linkStatus === 'manual' &&
          record.sakenowaBrandId === BRAND_ID,
      ),
    ).toBe(1)

    // 画面: パネルを閉じると一覧が読み直した結果で描き替わる
    await user.click(within(panel).getByRole('button', { name: '閉じる' }))
    expect(await screen.findByText('全 203本')).toBeInTheDocument()

    // **`manual` バッジが実データの画面に出る**(B28)
    expect(screen.getAllByText('手動').length).toBe(1)
    // 紐付いたので導線は 13 → 12 に減る
    expect(screen.getAllByRole('button', { name: '手動で紐付ける' }).length).toBe(12)

    // **5値目の絞り込みピルが出る**(ファセットは「実際に存在する値だけ」を出す設計なので、
    // 手動紐付けが1本も無い間は4値しか出ていなかった。B28)
    await user.click(screen.getByRole('button', { name: '絞り込み' }))
    const pills = statusPills()
    expect(pills.length).toBe(5)
    expect(pills).toContain('手動1')
  })

  it('リロードしても維持される(別名が IDB に残っている)', async () => {
    // 画面を作り直す = モジュールの state を持たない経路で読み直す
    const { summary } = await storeSummary()
    expect(summary.byStatus.manual).toBe(1)
    // 判断が永続化されている = 次の取り込みでも同じ紐付けになる
    expect((await listAliases()).filter((alias) => alias.brandId === BRAND_ID).length).toBe(1)

    render(<App />)
    expect(await screen.findByText('全 203本')).toBeInTheDocument()
    expect(screen.getAllByText('手動').length).toBe(1)
  })

  // **この describe は順番に状態を積む。** ここは最後で、紐付けを元に戻す方向を通す。
  // 記録だけ戻して別名が残ると「解除したのに次の取り込みで紐付けが復活する」= 原因の見えない
  // 状態になるので、記録の内訳と `aliases` ストアの両方を見る。
  it('もう一度解除するとその1本が未紐付けに戻り、保存した別名も消える', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('全 203本')).toBeInTheDocument()

    await openLinkPanel(user)
    const panel = await screen.findByRole('dialog', { name: '手動で紐付ける' })
    await user.click(within(panel).getByRole('button', { name: '紐付けを解除する' }))

    const confirm = await screen.findByRole('dialog', { name: '紐付けを解除する' })
    await user.click(within(confirm).getByRole('button', { name: '解除する' }))

    // 別名を消したことを言う(残っていると再取り込みで紐付けが復活する)
    expect(await within(panel).findByText(/別名も消した/)).toBeInTheDocument()

    const { summary } = await storeSummary()
    // **解除は「未紐付けに戻す」。** 自動の照合をやり直さないので `auto` には戻らない
    // (戻すと、本人が外した判断を機械が即座に取り消すことになる)
    expect(summary.byStatus).toEqual({
      auto: 177,
      alias: 13,
      manual: 0,
      unlinked: 8,
      unknown: 5,
    })
    expect(summary.withFlavor).toBe(189)
    // **記録だけでなく別名も消える。** 残っていると再取り込みで紐付けが復活する
    expect((await listAliases()).filter((alias) => alias.brandId === BRAND_ID).length).toBe(0)
  })
})
