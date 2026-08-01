// @vitest-environment node
// domain 層のテストは jsdom を要求しない(CLAUDE.md の依存方向)。
//
// **ここは2端末を用意せずに同期の分岐を全部踏むための場所。** 同期で壊れるのは通信ではなく
// 突き合わせで、しかも「消した記録が復活する」「片方の追加が消える」のように気づきにくい。
// サーバが1行も無い段階でこのファイルを赤にできることが、この設計の狙いそのもの。
import { describe, expect, it } from 'vitest'
import { planSync, type SyncEntry, type SyncInput } from './syncMerge.ts'

const T0 = '2026-08-01T00:00:00.000Z'
const T1 = '2026-08-01T01:00:00.000Z'
const T2 = '2026-08-01T02:00:00.000Z'
const T3 = '2026-08-01T03:00:00.000Z'

const alive = (id: string, updatedAt: string): SyncEntry => ({ id, updatedAt })
const dead = (id: string, deletedAt: string, updatedAt = T0): SyncEntry => ({
  id,
  updatedAt,
  deletedAt,
})

function plan(input: Partial<SyncInput>) {
  return planSync({
    local: [],
    localDeletions: [],
    remote: [],
    lastSyncedAt: T1,
    ...input,
  })
}

describe('何も変わっていないとき', () => {
  it('前回の同期より古いローカルは送らない(毎回全件が飛ばない)', () => {
    const result = plan({ local: [alive('a', T0)], lastSyncedAt: T1 })
    expect(result).toEqual({
      applyLocal: [],
      removeLocal: [],
      push: [],
      pushDeletions: [],
      conflicts: [],
    })
  })

  it('初回(lastSyncedAt が null)はローカルを全部送る', () => {
    const result = plan({ local: [alive('a', T0), alive('b', T0)], lastSyncedAt: null })
    expect(result.push).toEqual(['a', 'b'])
  })
})

describe('片側だけが変わったとき', () => {
  it('サーバにだけ在る記録を取り込む', () => {
    const result = plan({ remote: [alive('a', T2)] })
    expect(result.applyLocal).toEqual(['a'])
    expect(result.conflicts).toEqual([])
  })

  it('ローカルにだけ在る新しい記録を送る', () => {
    const result = plan({ local: [alive('a', T2)] })
    expect(result.push).toEqual(['a'])
  })

  it('持っていない記録の削除は取り込まない(消すものが無い)', () => {
    const result = plan({ remote: [dead('a', T2)] })
    expect(result.applyLocal).toEqual([])
    expect(result.removeLocal).toEqual([])
  })

  it('ローカルの削除を送る', () => {
    const result = plan({ localDeletions: [dead('a', T2)] })
    expect(result.pushDeletions).toEqual(['a'])
    expect(result.push).toEqual([])
  })
})

describe('削除の往復 — ここが復活の起きる場所', () => {
  it('サーバで消された記録はローカルからも消す', () => {
    const result = plan({ local: [alive('a', T0)], remote: [dead('a', T2)] })
    expect(result.removeLocal).toEqual(['a'])
    expect(result.applyLocal).toEqual([])
  })

  it('**オフラインで消した記録が、サーバの古い値で復活しない**', () => {
    // 端末Aが T2 に削除 → まだ送れていない。サーバは T0 の生きた値を返す
    const result = plan({
      localDeletions: [dead('a', T2)],
      remote: [alive('a', T0)],
      lastSyncedAt: T1,
    })
    expect(result.applyLocal).toEqual([])
    expect(result.removeLocal).toEqual([])
    // 削除として送り返す。ここが抜けると次の pull で必ず生き返る
    expect(result.pushDeletions).toEqual(['a'])
  })

  it('両方で消していたら何もしない', () => {
    const result = plan({ localDeletions: [dead('a', T2)], remote: [dead('a', T3)] })
    expect(result.removeLocal).toEqual([])
    expect(result.pushDeletions).toEqual([])
  })

  it('削除より後の編集が勝つ(消した後に別端末が直したなら残る)', () => {
    const result = plan({ local: [alive('a', T3)], remote: [dead('a', T2)] })
    expect(result.push).toEqual(['a'])
    expect(result.removeLocal).toEqual([])
  })
})

describe('競合 — 両側が変わったとき', () => {
  it('新しいほうが勝ち、負けた側を黙って捨てない', () => {
    const result = plan({ local: [alive('a', T2)], remote: [alive('a', T3)], lastSyncedAt: T1 })
    expect(result.applyLocal).toEqual(['a'])
    expect(result.conflicts).toEqual([{ id: 'a', winner: 'remote', winnerDeleted: false }])
  })

  it('ローカルが新しければローカルが勝つ', () => {
    const result = plan({ local: [alive('a', T3)], remote: [alive('a', T2)], lastSyncedAt: T1 })
    expect(result.push).toEqual(['a'])
    expect(result.applyLocal).toEqual([])
    expect(result.conflicts).toEqual([{ id: 'a', winner: 'local', winnerDeleted: false }])
  })

  it('同点は remote を採る(全端末が同じ値に収束する向きを固定する)', () => {
    const result = plan({ local: [alive('a', T2)], remote: [alive('a', T2)], lastSyncedAt: T1 })
    expect(result.applyLocal).toEqual(['a'])
    expect(result.conflicts).toEqual([{ id: 'a', winner: 'remote', winnerDeleted: false }])
  })

  it('勝ったのが削除なら、そうと分かる形で返す(「直したのに消えた」を言えるように)', () => {
    const result = plan({ local: [alive('a', T2)], remote: [dead('a', T3)], lastSyncedAt: T1 })
    expect(result.removeLocal).toEqual(['a'])
    expect(result.conflicts).toEqual([{ id: 'a', winner: 'remote', winnerDeleted: true }])
  })

  it('ローカルが前回の同期より古いなら競合ではない(触っていないので負けようがない)', () => {
    const result = plan({ local: [alive('a', T0)], remote: [alive('a', T2)], lastSyncedAt: T1 })
    expect(result.applyLocal).toEqual(['a'])
    expect(result.conflicts).toEqual([])
  })
})

describe('壊れた時刻', () => {
  it('読めない `updatedAt` は勝たない', () => {
    const result = plan({
      local: [alive('a', 'ぬるぽ')],
      remote: [alive('a', T2)],
      lastSyncedAt: T1,
    })
    expect(result.applyLocal).toEqual(['a'])
    expect(result.push).toEqual([])
  })

  it('読めない時刻のサーバ値も勝たない(片側だけを甘くしない)', () => {
    const result = plan({
      local: [alive('a', T2)],
      remote: [alive('a', '')],
      lastSyncedAt: T1,
    })
    expect(result.push).toEqual(['a'])
    expect(result.applyLocal).toEqual([])
  })
})

describe('組み合わせ', () => {
  it('取り込み・送信・削除が同時に起きても混ざらない', () => {
    const result = plan({
      local: [alive('keep', T0), alive('mine', T2), alive('theirs', T0)],
      localDeletions: [dead('gone', T2)],
      remote: [alive('theirs', T3), alive('new', T3), dead('killed', T3)],
      lastSyncedAt: T1,
    })
    expect(result).toEqual({
      applyLocal: ['theirs', 'new'],
      removeLocal: [],
      push: ['mine'],
      pushDeletions: ['gone'],
      conflicts: [],
    })
    // `keep` は触っていないので何も起きない。`killed` は持っていないので消すものが無い
    expect(result.push).not.toContain('keep')
  })

  it('同じIDが生存と削除の両方に居たら削除を採る', () => {
    const result = plan({
      local: [alive('a', T2)],
      localDeletions: [dead('a', T3)],
      lastSyncedAt: T1,
    })
    expect(result.pushDeletions).toEqual(['a'])
    expect(result.push).toEqual([])
  })
})
