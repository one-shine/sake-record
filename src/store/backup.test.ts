// @vitest-environment node
//
// **node 環境で回す(db.test.ts / records.test.ts と同じ理由)。** vitest の jsdom 環境は
// jsdom の `Blob` と Node の `structuredClone` を混ぜるので、IndexedDB に入れた Blob が
// 例外も出さずに `{}` へ潰れる。サムネイルの往復を見るテストが jsdom では嘘の緑になる。
//
// node には `FileReader` が無い(下の「環境の前提」で固定)。実装は
// **FileReader があればそれを使い、無ければ自前で data URL を組む**の2経路なので、
// ここでは (a) 自前の経路を base64 の期待値で、(b) FileReader の経路をスタブで、両方通す。
//
// Node の型(`Buffer` 等)は使わない。`@types/node` は入っていないので
// `/// <reference types="node" />` を書くと型チェックが落ちる(tables.test.ts と同じ制約)。
//
// テストデータは**すべて合成**。実際の飲酒記録(`data/seed/` は gitignore)を転記しない。
// 日付・銘柄名は架空の値で、リテラルの日付は2種類に留める(BACKLOG B22 の台帳ガード)。
import { indexedDB as fakeIndexedDB, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb'
import { APP_NAME } from '../config/app.ts'
import { APP_ID, SCHEMA_VERSION } from '../domain/backupSchema.ts'
import type { ExportPayload, ExportedRecord } from '../domain/backupSchema.ts'
import type { BrandAlias, SakeRecord } from '../domain/types.ts'
import {
  DEFAULT_IMPORT_MODE,
  EXPORT_MIME,
  exportAll,
  exportFileName,
  importAll,
} from './backup.ts'
import { aliasKey, clearAll, closeDb, get, getAll, put, putAll } from './db.ts'
import type { StoredAlias } from './db.ts'
import { listNotes, putNote } from './notes.ts'

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
// 合成データ
// ---------------------------------------------------------------------------

/** 合成の記録。既定は「まだ何も紐付いていない・写真なしの1本」(203本の形) */
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

const jpeg = (bytes: Uint8Array<ArrayBuffer> | readonly number[]) =>
  new Blob([bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)], { type: 'image/jpeg' })

/** 決定的な擬似バイト列(乱数を使うと落ちたときに再現できない) */
function bytesOfLength(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) bytes[i] = (i * 37 + 11) % 256
  return bytes
}

/**
 * base64 の独立した検算。**実装とは別の経路で組む** —
 * 実装は「3の倍数の塊ごとに btoa」なので、こちらは全体を1本の文字列にして btoa を1回だけ呼ぶ
 * (塊の境界にパディングが混ざる誤りがあればここで食い違う)。
 * 引数展開(`String.fromCharCode(...bytes)`)は使わないので 1MB でもスタックは飛ばない。
 */
function base64Oracle(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const byId = (a: SakeRecord, b: SakeRecord) => a.id.localeCompare(b.id)

async function bytesOf(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())]
}

async function payloadOf(file: Blob): Promise<ExportPayload> {
  return JSON.parse(await file.text()) as ExportPayload
}

// ---------------------------------------------------------------------------
// 実装の外側を差し替える道具
// ---------------------------------------------------------------------------

type BlobCall = { parts: BlobPart[]; type: string }

/** `new Blob(...)` の引数を捉える。「部品配列で組んでいる」ことを外から観測するため */
async function captureBlobCalls<T>(
  run: () => Promise<T>,
): Promise<{ result: T; calls: BlobCall[] }> {
  const RealBlob = globalThis.Blob
  const calls: BlobCall[] = []
  class SpyBlob extends RealBlob {
    constructor(parts: BlobPart[] = [], options: BlobPropertyBag = {}) {
      calls.push({ parts: [...parts], type: options.type ?? '' })
      super(parts, options)
    }
  }
  Object.defineProperty(globalThis, 'Blob', { value: SpyBlob, configurable: true, writable: true })
  try {
    return { result: await run(), calls }
  } finally {
    Object.defineProperty(globalThis, 'Blob', {
      value: RealBlob,
      configurable: true,
      writable: true,
    })
  }
}

/**
 * ブラウザの `FileReader` の代役。**onload / onerror / result の配線を検査するため**の最小実装で、
 * node には FileReader が無いので本番のブラウザ経路はこれでしか通せない。
 * `outcome` が文字列ならその値を `result` に載せて onload、Error なら onerror を呼ぶ。
 */
async function withStubFileReader<T>(
  outcome: string | Error,
  run: () => Promise<T>,
): Promise<{ result: T; reads: Blob[] }> {
  const reads: Blob[] = []
  class StubFileReader {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    result: string | null = null
    error: Error | null = null
    readAsDataURL(blob: Blob): void {
      reads.push(blob)
      // 本物と同じく非同期に完了する(同期に呼ぶと Promise の配線ミスを見逃す)
      queueMicrotask(() => {
        if (typeof outcome === 'string') {
          this.result = outcome
          this.onload?.()
        } else {
          this.error = outcome
          this.onerror?.()
        }
      })
    }
  }
  Object.defineProperty(globalThis, 'FileReader', {
    value: StubFileReader,
    configurable: true,
    writable: true,
  })
  try {
    return { result: await run(), reads }
  } finally {
    Reflect.deleteProperty(globalThis, 'FileReader')
  }
}

beforeEach(async () => {
  await clearAll()
})

afterAll(() => {
  closeDb()
})

// ---------------------------------------------------------------------------

describe('環境の前提', () => {
  it('node には FileReader が無い(実装は自前で data URL を組む経路に落ちる)', () => {
    expect(typeof FileReader).toBe('undefined')
  })

  it('Blob が structuredClone を素通りする(jsdom では潰れるので node で回している)', () => {
    const clone = structuredClone(jpeg([255, 216, 255, 1]))
    expect(clone.size).toBe(4)
    expect(clone.type).toBe('image/jpeg')
  })

  it('data: URL は fetch で解決できる(オフラインでも復号できる前提)', async () => {
    const url = `data:image/jpeg;base64,${base64Oracle(new Uint8Array([1, 2, 3]))}`
    const blob = await (await fetch(url)).blob()
    expect(blob.type).toBe('image/jpeg')
    expect(await bytesOf(blob)).toEqual([1, 2, 3])
  })
})

// ---------------------------------------------------------------------------
// exportAll
// ---------------------------------------------------------------------------

describe('exportAll — ファイル全体の形', () => {
  it('空の DB でも読める JSON になる(0件の境界)', async () => {
    const file = await exportAll()

    expect(file.type).toBe(EXPORT_MIME)
    const payload = await payloadOf(file)
    expect(payload.schemaVersion).toBe(SCHEMA_VERSION)
    expect(payload.app).toBe(APP_ID)
    expect(payload.records).toEqual([])
    expect(payload.aliases).toEqual([])
    expect(Number.isNaN(Date.parse(payload.exportedAt))).toBe(false)
  })

  it('records と aliases の両方を書き出す(aliases が無いと manual の根拠が失われる)', async () => {
    await put('records', synthetic({ id: 'a' }))
    await putAll('aliases', [
      syntheticAlias({ label: 'てすとしゅ', prefecture: null, brandId: 1 }),
      syntheticAlias({ label: 'べつのしゅ', prefecture: '架空県', brandId: 2 }),
    ])

    const payload = await payloadOf(await exportAll())

    expect(payload.records).toHaveLength(1)
    expect(payload.aliases).toHaveLength(2)
    expect(payload.aliases.map((alias) => alias.brandId).sort()).toEqual([1, 2])
  })

  it('DB を書き換えない(何度呼んでも同じ / 副作用が無い)', async () => {
    await put('records', synthetic({ id: 'a', thumbnail: jpeg([1, 2, 3]) }))

    await exportAll()
    await exportAll()

    const stored = await get('records', 'a')
    expect(stored?.thumbnail).toBeInstanceOf(Blob)
    expect(stored?.thumbnail?.size).toBe(3)
    expect(await getAll('records')).toHaveLength(1)
  })
})

describe('exportAll — 巨大文字列を1本作らない', () => {
  it('外側の見出し + 1件1部品 の配列で Blob を組む(全体を1本の文字列にしない)', async () => {
    const thumbnail = bytesOfLength(1_000_000)
    await putAll(
      'records',
      [1, 2, 3].map((n) => synthetic({ id: `id-${String(n)}`, thumbnail: jpeg(thumbnail) })),
    )

    const { result: file, calls } = await captureBlobCalls(() => exportAll())

    // 最後に組まれたのが成果物。部品は「外側の見出し + 3件 + 閉じ括弧」
    const built = calls.at(-1)
    expect(built?.type).toBe(EXPORT_MIME)
    expect(built?.parts).toHaveLength(3 + 2)
    expect(built?.parts.every((part) => typeof part === 'string')).toBe(true)

    // 1部品の最大長は「最も大きい1件」で止まる。全体を1本にしていたら 4MB 超の部品ができる
    const longest = Math.max(...(built?.parts ?? []).map((part) => String(part).length))
    expect(longest).toBeLessThan(2_000_000)
    expect(file.size).toBeGreaterThan(4_000_000)
  })

  it('1MB のサムネイルでも落ちない(引数展開でスタックを飛ばす経路を通っていない)', async () => {
    const bytes = bytesOfLength(1_000_000)
    await put('records', synthetic({ id: 'a', thumbnail: jpeg(bytes) }))

    const payload = await payloadOf(await exportAll())

    expect(payload.records[0].thumbnail).toBe(`data:image/jpeg;base64,${base64Oracle(bytes)}`)
  })
})

describe('exportAll — data URL の作り方', () => {
  it('image/jpeg の接頭辞付き data URL にする(自己記述的にする)', async () => {
    const bytes = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70])
    await put('records', synthetic({ id: 'a', thumbnail: jpeg(bytes) }))

    const payload = await payloadOf(await exportAll())

    expect(payload.records[0].thumbnail).toBe(`data:image/jpeg;base64,${base64Oracle(bytes)}`)
  })

  it('base64 の塊の境界がずれない(1件を分割して符号化している)', async () => {
    // 実装の塊は 3*8192 バイト。その倍数でない長さで境界にパディングが混ざらないかを見る
    const bytes = bytesOfLength(3 * 8192 * 2 + 5)
    await put('records', synthetic({ id: 'a', thumbnail: jpeg(bytes) }))

    const payload = await payloadOf(await exportAll())

    expect(payload.records[0].thumbnail).toBe(`data:image/jpeg;base64,${base64Oracle(bytes)}`)
    // 途中に = が現れない(= が出るのは末尾だけ)
    const base64 = String(payload.records[0].thumbnail).split(',')[1]
    expect(base64.indexOf('=')).toBe(base64.replace(/=+$/u, '').length)
  })

  it('写真が無い記録は thumbnail: null(203本はすべてこの形)', async () => {
    await put('records', synthetic({ id: 'a', thumbnail: null }))

    const payload = await payloadOf(await exportAll())

    expect(payload.records[0].thumbnail).toBeNull()
  })

  it('FileReader がある環境ではそれを使う(ブラウザの経路)', async () => {
    const canned = 'data:image/jpeg;base64,/9j/AQID'
    await put('records', synthetic({ id: 'a', thumbnail: jpeg([1, 2, 3]) }))

    const { result: file, reads } = await withStubFileReader(canned, () => exportAll())

    expect(reads).toHaveLength(1)
    expect(reads[0].size).toBe(3)
    expect((await payloadOf(file)).records[0].thumbnail).toBe(canned)
  })

  it('サムネイルが読めなければエクスポートを中止する(写真だけ欠けた「成功」を作らない)', async () => {
    await put('records', synthetic({ id: 'broken-thumb', thumbnail: jpeg([1, 2, 3]) }))

    await expect(
      withStubFileReader(new Error('読み取り失敗'), () => exportAll()),
    ).rejects.toThrow(/broken-thumb/)
  })

  it('thumbnail が Blob でない(潰れた `{}`)記録でも黙って通さない', async () => {
    // jsdom 環境で書き込むと Blob が structuredClone で `{}` に潰れる。
    // その DB からエクスポートしたら「写真が消えた JSON」ではなく失敗を返す
    await put('records', synthetic({ id: 'squashed', thumbnail: {} as unknown as Blob }))

    await expect(exportAll()).rejects.toThrow(/squashed/)
  })
})

describe('exportFileName', () => {
  it('中立名 + ローカル日付 + .json', () => {
    expect(exportFileName(new Date(2020, 0, 2))).toBe('sake-record-backup-2020-01-02.json')
  })

  it('ブランド名を含まない', () => {
    // 期待値の出所は `config/app.ts` の表示名、実装の出所は `backupSchema.ts` の
    // EXPORT_FILE_PREFIX。別の出所どうしを比べているので恒真にならない(B15)。
    // ブランド名のリテラルはここに書かない — 3ファイル以外に出た時点で naming:check が落ちる。
    expect(exportFileName(new Date(2020, 0, 2)).toLowerCase()).not.toContain(APP_NAME.toLowerCase())
  })
})

// ---------------------------------------------------------------------------
// 往復
// ---------------------------------------------------------------------------

describe('往復(A11)', () => {
  it('export → 全消し → import で件数・全項目・サムネイルが戻る', async () => {
    const bytes = [255, 216, 255, 224, 0, 16, 74, 70, 73, 70]
    const original = [
      synthetic({
        id: 'a',
        thumbnail: jpeg(bytes),
        rating: 4,
        place: '架空の店',
        note: '合成のメモ',
        spec: '純米大吟醸',
        sakenowaBrandId: 42,
        brandName: '架空銘柄',
        linkStatus: 'manual',
        prefecture: '架空県',
        sourceNo: 7,
      }),
      synthetic({ id: 'b' }),
      synthetic({ id: 'c', drankOn: '2020-01-02', sourceNo: 3 }),
    ]
    await putAll('records', original)

    const file = await exportAll()
    await clearAll()
    expect(await getAll('records')).toEqual([])

    const result = await importAll(file)

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.imported.records).toBe(3)
    expect(result.applied.join(' / ')).toMatch(/records 3件/)

    const restored = (await getAll('records')).sort(byId)
    expect(restored).toHaveLength(3)
    // 写真以外の全項目が一致する(項目の増減はここで落ちる)
    expect(restored.map((record) => ({ ...record, thumbnail: null }))).toEqual(
      original.map((record) => ({ ...record, thumbnail: null })),
    )

    const thumbnail = restored[0].thumbnail
    expect(thumbnail).toBeInstanceOf(Blob)
    expect(thumbnail?.size).toBe(bytes.length)
    expect(thumbnail?.type).toBe('image/jpeg')
    expect(await bytesOf(thumbnail as Blob)).toEqual(bytes)
    // 写真の無い記録は null のまま(空 Blob を作らない)
    expect(restored[1].thumbnail).toBeNull()
  })

  it('aliases が往復する(これが無いと手動紐付けが復元後に消える / A6)', async () => {
    const aliases = [
      syntheticAlias({ label: 'てすとしゅ', prefecture: null, brandId: 1 }),
      syntheticAlias({ label: 'てすとしゅ', prefecture: '架空県', brandId: 2 }),
    ]
    await putAll('aliases', aliases)

    const file = await exportAll()
    await clearAll()

    const result = await importAll(file)

    expect(result.imported.aliases).toBe(2)
    expect((await getAll('aliases')).length).toBe(2)
    // キーの作り方まで戻っている(ワイルドカードと県ありが別のキーとして残る)
    expect(await get('aliases', aliasKey('てすとしゅ', null))).toEqual(aliases[0])
    expect(await get('aliases', aliasKey('てすとしゅ', '架空県'))).toEqual(aliases[1])
  })

  it('203件規模でも1件も落ちない(A11 のサムネイル無し版)', async () => {
    const original = Array.from({ length: 203 }, (_, i) =>
      synthetic({
        // 同日に複数件ある形(drankOn は一意でない)を保つ
        id: `id-${String(i).padStart(3, '0')}`,
        drankOn: `2021-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + Math.floor(i / 12)).padStart(2, '0')}`,
        sourceNo: i + 1,
      }),
    )
    await putAll('records', original)

    const file = await exportAll()
    await clearAll()
    const result = await importAll(file)

    expect(result.ok).toBe(true)
    expect(result.imported.records).toBe(203)
    const restored = (await getAll('records')).sort(byId)
    expect(restored).toHaveLength(203)
    expect(new Set(restored.map((record) => record.id)).size).toBe(203)
    expect(restored).toEqual(original)
  })

  // **既定の 5秒では足りない**(実測): 1MB を base64 に起こして書き戻す往復を
  // `fake-indexeddb` で通すので、テストを並列で回している最中は 5秒を超えて timeout する
  // (フルスイートで2回発生。単体では 4.5秒前後で通る = 実装が遅いのではなく待ち時間の問題)。
  // **payload を小さくして逃げない** — 1MB を丸ごと戻せることがこのテストの主張そのもの
  // (途中で切れても `ok` は返るので、サイズを落とすと切り捨てを見逃す)。
  it('1MB のサムネイルもバイト単位で戻る', { timeout: 30_000 }, async () => {
    const bytes = bytesOfLength(1_000_000)
    await put('records', synthetic({ id: 'a', thumbnail: jpeg(bytes) }))

    const file = await exportAll()
    await clearAll()
    await importAll(file)

    const thumbnail = (await get('records', 'a'))?.thumbnail
    expect(thumbnail?.size).toBe(bytes.length)
    expect(new Uint8Array((await thumbnail?.arrayBuffer()) as ArrayBuffer)).toEqual(bytes)
  })

  it('空の export を import しても壊れない(0件の境界)', async () => {
    const file = await exportAll()

    const result = await importAll(file)

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.imported).toEqual({ records: 0, aliases: 0, notes: 0 })
    expect(await getAll('records')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// importAll — 入力の受け口
// ---------------------------------------------------------------------------

describe('importAll — 入力の形', () => {
  it('文字列でも File でも受ける', async () => {
    await put('records', synthetic({ id: 'a' }))
    const text = await (await exportAll()).text()
    await clearAll()

    expect((await importAll(text)).imported.records).toBe(1)
    await clearAll()
    expect(
      (await importAll(new File([text], 'backup.json', { type: EXPORT_MIME }))).imported.records,
    ).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// importAll — 断る
// ---------------------------------------------------------------------------

describe('importAll — 断る入力', () => {
  it('壊れた JSON は理由を付けて断る(DB に触らない)', async () => {
    await put('records', synthetic({ id: 'a' }))

    const result = await importAll('{ "schemaVersion": 1, ')

    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/JSON/)
    expect(result.applied).toEqual([])
    expect(await getAll('records')).toHaveLength(1)
  })

  it('未来の schemaVersion は断る(知らない項目を黙って捨てない)', async () => {
    await put('records', synthetic({ id: 'a' }))
    const payload = { schemaVersion: 999, exportedAt: '', records: [], aliases: [] }

    const result = await importAll(JSON.stringify({ ...payload, exportedAt: '2020-01-01T00:00:00.000Z' }))

    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/v999/)
    expect(result.errors.join(' ')).toMatch(/更新/)
    expect(await getAll('records')).toHaveLength(1)
  })

  it('別のアプリのバックアップは断る', async () => {
    const result = await importAll(
      JSON.stringify({
        app: 'other-app',
        schemaVersion: 1,
        exportedAt: '2020-01-01T00:00:00.000Z',
        records: [],
        aliases: [],
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/other-app/)
  })

  it('ファイル全体の形が違うものは断る(records の配列を直接渡した場合など)', async () => {
    for (const text of ['[]', '{"records":[]}', 'null', '"文字列"']) {
      const result = await importAll(text)
      expect(result.ok, text).toBe(false)
      expect(result.errors[0].length, text).toBeGreaterThan(0)
    }
  })

  it('records に行はあるのに1件も読めないときは既存の記録を消さない', async () => {
    await put('records', synthetic({ id: 'keep' }))

    const result = await importAll(
      JSON.stringify({
        app: APP_ID,
        schemaVersion: SCHEMA_VERSION,
        exportedAt: '2020-01-01T00:00:00.000Z',
        records: [{ id: 'broken' }, { nope: true }],
        aliases: [],
      }),
    )

    expect(result.imported.records).toBe(0)
    expect(result.errors.join(' ')).toMatch(/既存の記録には触っていない/)
    expect((await getAll('records')).map((record) => record.id)).toEqual(['keep'])
  })

  /**
   * **1件も入らなかったのに `ok: true` を返してはいけない。** UI(importActions.ts)は
   * `result.ok` をそのまま画面に出すので、ここが true だと「取り込んだ」と表示される。
   * さらに、records が全滅したファイルで aliases 側の「0件で置き換える」(= 全消し)を
   * 実行すると、**壊れたファイルを1回読むだけで手動紐付けの根拠が消える**(A6)。
   */
  it('records が全滅したバックアップは失敗を返し、aliases も消さない', async () => {
    await put('records', synthetic({ id: 'keep' }))
    await putAll('aliases', [syntheticAlias({ brandId: 9 })])

    const result = await importAll(
      JSON.stringify({
        app: APP_ID,
        schemaVersion: SCHEMA_VERSION,
        exportedAt: '2020-01-01T00:00:00.000Z',
        records: [{ id: 'broken' }, { nope: true }],
        aliases: [],
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.applied).toEqual([])
    expect(result.imported).toEqual({ records: 0, aliases: 0, notes: 0 })
    expect((await getAll('records')).map((record) => record.id)).toEqual(['keep'])
    expect(await getAll('aliases')).toHaveLength(1)
  })

  it('aliases が全滅したバックアップでも records は入れる(0行の records を消しはしない)', async () => {
    await put('records', synthetic({ id: 'keep' }))

    const result = await importAll(
      JSON.stringify({
        app: APP_ID,
        schemaVersion: SCHEMA_VERSION,
        exportedAt: '2020-01-01T00:00:00.000Z',
        records: [],
        aliases: ['ごみ'],
      }),
    )

    // records は0行 = 書くものが無い。壊れたファイルを理由に全消しはしない
    expect(result.ok).toBe(false)
    expect(result.applied).toEqual([])
    expect((await getAll('records')).map((record) => record.id)).toEqual(['keep'])
  })
})

// ---------------------------------------------------------------------------
// importAll — 部分インポート
// ---------------------------------------------------------------------------

describe('importAll — 部分インポート', () => {
  /** 1件だけ形の違う行を混ぜたペイロード(JSON 文字列) */
  function payloadText(over: Partial<ExportPayload> = {}): string {
    const wire: ExportedRecord = {
      ...synthetic({ id: 'ok' }),
      thumbnail: null,
    }
    return JSON.stringify({
      app: APP_ID,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2020-01-01T00:00:00.000Z',
      records: [wire],
      aliases: [],
      ...over,
    })
  }

  it('形の違う1件を飛ばして残りを取り込み、飛ばしたことを errors に積む', async () => {
    const text = payloadText({
      records: [
        { ...synthetic({ id: 'ok' }), thumbnail: null } as ExportedRecord,
        { ...synthetic({ id: 'bad' }), thumbnail: null, linkStatus: 'linked' } as unknown as ExportedRecord,
      ],
    })

    const result = await importAll(text)

    expect(result.ok).toBe(true)
    expect(result.imported.records).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/records\[1\]/)
    expect((await getAll('records')).map((record) => record.id)).toEqual(['ok'])
  })

  it('サムネイルだけ復元できない記録は写真なしで取り込み、理由を積む', async () => {
    const text = payloadText({
      records: [
        {
          ...synthetic({ id: 'thumb-broken' }),
          thumbnail: 'data:image/jpeg;base64,!!!これは base64 ではない!!!',
        } as ExportedRecord,
      ],
    })

    const result = await importAll(text)

    expect(result.ok).toBe(true)
    expect(result.imported.records).toBe(1)
    expect(result.errors.join(' ')).toMatch(/thumb-broken/)
    expect((await get('records', 'thumb-broken'))?.thumbnail).toBeNull()
  })

  it('aliases が壊れていても records は取り込む(全滅させない)', async () => {
    const text = payloadText({ aliases: [{ label: '', prefecture: null, brandId: 1 }, 'ごみ'] as unknown as BrandAlias[] })

    const result = await importAll(text)

    expect(result.imported.records).toBe(1)
    expect(result.imported.aliases).toBe(0)
    expect(result.errors).toHaveLength(3) // 2行 + 「既存の紐付けには触っていない」
    expect(await getAll('records')).toHaveLength(1)
  })

  it('正規化していない label のエイリアスは正規化して保存する(効かない行にしない)', async () => {
    const text = payloadText({
      aliases: [{ label: 'ＴＥＳＴ 酒（限定）', prefecture: '  ', brandId: 3 }],
    })

    const result = await importAll(text)

    expect(result.imported.aliases).toBe(1)
    const saved = await getAll('aliases')
    expect(saved[0].label).toBe('test酒')
    // 空文字の県は null に畳む(`''` は照合でワイルドカードにも県指定にもならない死んだ行になる)
    expect(saved[0].prefecture).toBeNull()
    expect(await get('aliases', aliasKey('test酒', null))).toEqual(saved[0])
  })

  /**
   * IndexedDB の `put` は同じキーを上書きするので、**行数をそのまま件数として報告すると
   * 画面が実際より多く言う**(ImportExportPanel の「記録 N件を取り込んだ」)。
   * 黙って畳まず、重複を errors に積んだうえで実際に入った件数を返す。
   */
  it('id が重複した records は1件として数え、重複を errors に積む', async () => {
    const wire: ExportedRecord = { ...synthetic({ id: 'dup' }), thumbnail: null }
    const text = payloadText({ records: [wire, { ...wire, rating: 5 }] })

    const result = await importAll(text)

    expect(result.imported.records).toBe(1)
    expect(result.applied.join(' / ')).toMatch(/records 1件/)
    expect(result.errors.join(' ')).toMatch(/records\[1\]/)
    const stored = await getAll('records')
    expect(stored).toHaveLength(1)
    // 後の行が勝つ(put と同じ = ファイルの最後の状態に戻る)
    expect(stored[0].rating).toBe(5)
  })

  it('(銘柄表記, 都道府県) が重複した aliases は1件として数える', async () => {
    const text = payloadText({
      aliases: [
        { label: 'てすとしゅ', prefecture: null, brandId: 1 },
        { label: 'てすとしゅ', prefecture: null, brandId: 2 },
      ],
    })

    const result = await importAll(text)

    expect(result.imported.aliases).toBe(1)
    expect(result.errors.join(' ')).toMatch(/aliases\[1\]/)
    const stored = await getAll('aliases')
    expect(stored).toHaveLength(1)
    expect(stored[0].brandId).toBe(2)
  })

  it('銘柄IDが不正なエイリアスは断る(黙って効かない紐付けを保存しない)', async () => {
    const text = payloadText({ aliases: [{ label: 'てすとしゅ', prefecture: null, brandId: 0 }] })

    const result = await importAll(text)

    expect(result.imported.aliases).toBe(0)
    expect(result.errors.join(' ')).toMatch(/aliases\[0\]/)
  })
})

// ---------------------------------------------------------------------------
// importAll — replace / merge
// ---------------------------------------------------------------------------

describe('importAll — 置き換えと結合', () => {
  /** 記録1件だけを含むバックアップ */
  async function backupOf(records: readonly SakeRecord[], aliases: readonly StoredAlias[] = []) {
    await clearAll()
    if (records.length > 0) await putAll('records', records)
    if (aliases.length > 0) await putAll('aliases', aliases)
    const file = await exportAll()
    await clearAll()
    return file
  }

  it('既定は replace(ファイルに無い既存の記録は消える)', async () => {
    expect(DEFAULT_IMPORT_MODE).toBe('replace')
    const file = await backupOf([synthetic({ id: 'in-file' })])
    await put('records', synthetic({ id: 'only-local' }))

    await importAll(file)

    expect((await getAll('records')).map((record) => record.id)).toEqual(['in-file'])
  })

  it('merge は既存を残し、同じ id だけ上書きする', async () => {
    const file = await backupOf([synthetic({ id: 'shared', rating: 5 })])
    await putAll('records', [
      synthetic({ id: 'shared', rating: null }),
      synthetic({ id: 'only-local' }),
    ])

    await importAll(file, { mode: 'merge' })

    const restored = (await getAll('records')).sort(byId)
    expect(restored.map((record) => record.id)).toEqual(['only-local', 'shared'])
    expect(restored[1].rating).toBe(5)
  })

  it('replace は meta を消さない(最終エクスポート日時は端末側の事実)', async () => {
    const file = await backupOf([synthetic({ id: 'a' })])
    await put('meta', '2020-01-01T00:00:00.000Z', 'lastExportedAt')

    await importAll(file)

    expect(await get('meta', 'lastExportedAt')).toBe('2020-01-01T00:00:00.000Z')
  })

  /**
   * **records が0行のバックアップは replace で全消しになる**(「ファイルの状態に戻す」の意味)。
   * 取り消せない挙動なので、テスト名を挙動に合わせて書く(以前は名前が「消さない」と主張して
   * いながら `mode: 'merge'` を渡していて、既定の挙動を1度も検査していなかった)。
   * 取り込む前に警告するのは UI の責務 — ImportExportPanel が
   * 「このファイルには記録が0件。取り込むと記録はすべて消える。」を出す。
   */
  it('replace は records が0行のバックアップで既存の記録を全消しする', async () => {
    const file = await backupOf([], [syntheticAlias({ brandId: 9 })])
    await put('records', synthetic({ id: 'a' }))

    const result = await importAll(file)

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.imported.aliases).toBe(1)
    expect(await getAll('records')).toEqual([])
  })

  it('merge は records が0行のバックアップで既存の記録を残す', async () => {
    const file = await backupOf([], [syntheticAlias({ brandId: 9 })])
    await put('records', synthetic({ id: 'a' }))

    const result = await importAll(file, { mode: 'merge' })

    expect(result.imported.aliases).toBe(1)
    expect((await getAll('records')).map((record) => record.id)).toEqual(['a'])
  })
})

// 銘柄・蔵元のメモ(B76)。**v2 以前のバックアップは `notes` を持たない**
describe('importAll — メモと古いバックアップ', () => {
  it('メモも往復する', async () => {
    await clearAll()
    await putNote({ target: 'brand', targetId: 1616, text: '往復する文' }, '2020-01-01T00:00:00.000Z')
    const file = await exportAll()
    await clearAll()

    const result = await importAll(file)
    expect(result.ok).toBe(true)
    expect(await listNotes()).toMatchObject([{ target: 'brand', targetId: 1616, text: '往復する文' }])
  })

  // **これを落とすと、古いバックアップを1回戻すだけで全部のメモが消える。**
  // 「無い」と「意図して0件」は別物で、`notes` を知らない版が書いたファイルは前者
  it('notes を持たない古いバックアップを戻しても、既存のメモは消えない', async () => {
    await clearAll()
    await putNote({ target: 'brand', targetId: 1616, text: '残るべき文' }, '2020-01-01T00:00:00.000Z')

    const result = await importAll(
      JSON.stringify({
        app: APP_ID,
        schemaVersion: 2,
        exportedAt: '2020-01-01T00:00:00.000Z',
        records: [],
        aliases: [],
      }),
    )

    expect(result.ok).toBe(true)
    expect(await listNotes()).toMatchObject([{ text: '残るべき文' }])
  })

  // 逆に、`notes: []` を持つファイルは「意図して0件」なので置き換える
  it('notes を空配列で持つバックアップは、既存のメモを消す', async () => {
    await clearAll()
    await putNote({ target: 'brand', targetId: 1616, text: '消えるべき文' }, '2020-01-01T00:00:00.000Z')

    await importAll(
      JSON.stringify({
        app: APP_ID,
        schemaVersion: SCHEMA_VERSION,
        exportedAt: '2020-01-01T00:00:00.000Z',
        records: [],
        aliases: [],
        notes: [],
      }),
    )

    expect(await listNotes()).toEqual([])
  })
})
