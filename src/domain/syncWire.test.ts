// 同期でやり取りする形の検証。**サーバは自分のものだが、応答は境界の外から来る。**
//
// ここが緩いと、形の違う行が例外も出さずに IndexedDB に入り、以降その記録が画面で壊れる
// (しかも原因が同期だと気付けない)。domain 層なので DOM も IndexedDB も要らない。

import { describe, expect, it } from 'vitest'
import {
  checkPullResponse,
  decodeSyncCredential,
  encodeSyncCredential,
  checkPushResponse,
  isSyncAliasChange,
  isSyncAliasChangeShape,
  isSyncRecordBody,
  isSyncRecordChange,
  isSyncRecordChangeShape,
  type SyncRecordBody,
  SYNC_SCHEMA_VERSION,
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

// **版を上げないと、失敗が画面に出ないまま壊れる。** 旧サーバは push の本体から records / aliases しか
// 読まないので、notes は知らないキーとして捨てられて 200 が返る。端末はそれを成功と受け取って
// 位置を進めるため、そのメモは二度と送られない(例外も出ず画面は正常)。
// 版を上げれば旧サーバが明示的に断るので、「同期できない」と画面に出る形になる。
describe('SYNC_SCHEMA_VERSION', () => {
  it('メモ(notes)を運ぶ版は 2', () => {
    expect(SYNC_SCHEMA_VERSION).toBe(2)
  })
})

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

// **合言葉をそのままヘッダに載せると `fetch` が例外を投げる**(ヘッダの値は1バイト文字だけ)。
// 実際に踏んだ: 日本語の合言葉で「index 7 の文字が 255 を超える」と落ちた。
// ブラウザでも同じなので、ここが緩むと日本語の合言葉ではアプリから同期できなくなる。
describe('合言葉の運び方', () => {
  it('日本語の合言葉が1バイト文字だけになる', () => {
    const encoded = encodeSyncCredential('日本語のあいことば')
    expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/)
    // ヘッダに載る形か(ByteString に変換できるか)を実際に確かめる
    expect(() => new Headers({ Authorization: `Bearer ${encoded}` })).not.toThrow()
  })

  it('そのまま載せると落ちることを固定する(この検査が変換の存在理由)', () => {
    expect(() => new Headers({ Authorization: 'Bearer 日本語のあいことば' })).toThrow()
  })

  it('元に戻る', () => {
    for (const password of ['日本語のあいことば', 'plain-ascii-password-1234', '絵と英字 mixed 混在', '𠮟責を含む']) {
      expect(decodeSyncCredential(encodeSyncCredential(password))).toBe(password)
    }
  })

  it('戻せない値は null(例外にしない)', () => {
    // 形の違う値が来るのは総当たりの一部。その都度例外を投げると
    // 失敗の理由が「サーバの不具合」に化ける
    expect(decodeSyncCredential('!!!not base64!!!')).toBeNull()
    expect(decodeSyncCredential('')).toBe('')
    // base64 としては読めるが UTF-8 として壊れている
    expect(decodeSyncCredential(btoa(String.fromCharCode(0xff, 0xfe)))).toBeNull()
  })

  it('長い合言葉でも落ちない(引数展開でスタックを飛ばさない)', () => {
    const long = 'あ'.repeat(20000)
    expect(decodeSyncCredential(encodeSyncCredential(long))).toBe(long)
  })
})
