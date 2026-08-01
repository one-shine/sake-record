// @vitest-environment node
//
// **node 環境で回す。** jsdom では `structuredClone` が Blob を例外も出さずに `{}` へ潰すので、
// 「サムネイル込みで同期できた」というテストが**何も検査しないまま緑になる**(A24 の中核)。
// 環境が戻っていないことは下の「環境の前提」が見張る。
//
// 通信は差し替える(`SyncTransport`)。実際のサーバの検査は `server/verify.mjs` が
// wrangler dev + D1 に対して行う分担で、ここは**順序と取りこぼし**だけを見る。

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { indexedDB as fakeIndexedDB, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb'
import type { SakeRecord } from '../domain/types.ts'
import type {
  PulledChanges,
  SyncAliasChange,
  SyncPushRequest,
  SyncPushResponse,
  SyncRecordChange,
} from '../domain/syncWire.ts'
import { aliasKey, clearAll, closeDb, get, getAll, put } from './db.ts'
import { deleteAlias, listAliasDeletions, listAliases, putAlias } from './aliases.ts'
import { getLastSyncedAt, getSyncCursor, setSyncCursor, setSyncToken } from './meta.ts'
import { listDeletions } from './records.ts'
import { sync, type SyncTransport } from './sync.ts'

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

const jpeg = (bytes: readonly number[]) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })

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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/** サーバから降ってくる1件。`body` は記録からサムネイルを抜いた形 */
function change(over: Partial<SakeRecord> = {}, hasThumbnail = false): SyncRecordChange {
  const { thumbnail: _thumbnail, ...body } = record(over)
  return {
    id: body.id,
    updatedAt: body.updatedAt,
    deletedAt: null,
    hasThumbnail,
    body,
  }
}

function removed(id: string, deletedAt: string): SyncRecordChange {
  return { id, updatedAt: deletedAt, deletedAt, hasThumbnail: false, body: null }
}

/** 差し替えた通信。呼ばれ方(順序・回数)を全部覚える */
function fakeTransport(
  pages: readonly Partial<PulledChanges>[] = [{}],
  overrides: Partial<SyncTransport> = {},
) {
  const calls: string[] = []
  const pushed: SyncPushRequest[] = []
  const thumbs = new Map<string, Blob>()
  let page = 0
  const transport: SyncTransport = {
    pull: vi.fn((since: number) => {
      calls.push(`pull:${String(since)}`)
      const value = pages[Math.min(page, pages.length - 1)] ?? {}
      page++
      return Promise.resolve({
        cursor: value.cursor ?? 0,
        hasMore: value.hasMore ?? false,
        records: value.records ?? [],
        aliases: value.aliases ?? [],
        dropped: value.dropped ?? 0,
      })
    }),
    push: vi.fn((body: SyncPushRequest): Promise<SyncPushResponse> => {
      calls.push(`push:${String(body.records.length)}+${String(body.aliases.length)}`)
      pushed.push(body)
      return Promise.resolve({ cursor: 0, accepted: 0, rejected: 0 })
    }),
    getThumbnail: vi.fn((id: string) => {
      calls.push(`getThumb:${id}`)
      return Promise.resolve(thumbs.get(id) ?? null)
    }),
    putThumbnail: vi.fn((id: string, blob: Blob) => {
      calls.push(`putThumb:${id}`)
      thumbs.set(id, blob)
      return Promise.resolve()
    }),
    ...overrides,
  }
  return { transport, calls, pushed, thumbs }
}

const run = (transport: SyncTransport) => sync({ transport })

beforeEach(async () => {
  await clearAll()
  await setSyncToken('t'.repeat(40))
})

afterAll(() => {
  closeDb()
})

describe('環境の前提', () => {
  it('Blob が structuredClone を素通りする(jsdom では潰れるので node 環境で回している)', () => {
    const clone = structuredClone(jpeg([255, 216, 255, 1]))
    expect(clone).toBeInstanceOf(Blob)
    expect(clone.size).toBe(4)
  })
})

describe('同期を設定していない端末', () => {
  // A28。**通信もしない** — ここが緩いと、設定していない端末で毎回失敗が出る
  it('同期先の URL が空なら何もしない(通信もしない)', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const outcome = await sync({ baseUrl: '' })
    expect(outcome).toEqual({ status: 'not-configured' })
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('トークンが無ければ何もしない', async () => {
    await put('meta', '', 'syncToken')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const outcome = await sync({ baseUrl: 'https://example.invalid' })
    expect(outcome).toEqual({ status: 'not-configured' })
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('受け取る', () => {
  it('サーバにだけある記録がこの端末に入る', async () => {
    const { transport } = fakeTransport([{ cursor: 5, records: [change({ id: 'from-server' })] }])
    const outcome = await run(transport)

    expect(outcome.status).toBe('done')
    expect(await get('records', 'from-server')).toMatchObject({ id: 'from-server' })
    expect(await getSyncCursor()).toBe(5)
  })

  // A24。写真は本体と別に運ぶので、ここが抜けると「写真だけ無い記録」が入る
  it('写真つきの記録はサムネイルごと入る', async () => {
    const { transport, thumbs } = fakeTransport([
      { cursor: 5, records: [change({ id: 'with-photo' }, true)] },
    ])
    thumbs.set('with-photo', jpeg([1, 2, 3, 4, 5]))

    await run(transport)

    const stored = await get('records', 'with-photo')
    expect(stored?.thumbnail).toBeInstanceOf(Blob)
    expect(stored?.thumbnail?.size).toBe(5)
  })

  // **写真の無い記録として保存しない**。保存すると位置が進んで二度と取りに来ない
  it('写真がまだサーバに無いなら、その記録は当てずに位置も進めない', async () => {
    const { transport } = fakeTransport([
      { cursor: 5, records: [change({ id: 'pending' }, true)] },
    ])
    const outcome = await run(transport)

    expect(await get('records', 'pending')).toBeUndefined()
    expect(await getSyncCursor()).toBe(0)
    expect(outcome.status === 'done' && outcome.result.notes.join()).toContain('写真')
  })

  it('写真の取得が失敗しても他の記録は入る(位置だけ進めない)', async () => {
    const { transport } = fakeTransport(
      [{ cursor: 5, records: [change({ id: 'ok' }), change({ id: 'ng' }, true)] }],
      { getThumbnail: () => Promise.reject(new Error('切れた')) },
    )
    await run(transport)

    expect(await get('records', 'ok')).toBeDefined()
    expect(await get('records', 'ng')).toBeUndefined()
    expect(await getSyncCursor()).toBe(0)
  })

  // 自分が送った記録は次の pull で戻ってくる。毎回 50KB を取り直さない
  it('同じ版で写真も持っているなら取りに行かない', async () => {
    await put('records', record({ id: 'mine', thumbnail: jpeg([9, 9]) }))
    const { transport, calls } = fakeTransport([
      { cursor: 5, records: [change({ id: 'mine' }, true)] },
    ])
    await run(transport)

    expect(calls.filter((call) => call.startsWith('getThumb'))).toEqual([])
    expect((await get('records', 'mine'))?.thumbnail?.size).toBe(2)
  })

  it('サーバで消された記録はこの端末からも消える', async () => {
    await put('records', record({ id: 'gone' }))
    const { transport } = fakeTransport([
      { cursor: 5, records: [removed('gone', '2026-02-01T00:00:00.000Z')] },
    ])
    await run(transport)

    expect(await get('records', 'gone')).toBeUndefined()
  })

  // **自分が消したのではないので削除の記録を書かない。** 書くと端末の「今」が入るため
  // サーバの削除時刻より新しくなり、次の同期で押し返して往復し続ける
  it('サーバ由来の削除では、この端末の削除の記録を作らない', async () => {
    await put('records', record({ id: 'gone' }))
    const { transport } = fakeTransport([
      { cursor: 5, records: [removed('gone', '2026-02-01T00:00:00.000Z')] },
    ])
    await run(transport)

    expect(await listDeletions()).toEqual([])
  })

  it('続きがあると言われたら最後まで辿る', async () => {
    const { transport, calls } = fakeTransport([
      { cursor: 10, hasMore: true, records: [change({ id: 'a' })] },
      { cursor: 20, hasMore: false, records: [change({ id: 'b' })] },
    ])
    await run(transport)

    expect(calls.filter((call) => call.startsWith('pull'))).toEqual(['pull:0', 'pull:10'])
    expect(await get('records', 'b')).toBeDefined()
    expect(await getSyncCursor()).toBe(20)
  })

  it('形が違って捨てられた件数を画面に出せる形で返す', async () => {
    const { transport } = fakeTransport([{ cursor: 1, dropped: 2 }])
    const outcome = await run(transport)
    expect(outcome.status === 'done' && outcome.result.notes.join()).toContain('2 件')
  })
})

describe('送る', () => {
  it('この端末で作った記録を送る', async () => {
    await put('records', record({ id: 'new-here' }))
    const { transport, pushed } = fakeTransport()
    await run(transport)

    expect(pushed.flatMap((body) => body.records).map((change_) => change_.id)).toEqual(['new-here'])
  })

  // **写真を先に送る。** 記録が見えてから写真が届くまでの隙間に別端末が同期すると、
  // その端末は写真の無い記録を保存したまま二度と取りに来ない
  it('写真を記録より先に送る', async () => {
    await put('records', record({ id: 'photo', thumbnail: jpeg([1, 2, 3]) }))
    const { transport, calls } = fakeTransport()
    await run(transport)

    expect(calls.indexOf('putThumb:photo')).toBeLessThan(
      calls.findIndex((call) => call.startsWith('push:')),
    )
  })

  it('消したことを送り、送れたら削除の記録を捨てる', async () => {
    await put('records', record({ id: 'bye' }))
    const { deleteRecord } = await import('./records.ts')
    await deleteRecord('bye', '2026-03-01T00:00:00.000Z')
    expect(await listDeletions()).toHaveLength(1)

    const { transport, pushed } = fakeTransport()
    await run(transport)

    const sent = pushed.flatMap((body) => body.records)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ id: 'bye', deletedAt: '2026-03-01T00:00:00.000Z', body: null })
    expect(await listDeletions()).toEqual([])
  })

  // **送れていない削除を捨てない。** 捨てるとその記録が次の同期で復活する
  it('送信に失敗したら削除の記録を残し、位置も進めない', async () => {
    await put('records', record({ id: 'bye' }))
    const { deleteRecord } = await import('./records.ts')
    await deleteRecord('bye', '2026-03-01T00:00:00.000Z')
    await setSyncCursor(3)

    const { transport } = fakeTransport([{ cursor: 9 }], {
      push: () => Promise.reject(new Error('送れない')),
    })
    const outcome = await run(transport)

    expect(outcome.status).toBe('failed')
    expect(await listDeletions()).toHaveLength(1)
    expect(await getSyncCursor()).toBe(3)
    expect(await getLastSyncedAt()).toBeNull()
  })

  it('上限を越える件数は分けて送る', async () => {
    for (let i = 0; i < 32; i++) await put('records', record({ id: `r${String(i)}` }))
    const { transport, pushed } = fakeTransport()
    await run(transport)

    expect(pushed.length).toBeGreaterThanOrEqual(3)
    for (const body of pushed) expect(body.records.length).toBeLessThanOrEqual(15)
    expect(pushed.flatMap((body) => body.records)).toHaveLength(32)
  })

  it('前回の同期より後に触っていない記録は送らない', async () => {
    await put('records', record({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }))
    const first = fakeTransport()
    await run(first.transport)
    expect(first.pushed.flatMap((body) => body.records)).toHaveLength(1)

    const second = fakeTransport()
    await run(second.transport)
    expect(second.pushed.flatMap((body) => body.records)).toEqual([])
  })
})

describe('手動紐付け', () => {
  it('この端末の紐付けを送る', async () => {
    await putAlias({ label: 'しゃらく', prefecture: '福島県', brandId: 1616 }, '2026-01-01T00:00:00.000Z')
    const { transport, pushed } = fakeTransport()
    await run(transport)

    const sent = pushed.flatMap((body) => body.aliases)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.key).toBe(aliasKey('しゃらく', '福島県'))
    expect(sent[0]?.body).toMatchObject({ brandId: 1616 })
  })

  it('サーバの紐付けがこの端末に入る', async () => {
    const key = aliasKey('しゃらく', '福島県')
    const incoming: SyncAliasChange = {
      key,
      updatedAt: '2026-04-01T00:00:00.000Z',
      deletedAt: null,
      body: { label: 'しゃらく', prefecture: '福島県', brandId: 1616 },
    }
    const { transport } = fakeTransport([{ cursor: 2, aliases: [incoming] }])
    await run(transport)

    expect(await listAliases()).toMatchObject([{ brandId: 1616, updatedAt: '2026-04-01T00:00:00.000Z' }])
  })

  // 外した紐付けが別端末から押し返されると、`寫楽` が意図しない銘柄に戻る(A6 の逆流)
  it('外した紐付けは削除として送られ、送れたら記録を捨てる', async () => {
    await putAlias({ label: 'しゃらく', prefecture: null, brandId: 1616 }, '2026-01-01T00:00:00.000Z')
    await deleteAlias(aliasKey('しゃらく', null), '2026-05-01T00:00:00.000Z')

    const { transport, pushed } = fakeTransport()
    await run(transport)

    const sent = pushed.flatMap((body) => body.aliases)
    expect(sent).toMatchObject([{ deletedAt: '2026-05-01T00:00:00.000Z', body: null }])
    expect(await listAliasDeletions()).toEqual([])
  })

  // 同じ状態で2回同期して2回目に何も飛ばないこと = 押し合いが起きていないことの検査
  it('同じ状態で2回同期しても2回目は1件も送らない', async () => {
    await putAlias({ label: 'しゃらく', prefecture: null, brandId: 1616 }, '2026-01-01T00:00:00.000Z')
    await run(fakeTransport().transport)

    const second = fakeTransport()
    await run(second.transport)
    expect(second.pushed.flatMap((body) => body.aliases)).toEqual([])
  })
})

describe('同期の最中に本人が触ったとき', () => {
  // `planSync` は同期を始めた時点の値で判断している。当てると保存したばかりの編集が消える
  it('通信の途中で変わった記録には当てない(理由を残す)', async () => {
    await put('records', record({ id: 'busy', updatedAt: '2026-01-01T00:00:00.000Z' }))
    const { transport } = fakeTransport(
      [{ cursor: 5, records: [change({ id: 'busy', updatedAt: '2026-06-01T00:00:00.000Z', note: 'サーバ' })] }],
      {
        // pull の最中に本人が保存した、という状況を作る
        pull: async (since: number) => {
          await put('records', record({ id: 'busy', updatedAt: '2026-07-01T00:00:00.000Z', note: '手元' }))
          return {
            cursor: 5,
            hasMore: false,
            dropped: 0,
            aliases: [],
            records: [change({ id: 'busy', updatedAt: '2026-06-01T00:00:00.000Z', note: 'サーバ' })],
            ...(since === -1 ? {} : {}),
          }
        },
      },
    )
    const outcome = await run(transport)

    expect((await get('records', 'busy'))?.note).toBe('手元')
    expect(outcome.status === 'done' && outcome.result.notes.join()).toContain('当てなかった')
  })
})

describe('失敗の言い分け', () => {
  it('トークンが違うことと通信できないことを区別する', async () => {
    const unauthorized = fakeTransport([{}], {
      pull: () => {
        const error: Error & { syncKind?: string } = new Error('トークンが違う(401)')
        error.syncKind = 'unauthorized'
        return Promise.reject(error)
      },
    })
    const outcome = await run(unauthorized.transport)
    expect(outcome).toMatchObject({ status: 'failed', kind: 'unauthorized' })

    const offline = fakeTransport([{}], { pull: () => Promise.reject(new TypeError('failed')) })
    expect(await run(offline.transport)).toMatchObject({ status: 'failed', kind: 'offline' })
  })

  it('例外を投げない(呼び側が catch を書き忘れても記録の閲覧を止めない)', async () => {
    const { transport } = fakeTransport([{}], { pull: () => Promise.reject(new Error('爆発')) })
    await expect(run(transport)).resolves.toMatchObject({ status: 'failed' })
  })
})

describe('二重起動', () => {
  // 起動時と保存後の両方から呼ばれる。並走すると位置が巻き戻り、未送信の変更が飛ぶ
  it('走っている同期があれば同じものを返す(2周しない)', async () => {
    let resolvePull: (value: PulledChanges) => void = () => {}
    const gate = new Promise<PulledChanges>((resolve) => {
      resolvePull = resolve
    })
    const pull = vi.fn(() => gate)
    const { transport } = fakeTransport([{}], { pull })

    const first = sync({ transport })
    const second = sync({ transport })
    expect(first).toBe(second)

    resolvePull({ cursor: 1, hasMore: false, records: [], aliases: [], dropped: 0 })
    await first
    expect(pull).toHaveBeenCalledTimes(1)
  })
})

describe('取り込みと全消去のあと', () => {
  // 位置を残すと、全置換で消えた記録がサーバに残り続けてこの端末に戻らない
  it('取り込みの後は位置が初期化され、次の同期が全件のやり取りになる', async () => {
    await setSyncCursor(42)
    const { importAll } = await import('./backup.ts')
    const result = await importAll(
      JSON.stringify({
        schemaVersion: 2,
        exportedAt: '2026-01-01T00:00:00.000Z',
        aliases: [],
        records: [{ ...record({ id: 'restored' }), thumbnail: null }],
      }),
    )
    expect(result.ok).toBe(true)
    expect(await getSyncCursor()).toBe(0)
    expect(await getLastSyncedAt()).toBeNull()
  })
})

describe('この端末が読めないとき', () => {
  // 空配列に畳むと、サーバ側の古い版がローカルの新しい版を無条件に上書きし、競合にも出ない
  it('保存領域を読めなければ中止する(送らない・位置も進めない)', async () => {
    await put('records', record({ id: 'keep' }))
    await setSyncCursor(7)
    const { transport, pushed } = fakeTransport([{ cursor: 9 }])

    const records = await import('./records.ts')
    const spy = vi.spyOn(records, 'listDeletions').mockRejectedValue(new Error('開けない'))
    const outcome = await run(transport)
    spy.mockRestore()

    expect(outcome).toMatchObject({ status: 'failed', kind: 'local' })
    expect(pushed).toEqual([])
    expect(await getSyncCursor()).toBe(7)
    expect(await getAll('records')).toHaveLength(1)
  })
})
