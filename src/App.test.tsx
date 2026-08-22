// App が持っているのは配線だけ。単体テストが層ごとに緑でも、**落ちた側だけを名指しできているか**と
// **書き込みの後に一覧を読み直しているか**は結線しないと分からないのでここで固定する:
//
//  1. 記録(IndexedDB)が読めないときに**無音で空リストを出さない**(0本と「読めなかった」を
//     同じ見た目にすると、台帳が消えたのか読めないのかが区別できない)。再試行で復帰する
//  2. さけのわの同梱テーブル(fetch)が落ちても**一覧は出る**。ただし詳細・記録の作成・
//     手動紐付けは開けない(空のテーブルで「データ無し」と嘘をつかない)
//  3. 作成 / 編集 / 削除 / 手動紐付けが store に届き、**成功したときだけ画面を閉じて
//     一覧を読み直す**。削除は自作の確認ダイアログを経る(OS の `confirm()` は使わない)
//  4. **味タグは絞り込みパネルを開くまで取らず、失敗しても他を止めない**。4表に畳んでいたら
//     味タグの取得失敗だけで記録の作成・詳細・手動紐付けが開けなくなる
//
// store は差し替えるが `importOriginal` で残りは実物を使う(Timeline が同じモジュールから
// `byNewestFirst` を import しているので、モジュールを丸ごと置き換えると並び替えが消える)。
//
// データは全部合成。日付リテラルは1種類に留める(BACKLOG B22 の台帳ガード)。

import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.tsx'
import {
  decodeFlavorTags,
  decodeTables,
  type DecodedFlavorTags,
  type DecodedTables,
} from './data/tables.ts'
import type { SakeRecord } from './domain/types.ts'
import { getFlavorTags, getTables } from './store/linking.ts'
import { requestPersistentStorage } from './store/meta.ts'
import { createRecord, deleteRecord, listRecords, updateRecord } from './store/records.ts'
import { listNotes } from './store/notes.ts'
import { sync } from './store/sync.ts'

vi.mock('./store/meta.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./store/meta.ts')>()
  return { ...actual, requestPersistentStorage: vi.fn() }
})

vi.mock('./store/records.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./store/records.ts')>()
  return {
    ...actual,
    listRecords: vi.fn(),
    createRecord: vi.fn(),
    updateRecord: vi.fn(),
    deleteRecord: vi.fn(),
  }
})

vi.mock('./store/sync.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./store/sync.ts')>()
  return { ...actual, sync: vi.fn() }
})

vi.mock('./store/notes.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./store/notes.ts')>()
  return { ...actual, listNotes: vi.fn(), putNote: vi.fn(), deleteNote: vi.fn() }
})

vi.mock('./store/linking.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./store/linking.ts')>()
  return {
    ...actual,
    getTables: vi.fn(),
    invalidateTables: vi.fn(),
    getFlavorTags: vi.fn(),
    invalidateFlavorTags: vi.fn(),
  }
})

const listRecordsMock = vi.mocked(listRecords)
const getTablesMock = vi.mocked(getTables)
const getFlavorTagsMock = vi.mocked(getFlavorTags)
const createRecordMock = vi.mocked(createRecord)
const updateRecordMock = vi.mocked(updateRecord)
const deleteRecordMock = vi.mocked(deleteRecord)
const requestPersistenceMock = vi.mocked(requestPersistentStorage)
const syncMock = vi.mocked(sync)
const listNotesMock = vi.mocked(listNotes)

/** 銘柄1件だけの合成テーブル。復号は実物を通す(索引の作り方を二重実装しない) */
function syntheticTables(): DecodedTables {
  return decodeTables({
    areas: { copyright: 'synthetic', rows: ['その他', '北海道'] },
    breweries: { copyright: 'synthetic', rows: [[11, 'テスト酒造', 1]] },
    brands: { copyright: 'synthetic', rows: [[101, 'テスト酒', 11]] },
    flavorCharts: { copyright: 'synthetic', rows: [[101, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]] },
  })
}

/** 味タグの合成表。**4表とは別の資源**なので別の関数で組む(App もそう扱う) */
function syntheticFlavorTags(): DecodedFlavorTags {
  return decodeFlavorTags({
    flavorTags: {
      copyright: 'synthetic',
      rows: [
        [1, 'テスト味あ'],
        [2, 'テスト味い'],
      ],
    },
    brandFlavorTags: { copyright: 'synthetic', rows: [[101, 1, 2]] },
  })
}

function record(over: Partial<SakeRecord> & { id: string }): SakeRecord {
  return {
    drankOn: '2020-01-01',
    brandLabel: 'テスト酒',
    sakenowaBrandId: 101,
    brandName: 'テスト酒',
    linkStatus: 'auto',
    prefecture: '北海道',
    spec: '',
    rating: null,
    place: '',
    note: '',
    thumbnail: null,
    sourceNo: 1,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    ...over,
  }
}

beforeEach(() => {
  // 呼び出し履歴はテストごとに空から始める(「createRecord が呼ばれていない」を見るテストが
  // 前のテストの呼び出しを拾わないようにする)。実装(mockResolvedValue)は各テストが置く
  vi.clearAllMocks()
  // Overlay は閉じるときに history.back() を予約する。実際に戻すとテスト間で popstate が飛ぶ
  vi.spyOn(window.history, 'back').mockImplementation(() => {})
  // 永続化の要求は **Promise を返す**のが本物の面。既定を置かないと `undefined` を返す
  // 別物の二重体になり、呼び側が Promise として扱っているかどうかを検査できなくなる
  // (この既定を消すと「1本目で要求する」テストが要求の有無ではなく型の事故で落ちる)
  requestPersistenceMock.mockResolvedValue('denied')
  // 味タグは**要求されるまで呼ばれない**のが既定の姿。既定の実装を置いておくのは
  // 「呼ばれていない」を見るテストと「開いたら取る」テストを同じ土台で書くため
  getFlavorTagsMock.mockResolvedValue(syntheticFlavorTags())
  // 同期は**設定していない端末では何もしない**のが既定の姿(A28)。
  // 既定を置かないと `undefined` が返り、App の `.then` が型の事故で落ちる
  syncMock.mockResolvedValue({ status: 'not-configured' })
  // メモは**既定で0件**。降りてくる筋のテストだけが値を差し替える
  listNotesMock.mockResolvedValue([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('産地から記録へ辿る', () => {
  // 集計から記録へ飛べないのが不便、という指摘への手当て。
  // **層ごとに緑でも配線は結線しないと分からない**(タブの切り替えと絞り込みの引き渡しが別物)
  it('県の銘柄一覧から記録タブへ移り、その県で絞り込まれた状態で開く', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([
      record({ id: 'a', prefecture: '北海道' }),
      record({
        id: 'b',
        prefecture: '秋田県',
        brandLabel: 'べつの酒',
        brandName: null,
        sakenowaBrandId: null,
        linkStatus: 'unlinked',
      }),
    ])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)
    await screen.findByText('テスト酒')

    // 下端のタブは `role="tab"` を持たない素のボタン。文言で引く(screens.test.tsx と同じ手)
    const areaTab = [...document.querySelectorAll('nav button')].find(
      (button) => button.textContent === '産地',
    )
    if (areaTab === undefined) throw new Error('産地タブが無い')
    await user.click(areaTab)
    await user.click(await screen.findByRole('button', { name: /北海道/ }))
    expect(screen.getByText(/北海道で飲んだ銘柄/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '記録タブで見る' }))

    // 記録タブに移り、北海道の1本だけが残っている
    expect(await screen.findByText('テスト酒')).toBeInTheDocument()
    expect(screen.queryByText('べつの酒')).not.toBeInTheDocument()
  })
})

describe('統計から記録へ辿る', () => {
  /** 下端のタブは `role="tab"` を持たない素のボタン。文言で引く */
  async function goToTab(user: ReturnType<typeof userEvent.setup>, name: string) {
    const tab = [...document.querySelectorAll('nav button')].find(
      (button) => button.textContent === name,
    )
    if (tab === undefined) throw new Error(`${name}タブが無い`)
    await user.click(tab)
  }

  function twoRecords() {
    listRecordsMock.mockResolvedValue([
      record({
        id: 'a',
        prefecture: '北海道',
        drankOn: '2020-01-01',
        rating: 5,
        spec: '純米大吟醸',
      }),
      record({
        id: 'b',
        prefecture: '秋田県',
        drankOn: '2021-05-05',
        rating: 3,
        spec: '本醸造',
        brandLabel: 'べつの酒',
        brandName: 'べつの酒',
        sakenowaBrandId: 102,
      }),
    ])
    getTablesMock.mockResolvedValue(syntheticTables())
  }

  // 棒 → 記録の引き渡しは、軸ごとに**別の絞り込みに落ちる**。
  // 1軸だけ結線して残りを忘れる事故が起きやすいので、軸ごとに1本ずつ見る
  it.each([
    { axis: '年別の本数', bar: /2021/, kept: 'べつの酒', dropped: 'テスト酒' },
    { axis: '都道府県別の本数', bar: /北海道/, kept: 'テスト酒', dropped: 'べつの酒' },
    { axis: '評価別の本数', bar: /^5 /, kept: 'テスト酒', dropped: 'べつの酒' },
    { axis: 'スタイル別の本数', bar: /^本醸造 /, kept: 'べつの酒', dropped: 'テスト酒' },
  ])('$axis の棒を押すと、その条件で絞り込まれた記録タブが開く', async ({ bar, kept, dropped }) => {
    const user = userEvent.setup()
    twoRecords()

    render(<App />)
    await screen.findByText('テスト酒')

    await goToTab(user, '統計')
    await user.click(await screen.findByRole('button', { name: bar }))

    expect(await screen.findByText(kept)).toBeInTheDocument()
    expect(screen.queryByText(dropped)).not.toBeInTheDocument()
  })

  // 味タブの内訳。**散布図の点からは飛べない**(点は銘柄名を持たない = B24)ので、
  // この画面から記録へ戻る唯一の道
  it('味タブの「未紐付け」を押すと、未紐付けの記録だけに絞り込まれる', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([
      record({ id: 'a' }),
      record({
        id: 'b',
        brandLabel: 'べつの酒',
        brandName: null,
        sakenowaBrandId: null,
        linkStatus: 'unlinked',
      }),
    ])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)
    await screen.findByText('テスト酒')

    await goToTab(user, '味')
    await user.click(await screen.findByRole('button', { name: /未紐付けの1本を記録タブで見る/ }))

    expect(await screen.findByText('べつの酒')).toBeInTheDocument()
    expect(screen.queryByText('テスト酒')).not.toBeInTheDocument()
  })

  // **同じ棒を2回押しても効く。** 記録タブ側で絞り込みを触った後に戻ってきたとき、
  // 「前と同じ値だから何もしない」になると押しても動かない画面になる
  it('記録タブで絞り込みを消してから同じ棒を押し直しても、また絞り込まれる', async () => {
    const user = userEvent.setup()
    twoRecords()

    render(<App />)
    await screen.findByText('テスト酒')

    await goToTab(user, '統計')
    await user.click(await screen.findByRole('button', { name: /北海道/ }))
    expect(screen.queryByText('べつの酒')).not.toBeInTheDocument()

    // 効いている条件はチップで見えている。そこから解除する
    await user.click(screen.getByRole('button', { name: '北海道 の絞り込みを解除' }))
    expect(await screen.findByText('べつの酒')).toBeInTheDocument()

    await goToTab(user, '統計')
    await user.click(await screen.findByRole('button', { name: /北海道/ }))
    expect(await screen.findByText('テスト酒')).toBeInTheDocument()
    expect(screen.queryByText('べつの酒')).not.toBeInTheDocument()
  })
})

// **SW の更新が打った内容を黙って消さない**(B87)。`sw.js` は skipWaiting + clients.claim を
// 呼び、復帰のたびに reg.update() が走るので、「記録の途中で写真アプリへ切り替えて戻った瞬間」に
// 版が入れ替わりうる。以前はそこで無条件に location.reload() していた。
describe('新しい版への入れ替え(B87)', () => {
  /** controllerchange を任意のタイミングで起こす。実ブラウザの口と同じ形だけ真似る */
  function fakeServiceWorker() {
    const handlers: (() => void)[] = []
    const worker = {
      controller: {},
      addEventListener: (_type: string, handler: () => void) => {
        handlers.push(handler)
      },
      removeEventListener: (_type: string, handler: () => void) => {
        const at = handlers.indexOf(handler)
        if (at >= 0) handlers.splice(at, 1)
      },
    }
    Object.defineProperty(navigator, 'serviceWorker', { value: worker, configurable: true })
    return { fire: () => { for (const handler of [...handlers]) handler() } }
  }

  function stubReload() {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      configurable: true,
    })
    return reload
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker')
  })

  it('何も開いていなければその場で入れ替える', async () => {
    const sw = fakeServiceWorker()
    const reload = stubReload()
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)
    await screen.findByText('テスト酒')

    act(() => {
      sw.fire()
    })

    await waitFor(() => {
      expect(reload).toHaveBeenCalled()
    })
  })

  // ★ ここが本題。フォームの入力はメモリ上にしか無く、dirty の確認ダイアログは
  // アプリ内の閉じる操作にしか効かないので、ここでリロードすると打った内容が全損する
  it('記録フォームが開いている間はリロードせず、本人に委ねる', async () => {
    const user = userEvent.setup()
    const sw = fakeServiceWorker()
    const reload = stubReload()
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)
    await user.click(await screen.findByRole('button', { name: '記録する' }))
    await screen.findByRole('dialog')

    act(() => {
      sw.fire()
    })

    expect(reload).not.toHaveBeenCalled()
    expect(await screen.findByText(/新しい版がある/)).toBeInTheDocument()
    // 押したときだけ入れ替わる
    await user.click(screen.getByRole('button', { name: '再読み込み' }))
    expect(reload).toHaveBeenCalled()
  })

  // 保留を解除した瞬間にリロードすると「フォームを閉じたら画面が再読み込みされた」という
  // 別の驚きになる。保留したら本人が押すまで待つ
  it('保留したあとフォームを閉じても、勝手にはリロードしない', async () => {
    const user = userEvent.setup()
    const sw = fakeServiceWorker()
    const reload = stubReload()
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)
    await user.click(await screen.findByRole('button', { name: '記録する' }))
    await screen.findByRole('dialog')
    act(() => {
      sw.fire()
    })

    await user.click(screen.getByRole('button', { name: '閉じる' }))

    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByText(/新しい版がある/)).toBeInTheDocument()
  })
})

describe('同期(A28)', () => {
  // **同期は足すものであって前提にしない。** ここが崩れると、同期先が落ちている日に
  // 記録の閲覧も作成もできなくなる
  it('同期が失敗しても一覧は出るし、記録も作れる', async () => {
    const user = userEvent.setup()
    syncMock.mockResolvedValue({ status: 'failed', kind: 'offline', message: '届かない' })
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)

    expect(await screen.findByText('テスト酒')).toBeInTheDocument()
    // 同期の失敗を記録の状態に混ぜない(記録の読み込みエラーの面を出さない)
    expect(screen.queryByText('記録を読み込めなかった')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '記録する' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  // **自動同期で消えたものを黙って消させない**(B82 / A26)。起動時の同期は成功すると
  // 位置を進めるので、ここで言わなかった競合はあとから手で押しても二度と出ない
  it('起動時の同期で競合が起きたら、記録タブで言う', async () => {
    syncMock.mockResolvedValue({
      status: 'done',
      result: {
        startedAt: '2026-08-22T00:00:00.000Z',
        localRecords: 1,
        applied: 1,
        removed: 0,
        pushed: 0,
        conflicts: [{ id: 'a', winner: 'remote', winnerDeleted: false }],
        messages: [],
      },
    })
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)

    expect(await screen.findByText(/1 件が別の端末の内容に置き換わった/)).toBeInTheDocument()
  })

  // `actionError` と同じスロットに載せていると、フォームを開く・保存するだけで消える。
  // 二度と再生成されない通知なので、本人が閉じるまで残さなければ言わなかったのと同じ
  it('その通知は、記録を作っても消えない', async () => {
    const user = userEvent.setup()
    syncMock.mockResolvedValue({
      status: 'done',
      result: {
        startedAt: '2026-08-22T00:00:00.000Z',
        localRecords: 1,
        applied: 1,
        removed: 0,
        pushed: 0,
        conflicts: [{ id: 'a', winner: 'remote', winnerDeleted: false }],
        messages: [],
      },
    })
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)
    const notice = await screen.findByText(/1 件が別の端末の内容に置き換わった/)

    await user.click(screen.getByRole('button', { name: '記録する' }))
    await screen.findByRole('dialog')

    expect(notice).toBeInTheDocument()
  })

  it('その通知は「閉じる」で消える', async () => {
    const user = userEvent.setup()
    syncMock.mockResolvedValue({
      status: 'failed',
      kind: 'unauthorized',
      message: 'パスワードが違う(401)',
    })
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)
    expect(await screen.findByText(/パスワードが合っていない/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '閉じる' }))

    expect(screen.queryByText(/パスワードが合っていない/)).toBeNull()
  })

  // `sync()` は投げない約束だが、投げても記録の閲覧を止めてはいけない
  it('同期が例外を投げても一覧は出る', async () => {
    syncMock.mockRejectedValue(new Error('想定外'))
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)

    expect(await screen.findByText('テスト酒')).toBeInTheDocument()
  })

  it('同期の画面を開ける', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)
    await screen.findByText('テスト酒')
    await user.click(screen.getByRole('button', { name: '同期' }))

    expect(await screen.findByRole('heading', { name: '同期' })).toBeInTheDocument()
  })
})

describe('記録が読めないとき', () => {
  it('理由と再試行を出し、空の一覧を黙って描かない', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockRejectedValueOnce(new Error('保存領域を開けない'))
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)

    expect(await screen.findByText('記録を読み込めなかった')).toBeInTheDocument()
    expect(screen.getByText(/保存領域を開けない/)).toBeInTheDocument()
    // 「まだ0本」の空状態と混ざらないこと(導線を出して取り込みを促してはいけない)
    expect(screen.queryByText('まだ1本も記録が無い')).toBeNull()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)

    // 再試行で復帰する(失敗を掴んだまま固まらない)
    listRecordsMock.mockResolvedValueOnce([record({ id: 'a' })])
    await user.click(screen.getByRole('button', { name: '再試行' }))

    expect(await screen.findByText('全 1本')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(1)
  })
})

describe('さけのわの同梱テーブルが読めないとき', () => {
  it('一覧は出したまま、落ちた側だけを名指しする', async () => {
    listRecordsMock.mockResolvedValue([record({ id: 'a' }), record({ id: 'b' })])
    getTablesMock.mockRejectedValue(new Error('オフライン'))

    render(<App />)

    // 記録は端末に保存された値なのでテーブルの失敗に影響されない
    expect(await screen.findByText('全 2本')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('銘柄・フレーバーの元データを読み込めなかった')).toBeInTheDocument()
    expect(screen.getByText(/オフライン/)).toBeInTheDocument()
  })

  it('テーブルが未着のあいだ記録の詳細を開けない(空のテーブルで「データ無し」と嘘をつかない)', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockRejectedValue(new Error('オフライン'))

    render(<App />)
    await screen.findByText('全 1本')

    // 行はボタンにならない(押しても何も起きない行を作らない)
    expect(screen.queryByRole('button', { name: /テスト酒/ })).toBeNull()

    // 逆にテーブルが揃えば開ける
    getTablesMock.mockResolvedValue(syntheticTables())
    await user.click(screen.getByRole('button', { name: '再試行' }))

    const row = await screen.findByRole('button', { name: /テスト酒/ })
    await user.click(row)

    expect(await screen.findByRole('dialog', { name: '記録の詳細' })).toBeInTheDocument()
  })
})

describe('味タグ（絞り込みの1軸だけが使う任意の資源）', () => {
  /**
   * 2本。**日付は1種類のまま**(B22 の台帳ガード)なので、味タグ以外の軸には紐付けの状態を使う。
   * タグを引けるのは銘柄 101 の1本だけ = ピルの件数は1になる。
   */
  const two = [
    record({ id: 'a', brandLabel: '架空酒甲' }),
    record({
      id: 'b',
      brandLabel: '架空酒乙',
      sakenowaBrandId: null,
      brandName: null,
      linkStatus: 'unlinked',
      prefecture: null,
    }),
  ]

  it('絞り込みパネルを開くまで取得しない（開いたら1回だけ取る）', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue(two)
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)
    await screen.findByText('全 2本')

    // 起動時には取らない(22KB の parse を開かないセッションで走らせない)
    expect(getFlavorTagsMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '絞り込み' }))
    expect(getFlavorTagsMock).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: /^テスト味あ 1$/ })).toBeInTheDocument()

    // 閉じて開き直しても取り直さない
    await user.click(screen.getByRole('button', { name: '絞り込み' }))
    await user.click(screen.getByRole('button', { name: '絞り込み' }))
    expect(getFlavorTagsMock).toHaveBeenCalledTimes(1)
  })

  it('味タグが読めなくても一覧と他の絞り込みは効き、再試行で復帰する', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue(two)
    getTablesMock.mockResolvedValue(syntheticTables())
    getFlavorTagsMock.mockRejectedValue(new Error('オフライン'))

    render(<App />)
    await screen.findByText('全 2本')
    await user.click(screen.getByRole('button', { name: '絞り込み' }))

    expect(await screen.findByText('味タグを読み込めなかった')).toBeInTheDocument()
    // **記録は開ける**(味タグを 4表 に畳んでいたらここが「元データを読み込めていない」になる)
    expect(screen.queryAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '記録する' })).toBeInTheDocument()
    // 他の軸は生きている(味タグの状態と無関係に絞れる)
    await user.click(screen.getByRole('button', { name: /^自動 1$/ }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)

    getFlavorTagsMock.mockResolvedValue(syntheticFlavorTags())
    await user.click(screen.getByRole('button', { name: '再試行' }))

    expect(await screen.findByRole('button', { name: /^テスト味あ 1$/ })).toBeInTheDocument()
  })
})

/**
 * 5つ目のタブ「知る」の配線。**器(AppShell / tabs / App の分岐)を通したときだけ見えること**を
 * 固定する。ページの中身は `ui/Learn/Learn.test.tsx` が持つのでここでは繰り返さない。
 *
 * ラベルの期待値は `TABS` から導出せず**リテラルで並べる**(配列から作ると、配列を壊しても
 * 期待値が一緒に壊れて常に緑になる)。件数を見ているのは `AppShell` の `grid-cols-5` が
 * タブの本数と対応しているかを人が気付ける唯一の場所だから。
 */
describe('「知る」タブの配線', () => {
  function navLabels(): string[] {
    return [...document.querySelectorAll('nav button')].map((button) => button.textContent ?? '')
  }

  it('下端のタブは5つで、「知る」が最後にある', async () => {
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)
    await screen.findByText('全 1本')

    expect(navLabels()).toEqual(['記録', '統計', '味', '産地', '知る'])
  })

  it('記録が読めなくても開ける（説明のページ自体が読めなくならない）', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockRejectedValue(new Error('保存領域を開けない'))
    getTablesMock.mockRejectedValue(new Error('オフライン'))

    render(<App />)
    await screen.findByText('記録を読み込めなかった')

    await user.click(screen.getByRole('button', { name: '知る' }))

    // 記録も同梱テーブルも落ちている状態で中身が出る(集計タブと同じ面を通していない証拠)
    expect(await screen.findByRole('region', { name: '知る' })).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: '知るの内容' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '日本酒の種類' })).toBeInTheDocument()
    expect(screen.queryByText('記録を読み込めなかった')).toBeNull()
  })

  it('CC-BY のクレジットはフッタから消え、「知る」から辿れる', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)
    await screen.findByText('全 1本')

    // フッタは さけのわ の1行だけ。CC-BY の4項目は全画面から消えている
    expect(screen.getByText('さけのわデータを利用しています')).toBeInTheDocument()
    expect(screen.queryByText(/Victor Cazanave/)).toBeNull()

    // フッタのボタンが「知る」へ連れて行く(ここが未配線でもフッタ単体テストは緑になる)
    await user.click(screen.getByRole('button', { name: '出典とライセンス' }))

    expect(await screen.findByRole('region', { name: '知る' })).toBeInTheDocument()
    // **出典を含むタブ(アプリ)が開いた状態で着く**。既定のタブで着くと、押したラベルの
    // 行き先が画面に無い(下位タブに割った時点で「スクロールすれば読める」も成り立たない)
    expect(screen.getByRole('tab', { name: 'アプリ', selected: true })).toBeInTheDocument()
    expect(screen.getByText(/Victor Cazanave/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '知る' })).toHaveAttribute('aria-current', 'page')
  })

  /**
   * さけのわの利用条件は「**データを利用している箇所に併記する** / 1画面で何箇所使っていても
   * 表示は1箇所にまとめてよい」。**5タブすべてがさけのわのデータで動く**ので、
   * 5画面それぞれに1行が要る。
   *
   * ここに置く理由: `Attribution.test.tsx` は部品が文言を出すことしか見ておらず、
   * `AppShell` が `<main>` の外(タブごとの分岐の中)にフッタを移しても緑のままになる。
   * 実台帳での通し(`src/integration/screens.test.tsx`)は `data/seed/` が無い CI では skip される
   * ので、**CI で走るこのテストが唯一の併記の証拠**になる(CC-BY 側で同じ穴を踏んだ)。
   */
  it('さけのわのクレジットは5タブすべてのフッタに出る', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)
    await screen.findByText('全 1本')

    // タブのラベルはリテラルで書く(`TABS` から回すと、タブが1つ消えても緑になる)
    for (const label of ['記録', '統計', '味', '産地', '知る']) {
      await user.click(screen.getByRole('button', { name: label }))
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-current', 'page')
      // 1画面に1つだけ(`getByRole` は複数あると落ちる)。リンク先もリテラルで確かめる
      expect(
        screen.getByRole('link', { name: 'さけのわデータを利用しています' }),
        `${label} タブのフッタ`,
      ).toHaveAttribute('href', 'https://sakenowa.com')
    }
  })
})

describe('空状態の導線', () => {
  it('空状態からでも取り込み画面は開ける(主要導線が空振りしない)', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)
    await screen.findByText('まだ1本も記録が無い')

    await user.click(screen.getByRole('button', { name: 'JSON を取り込む' }))

    expect(
      await screen.findByRole('dialog', { name: 'インポート / エクスポート' }),
    ).toBeInTheDocument()
  })
})

describe('記録の作成', () => {
  it('空状態の導線からフォームが開き、保存すると閉じて一覧を読み直す', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([])
    getTablesMock.mockResolvedValue(syntheticTables())
    createRecordMock.mockResolvedValue(record({ id: 'created' }))

    render(<App />)
    await screen.findByText('まだ1本も記録が無い')

    await user.click(screen.getByRole('button', { name: '1本目を記録する' }))
    const dialog = await screen.findByRole('dialog', { name: '記録を追加' })

    // 必須は日付だけで、既定は「今日」。銘柄を書かずに保存できる(推定で紐付けない)
    listRecordsMock.mockResolvedValue([record({ id: 'created' })])
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(createRecordMock).toHaveBeenCalledTimes(1)
    const draft = createRecordMock.mock.calls[0][0]
    // アプリで作った記録は元ログの No. を持たない(並び順の第3キー)
    expect(draft.sourceNo).toBeNull()
    // 銘柄が空 = `unknown`。空文字の銘柄名を `unlinked` として保存しない
    expect(draft.linkStatus).toBe('unknown')

    // 成功したときだけ閉じ、一覧は読み直した結果で描き替わる
    expect(await screen.findByText('全 1本')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '記録を追加' })).toBeNull()
  })

  it('一覧があるときも主画面から記録できる(見出し機能の入口を空状態に閉じ込めない)', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)
    await screen.findByText('全 1本')

    await user.click(screen.getByRole('button', { name: '記録する' }))

    expect(await screen.findByRole('dialog', { name: '記録を追加' })).toBeInTheDocument()
  })

  it('保存が失敗したら閉じずに理由を出す(消えた入力を作らない)', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())
    createRecordMock.mockRejectedValue(new Error('保存領域がいっぱい'))

    render(<App />)
    await screen.findByText('全 1本')
    await user.click(screen.getByRole('button', { name: '記録する' }))
    const dialog = await screen.findByRole('dialog', { name: '記録を追加' })

    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(await within(dialog).findByText(/保存領域がいっぱい/)).toBeInTheDocument()
    // 開いたまま(打った内容が残っている)
    expect(screen.getByRole('dialog', { name: '記録を追加' })).toBeInTheDocument()
  })

  // PHASE_7 の完了条件「`navigator.storage.persist()` を初回書き込み時に要求」(B7)。
  // 取り込み経路(`ImportExportPanel`)には既に配線されているが、**フォームから1本目を作る人**は
  // 取り込み画面を一度も開かない。この経路が無いと、その人の記録は永続化を一度も要求されないまま
  // ブラウザの自動退避の対象で居続ける。
  it('1本目の保存でストレージの永続化を要求する(取り込みを使わない人も要求される)', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([])
    getTablesMock.mockResolvedValue(syntheticTables())
    createRecordMock.mockResolvedValue(record({ id: 'created' }))
    requestPersistenceMock.mockResolvedValue('denied')

    render(<App />)
    await screen.findByText('まだ1本も記録が無い')
    await user.click(screen.getByRole('button', { name: '1本目を記録する' }))
    const dialog = await screen.findByRole('dialog', { name: '記録を追加' })

    listRecordsMock.mockResolvedValue([record({ id: 'created' })])
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(await screen.findByText('全 1本')).toBeInTheDocument()
    expect(requestPersistenceMock).toHaveBeenCalledTimes(1)
  })

  it('2本目からは永続化を要求しない(許可を尋ねるブラウザで保存のたびに訊かない)', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())
    createRecordMock.mockResolvedValue(record({ id: 'created' }))

    render(<App />)
    await screen.findByText('全 1本')
    await user.click(screen.getByRole('button', { name: '記録する' }))
    const dialog = await screen.findByRole('dialog', { name: '記録を追加' })

    listRecordsMock.mockResolvedValue([record({ id: 'a' }), record({ id: 'created' })])
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(await screen.findByText('全 2本')).toBeInTheDocument()
    expect(requestPersistenceMock).not.toHaveBeenCalled()
  })

  it('永続化の要求が失敗しても保存は成功のまま閉じる(要求は保存の付随物)', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([])
    getTablesMock.mockResolvedValue(syntheticTables())
    createRecordMock.mockResolvedValue(record({ id: 'created' }))
    requestPersistenceMock.mockRejectedValue(new Error('storage manager が壊れている'))

    render(<App />)
    await screen.findByText('まだ1本も記録が無い')
    await user.click(screen.getByRole('button', { name: '1本目を記録する' }))
    const dialog = await screen.findByRole('dialog', { name: '記録を追加' })

    listRecordsMock.mockResolvedValue([record({ id: 'created' })])
    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(await screen.findByText('全 1本')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '記録を追加' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('元データが未着ならフォームを開かず理由を出す(空のサジェストで嘘をつかない)', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockRejectedValue(new Error('オフライン'))

    render(<App />)
    await screen.findByText('全 1本')

    await user.click(screen.getByRole('button', { name: '記録する' }))

    expect(screen.queryByRole('dialog', { name: '記録を追加' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toMatch(/銘柄の元データ/)
  })
})

describe('記録の編集と削除', () => {
  it('詳細から編集フォームが開き、保存すると同じ記録が更新される', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([record({ id: 'a', place: '自宅' })])
    getTablesMock.mockResolvedValue(syntheticTables())
    updateRecordMock.mockResolvedValue(record({ id: 'a', place: '自宅' }))

    render(<App />)
    await user.click(await screen.findByRole('button', { name: /テスト酒/ }))
    await screen.findByRole('dialog', { name: '記録の詳細' })

    await user.click(screen.getByRole('button', { name: '編集' }))
    const dialog = await screen.findByRole('dialog', { name: '記録を編集' })
    // 既存の値が入っている(新規フォームが開いていない)
    expect(within(dialog).getByDisplayValue('自宅')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(updateRecordMock).toHaveBeenCalledTimes(1)
    expect(updateRecordMock.mock.calls[0][0]).toBe('a')
    // 銘柄欄に触っていないので、機械が当てた `auto` を `manual` に書き換えない
    expect(updateRecordMock.mock.calls[0][1].linkStatus).toBe('auto')
    expect(createRecordMock).not.toHaveBeenCalled()
  })

  // App が `key={editingId ?? 'new'}` を渡していることを**呼び側の位置で**固定する。
  // `RecordForm.test.tsx` の「編集フォームの同一性」は部品に key を渡す/渡さないの違いしか
  // 見ていないので、App から key を消しても部品のテストは全部緑のまま通る(実演済み)。
  //
  // 経路: 編集フォームを開いたまま一覧の別の行を押す → 詳細がその記録に替わる →
  // 「編集」で `editingId` が別の id に変わる。**実ブラウザでは背景(Overlay の backdrop)が
  // 手前にあるので今この経路をマウスでは踏めない**が、切り替わったときに前の入力が残らない
  // ことは App の配線の約束で、詳細に前後移動を足した瞬間に前の記録の入力が別の記録へ
  // 無音で保存される(brain の既知事故)。key を消すとこのテストだけが赤くなる。
  it('編集フォームを開いたまま別の記録に切り替えても、前の記録の入力を持ち越さない', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([
      record({ id: 'a', brandLabel: '架空酒甲', brandName: '架空酒甲', place: '甲店' }),
      record({ id: 'b', brandLabel: '架空酒乙', brandName: '架空酒乙', place: '乙店' }),
    ])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)
    await screen.findByText('全 2本')

    await user.click(screen.getByRole('button', { name: /架空酒甲/ }))
    await user.click(await screen.findByRole('button', { name: '編集' }))
    const first = await screen.findByRole('dialog', { name: '記録を編集' })
    await user.type(within(first).getByLabelText('場所・店名'), 'に追記')
    expect(within(first).getByLabelText('場所・店名')).toHaveValue('甲店に追記')

    // 一覧の別の行 → 詳細が切り替わり、そこから編集を開くと editingId が 'b' に変わる
    await user.click(screen.getByRole('button', { name: /架空酒乙/ }))
    await user.click(screen.getByRole('button', { name: '編集' }))

    const second = await screen.findByRole('dialog', { name: '記録を編集' })
    expect(within(second).getByLabelText('場所・店名')).toHaveValue('乙店')

    // 保存先も切り替わっている(前の記録の入力で別の記録を上書きしない)
    updateRecordMock.mockResolvedValue(record({ id: 'b', place: '乙店' }))
    await user.click(within(second).getByRole('button', { name: '保存' }))

    expect(updateRecordMock).toHaveBeenCalledTimes(1)
    expect(updateRecordMock.mock.calls[0][0]).toBe('b')
    expect(updateRecordMock.mock.calls[0][1].place).toBe('乙店')
  })

  it('削除は自作の確認ダイアログを経てから store に届く', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())
    deleteRecordMock.mockResolvedValue(undefined)

    render(<App />)
    await user.click(await screen.findByRole('button', { name: /テスト酒/ }))
    await screen.findByRole('dialog', { name: '記録の詳細' })

    await user.click(screen.getByRole('button', { name: '削除' }))
    // OS の confirm() ではなく自作のダイアログ。押すまでは1件も消さない
    const confirm = await screen.findByRole('dialog', { name: '記録を削除する' })
    expect(deleteRecordMock).not.toHaveBeenCalled()

    listRecordsMock.mockResolvedValue([])
    await user.click(within(confirm).getByRole('button', { name: '削除する' }))

    expect(deleteRecordMock).toHaveBeenCalledWith('a')
    // 消した記録の詳細を残さず、一覧は読み直した結果になる
    expect(await screen.findByText('まだ1本も記録が無い')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '記録の詳細' })).toBeNull()
  })

  it('削除が失敗したら一覧から消さずに理由を出す', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())
    deleteRecordMock.mockRejectedValue(new Error('保存領域を開けない'))

    render(<App />)
    await user.click(await screen.findByRole('button', { name: /テスト酒/ }))
    await user.click(await screen.findByRole('button', { name: '削除' }))
    const confirm = await screen.findByRole('dialog', { name: '記録を削除する' })
    await user.click(within(confirm).getByRole('button', { name: '削除する' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/削除できなかった/)
    expect(screen.getByText('全 1本')).toBeInTheDocument()
  })
})

describe('手動紐付けの導線', () => {
  it('未紐付けの行から開ける。紐付いている行には行の導線を出さない', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([
      record({ id: 'a' }),
      record({
        id: 'b',
        brandLabel: '架空酒',
        sakenowaBrandId: null,
        brandName: null,
        linkStatus: 'unlinked',
        prefecture: null,
      }),
    ])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)
    await screen.findByText('全 2本')

    // 2本のうち導線が出るのは未紐付けの1本だけ
    const entries = screen.getAllByRole('button', { name: '手動で紐付ける' })
    expect(entries).toHaveLength(1)

    await user.click(entries[0])

    expect(await screen.findByRole('dialog', { name: '手動で紐付ける' })).toBeInTheDocument()
  })

  it('紐付け済みの記録も詳細から見直せる(本人の判断を取り消す入口を残す)', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)
    await user.click(await screen.findByRole('button', { name: /テスト酒/ }))
    await screen.findByRole('dialog', { name: '記録の詳細' })

    await user.click(screen.getByRole('button', { name: '紐付けを見直す' }))

    expect(await screen.findByRole('dialog', { name: '手動で紐付ける' })).toBeInTheDocument()
  })
})

// 同期で降りてきたメモが画面に出るまで。**層ごとに緑でも配線は結線しないと分からない** —
// メモを足したとき、同期の後に読み直すのが記録だけになっていて、
// 降りてきたメモは IndexedDB に入っているのに再読み込みするまで画面に出なかった
describe('同期で降りてきたメモを画面に出す', () => {
  function storedNote(text: string) {
    return {
      key: `brand${'\u0000'}101`,
      target: 'brand' as const,
      targetId: 101,
      text,
      updatedAt: '2026-08-02T00:00:00.000Z',
    }
  }

  it('同期のあとにメモを読み直し、開いている記録の詳細に出る', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())
    // 起動時は0件。同期が終わってから1件になる、という並びを作る
    listNotesMock.mockResolvedValueOnce([]).mockResolvedValue([storedNote('別の端末で書いた')])
    syncMock.mockResolvedValue({
      status: 'done',
      result: {
        applied: 0,
        removed: 0,
        pushed: 0,
        localRecords: 1,
        conflicts: [],
        messages: [],
        startedAt: '2026-08-02T00:00:00.000Z',
      },
    })

    render(<App />)
    await user.click(await screen.findByText('テスト酒'))

    // **`loadMemos` を呼ばないと、ここに古い(0件の)状態が出たままになる**
    expect(await screen.findByDisplayValue('別の端末で書いた')).toBeInTheDocument()
  })
})

// **書いたものが端末から出るのは同期のとき。** 書き込みの経路ごとに sync() を書いていると
// 足した日に1箇所だけ抜ける。実際メモを足したとき、保存も削除も同期を蹴っておらず、
// 書いたメモがアプリを開き直すまで端末から出なかった(スマホ→PC で届かない、として表面化)
describe('書いたあとに同期を試す', () => {
  function ready() {
    listRecordsMock.mockResolvedValue([record({ id: 'a' })])
    getTablesMock.mockResolvedValue(syntheticTables())
  }

  /** 起動時の同期を1回数えたあと、そこからの増分を見る */
  async function callsAfter(action: () => Promise<void>): Promise<number> {
    const before = syncMock.mock.calls.length
    await action()
    return syncMock.mock.calls.length - before
  }

  it('メモを保存すると同期を試す', async () => {
    const user = userEvent.setup()
    ready()
    render(<App />)
    await user.click(await screen.findByText('テスト酒'))

    const added = await callsAfter(async () => {
      await user.type(screen.getByLabelText('テスト酒（銘柄）のメモ'), 'あ')
      await user.click(screen.getAllByRole('button', { name: '保存する' })[0]!)
    })
    expect(added).toBeGreaterThan(0)
  })

  it('メモを消すと同期を試す', async () => {
    const user = userEvent.setup()
    ready()
    listNotesMock.mockResolvedValue([
      {
        key: `brand${'\u0000'}101`,
        target: 'brand' as const,
        targetId: 101,
        text: 'ある',
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
    ])
    render(<App />)
    await user.click(await screen.findByText('テスト酒'))

    const added = await callsAfter(async () => {
      await user.click(screen.getAllByRole('button', { name: '消す' })[0]!)
    })
    expect(added).toBeGreaterThan(0)
  })

  it('記録を消すと同期を試す', async () => {
    const user = userEvent.setup()
    ready()
    deleteRecordMock.mockResolvedValue(undefined)
    render(<App />)
    await user.click(await screen.findByText('テスト酒'))

    const added = await callsAfter(async () => {
      await user.click(screen.getByRole('button', { name: '削除' }))
      await user.click(screen.getByRole('button', { name: '削除する' }))
    })
    expect(added).toBeGreaterThan(0)
  })
})
