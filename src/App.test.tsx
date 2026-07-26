// App が持っているのは配線だけ。単体テストが層ごとに緑でも、**落ちた側だけを名指しできているか**と
// **書き込みの後に一覧を読み直しているか**は結線しないと分からないのでここで固定する:
//
//  1. 記録(IndexedDB)が読めないときに**無音で空リストを出さない**(0本と「読めなかった」を
//     同じ見た目にすると、台帳が消えたのか読めないのかが区別できない)。再試行で復帰する
//  2. さけのわの同梱テーブル(fetch)が落ちても**一覧は出る**。ただし詳細・記録の作成・
//     手動紐付けは開けない(空のテーブルで「データ無し」と嘘をつかない)
//  3. 作成 / 編集 / 削除 / 手動紐付けが store に届き、**成功したときだけ画面を閉じて
//     一覧を読み直す**。削除は自作の確認ダイアログを経る(OS の `confirm()` は使わない)
//
// store は差し替えるが `importOriginal` で残りは実物を使う(Timeline が同じモジュールから
// `byNewestFirst` を import しているので、モジュールを丸ごと置き換えると並び替えが消える)。
//
// データは全部合成。日付リテラルは1種類に留める(BACKLOG B22 の台帳ガード)。

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.tsx'
import { decodeTables, type DecodedTables } from './data/tables.ts'
import type { SakeRecord } from './domain/types.ts'
import { getTables } from './store/linking.ts'
import { requestPersistentStorage } from './store/meta.ts'
import { createRecord, deleteRecord, listRecords, updateRecord } from './store/records.ts'

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

vi.mock('./store/linking.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./store/linking.ts')>()
  return { ...actual, getTables: vi.fn(), invalidateTables: vi.fn() }
})

const listRecordsMock = vi.mocked(listRecords)
const getTablesMock = vi.mocked(getTables)
const createRecordMock = vi.mocked(createRecord)
const updateRecordMock = vi.mocked(updateRecord)
const deleteRecordMock = vi.mocked(deleteRecord)
const requestPersistenceMock = vi.mocked(requestPersistentStorage)

/** 銘柄1件だけの合成テーブル。復号は実物を通す(索引の作り方を二重実装しない) */
function syntheticTables(): DecodedTables {
  return decodeTables({
    areas: { copyright: 'synthetic', rows: ['その他', '北海道'] },
    breweries: { copyright: 'synthetic', rows: [[11, 'テスト酒造', 1]] },
    brands: { copyright: 'synthetic', rows: [[101, 'テスト酒', 11]] },
    flavorCharts: { copyright: 'synthetic', rows: [[101, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]] },
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
})

afterEach(() => {
  vi.restoreAllMocks()
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
