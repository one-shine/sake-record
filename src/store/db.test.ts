// @vitest-environment node
//
// **node 環境で回す。jsdom では Blob の往復が静かに壊れる。**
// vitest の jsdom 環境は `structuredClone` が無い jsdom の window に Node の structuredClone を
// 注入する一方、`Blob` は jsdom の実装を使う。Node の structuredClone は jsdom の Blob を
// 知らないので、**例外も出さずに `{}`(size/type が undefined の素のオブジェクト)へ潰す**。
// IndexedDB は structuredClone で値を保存するため、jsdom で回すと「保存できたのに写真が消える」
// という A11 の事故そのものを再現してしまい、しかもテストの側が先に壊れる。
// node 環境なら Blob も structuredClone も Node のものが揃うので往復が本番と同じ形で検査できる。
// (この前提は下の「環境の前提」の1テストが見張っている。環境を jsdom に変えると赤くなる)
//
// テストデータは**すべて合成**。実際の飲酒記録(`data/seed/` は gitignore)を転記しない。
import { indexedDB as fakeIndexedDB, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb'
import { OLDEST_UPDATED_AT } from '../domain/syncMerge.ts'
import type { SakeRecord } from '../domain/types.ts'
import {
  DB_NAME,
  DB_VERSION,
  STORE_NAMES,
  aliasKey,
  clear,
  clearAll,
  closeDb,
  del,
  deleteDatabase,
  get,
  getAll,
  getAllByIndex,
  openDb,
  put,
  putAll,
  req,
  tx,
} from './db.ts'
import type { StoredAlias } from './db.ts'

// `fake-indexeddb/auto` は package.json の exports に型が無く tsc が拾えないので、
// 型の付いている名前付き import で globalThis に差す(ブラウザと同じ形の global を作る)。
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

/** 合成の記録。既定値は「まだ何も紐付いていない1本」 */
function synthetic(over: Partial<SakeRecord> = {}): SakeRecord {
  return {
    id: 'id-1',
    drankOn: '2020-01-01',
    brandLabel: 'テスト酒',
    sakenowaBrandId: null,
    brandName: null,
    linkStatus: 'unknown',
    prefecture: null,
    spec: '',
    rating: null,
    place: '',
    note: '',
    thumbnail: null,
    sourceNo: null,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    ...over,
  }
}

/** 合成の紐付け。**更新時刻つき**(v3 以降の保存形。同期の勝ち負けを決める値) */
function syntheticAlias(over: Partial<StoredAlias> = {}): StoredAlias {
  return { label: 'てすとしゅ', prefecture: null, brandId: 1, updatedAt: '2026-01-01T00:00:00.000Z', ...over }
}

/** 保存形のサムネイル。**Blob ではなくバイト列**(B72) */
const jpeg = (bytes: readonly number[]): ArrayBuffer => new Uint8Array(bytes).buffer

beforeEach(async () => {
  await clearAll()
})

afterAll(() => {
  closeDb()
})

describe('環境の前提', () => {
  it('バイト列が structuredClone で**値として**複製される(B72 の根拠)', () => {
    const original = jpeg([255, 216, 255, 1])
    const clone = structuredClone(original)
    expect(clone).toBeInstanceOf(ArrayBuffer)
    expect([...new Uint8Array(clone)]).toEqual([255, 216, 255, 1])
    // 参照ではなく複製。Blob は逆に**参照のまま**入り、iOS では後から実体が失われる
    expect(clone).not.toBe(original)
  })

  it('バイト列は JSON では消える(だから wire 型は data URL 文字列で持つ)', () => {
    // 生の SakeRecord を JSON.stringify してエクスポートすると、例外も出ずに写真だけ消える。
    // backupSchema.ts が `thumbnail: string | null` を別型として立てている理由。
    expect(JSON.stringify({ thumbnail: jpeg([1, 2, 3]) })).toBe('{"thumbnail":{}}')
  })
})

describe('openDb — スキーマ', () => {
  it('records / aliases / meta / deletions / aliasDeletions / notes / noteDeletions の7ストアを現行の版で作る', async () => {
    const db = await openDb()
    expect(db.version).toBe(DB_VERSION)
    expect([...db.objectStoreNames].sort()).toEqual(['aliasDeletions', 'aliases', 'deletions', 'meta', 'noteDeletions', 'notes', 'records'])
    expect([...STORE_NAMES].sort()).toEqual(['aliasDeletions', 'aliases', 'deletions', 'meta', 'noteDeletions', 'notes', 'records'])
  })

  // **版上げは既存の利用者が必ず通る道。** version 1 の DB(deletions が無い)に対して
  // 開き直したときに、記録を1件も失わずに新しいストアだけが足されることを固定する。
  // ここが壊れると「アプリを開いたら記録が消えた」になる
  it('version 1 の DB を開き直しても記録が残り、足りないストアだけが足される', async () => {
    closeDb()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(new Error('消せない'))
    })
    // 旧版(version 1 / deletions 無し)を手で作り、記録を1件入れる
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('records', { keyPath: 'id' }).createIndex('drankOn', 'drankOn')
        db.createObjectStore('aliases')
        db.createObjectStore('meta')
      }
      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction('records', 'readwrite')
        transaction.objectStore('records').put(synthetic({ id: 'old-1' }))
        transaction.oncomplete = () => {
          db.close()
          resolve()
        }
        transaction.onerror = () => reject(new Error('旧版に書けない'))
      }
      request.onerror = () => reject(new Error('旧版を作れない'))
    })

    const db = await openDb()

    expect(db.version).toBe(DB_VERSION)
    expect([...db.objectStoreNames].sort()).toEqual(['aliasDeletions', 'aliases', 'deletions', 'meta', 'noteDeletions', 'notes', 'records'])
    expect((await getAll('records')).map((row) => row.id)).toEqual(['old-1'])
    expect(await getAll('deletions')).toEqual([])
  })

  // **更新時刻を持たない紐付けは、入れておかないと同期で無音で消える**
  // (`OLDEST_UPDATED_AT` のコメントに実測を書いてある)。version 2 までの行が該当する
  it('version 2 の DB を開き直すと、更新時刻の無い紐付けに最古の時刻が入る', async () => {
    closeDb()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(new Error('消せない'))
    })
    const legacyKey = aliasKey('ぜぶら', '甲県')
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 2)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('records', { keyPath: 'id' }).createIndex('drankOn', 'drankOn')
        db.createObjectStore('aliases')
        db.createObjectStore('meta')
        db.createObjectStore('deletions', { keyPath: 'id' })
      }
      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction(['records', 'aliases'], 'readwrite')
        transaction.objectStore('records').put(synthetic({ id: 'old-2' }))
        // v2 の形 = 更新時刻を持たない
        transaction
          .objectStore('aliases')
          .put({ label: 'ぜぶら', prefecture: '甲県', brandId: 7 }, legacyKey)
        transaction.oncomplete = () => {
          db.close()
          resolve()
        }
        transaction.onerror = () => reject(new Error('旧版に書けない'))
      }
      request.onerror = () => reject(new Error('旧版を作れない'))
    })

    const db = await openDb()

    expect(db.version).toBe(DB_VERSION)
    // 記録は1件も失わない
    expect((await getAll('records')).map((row) => row.id)).toEqual(['old-2'])
    // **キーは変わらない**(out-of-line キーなので、書き直しでキーがずれると引けなくなる)
    const stamped = await get('aliases', legacyKey)
    expect(stamped).toEqual({
      label: 'ぜぶら',
      prefecture: '甲県',
      brandId: 7,
      updatedAt: OLDEST_UPDATED_AT,
    })
    expect(await getAll('aliasDeletions')).toEqual([])
  })

  it('既に更新時刻を持つ行は版上げで書き換えない(送り直しを起こさない)', async () => {
    closeDb()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(new Error('消せない'))
    })
    const key = aliasKey('ぜぶら', null)
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 2)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('records', { keyPath: 'id' }).createIndex('drankOn', 'drankOn')
        db.createObjectStore('aliases')
        db.createObjectStore('meta')
        db.createObjectStore('deletions', { keyPath: 'id' })
      }
      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction('aliases', 'readwrite')
        transaction
          .objectStore('aliases')
          .put(
            { label: 'ぜぶら', prefecture: null, brandId: 7, updatedAt: '2026-05-05T00:00:00.000Z' },
            key,
          )
        transaction.oncomplete = () => {
          db.close()
          resolve()
        }
        transaction.onerror = () => reject(new Error('旧版に書けない'))
      }
      request.onerror = () => reject(new Error('旧版を作れない'))
    })

    await openDb()
    expect((await get('aliases', key))?.updatedAt).toBe('2026-05-05T00:00:00.000Z')
  })

  it('records は keyPath `id` と 非一意の `drankOn` 索引を持つ', async () => {
    const db = await openDb()
    const store = db.transaction('records', 'readonly').objectStore('records')
    expect(store.keyPath).toBe('id')
    expect([...store.indexNames]).toEqual(['drankOn'])
    expect(store.index('drankOn').unique).toBe(false)
  })

  it('aliases / meta は out-of-line キー(keyPath を持たない)', async () => {
    const db = await openDb()
    const transaction = db.transaction(['aliases', 'meta'], 'readonly')
    // BrandAlias.prefecture は null を取り、null は IndexedDB のキーになれない。
    // だから keyPath: ['label','prefecture'] は作れず、合成文字列キーにしてある。
    expect(transaction.objectStore('aliases').keyPath).toBeNull()
    expect(transaction.objectStore('meta').keyPath).toBeNull()
  })

  it('2回目以降は同じ接続を返す', async () => {
    expect(await openDb()).toBe(await openDb())
  })
})

describe('records — put / get / getAll', () => {
  it('put が返すキーは id で、get で同じ内容が戻る', async () => {
    const record = synthetic({ id: 'a', brandLabel: 'テスト酒', spec: '純米' })
    expect(await put('records', record)).toBe('a')
    expect(await get('records', 'a')).toEqual(record)
  })

  it('同じ id への put は上書き(件数は増えない)', async () => {
    await put('records', synthetic({ id: 'a', rating: null }))
    await put('records', synthetic({ id: 'a', rating: 4 }))
    expect(await getAll('records')).toHaveLength(1)
    expect((await get('records', 'a'))?.rating).toBe(4)
  })

  it('未知のキーは undefined を返す(全件に落ちない)', async () => {
    await put('records', synthetic({ id: 'a' }))
    expect(await get('records', 'no-such-id')).toBeUndefined()
  })

  it('空の状態の getAll は空配列', async () => {
    expect(await getAll('records')).toEqual([])
  })

  it('putAll は多件を1トランザクションで入れる', async () => {
    // 203本(実データの規模)を合成で作る。日付は組み立てで作り、リテラルの日付を並べない
    const records = Array.from({ length: 203 }, (_, i) =>
      synthetic({
        id: `id-${i}`,
        drankOn: `2021-0${1 + (i % 9)}-15`,
        sourceNo: i + 1,
        createdAt: `2021-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
      }),
    )
    expect(await putAll('records', records)).toBe(203)
    expect(await getAll('records')).toHaveLength(203)
  })

  it('putAll に空配列を渡しても失敗しない', async () => {
    expect(await putAll('records', [])).toBe(0)
  })
})

describe('records — drankOn 索引', () => {
  beforeEach(async () => {
    await putAll('records', [
      synthetic({ id: 'a', drankOn: '2020-01-01', sourceNo: 1 }),
      // 同日に複数件ある(実データは同日に最大6〜7本。drankOn は一意ではない)
      synthetic({ id: 'b', drankOn: '2022-05-05', sourceNo: 2 }),
      synthetic({ id: 'c', drankOn: '2022-05-05', sourceNo: 3 }),
      synthetic({ id: 'd', drankOn: '2024-11-30', sourceNo: 4 }),
    ])
  })

  it('同日の複数件をすべて返す', async () => {
    const found = await getAllByIndex('records', 'drankOn', '2022-05-05')
    expect(found.map((record) => record.id).sort()).toEqual(['b', 'c'])
  })

  it('該当のない日付は空配列(全件にフォールバックしない)', async () => {
    expect(await getAllByIndex('records', 'drankOn', '2021-01-01')).toEqual([])
  })

  it('全件が要るときは null を明示する', async () => {
    expect(await getAllByIndex('records', 'drankOn', null)).toHaveLength(4)
  })

  it('絞り込みキーが undefined なら理由付きで投げる(黙って全件にしない)', () => {
    expect(() =>
      getAllByIndex('records', 'drankOn', undefined as unknown as null),
    ).toThrow(/undefined/)
  })

  it('IDBKeyRange で期間を絞れる', async () => {
    const found = await getAllByIndex(
      'records',
      'drankOn',
      FakeIDBKeyRange.bound('2021-01-01', '2022-05-05'),
    )
    expect(found.map((record) => record.id).sort()).toEqual(['b', 'c'])
  })
})

describe('サムネイルの往復', () => {
  it('thumbnail のバイト列が長さと中身ごと保存される', async () => {
    const bytes = [255, 216, 255, 224, 0, 16, 74, 70]
    await put('records', synthetic({ id: 'a', thumbnail: jpeg(bytes) }))

    const loaded = await get('records', 'a')
    const thumbnail = loaded?.thumbnail
    // **Blob で戻ってきてはいけない(B72)。** 参照で保存されると iOS で実体だけが失われる
    expect(thumbnail).toBeInstanceOf(ArrayBuffer)
    expect(thumbnail?.byteLength).toBe(bytes.length)
    expect([...new Uint8Array(thumbnail as ArrayBuffer)]).toEqual(bytes)
  })

  it('thumbnail が null の記録も往復する(203本は写真が1枚も無い)', async () => {
    await put('records', synthetic({ id: 'a', thumbnail: null }))
    expect((await get('records', 'a'))?.thumbnail).toBeNull()
  })
})

describe('aliases — 合成キー', () => {
  it('aliasKey で put / get できる', async () => {
    const alias = syntheticAlias({ label: 'てすとしゅ', prefecture: '福島県', brandId: 42 })
    const key = aliasKey(alias.label, alias.prefecture)
    await put('aliases', alias, key)
    expect(await get('aliases', key)).toEqual(alias)
  })

  it('label は normalize されるので表記ゆれが同じキーに落ちる', () => {
    expect(aliasKey('ＴＥＳＴ', null)).toBe(aliasKey('test', null))
    expect(aliasKey('テスト酒 （限定）', null)).toBe(aliasKey('テスト酒', null))
  })

  it('prefecture の null(県を問わない)と県ありは別のキー', () => {
    expect(aliasKey('test', null)).not.toBe(aliasKey('test', '福島県'))
    expect(aliasKey('test', '福島県')).not.toBe(aliasKey('test', '山形県'))
  })

  it('空文字の prefecture は null と同じキー', () => {
    expect(aliasKey('test', '')).toBe(aliasKey('test', null))
  })

  it('putAll がキーを導いて一括保存する(呼び側はキーを組まない)', async () => {
    const wildcard = syntheticAlias({ label: 'てすとしゅ', prefecture: null, brandId: 1 })
    const scoped = syntheticAlias({ label: 'てすとしゅ', prefecture: '三重県', brandId: 2 })
    expect(await putAll('aliases', [wildcard, scoped])).toBe(2)

    expect(await getAll('aliases')).toHaveLength(2)
    expect(await get('aliases', aliasKey('てすとしゅ', null))).toEqual(wildcard)
    expect(await get('aliases', aliasKey('てすとしゅ', '三重県'))).toEqual(scoped)
  })

  it('同じ(label, prefecture)への保存は後勝ちで上書き', async () => {
    await putAll('aliases', [syntheticAlias({ brandId: 1 })])
    await putAll('aliases', [syntheticAlias({ brandId: 2 })])
    expect(await getAll('aliases')).toHaveLength(1)
    expect((await get('aliases', aliasKey('てすとしゅ', null)))?.brandId).toBe(2)
  })
})

describe('meta — key-value', () => {
  it('任意のキーで読み書きできる', async () => {
    const exportedAt = '2020-03-04T05:06:07.000Z'
    await put('meta', exportedAt, 'lastExportedAt')
    expect(await get('meta', 'lastExportedAt')).toBe(exportedAt)
  })

  it('未設定のキーは undefined', async () => {
    expect(await get('meta', 'lastExportedAt')).toBeUndefined()
  })
})

describe('del / clear / clearAll', () => {
  it('del は1件だけ消す', async () => {
    await putAll('records', [synthetic({ id: 'a' }), synthetic({ id: 'b' })])
    await del('records', 'a')
    expect((await getAll('records')).map((record) => record.id)).toEqual(['b'])
  })

  it('clear は指定したストアだけを空にする', async () => {
    await put('records', synthetic({ id: 'a' }))
    await putAll('aliases', [syntheticAlias()])
    await clear('records')
    expect(await getAll('records')).toEqual([])
    expect(await getAll('aliases')).toHaveLength(1)
  })

  it('clearAll は既定で全ストアを空にする', async () => {
    await put('records', synthetic({ id: 'a' }))
    await putAll('aliases', [syntheticAlias()])
    await put('meta', 'x', 'lastExportedAt')
    await clearAll()
    expect(await getAll('records')).toEqual([])
    expect(await getAll('aliases')).toEqual([])
    expect(await get('meta', 'lastExportedAt')).toBeUndefined()
  })

  it('clearAll は対象ストアを選べる(インポートの全置換で meta を残すため)', async () => {
    await put('records', synthetic({ id: 'a' }))
    await put('meta', 'x', 'lastExportedAt')
    await clearAll(['records', 'aliases'])
    expect(await getAll('records')).toEqual([])
    expect(await get('meta', 'lastExportedAt')).toBe('x')
  })
})

describe('tx', () => {
  it('複数ストアを1トランザクションで書ける', async () => {
    const written = await tx(['records', 'aliases'], 'readwrite', (transaction) =>
      Promise.all([
        req(transaction.objectStore('records').put(synthetic({ id: 'a' })), 'records の保存'),
        req(
          transaction.objectStore('aliases').put(syntheticAlias(), aliasKey('てすとしゅ', null)),
          'aliases の保存',
        ),
      ]),
    )
    expect(written).toHaveLength(2)
    expect(await getAll('records')).toHaveLength(1)
    expect(await getAll('aliases')).toHaveLength(1)
  })

  it('run が投げたら中断して書き込みが残らない', async () => {
    await expect(
      tx('records', 'readwrite', (transaction) => {
        // 中断されるので、この要求の拒否は掴んでおく(未処理の rejection にしない)
        void req(transaction.objectStore('records').put(synthetic({ id: 'a' })), '保存').catch(
          () => {},
        )
        throw new Error('わざと失敗させる')
      }),
    ).rejects.toThrow('わざと失敗させる')

    expect(await getAll('records')).toEqual([])
  })

  it('readonly のトランザクションで書こうとすると理由付きで失敗する', async () => {
    await expect(
      tx('records', 'readonly', (transaction) =>
        req(transaction.objectStore('records').put(synthetic({ id: 'a' })), '保存'),
      ),
    ).rejects.toThrow()
  })
})

describe('deleteDatabase', () => {
  it('DB ごと消え、開き直すと空のスキーマができる(サイトデータ削除の相当)', async () => {
    await put('records', synthetic({ id: 'a' }))
    expect(await getAll('records')).toHaveLength(1)

    await deleteDatabase()

    const db = await openDb()
    expect(db.version).toBe(DB_VERSION)
    expect([...db.objectStoreNames].sort()).toEqual(['aliasDeletions', 'aliases', 'deletions', 'meta', 'noteDeletions', 'notes', 'records'])
    expect(await getAll('records')).toEqual([])
  })
})

describe('IndexedDB が無い環境', () => {
  it('理由の分かる Error で失敗し、環境が戻れば開ける', async () => {
    closeDb()
    Object.defineProperty(globalThis, 'indexedDB', {
      value: undefined,
      configurable: true,
      writable: true,
    })

    await expect(openDb()).rejects.toThrow(/IndexedDB/)

    // 失敗した接続を掴んだままにしない(掴むと環境が戻っても永久に同じ失敗を返す)
    installFakeIndexedDb()
    await expect(openDb()).resolves.toBeDefined()
  })
})
