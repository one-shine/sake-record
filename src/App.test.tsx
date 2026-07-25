// App が持っているのは「2つの非同期資源を独立に扱う」配線だけ。単体テストが層ごとに緑でも、
// **落ちた側だけを名指しできているか**は結線しないと分からないのでここで固定する:
//
//  1. 記録(IndexedDB)が読めないときに**無音で空リストを出さない**(0本と「読めなかった」を
//     同じ見た目にすると、台帳が消えたのか読めないのかが区別できない)。再試行で復帰する
//  2. さけのわの同梱テーブル(fetch)が落ちても**一覧は出る**。ただし詳細は開けない
//     (空のテーブルで「データ無し」と嘘をつかない)
//  3. まだ無い操作(記録フォーム)は告知を返す。**押しても無反応のボタンを作らない**
//
// store は差し替えるが `importOriginal` で残りは実物を使う(Timeline が同じモジュールから
// `byNewestFirst` を import しているので、モジュールを丸ごと置き換えると並び替えが消える)。
//
// データは全部合成。日付リテラルは1種類に留める(BACKLOG B22 の台帳ガード)。

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.tsx'
import { decodeTables, type DecodedTables } from './data/tables.ts'
import type { SakeRecord } from './domain/types.ts'
import { getTables } from './store/linking.ts'
import { listRecords } from './store/records.ts'

vi.mock('./store/records.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./store/records.ts')>()
  return { ...actual, listRecords: vi.fn(), deleteRecord: vi.fn() }
})

vi.mock('./store/linking.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./store/linking.ts')>()
  return { ...actual, getTables: vi.fn(), invalidateTables: vi.fn() }
})

const listRecordsMock = vi.mocked(listRecords)
const getTablesMock = vi.mocked(getTables)

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
  // Overlay は閉じるときに history.back() を予約する。実際に戻すとテスト間で popstate が飛ぶ
  vi.spyOn(window.history, 'back').mockImplementation(() => {})
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

describe('まだ無い操作', () => {
  it('押すと何が無いかを告知する(dead button を作らない)', async () => {
    const user = userEvent.setup()
    listRecordsMock.mockResolvedValue([])
    getTablesMock.mockResolvedValue(syntheticTables())

    render(<App />)
    await screen.findByText('まだ1本も記録が無い')

    await user.click(screen.getByRole('button', { name: '1本目を記録する' }))

    const dialog = await screen.findByRole('dialog', { name: 'この操作はまだ使えない' })
    // 開発フェーズ名(Phase n)を UI に出さない。今できること(取り込み)を書く
    expect(dialog.textContent).not.toMatch(/Phase/i)
    expect(dialog.textContent).toMatch(/取り込み/)
  })

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
