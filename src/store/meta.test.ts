// @vitest-environment node
//
// **node 環境で回す(db.test.ts / records.test.ts と同じ理由)。** jsdom 環境は jsdom の `Blob` と
// Node の `structuredClone` を混ぜるので store 層のテストが本番と別の経路になる。`meta` に入れる
// のは文字列だけなのでこのファイル自体は Blob を通らないが、**store 層のテストは環境を揃える**
// (1ファイルだけ jsdom にすると「どの環境で検証したか」が読めなくなる)。
//
// `navigator.storage` はスタブで作る。node にも jsdom にも実物は無いので、
// **「API が無い環境」も「拒否する環境」も自分で再現しない限り一度も検証できない**
// (iOS Safari の `persist()` 無視は手元で再現できない = ここが唯一の歯止め)。
//
// データはすべて合成。実際の飲酒記録は使わない(そもそも meta に記録は入らない)。

import { indexedDB as fakeIndexedDB, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb'
import { clear, closeDb, put } from './db.ts'
import {
  META_LAST_EXPORTED_AT,
  checkPersistentStorage,
  daysSince,
  getLastExportedAt,
  requestPersistentStorage,
  setLastExportedAt,
} from './meta.ts'

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
// 合成の時刻
// ---------------------------------------------------------------------------

/** 起点。合成の日時(台帳の日付ではない) */
const BASE = '2020-01-01T00:00:00.000Z'
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** 起点から `days` 日 + `hours` 時間後の時刻 */
function after(days: number, hours = 0): Date {
  return new Date(Date.parse(BASE) + days * DAY_MS + hours * HOUR_MS)
}

// ---------------------------------------------------------------------------
// navigator.storage のスタブ
// ---------------------------------------------------------------------------

type StorageStub = { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> }

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

/** `storage` に `null` を渡すと「`navigator.storage` が無い環境」になる */
function stubNavigator(storage: StorageStub | null): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: storage === null ? {} : { storage },
    configurable: true,
    writable: true,
  })
}

function restoreNavigator(): void {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
  else delete (globalThis as { navigator?: unknown }).navigator
}

// ---------------------------------------------------------------------------

describe('daysSince', () => {
  it('同日(数時間後)は0日', () => {
    expect(daysSince(BASE, after(0, 5))).toBe(0)
  })

  it('13日後は13', () => {
    expect(daysSince(BASE, after(13))).toBe(13)
  })

  it('14日後は14(注意のしきい値)', () => {
    expect(daysSince(BASE, after(14))).toBe(14)
  })

  it('29日後は29', () => {
    expect(daysSince(BASE, after(29))).toBe(29)
  })

  it('30日後は30(強めのしきい値)', () => {
    expect(daysSince(BASE, after(30))).toBe(30)
  })

  it('13日23時間は13(24時間単位で切り捨てる。暦日の差ではない)', () => {
    expect(daysSince(BASE, after(13, 23))).toBe(13)
  })

  it('未来の日時は0に丸める(負の日数を画面に出さない)', () => {
    expect(daysSince(after(3).toISOString(), new Date(Date.parse(BASE)))).toBe(0)
  })

  it('読めない日時は null(0 で埋めない)', () => {
    expect(daysSince('きのう', after(30))).toBeNull()
    expect(daysSince('', after(30))).toBeNull()
  })

  it('now が読めない Date でも null(NaN を日数として返さない)', () => {
    expect(daysSince(BASE, new Date(Number.NaN))).toBeNull()
  })
})

describe('lastExportedAt', () => {
  beforeEach(async () => {
    await clear('meta')
  })

  afterAll(() => {
    closeDb()
  })

  it('一度も書き出していなければ null', async () => {
    await expect(getLastExportedAt()).resolves.toBeNull()
  })

  it('書いた ISO 日時をそのまま読み戻す', async () => {
    await setLastExportedAt(BASE)

    await expect(getLastExportedAt()).resolves.toBe(BASE)
  })

  it('後から書いた値で上書きする(督促の起点は最新の1つだけ)', async () => {
    await setLastExportedAt(BASE)
    await setLastExportedAt(after(14).toISOString())

    await expect(getLastExportedAt()).resolves.toBe(after(14).toISOString())
  })

  it('ISO として読めない値は保存せずに例外(黙って督促を効かなくしない)', async () => {
    await expect(setLastExportedAt('きのう')).rejects.toThrow('ISO 8601 として読めない')

    await expect(getLastExportedAt()).resolves.toBeNull()
  })

  it('文字列でない値が入っていたら null に畳む(督促が強くなる側に寄せる)', async () => {
    // meta は unknown を入れられるストアなので、古い版や壊れた DB から数値が来得る
    await put('meta', 12345, META_LAST_EXPORTED_AT)

    await expect(getLastExportedAt()).resolves.toBeNull()
  })

  it('日時として読めない文字列が入っていたら null に畳む', async () => {
    await put('meta', 'きのう', META_LAST_EXPORTED_AT)

    await expect(getLastExportedAt()).resolves.toBeNull()
  })
})

describe('requestPersistentStorage', () => {
  afterEach(() => {
    restoreNavigator()
  })

  it('persist() が true なら granted', async () => {
    stubNavigator({ persist: () => Promise.resolve(true), persisted: () => Promise.resolve(false) })

    await expect(requestPersistentStorage()).resolves.toBe('granted')
  })

  it('persist() が false なら denied(iOS Safari が無視する経路。granted と偽らない)', async () => {
    stubNavigator({ persist: () => Promise.resolve(false), persisted: () => Promise.resolve(false) })

    await expect(requestPersistentStorage()).resolves.toBe('denied')
  })

  it('navigator.storage が無ければ unsupported(denied と区別する)', async () => {
    stubNavigator(null)

    await expect(requestPersistentStorage()).resolves.toBe('unsupported')
  })

  it('persist() を持たない storage も unsupported', async () => {
    stubNavigator({ persisted: () => Promise.resolve(false) })

    await expect(requestPersistentStorage()).resolves.toBe('unsupported')
  })

  it('既に永続化されていれば persist() を呼ばない(毎回プロンプトを出さない)', async () => {
    const persist = vi.fn(() => Promise.resolve(true))
    stubNavigator({ persist, persisted: () => Promise.resolve(true) })

    await expect(requestPersistentStorage()).resolves.toBe('granted')
    expect(persist).not.toHaveBeenCalled()
  })

  it('persisted() が無くても persist() だけで判定する', async () => {
    stubNavigator({ persist: () => Promise.resolve(true) })

    await expect(requestPersistentStorage()).resolves.toBe('granted')
  })

  it('例外は unsupported に寄せる(拒否されたとは言わない)', async () => {
    stubNavigator({ persist: () => Promise.reject(new Error('SecurityError')) })

    await expect(requestPersistentStorage()).resolves.toBe('unsupported')
  })
})

describe('checkPersistentStorage', () => {
  afterEach(() => {
    restoreNavigator()
  })

  it('永続化されていれば granted', async () => {
    stubNavigator({ persisted: () => Promise.resolve(true) })

    await expect(checkPersistentStorage()).resolves.toBe('granted')
  })

  it('永続化されていなければ denied', async () => {
    stubNavigator({ persisted: () => Promise.resolve(false) })

    await expect(checkPersistentStorage()).resolves.toBe('denied')
  })

  it('persisted() が無ければ unsupported', async () => {
    stubNavigator(null)

    await expect(checkPersistentStorage()).resolves.toBe('unsupported')
  })

  it('要求はしない(表示のために状態を読むだけ)', async () => {
    const persist = vi.fn(() => Promise.resolve(true))
    stubNavigator({ persist, persisted: () => Promise.resolve(false) })

    await expect(checkPersistentStorage()).resolves.toBe('denied')
    expect(persist).not.toHaveBeenCalled()
  })
})
