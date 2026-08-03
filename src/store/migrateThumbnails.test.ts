// @vitest-environment node
//
// 保存形の版上げ(B72)の検証。**node 環境で回す**(db.test.ts と同じ理由)。
//
// ここで守っているのは3つ。どれも壊れ方が「気付けない」形をしている:
//   1. **Blob が残らない** — 残ると iOS で実体だけが失われるという事故がそのまま続く
//   2. **更新時刻が動かない** — 動かすと203件が「本人がいま編集した」ことになり、
//      次の同期で別端末の新しい編集を全部倒す
//   3. **読めなかった写真を黙って消さない** — 同期先に良い複製が在るのに二度と取りに行かない
//
// テストデータはすべて合成。実際の飲酒記録を転記しない。
import { indexedDB as fakeIndexedDB, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SakeRecord } from '../domain/types.ts'
import { clearAll, closeDb, get, getAll, put } from './db.ts'
import { getThumbnailRepairs } from './meta.ts'
import {
  describeThumbnailMigration,
  ensureThumbnailsMigrated,
  migrateThumbnailsToBytes,
  resetThumbnailMigrationForTest,
} from './migrateThumbnails.ts'
import { listRecords } from './records.ts'

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

const UPDATED_AT = '2026-01-01T00:00:00.000Z'

function record(over: Partial<SakeRecord> = {}): SakeRecord {
  return {
    id: 'r1',
    drankOn: '2026-01-01',
    brandLabel: 'てすとしゅ',
    sakenowaBrandId: null,
    brandName: null,
    linkStatus: 'unlinked',
    prefecture: null,
    spec: '',
    rating: null,
    place: '',
    note: '',
    thumbnail: null,
    sourceNo: null,
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    ...over,
  }
}

/** 版上げ前の形。**型の上では通らない**ので、ここでだけ嘘をつく */
const oldBlob = (bytes: readonly number[]): ArrayBuffer =>
  new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }) as unknown as ArrayBuffer

const bytesOf = (buffer: ArrayBuffer | null | undefined): number[] =>
  buffer === null || buffer === undefined ? [] : [...new Uint8Array(buffer)]

beforeEach(async () => {
  resetThumbnailMigrationForTest()
  vi.restoreAllMocks()
  await clearAll()
})

afterAll(() => {
  closeDb()
})

describe('環境の前提', () => {
  it('fake-indexeddb は Blob をそのまま往復させる(版上げ前の状態を作れる)', async () => {
    await put('records', record({ id: 'a', thumbnail: oldBlob([1, 2, 3]) }))
    const stored = await get('records', 'a')
    expect(stored?.thumbnail).toBeInstanceOf(Blob)
  })
})

describe('migrateThumbnailsToBytes', () => {
  it('Blob をバイト列に移す(中身は1バイトも変わらない)', async () => {
    const bytes = [255, 216, 255, 224, 0, 16]
    await put('records', record({ id: 'a', thumbnail: oldBlob(bytes) }))

    const result = await migrateThumbnailsToBytes()

    expect(result).toEqual({ moved: 1, lost: [] })
    const moved = (await get('records', 'a'))?.thumbnail
    expect(moved).toBeInstanceOf(ArrayBuffer)
    expect(bytesOf(moved)).toEqual(bytes)
  })

  // **動かすと203件が「いま編集した」ことになり、次の同期で別端末の編集を全部倒す**
  it('更新時刻を動かさない(保存形の変換であって記録の変更ではない)', async () => {
    await put('records', record({ id: 'a', thumbnail: oldBlob([1]) }))

    await migrateThumbnailsToBytes()

    const moved = await get('records', 'a')
    expect(moved?.updatedAt).toBe(UPDATED_AT)
    expect(moved?.createdAt).toBe(UPDATED_AT)
  })

  it('写真以外の項目を書き換えない', async () => {
    const original = record({ id: 'a', rating: 4, place: '架空の店', note: 'めも' })
    await put('records', { ...original, thumbnail: oldBlob([9]) })

    await migrateThumbnailsToBytes()

    const moved = await get('records', 'a')
    expect({ ...moved, thumbnail: null }).toEqual({ ...original, thumbnail: null })
  })

  it('写真の無い記録には触らない', async () => {
    await put('records', record({ id: 'a', thumbnail: null }))

    expect(await migrateThumbnailsToBytes()).toEqual({ moved: 0, lost: [] })
    expect((await get('records', 'a'))?.thumbnail).toBeNull()
  })

  // **何度でも呼ばれる**(起動のたびに通る)。移し終わった行を毎回書き戻さない
  it('既にバイト列の行は書き直さない', async () => {
    await put('records', record({ id: 'a', thumbnail: new Uint8Array([1, 2]).buffer }))

    expect(await migrateThumbnailsToBytes()).toEqual({ moved: 0, lost: [] })
    expect(bytesOf((await get('records', 'a'))?.thumbnail)).toEqual([1, 2])
  })

  it('2回続けて呼んでも2回目は何もしない(冪等)', async () => {
    await put('records', record({ id: 'a', thumbnail: oldBlob([1, 2, 3]) }))

    expect(await migrateThumbnailsToBytes()).toEqual({ moved: 1, lost: [] })
    expect(await migrateThumbnailsToBytes()).toEqual({ moved: 0, lost: [] })
    expect(bytesOf((await get('records', 'a'))?.thumbnail)).toEqual([1, 2, 3])
  })

  it('移す行と移さない行が混ざっていても取り違えない', async () => {
    await put('records', record({ id: 'blob', thumbnail: oldBlob([1]) }))
    await put('records', record({ id: 'bytes', thumbnail: new Uint8Array([2]).buffer }))
    await put('records', record({ id: 'none', thumbnail: null }))

    expect(await migrateThumbnailsToBytes()).toEqual({ moved: 1, lost: [] })

    expect(bytesOf((await get('records', 'blob'))?.thumbnail)).toEqual([1])
    expect(bytesOf((await get('records', 'bytes'))?.thumbnail)).toEqual([2])
    expect((await get('records', 'none'))?.thumbnail).toBeNull()
    expect(await getAll('records')).toHaveLength(3)
  })
})

// **移行の時点で既に実体を失っている Blob がありうる**(まさに B72 で踏んだ状態)。
// バイト列にできない以上 null にするしかないが、**その事実を残さないと写真が黙って消える**
describe('実体を読めなかったとき', () => {
  /** 読めない Blob の再現。個々の Blob に細工しても保存で消えるのでプロトタイプ側に仕掛ける */
  function breakBlobReads(): void {
    vi.spyOn(Blob.prototype, 'arrayBuffer').mockRejectedValue(new Error('blob の実体が無い'))
  }

  it('null にして、同期先から取り直す待ち行列に積む', async () => {
    await put('records', record({ id: 'lost', thumbnail: oldBlob([1, 2, 3]) }))
    breakBlobReads()

    const result = await migrateThumbnailsToBytes()

    expect(result).toEqual({ moved: 0, lost: ['lost'] })
    expect((await get('records', 'lost'))?.thumbnail).toBeNull()
    // 積まないと、同期先に良い複製が在るのに二度と取りに行かない
    expect(await getThumbnailRepairs()).toEqual(['lost'])
  })

  // 0バイトは「読めた」ではない。送ると同期先の良い複製を 0 バイトで壊す
  it('中身が空だったら読めなかったのと同じ扱いにする', async () => {
    await put('records', record({ id: 'empty', thumbnail: oldBlob([]) }))

    const result = await migrateThumbnailsToBytes()

    expect(result).toEqual({ moved: 0, lost: ['empty'] })
    expect(await getThumbnailRepairs()).toEqual(['empty'])
  })

  it('読めた行の移行は止めない(1枚のために全部を諦めない)', async () => {
    await put('records', record({ id: 'ok', thumbnail: oldBlob([7, 7]) }))
    await put('records', record({ id: 'empty', thumbnail: oldBlob([]) }))

    const result = await migrateThumbnailsToBytes()

    expect(result.moved).toBe(1)
    expect(result.lost).toEqual(['empty'])
    expect(bytesOf((await get('records', 'ok'))?.thumbnail)).toEqual([7, 7])
  })

  it('読めなかった記録も更新時刻は動かさない(同期で他端末を倒さない)', async () => {
    await put('records', record({ id: 'empty', thumbnail: oldBlob([]) }))

    await migrateThumbnailsToBytes()

    expect((await get('records', 'empty'))?.updatedAt).toBe(UPDATED_AT)
  })
})

describe('ensureThumbnailsMigrated — 呼ぶ側に判断を持たせない', () => {
  it('何度呼んでも移行は1回だけ走る', async () => {
    await put('records', record({ id: 'a', thumbnail: oldBlob([1]) }))

    const [first, second] = await Promise.all([
      ensureThumbnailsMigrated(),
      ensureThumbnailsMigrated(),
    ])

    expect(first).toBe(second)
    expect(first.moved).toBe(1)
  })

  // **移行できないことと記録が読めないことは別。** 後者にすると、写真の版上げに失敗した端末で
  // 一覧が丸ごと出なくなる
  it('移行が失敗しても投げない(記録の読み込みを止めない)', async () => {
    await put('records', record({ id: 'a', thumbnail: oldBlob([1]) }))
    // 失敗の作り方は何でもよい。DB そのものを引けなくする
    closeDb()
    const real = globalThis.indexedDB
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true })

    await expect(ensureThumbnailsMigrated()).resolves.toEqual({ moved: 0, lost: [] })

    // 失敗した promise を掴んだままにしない(次の起動でもう一度試せる)
    Object.defineProperty(globalThis, 'indexedDB', { value: real, configurable: true })
    resetThumbnailMigrationForTest()
    await expect(ensureThumbnailsMigrated()).resolves.toEqual({ moved: 1, lost: [] })
  })

  // **記録を読む道の入口で済ませる。** 呼び側に任せると、経路を足した日に1箇所だけ抜ける
  it('listRecords が移行を先に済ませる(古い形を画面に渡さない)', async () => {
    await put('records', record({ id: 'a', thumbnail: oldBlob([4, 5]) }))

    const listed = await listRecords()

    expect(listed[0].thumbnail).toBeInstanceOf(ArrayBuffer)
    expect(bytesOf(listed[0].thumbnail)).toEqual([4, 5])
    // 画面に渡すだけでなく、端末の保存形も移っている
    expect((await get('records', 'a'))?.thumbnail).toBeInstanceOf(ArrayBuffer)
  })
})

describe('describeThumbnailMigration', () => {
  // **本人が頼んだ操作ではない。** 成功を毎回報告すると、次に本当の警告が出たときに読まれない
  it('移せただけなら何も言わない', () => {
    expect(describeThumbnailMigration({ moved: 3, lost: [] })).toBeNull()
  })

  it('読めなかった分は件数と打てる手を言う(黙って消さない)', () => {
    const message = describeThumbnailMigration({ moved: 2, lost: ['a', 'b'] })
    expect(message).toContain('2 件')
    // 同期している端末とそうでない端末の両方に道を示す
    expect(message).toContain('同期先')
    expect(message).toContain('バックアップ')
  })
})
