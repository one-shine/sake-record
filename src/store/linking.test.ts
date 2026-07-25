// @vitest-environment node
//
// **node 環境で回す(db.test.ts / records.test.ts と同じ理由)。** ここで見たいのは
// 「fetch とテーブルのキャッシュと IDB の runtime エイリアスの配線」だけで、DOM は要らない。
// jsdom を使わないことで、linking.ts に window/document が混ざった瞬間に落ちる。
//
// aliases.test.ts が「畳み方(mergeAliases)」を、linkBrand.test.ts が「照合そのもの」を
// 既に押さえている。このファイルが担当するのは linking.ts が足している3つだけ:
//   1. テーブルのキャッシュ(成功は共有し、**失敗は掴まない**)
//   2. runtime エイリアスを IDB から読む配線(手動紐付けが実際に効く経路)
//   3. 取得に失敗したときに**空テーブルの Linker に落ちない**こと
//      — 落ちると203本すべてが unlinked で保存され、しかも画面は正常に見える
//
// テーブルは6件の合成データ。実際の同梱データ(3264件)は tables.test.ts が見ているので
// ここでは「注入した表だけを見ている」ことが分かる最小の形にする。
// 実際の飲酒記録は一切使わない(日付リテラルも持たない)。
import { indexedDB as fakeIndexedDB, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb'
import type {
  AreasFile,
  BrandAlias,
  BrandsFile,
  BreweriesFile,
  FlavorChartsFile,
} from '../domain/types.ts'
import { clearAliases, putAlias } from './aliases.ts'
import { closeDb } from './db.ts'
import { buildLinker, getTables, invalidateTables } from './linking.ts'

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

// ---------------------------------------------------------------------------
// 合成した同梱データ(タプル形式のまま。loadTables → decodeTables を実際に通す)
// ---------------------------------------------------------------------------

/** areas.json は**添字が areaId**。0 は「その他」で都道府県ではない */
const AREAS: AreasFile = { copyright: 'synthetic', rows: ['その他', '北海道', '青森県'] }
const BREWERIES: BreweriesFile = {
  copyright: 'synthetic',
  rows: [
    [11, 'テスト酒造', 1],
    [12, 'テスト酒造(青森)', 2],
  ],
}
const BRANDS: BrandsFile = {
  copyright: 'synthetic',
  rows: [
    [101, 'テスト一', 11],
    [102, 'テスト二', 12],
  ],
}
const FLAVOR_CHARTS: FlavorChartsFile = {
  copyright: 'synthetic',
  rows: [[101, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]],
}

const FILES: Record<string, unknown> = {
  'areas.json': AREAS,
  'breweries.json': BREWERIES,
  'brands.json': BRANDS,
  'flavorCharts.json': FLAVOR_CHARTS,
}

/** URL の末尾のファイル名で合成データを返す fetch。呼ばれた URL を全部記録する */
function stubFetch(): { urls: string[] } {
  const urls: string[] = []
  vi.stubGlobal('fetch', (input: unknown) => {
    const url = String(input)
    urls.push(url)
    const name = url.slice(url.lastIndexOf('/') + 1)
    const body = FILES[name]
    if (body === undefined) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  })
  return { urls }
}

/** 何を要求されても失敗する fetch(オフライン相当) */
function stubOfflineFetch(): void {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
}

const TABLES = {
  brands: [
    { id: 101, name: 'テスト一', breweryId: 11 },
    { id: 102, name: 'テスト二', breweryId: 12 },
  ],
  breweries: [
    { id: 11, name: 'テスト酒造', areaId: 1 },
    { id: 12, name: 'テスト酒造(青森)', areaId: 2 },
  ],
  areas: [
    { id: 0, name: 'その他' },
    { id: 1, name: '北海道' },
    { id: 2, name: '青森県' },
  ],
}

const BUILTIN: BrandAlias[] = [{ label: 'てすと壱', prefecture: null, brandId: 101 }]

beforeEach(async () => {
  invalidateTables()
  vi.unstubAllGlobals()
  await clearAliases()
})

afterAll(() => {
  closeDb()
})

// ---------------------------------------------------------------------------
// テーブルのキャッシュ
// ---------------------------------------------------------------------------

describe('getTables のキャッシュ', () => {
  it('2回呼んでも fetch は4ファイル分だけで、同じ束を返す', async () => {
    const { urls } = stubFetch()

    const first = await getTables()
    const second = await getTables()

    expect(second).toBe(first)
    expect(urls).toHaveLength(4)
    expect(first.brandById.get(101)?.name).toBe('テスト一')
  })

  it('invalidateTables のあとは読み直す', async () => {
    const { urls } = stubFetch()
    await getTables()
    invalidateTables()

    await getTables()

    expect(urls).toHaveLength(8)
  })

  it('失敗した取得は掴まない(オフラインで1回失敗しても復帰後に読める)', async () => {
    stubOfflineFetch()
    await expect(getTables()).rejects.toThrow(/offline/)

    // 電波が戻った = fetch が成功するようになった状態。invalidate を呼ばずに読み直せること
    const { urls } = stubFetch()
    const tables = await getTables()

    expect(tables.brands).toHaveLength(2)
    expect(urls).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// Linker の組み立て
// ---------------------------------------------------------------------------

describe('buildLinker', () => {
  it('テーブルを注入すれば fetch しない', async () => {
    const { urls } = stubFetch()

    const link = await buildLinker({ tables: TABLES, runtimeAliases: [], builtinAliases: [] })

    expect(urls).toEqual([])
    expect(link('テスト一', null).status).toBe('auto')
    expect(link('テスト一', null).brandId).toBe(101)
  })

  it('注入した表に無い銘柄は unlinked に留まり、既定の銘柄に落ちない', async () => {
    const link = await buildLinker({ tables: TABLES, runtimeAliases: [], builtinAliases: [] })

    const result = link('存在しない銘柄', null)

    expect(result.status).toBe('unlinked')
    expect(result.brandId).toBeNull()
    expect(result.brandName).toBeNull()
  })

  it('IDB に保存した runtime エイリアスが効く(手動紐付けの経路)', async () => {
    await putAlias({ label: 'てすと弐', prefecture: null, brandId: 102 })

    const link = await buildLinker({ tables: TABLES, builtinAliases: BUILTIN })
    const result = link('てすと弐', null)

    expect(result.status).toBe('alias')
    expect(result.brandId).toBe(102)
    expect(result.brandName).toBe('テスト二')
  })

  it('同じキーでは runtime が builtin に勝つ', async () => {
    await putAlias({ label: 'てすと壱', prefecture: null, brandId: 102 })

    const link = await buildLinker({ tables: TABLES, builtinAliases: BUILTIN })

    expect(link('てすと壱', null).brandId).toBe(102)
  })

  it('呼ぶたびに組み直す(前回の Linker が古い表のまま残らない)', async () => {
    const before = await buildLinker({ tables: TABLES, builtinAliases: BUILTIN })
    expect(before('てすと弐', null).status).toBe('unlinked')

    // 本人がここで手動紐付けした、に相当する
    await putAlias({ label: 'てすと弐', prefecture: null, brandId: 102 })
    const after = await buildLinker({ tables: TABLES, builtinAliases: BUILTIN })

    expect(after('てすと弐', null).status).toBe('alias')
    // 既に組んだ関数は古い表を見ている(だからキャッシュしてはいけない)
    expect(before('てすと弐', null).status).toBe('unlinked')
  })

  it('テーブルが読めないときは拒否する(空テーブルの Linker に落ちない)', async () => {
    stubOfflineFetch()

    // 空テーブルに落ちると全件 unlinked の Linker が返り、203本が静かに未紐付けで保存される
    await expect(buildLinker({ runtimeAliases: [] })).rejects.toThrow(/offline/)
  })
})
