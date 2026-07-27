// 5画面の**通し**のテスト。受け入れ基準 A9「4画面すべてが203本の実データで表示される」を、
// `App` を実物のまま描いてタブを押して確かめる(「知る」は A9 より後に足した5つ目のタブ。
// 実データを1件も読まない面なので、ここで見るのは実台帳を入れた状態でも開けることだけ)。
//
// 層ごとの単体テストは全部緑でも、この経路は境界にしか無い:
//
//   実 seed の取り込み → IndexedDB → App の `listRecords()` → `computeStats()` を1回
//   → 統計(Dashboard) と 産地(AreaMap) が同じ `Stats` を読む / 味(FlavorMap) が
//   `computeFlavor()` で分母を出す → タブを押して画面に数字が出る
//
// ## このファイルだけが見られること
//
// 1. **合成データでは不可能な数値の突合。** 単体テストの投入データは全部合成で、
//    スタイル分布(スペック列)と評価は射影2ファイル(`stats.cases.json` / `linkBrand.cases.json`)に
//    列が無いため、`stats.test.ts` は「規則」しか固定できていない(あちらの申し送り)。
//    実 seed を通すこのファイルが**実測値そのもの**を固定する唯一の場所。
// 2. **分母が画面から読めること**(BACKLOG B29 / B1(3))。`summarize()` が返す 185 は取り込み
//    パネルの中にしか出ていなかった。ここでは味タブの本文から 185 を読み、手動紐付けの後に
//    **同じ場所が 190 に変わる**ことまで1本のテストで通す(数字が画面に届いている証拠)。
// 3. **未進出県が空白で分かること**。地図の `data-step` を読む(色の見た目ではなく段の番号)。
//
// ## seed が無い環境では丸ごと skip される
//
// `data/seed/sake-log-rows.json` は gitignore なので CI には存在しない。**skip されている
// 環境では下の実測値は未検証**で、それが分かるように要約の `skipped` に加えてモジュール
// 読み込み時に1行出す(無音の緑にしない)。seedImport / manualLink と同じ構造の制約。
//
// ## 実台帳を失敗ログに出さない
//
// 期待値は**件数と集計値だけ**。`screen.getByText` / `findByText` は見つからないときに
// DOM 全体(= 203本の銘柄と日付)を吐くので、この画面群の検査には使わず、
// `expectVisible()` などの「探した文字列だけを言って落ちる」ヘルパを通す。
// **実台帳の日付をこのファイルに1文字も書かない**。年(`2022`)と件数は台帳のサマリで、
// 銘柄名 `寫楽` / `宮泉` と brandId 2401 はさけのわの公開マスタ側の値なので書ける。

import { render, screen, waitFor, within } from '@testing-library/react'
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
} from '../domain/types.ts'
import { clearAll, closeDb } from '../store/db.ts'
import { invalidateTables } from '../store/linking.ts'
import { checkImportRows, listRecords } from '../store/records.ts'
import { notice } from '../test/notice.ts'
import { defaultActions } from '../ui/ImportExport/importActions.ts'

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
    '[screens.test] SKIP: data/seed/sake-log-rows.json が無いので、実データ203本での5画面' +
      '(統計 総本数203 / 2022年65本 / 福島県22本 / スタイル延べ314、味 分母185(12・5・1)と' +
      '手動紐付け後190、産地 塗った197本と未進出14県、知る 実台帳を入れた状態で開けること)' +
      'を検証していない。タブの配線そのものは合成データの App.test.tsx が見ている。',
  )
}

/** 同梱データは `public/` に常にあるので静的 import で読み、fetch だけ差し替える */
const SAKENOWA_FILES: Record<string, unknown> = {
  'areas.json': areasJson as AreasFile,
  'breweries.json': breweriesJson as unknown as BreweriesFile,
  'brands.json': brandsJson as unknown as BrandsFile,
  'flavorCharts.json': flavorChartsJson as unknown as FlavorChartsFile,
}

/** ブラウザと同じ経路(loadTables → fetch → decodeTables)を通すための stub */
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

// ---------------------------------------------------------------------------
// 取り出し — **失敗しても探した文字列だけを言う**(DOM を吐かせない)
// ---------------------------------------------------------------------------

type User = ReturnType<typeof userEvent.setup>

function screenText(): string {
  return document.body.textContent ?? ''
}

function expectVisible(needle: string): void {
  expect(screenText().includes(needle) ? 'ok' : `画面に「${needle}」が無い`).toBe('ok')
}

function expectNotVisible(needle: string): void {
  expect(screenText().includes(needle) ? `画面に「${needle}」が出ている` : 'ok').toBe('ok')
}

/** 非同期(IndexedDB / fetch)の解決待ち。`findBy*` を使わないのは失敗時の DOM 吐き出しを避けるため */
async function waitForVisible(needle: string): Promise<void> {
  await waitFor(() => {
    expectVisible(needle)
  })
}

const TAB_LABELS = {
  timeline: '記録',
  stats: '統計',
  flavor: '味',
  area: '産地',
  learn: '知る',
} as const

/** 下端のタブを押す。`getByRole` の名前引きを使わない(見つからないときに DOM を吐く) */
async function openTab(user: User, tab: keyof typeof TAB_LABELS): Promise<void> {
  const label = TAB_LABELS[tab]
  const button = [...document.querySelectorAll('nav button')].find(
    (candidate) => candidate.textContent === label,
  )
  if (button === undefined) throw new Error(`タブ「${label}」が無い`)
  await user.click(button)
}

/** 記録が読めるまで待ってから始める。空の集計を「記録0本」として出していないことも兼ねる */
async function renderApp(): Promise<User> {
  const user = userEvent.setup()
  render(<App />)
  await waitForVisible('全 203本')
  return user
}

/** 横棒の一覧(`aria-label`)の行 → ラベルと本数。`<li>` 直下は span / svg / span の順 */
function barRows(label: string): { label: string; count: string }[] {
  return listItems(label).map((item) => {
    const spans = [...item.querySelectorAll(':scope > span')]
    return { label: spans[0]?.textContent ?? '', count: spans.at(-1)?.textContent ?? '' }
  })
}

/** 縦棒(年別)は件数が上・ラベルが下なので span の順が逆 */
function columnRows(label: string): { label: string; count: string }[] {
  return listItems(label).map((item) => {
    const spans = [...item.querySelectorAll(':scope > span')]
    return { label: spans.at(-1)?.textContent ?? '', count: spans[0]?.textContent ?? '' }
  })
}

function listItems(label: string): HTMLElement[] {
  const list = document.querySelector(`[aria-label="${label}"]`)
  if (list === null) throw new Error(`一覧「${label}」が描かれていない`)
  return [...list.querySelectorAll(':scope > li')] as HTMLElement[]
}

/** 味タブの未取得3種の行 → 件数の表示。3種を1つに潰していないことを行単位で見る */
function missingCount(label: string): string {
  for (const item of document.querySelectorAll('li')) {
    const spans = [...item.querySelectorAll(':scope > span')]
    if (spans[0]?.textContent === label) return spans[1]?.textContent ?? ''
  }
  throw new Error(`味タブに「${label}」の行が無い`)
}

/** 地図の1県。`data-romaji` は `@svg-maps/japan` の id をそのまま出したもの */
function mapShape(romaji: string): Element {
  const path = document.querySelector(`path[data-romaji="${romaji}"]`)
  if (path === null) throw new Error(`地図に ${romaji} の形が無い`)
  return path
}

/** 段(`data-step`)ごとの形の数。色の見た目ではなく段の番号で「濃い / 空白」を見る */
function shapesAtStep(step: string): Element[] {
  return [...document.querySelectorAll(`path[data-step="${step}"]`)]
}

// ---------------------------------------------------------------------------

describe.skipIf(!hasSeed)('実データ203本: 5画面が表示される(A9) / 分母が画面から読める(B29)', () => {
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

  it('記録タブ: 203本が203行で出る', async () => {
    await renderApp()
    // 行は `<ol><li>`。要素の配列ではなく件数を比べる(失敗時に DOM を吐かせない)
    expect(document.querySelectorAll('ol > li').length).toBe(203)
  })

  it('統計タブ: 総本数203 / 2022年65本 / 福島県22本 が台帳のサマリと一致する', async () => {
    const user = await renderApp()
    await openTab(user, 'stats')

    const section = document.querySelector('section[aria-label="統計"]')
    if (section === null) throw new Error('統計の画面が描かれていない')
    // 総本数は数字そのものをテキストで出す(棒の中に隠さない)。region の中だけで引く
    expect(within(section as HTMLElement).getByText('203')).toBeInTheDocument()
    expectVisible('同じ 203本 から数えている')

    // 年別。2020-2026 の7年なので 0埋めの対象にならず、観測年がそのまま並ぶ
    expect(columnRows('年別の本数')).toEqual([
      { label: '2020', count: '1' },
      { label: '2021', count: '12' },
      { label: '2022', count: '65' },
      { label: '2023', count: '33' },
      { label: '2024', count: '31' },
      { label: '2025', count: '33' },
      { label: '2026', count: '28' },
    ])
    // 203本すべて日付が読める = 年別の外に落ちる記録は無い
    expectNotVisible('日付が YYYY-MM-DD として読めない記録')

    // 都道府県別。33行(未進出県の0行は出さない)で、上位3県が台帳のサマリと一致する
    const prefectures = barRows('都道府県別の本数')
    expect(prefectures.length).toBe(33)
    expect(prefectures.slice(0, 3)).toEqual([
      { label: '福島県', count: '22' },
      { label: '和歌山県', count: '20' },
      { label: '山形県', count: '17' },
    ])
    // 33県 + 「静岡県または京都府」= 34区分。空欄5本を除いた198本
    expectVisible('34区分に198本')
    expectVisible('合計 6本 は都道府県が特定できていない')
  })

  // **合成データでは検証できない唯一の節**(スペック列は射影2ファイルに無い)。
  // `stats.test.ts` は規則(重複計上 / spec 列のみ / 備考は数えない)を合成データで固定して
  // あるので、ここが実測値そのものを固定する。
  it('統計タブ: スタイル分布が実測値と一致し、延べ314件が203本を超える', async () => {
    const user = await renderApp()
    await openTab(user, 'stats')

    expect(barRows('スタイル別の本数')).toEqual([
      { label: '純米大吟醸', count: '43' },
      { label: '大吟醸', count: '45' },
      { label: '純米吟醸', count: '51' },
      { label: '純米', count: '112' },
      // 0 が正しい語。行を消すと「0本」と「数えていない」が同じ見た目になる
      { label: '本醸造', count: '0' },
      { label: '生原酒', count: '15' },
      { label: '無濾過', count: '13' },
      { label: '原酒', count: '16' },
      { label: 'ひやおろし', count: '7' },
      { label: 'しぼりたて', count: '8' },
      { label: 'にごり', count: '4' },
    ])
    // 重複計上(`大吟醸45` は `純米大吟醸43` を含む / `原酒16` は `生原酒15` を含む)なので
    // 延べが総本数を超える。**超えるのが正しい**ことを画面に書いてある
    expectVisible('延べ 314件 が総本数 203本 を超えるのは正しい')
    expectVisible('重複計上')

    // 取り込んだ203本に評価は付いていない。0点として数えず、段も消さない
    expectVisible('評価済み 0本 / 未評価 203本')
    expect(barRows('評価別の本数').map((row) => row.count)).toEqual(['0', '0', '0', '0', '0'])
  })

  it('味タブ: 「203本中185本」と未取得の内訳 12 / 5 / 1 が画面から読める', async () => {
    const user = await renderApp()
    await openTab(user, 'flavor')
    // 同梱テーブルの fetch が終わるまでは数字を出さない(空の表で集計しない)
    await waitForVisible('203本中 185本のデータで集計')

    expectVisible('91%') // floor(185/203) — 切り上げて100%にしない
    expectVisible('フレーバー未取得は 18本')

    // 3種を1つに潰さない。**「チャート無し 1本」が 紐付け済み186 ≠ フレーバー取得済み185 の差**
    expect(missingCount('未紐付け')).toBe('12本')
    expect(missingCount('銘柄不明')).toBe('5本')
    expect(missingCount('チャート無し')).toBe('1本')

    // 平均のレーダーも同じ分母で描かれている(2箇所目の 185)
    expectVisible('太い線が平均（185本）')
    // 推定値で埋めていないので NaN も出ない
    expect(screenText()).not.toMatch(/NaN|Infinity/)
  })

  it('産地タブ: 福島・和歌山・山形が最上段で、未進出14県が空白', async () => {
    const user = await renderApp()
    await openTab(user, 'area')

    // 47県すべての形がある(解決できない id は1件も無い)
    expect(document.querySelectorAll('path[data-romaji]').length).toBe(47)
    expectNotVisible('都道府県に対応付けられなかった')

    // 濃い3県 = 最上段(11本以上)。段の番号で見るので、色を変えても意味は変わらない
    for (const [romaji, count] of [
      ['fukushima', '22'],
      ['wakayama', '20'],
      ['yamagata', '17'],
    ]) {
      const shape = mapShape(romaji)
      expect(shape.getAttribute('data-count')).toBe(count)
      expect(shape.getAttribute('data-step')).toBe('4')
    }

    // 未進出 = 47県 - 訪問33県。**0本の県は空白の段(0)で、本数も 0 として持っている**
    const blank = shapesAtStep('0')
    expect(blank.length).toBe(14)
    expect(blank.every((shape) => shape.getAttribute('data-count') === '0')).toBe(true)
    expectVisible('未進出（0本）14県')

    // 塗った本数と全本数を並べて出す。差の6本(空欄5 + 県が決まらない表記1)は地図の外
    expectVisible('訪問 33県 / 47県')
    expectVisible('地図に塗った 197本')
    expectVisible('全 203本')
    expectVisible('地図に塗れなかった 6本')

    // CC-BY のクレジット(4項目)は**ライセンス対象を描くこの画面**にある。
    // フッタから外したので、産地タブに無ければどの画面にも無い(義務違反)。
    expectVisible('Victor Cazanave')
    expectVisible('CC BY 4.0')
    expectVisible('本数に応じて着色する改変あり')
  })

  // 「知る」は実台帳を1件も読まない面(凡例と告示の逐語だけ)。それでも**203本を入れた
  // 状態で開けること**は器の配線なのでここで通す。中身は Learn.test.tsx が持つ。
  it('知るタブ: 実台帳を入れた状態でも5つの下位タブが開き、凡例が実装の語で出る', async () => {
    const user = await renderApp()
    await openTab(user, 'learn')

    // 既定は「数え方」。凡例は実装(LINK_STATUS_BADGES)を走査して描く
    expectVisible('銘柄不明')

    // 下位タブごとに中身が入れ替わる。**開いていないタブの中身は DOM に無い**ので、
    // 1つずつ開いて実装から引いた語(FLAVOR_AXIS_LABELS / FILL_STEPS / STYLE_TERMS)を見る
    for (const [tab, needle] of [
      ['味', '華やか'],
      ['産地', '未進出（0本）'],
      ['名称', '純米大吟醸'],
      // ライセンスの全文はこの画面にもある(産地タブと2箇所)
      ['出典', 'Victor Cazanave'],
    ]) {
      await user.click(screen.getByRole('tab', { name: tab }))
      expectVisible(needle)
    }

    // 台帳の集計はこの画面に出ない(記録を読まない面なので数字が混ざっていないこと)
    expectNotVisible('全 203本')
  })

  // **この it は台帳の状態を書き換えるので最後に置く。** 前の5本は読むだけ。
  //
  // B29 / B1(3) の回収: 分母が画面から読めることの証拠。同じ1本のテストの中で
  // 185 を読み → 手動紐付けし → 同じ場所が 190 に変わることを見る(片方だけを別テストで
  // 見ると、実は最初から190だった/最後まで185だった場合に気付けない)。
  it('手動紐付け(寫楽5本 → 宮泉2401)で味タブの分母が 185 → 190 になる', async () => {
    const user = await renderApp()

    await openTab(user, 'flavor')
    await waitForVisible('203本中 185本のデータで集計')

    await openTab(user, 'timeline')
    // 未紐付け(12) + 銘柄不明(5) の行にだけ導線が出る。**紐付いている186本には出ない**
    const entries = await screen.findAllByRole('button', { name: '手動で紐付ける' })
    expect(entries.length).toBe(17)

    const target = entries.find((button) => button.closest('li')?.textContent?.includes(LABEL))
    if (target === undefined) throw new Error(`${LABEL} の行に手動紐付けの導線が無い`)
    await user.click(target)

    const panel = await screen.findByRole('dialog', { name: '手動で紐付ける' })
    await user.type(within(panel).getByLabelText(/銘柄名/), BRAND_NAME)
    await user.click(await within(panel).findByRole('button', { name: `${BRAND_NAME} を選ぶ` }))

    // 波及件数を**確定する前に**出す(無音で一括変更しない)
    const confirm = await screen.findByRole('dialog', { name: 'この銘柄に紐付ける' })
    await user.click(within(confirm).getByRole('button', { name: '紐付ける' }))
    expect(await within(panel).findByText(/他4本にも適用した/)).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: '閉じる' }))

    // ストア: 5本が 宮泉(2401) の manual になった
    const records = await listRecords()
    expect(records.length).toBe(203)
    expect(
      records.filter(
        (record) =>
          record.brandLabel === LABEL &&
          record.linkStatus === 'manual' &&
          record.sakenowaBrandId === BRAND_ID,
      ).length,
    ).toBe(5)

    // 画面: 味タブの分母が増える。**未紐付けが 12 → 7 に減った分がそのまま分母に乗る**
    await openTab(user, 'flavor')
    await waitForVisible('203本中 190本のデータで集計')
    expectNotVisible('203本中 185本のデータで集計')
    expect(missingCount('未紐付け')).toBe('7本')
    expect(missingCount('銘柄不明')).toBe('5本')
    expect(missingCount('チャート無し')).toBe('1本')
    expectVisible('フレーバー未取得は 13本')
    expectVisible('太い線が平均（190本）')
  })
})
