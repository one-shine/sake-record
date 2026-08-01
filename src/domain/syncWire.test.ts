// 同期でやり取りする形の検証。**サーバは自分のものだが、応答は境界の外から来る。**
//
// ここが緩いと、形の違う行が例外も出さずに IndexedDB に入り、以降その記録が画面で壊れる
// (しかも原因が同期だと気付けない)。domain 層なので DOM も IndexedDB も要らない。

import { describe, expect, it } from 'vitest'
import {
  checkPullResponse,
  checkPushResponse,
  isSyncAliasChange,
  isSyncAliasChangeShape,
  isSyncRecordBody,
  isSyncRecordChange,
  isSyncRecordChangeShape,
  type SyncRecordBody,
} from './syncWire.ts'

function body(id = 'r1', overrides: Partial<SyncRecordBody> = {}): SyncRecordBody {
  return {
    id,
    drankOn: '2026-08-01',
    brandLabel: '寫楽',
    sakenowaBrandId: null,
    brandName: null,
    linkStatus: 'unlinked',
    prefecture: '福島県',
    spec: '純米吟醸',
    rating: 4,
    place: '',
    note: '',
    sourceNo: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function alive(id = 'r1') {
  return {
    id,
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
    hasThumbnail: false,
    body: body(id),
  }
}

function deleted(id = 'r1') {
  return {
    id,
    updatedAt: '2026-08-01T00:00:00.000Z',
    deletedAt: '2026-08-02T00:00:00.000Z',
    hasThumbnail: false,
    body: null,
  }
}

const ALIAS = {
  key: '寫楽\u0000福島県',
  updatedAt: '2026-08-01T00:00:00.000Z',
  deletedAt: null,
  body: { label: '寫楽', prefecture: '福島県', brandId: 1234 },
}

describe('isSyncRecordBody', () => {
  it('記録の中身として読める', () => {
    expect(isSyncRecordBody(body())).toBe(true)
  })

  // **サムネイルを中身に載せる経路を作らない。** 載せると1件50KBが 1.37倍に膨らんだ文字列で
  // まとめて飛び、`store/backup.ts` が避けている巨大文字列がここで復活する
  it('サムネイルが混ざっていたら断る', () => {
    expect(isSyncRecordBody({ ...body(), thumbnail: null })).toBe(false)
    expect(isSyncRecordBody({ ...body(), thumbnail: 'data:image/jpeg;base64,AAAA' })).toBe(false)
  })

  it('項目が欠けていたら断る', () => {
    const { drankOn: _drankOn, ...missing } = body()
    expect(isSyncRecordBody(missing)).toBe(false)
  })

  it('日付の形が違えば断る', () => {
    expect(isSyncRecordBody(body('r1', { drankOn: '2026/08/01' }))).toBe(false)
  })

  it('オブジェクトでなければ断る', () => {
    expect(isSyncRecordBody(null)).toBe(false)
    expect(isSyncRecordBody([body()])).toBe(false)
    expect(isSyncRecordBody('x')).toBe(false)
  })
})

describe('isSyncRecordChange', () => {
  it('生きている記録', () => {
    expect(isSyncRecordChange(alive())).toBe(true)
  })

  it('削除した記録', () => {
    expect(isSyncRecordChange(deleted())).toBe(true)
  })

  // 片方だけ来る行はどちらとも解釈できる。生きていると扱えば中身が空の記録が増え、
  // 削除と扱えば生きている記録が消える
  it('生きているのに中身が無い行は断る', () => {
    expect(isSyncRecordChange({ ...alive(), body: null })).toBe(false)
  })

  it('削除なのに中身がある行は断る', () => {
    expect(isSyncRecordChange({ ...deleted(), body: body() })).toBe(false)
  })

  it('外側と中身で id が食い違う行は断る', () => {
    expect(isSyncRecordChange({ ...alive('r1'), body: body('r2') })).toBe(false)
  })

  it('更新時刻が無い行は断る(勝ち負けを決める鍵なので欠けると比較が壊れる)', () => {
    expect(isSyncRecordChange({ ...alive(), updatedAt: '' })).toBe(false)
    const { updatedAt: _updatedAt, ...missing } = alive()
    expect(isSyncRecordChange(missing)).toBe(false)
  })

  it('写真の有無が真偽値でない行は断る', () => {
    expect(isSyncRecordChange({ ...alive(), hasThumbnail: 'yes' })).toBe(false)
  })

  // サーバは中身を見ない(項目を足すたびに再デプロイしなくて済むように)。
  // 外側だけの判定は中身が壊れていても通る
  it('外側だけの判定は中身を見ない', () => {
    expect(isSyncRecordChangeShape({ ...alive(), body: { でたらめ: true } })).toBe(true)
    expect(isSyncRecordChange({ ...alive(), body: { でたらめ: true } })).toBe(false)
  })

  it('外側だけの判定でも id と更新時刻は要る', () => {
    expect(isSyncRecordChangeShape({ ...alive(), id: '' })).toBe(false)
    expect(isSyncRecordChangeShape({ ...alive(), updatedAt: '' })).toBe(false)
  })
})

describe('isSyncAliasChange', () => {
  it('生きている紐付け', () => {
    expect(isSyncAliasChange(ALIAS)).toBe(true)
  })

  it('消した紐付け', () => {
    expect(isSyncAliasChange({ ...ALIAS, deletedAt: '2026-08-02T00:00:00.000Z', body: null })).toBe(
      true,
    )
  })

  it('キーが空なら断る', () => {
    expect(isSyncAliasChange({ ...ALIAS, key: '' })).toBe(false)
  })

  it('銘柄IDが整数でなければ断る', () => {
    expect(isSyncAliasChange({ ...ALIAS, body: { ...ALIAS.body, brandId: 'x' } })).toBe(false)
  })

  it('外側だけの判定は中身を見ない', () => {
    expect(isSyncAliasChangeShape({ ...ALIAS, body: { でたらめ: true } })).toBe(true)
    expect(isSyncAliasChange({ ...ALIAS, body: { でたらめ: true } })).toBe(false)
  })
})

describe('checkPullResponse', () => {
  it('読めた変更を返す', () => {
    const check = checkPullResponse({
      cursor: 7,
      hasMore: false,
      records: [alive('r1')],
      aliases: [ALIAS],
    })
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.value.cursor).toBe(7)
    expect(check.value.records).toHaveLength(1)
    expect(check.value.aliases).toHaveLength(1)
    expect(check.value.dropped).toBe(0)
  })

  // **壊れた行だけ捨てて残りは通す**(1件のために全部を落とさない)。ただし捨てたことは数える
  it('形の違う行だけ捨てて数える', () => {
    const check = checkPullResponse({
      cursor: 1,
      records: [alive('r1'), { id: 'r2' }, alive('r3')],
      aliases: [ALIAS, { key: '' }],
    })
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.value.records.map((entry) => entry.id)).toEqual(['r1', 'r3'])
    expect(check.value.aliases).toHaveLength(1)
    expect(check.value.dropped).toBe(2)
  })

  // 位置が分からないまま先へ進むと、次回の `since` が狂って変更を取りこぼす。
  // **ここだけは失敗にする**(変更が0件なのは失敗ではない)
  it('位置が無い / 整数でない応答は失敗にする', () => {
    expect(checkPullResponse({ records: [], aliases: [] }).ok).toBe(false)
    expect(checkPullResponse({ cursor: 1.5, records: [], aliases: [] }).ok).toBe(false)
    expect(checkPullResponse({ cursor: -1, records: [], aliases: [] }).ok).toBe(false)
    expect(checkPullResponse({ cursor: '3', records: [], aliases: [] }).ok).toBe(false)
  })

  it('変更が0件でも成功', () => {
    const check = checkPullResponse({ cursor: 0, records: [], aliases: [] })
    expect(check.ok).toBe(true)
  })

  it('配列が無い応答は失敗にする', () => {
    expect(checkPullResponse({ cursor: 0, records: [] }).ok).toBe(false)
    expect(checkPullResponse({ cursor: 0, records: {}, aliases: [] }).ok).toBe(false)
  })

  it('JSON オブジェクトでなければ失敗にする', () => {
    expect(checkPullResponse(null).ok).toBe(false)
    expect(checkPullResponse('<html>').ok).toBe(false)
  })

  it('続きの有無は真偽値に畳む', () => {
    const yes = checkPullResponse({ cursor: 0, hasMore: true, records: [], aliases: [] })
    expect(yes.ok && yes.value.hasMore).toBe(true)
    const missing = checkPullResponse({ cursor: 0, records: [], aliases: [] })
    expect(missing.ok && missing.value.hasMore).toBe(false)
  })
})

describe('checkPushResponse', () => {
  it('件数と位置を返す', () => {
    const check = checkPushResponse({ cursor: 3, accepted: 2, rejected: 1 })
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.value).toEqual({ cursor: 3, accepted: 2, rejected: 1 })
  })

  it('採用0件でも成功(相手のほうが新しかっただけ)', () => {
    expect(checkPushResponse({ cursor: 3, accepted: 0, rejected: 5 }).ok).toBe(true)
  })

  it('位置や件数が欠けていれば失敗', () => {
    expect(checkPushResponse({ accepted: 0, rejected: 0 }).ok).toBe(false)
    expect(checkPushResponse({ cursor: 1, accepted: 0 }).ok).toBe(false)
    expect(checkPushResponse({ cursor: 1, accepted: '0', rejected: 0 }).ok).toBe(false)
  })
})
