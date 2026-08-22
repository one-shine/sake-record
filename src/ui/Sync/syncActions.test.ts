// @vitest-environment node
// store は差し替えるので IndexedDB も通信も要らない。
//
// **ここが守っているのは「負けて消えた記録の名前を出せること」**(B90)。
// 以前は同期の**あと**の一覧からしか名前を引いていなかったので、消えた記録は必ず引けず、
// 画面には生の uuid が出ていた(頭注は「その旨を書く」と約束していたのに実装が無かった)。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SakeRecord } from '../../domain/types.ts'
import { defaultSyncActions } from './syncActions.ts'

const listRecords = vi.hoisted(() => vi.fn())
const sync = vi.hoisted(() => vi.fn())

vi.mock('../../store/records.ts', () => ({ listRecords }))
vi.mock('../../store/sync.ts', () => ({ sync }))
vi.mock('../../store/meta.ts', () => ({
  getSyncPassword: vi.fn(() => Promise.resolve(null)),
  setSyncPassword: vi.fn(() => Promise.resolve()),
  getLastSyncedAt: vi.fn(() => Promise.resolve(null)),
  getLastSyncReport: vi.fn(() => Promise.resolve(null)),
}))

function record(id: string, brandLabel: string): SakeRecord {
  return {
    id,
    drankOn: '2020-01-01',
    brandLabel,
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
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  }
}

function doneWith(conflicts: { kind: 'record' | 'alias' | 'note'; id: string }[]) {
  return {
    status: 'done' as const,
    result: {
      startedAt: '2026-08-22T00:00:00.000Z',
      localRecords: 1,
      applied: 0,
      removed: 0,
      pushed: 0,
      conflicts: conflicts.map((entry) => ({
        ...entry,
        winner: 'remote' as const,
        winnerDeleted: true,
      })),
      messages: [],
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('競合に名前を添える(B90)', () => {
  // ★ 本題。同期で消えた記録は**あとの一覧には無い**ので、前を読んでいないと名前が出ない
  it('負けて消えた記録の名前を、同期前のスナップショットから引く', async () => {
    listRecords
      .mockResolvedValueOnce([record('gone', '而今')]) // 同期の前
      .mockResolvedValueOnce([]) // 同期のあと(消えている)
    sync.mockResolvedValue(doneWith([{ kind: 'record', id: 'gone' }]))

    const result = await defaultSyncActions.runSync()

    expect(result.conflicts[0]?.label).toBe('2020-01-01 而今')
  })

  // 当てた結果を反映した名前のほうが正しい(サーバの値で置き換わった記録)
  it('残った記録は同期後の名前を採る', async () => {
    listRecords
      .mockResolvedValueOnce([record('kept', 'ふるい表記')])
      .mockResolvedValueOnce([record('kept', 'あたらしい表記')])
    sync.mockResolvedValue(doneWith([{ kind: 'record', id: 'kept' }]))

    const result = await defaultSyncActions.runSync()

    expect(result.conflicts[0]?.label).toBe('2020-01-01 あたらしい表記')
  })

  // 紐付けとメモの id は内部キー。記録の辞書を引くと**別の記録の名前が付きうる**
  it('紐付けとメモには記録の名前を付けない', async () => {
    listRecords.mockResolvedValue([record('寫楽|福島県', 'まぎらわしい')])
    sync.mockResolvedValue(
      doneWith([
        { kind: 'alias', id: '寫楽|福島県' },
        { kind: 'note', id: 'brand:1' },
      ]),
    )

    const result = await defaultSyncActions.runSync()

    expect(result.conflicts.map((entry) => entry.label)).toEqual([null, null])
  })

  // 説明が付かないだけ。**競合そのものは必ず出す**(黙って捨てない)
  it('一覧を読めなくても競合は返す', async () => {
    listRecords.mockRejectedValue(new Error('読めない'))
    sync.mockResolvedValue(doneWith([{ kind: 'record', id: 'r1' }]))

    const result = await defaultSyncActions.runSync()

    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.label).toBeNull()
  })

  // 競合が無いときに一覧を2回読む必要は無い(同期の前だけで済ませる)
  it('競合が無ければ同期後の読み直しをしない', async () => {
    listRecords.mockResolvedValue([record('a', 'なにか')])
    sync.mockResolvedValue(doneWith([]))

    await defaultSyncActions.runSync()

    expect(listRecords).toHaveBeenCalledTimes(1)
  })
})
