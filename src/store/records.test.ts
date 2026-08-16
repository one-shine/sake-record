// @vitest-environment node
//
// **node 環境で回す(db.test.ts と同じ理由)。** vitest の jsdom 環境は jsdom の `Blob` と
// Node の `structuredClone` を混ぜるので、IndexedDB に入れた Blob が例外も出さずに `{}` へ潰れる。
// サムネイル付きの記録を保存するテストが jsdom では嘘の緑になるため、store 層は node で回す。
//
// テストデータは**すべて合成**。実際の飲酒記録(`data/seed/` は gitignore)を転記しない。
// 日付・銘柄名は架空の値で、リテラルの日付は種類を最小限に留める(BACKLOG B22 の台帳ガード)。
import { indexedDB as fakeIndexedDB, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb'
import type { SakeLogRow } from '../domain/parseSakeLog.ts'
import type { LinkResult, Linker, SakeRecord } from '../domain/types.ts'
import { clearAll, closeDb, get, getAll, put } from './db.ts'
import type { StoredAlias } from './db.ts'
import {
  byNewestFirst,
  checkImportRows,
  clearRecords,
  createRecord,
  clearDeletions,
  deleteRecord,
  listDeletions,
  getRecord,
  importRows,
  listRecords,
  updateRecord,
  type NewRecord,
} from './records.ts'

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

/** createRecord に渡す入力。既定は「まだ何も紐付いていない1本」 */
function newInput(over: Partial<NewRecord> = {}): NewRecord {
  return {
    drankOn: '2020-01-01',
    brandLabel: 'テスト酒',
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
    ...over,
  }
}

/** DB に直接置く合成レコード(createdAt を狙った値にしたいときに使う) */
function stored(over: Partial<SakeRecord> = {}): SakeRecord {
  return {
    id: 'id-1',
    ...newInput(),
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    ...over,
  }
}

function row(over: Partial<SakeLogRow> = {}): SakeLogRow {
  return { no: 1, drankOn: '2025-01-01', brandLabel: '架空酒', prefecture: '', spec: '', note: '', ...over }
}

const UNLINKED: LinkResult = { brandId: null, brandName: null, status: 'unlinked', candidates: [] }

/** 銘柄表記 → 紐付け結果 の対応表だけを持つスタブ。呼ばれた引数を記録する */
function stubLinker(results: Record<string, LinkResult> = {}): {
  link: Linker
  calls: { label: string; prefecture: string | null }[]
} {
  const calls: { label: string; prefecture: string | null }[] = []
  const link: Linker = (label, prefecture) => {
    calls.push({ label, prefecture })
    return results[label] ?? UNLINKED
  }
  return { link, calls }
}

/** さけのわテーブルの代わり。brandId → 県名 の対応表だけを持つ */
function stubTables(prefectureByBrandId: Record<number, string> = {}) {
  return { prefectureOfBrand: (brandId: number) => prefectureByBrandId[brandId] ?? null }
}

const linked = (brandId: number, brandName: string, status: 'auto' | 'alias' | 'manual'): LinkResult => ({
  brandId,
  brandName,
  status,
  candidates: [],
})

/**
 * 203件規模の合成行。**同日に最大7件**が並ぶ塊にする(実データの癖: `drankOn` は一意でない)。
 * 日付はリテラルで書かずに組み立てる(台帳ガードに引っかからないように)。
 */
function syntheticRows(count: number): SakeLogRow[] {
  return Array.from({ length: count }, (_, i) => {
    const day = Math.floor(i / 7)
    const month = String(1 + (day % 12)).padStart(2, '0')
    const date = String(1 + Math.floor(day / 12)).padStart(2, '0')
    return row({
      no: i + 1,
      drankOn: `2023-${month}-${date}`,
      // 同じ銘柄表記が何度も現れる(同日同銘柄の衝突も起きる)
      brandLabel: `合成酒${i % 5}`,
    })
  })
}

beforeEach(async () => {
  await clearAll()
})

afterEach(() => {
  vi.useRealTimers()
})

afterAll(() => {
  closeDb()
})

// ---------------------------------------------------------------------------
// createRecord / getRecord
// ---------------------------------------------------------------------------

describe('createRecord', () => {
  it('id と createdAt / updatedAt を埋めて保存し、getRecord で同じ内容が戻る', async () => {
    const created = await createRecord(newInput({ brandLabel: 'テスト酒', spec: '純米大吟醸' }))

    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(created.createdAt).toBe(created.updatedAt)
    expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false)
    expect(await getRecord(created.id)).toEqual(created)
  })

  it('id は毎回違う(同じ内容を連続で作っても衝突しない)', async () => {
    const ids = new Set<string>()
    for (let i = 0; i < 50; i++) ids.add((await createRecord(newInput())).id)
    expect(ids.size).toBe(50)
    expect(await getAll('records')).toHaveLength(50)
  })

  it('サムネイルのバイト列が長さごと保存される(Phase 4 の経路)', async () => {
    const thumbnail = new Uint8Array([255, 216, 255, 224]).buffer
    const created = await createRecord(newInput({ thumbnail }))

    const loaded = (await getRecord(created.id))?.thumbnail
    // Blob で保存すると iOS で実体だけが失われる(B72)。保存形はバイト列
    expect(loaded).toBeInstanceOf(ArrayBuffer)
    expect(loaded?.byteLength).toBe(4)
    expect([...new Uint8Array(loaded as ArrayBuffer)]).toEqual([255, 216, 255, 224])
  })

  it('crypto.randomUUID が無い環境(secure context でない実機確認)でも v4 の id を作る', async () => {
    const original = crypto.randomUUID
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      const a = await createRecord(newInput())
      const b = await createRecord(newInput())
      expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(a.id).not.toBe(b.id)
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true })
    }
  })
})

describe('getRecord', () => {
  it('未知の id は undefined(全件に落ちない)', async () => {
    await createRecord(newInput())
    expect(await getRecord('no-such-id')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// updateRecord
// ---------------------------------------------------------------------------

describe('updateRecord', () => {
  it('指定した項目だけを変え、updatedAt を進める(id / createdAt は不変)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'))
    const created = await createRecord(newInput({ rating: null, note: '' }))

    vi.setSystemTime(new Date('2020-01-02T00:00:00.000Z'))
    const updated = await updateRecord(created.id, { rating: 4, note: 'あとで書いたメモ' })

    expect(updated.id).toBe(created.id)
    expect(updated.createdAt).toBe('2020-01-01T00:00:00.000Z')
    expect(updated.updatedAt).toBe('2020-01-02T00:00:00.000Z')
    expect(updated.rating).toBe(4)
    expect(updated.note).toBe('あとで書いたメモ')
    // 触っていない項目はそのまま
    expect(updated.brandLabel).toBe(created.brandLabel)
    expect(await getRecord(created.id)).toEqual(updated)
  })

  it('null を渡すと明示的に消せる(undefined は「指定なし」)', async () => {
    const created = await createRecord(newInput({ rating: 5, prefecture: '架空県' }))

    const cleared = await updateRecord(created.id, { rating: null, prefecture: undefined })

    expect(cleared.rating).toBeNull()
    expect(cleared.prefecture).toBe('架空県')
  })

  it('紐付けの4項目をまとめて差し替えられる(Phase 5 の手動紐付け)', async () => {
    const created = await createRecord(newInput())

    const linkedRecord = await updateRecord(created.id, {
      sakenowaBrandId: 42,
      brandName: '架空銘柄',
      linkStatus: 'manual',
      prefecture: '架空県',
    })

    expect(linkedRecord.sakenowaBrandId).toBe(42)
    expect(linkedRecord.brandName).toBe('架空銘柄')
    expect(linkedRecord.linkStatus).toBe('manual')
  })

  it('存在しない id は理由付きで失敗する(無音で成功しない / 新規作成もしない)', async () => {
    await expect(updateRecord('no-such-id', { rating: 3 })).rejects.toThrow(/no-such-id/)
    expect(await getAll('records')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// deleteRecord
// ---------------------------------------------------------------------------

describe('deleteRecord', () => {
  it('1件だけ消す', async () => {
    const a = await createRecord(newInput())
    const b = await createRecord(newInput())

    await deleteRecord(a.id)

    expect(await getRecord(a.id)).toBeUndefined()
    expect((await getAll('records')).map((record) => record.id)).toEqual([b.id])
  })

  it('削除の記録を残す — これが無いと次の同期でサーバから復活する(PHASE 8)', async () => {
    const a = await createRecord(newInput())
    await deleteRecord(a.id, '2026-08-01T00:00:00.000Z')

    expect(await listDeletions()).toEqual([{ id: a.id, deletedAt: '2026-08-01T00:00:00.000Z' }])
  })

  // 守っているのは書く順序ではなく**トランザクションの原子性**(失敗すれば削除の記録も巻き戻る)。
  // 順序を入れ替えても通るのはそのため — ここが赤くなるのは別々のトランザクションに割ったとき
  it('存在しない記録を消しても削除の記録は作らない(在るものを消す指示を送ってしまう)', async () => {
    await expect(deleteRecord('no-such-id')).rejects.toThrow()

    expect(await listDeletions()).toEqual([])
  })

  it('送り終えた削除の記録だけを捨てる(まとめて全消しすると未送信の削除が失われる)', async () => {
    const a = await createRecord(newInput())
    const b = await createRecord(newInput())
    await deleteRecord(a.id)
    await deleteRecord(b.id)

    await clearDeletions([a.id])

    expect((await listDeletions()).map((row) => row.id)).toEqual([b.id])
  })

  it('存在しない id は理由付きで失敗する(IDB の delete は空振りでも成功するので自分で見る)', async () => {
    const a = await createRecord(newInput())
    await expect(deleteRecord('no-such-id')).rejects.toThrow(/no-such-id/)
    expect(await getAll('records')).toHaveLength(1)
    expect(await getRecord(a.id)).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// listRecords — 表示順
// ---------------------------------------------------------------------------

describe('listRecords', () => {
  it('空なら空配列', async () => {
    expect(await listRecords()).toEqual([])
  })

  it('drankOn の降順(新しい順)', async () => {
    await put('records', stored({ id: 'old', drankOn: '2024-05-05' }))
    await put('records', stored({ id: 'new', drankOn: '2024-05-06' }))

    expect((await listRecords()).map((record) => record.id)).toEqual(['new', 'old'])
  })

  it('同じ drankOn の3件は createdAt の降順(第2キーが無いと順序が非決定になる)', async () => {
    // 挿入順は表示順と無関係にしておく(索引の並びに頼っていないことを見る)
    await put('records', stored({ id: 'mid', drankOn: '2024-05-05', createdAt: '2024-05-05T00:00:01.000Z' }))
    await put('records', stored({ id: 'last', drankOn: '2024-05-05', createdAt: '2024-05-05T00:00:00.000Z' }))
    await put('records', stored({ id: 'first', drankOn: '2024-05-05', createdAt: '2024-05-05T00:00:02.000Z' }))

    expect((await listRecords()).map((record) => record.id)).toEqual(['first', 'mid', 'last'])
  })

  it('drankOn も createdAt も同じ2件でも順序が決まる(sourceNo の降順 = 元ログの No. 逆順)', async () => {
    const at = '2024-05-05T00:00:00.000Z'
    await put('records', stored({ id: 'a', drankOn: '2024-05-05', createdAt: at, sourceNo: 10 }))
    await put('records', stored({ id: 'b', drankOn: '2024-05-05', createdAt: at, sourceNo: 11 }))

    expect((await listRecords()).map((record) => record.id)).toEqual(['b', 'a'])
    // 2回呼んでも同じ(比較関数が全順序を作っている)
    expect((await listRecords()).map((record) => record.id)).toEqual(['b', 'a'])
  })

  it('byNewestFirst は全項目が同値でも 0 を返して落ちない(同一レコードの比較)', () => {
    const record = stored()
    expect(byNewestFirst(record, record)).toBe(0)
  })

  it('後から編集しても表示順は動かない(updatedAt はソートキーではない)', async () => {
    await put('records', stored({ id: 'old', drankOn: '2024-05-05' }))
    await put('records', stored({ id: 'new', drankOn: '2024-05-06' }))

    // 古い方にメモを足す。「最近いじった順」に化けると時系列リストの意味が消える
    await updateRecord('old', { note: '後から書いたメモ' })

    expect((await listRecords()).map((record) => record.id)).toEqual(['new', 'old'])
  })
})

// ---------------------------------------------------------------------------
// importRows
// ---------------------------------------------------------------------------

describe('importRows', () => {
  it('同日・同銘柄の2行を2件として保存する(dedupe しない / id が衝突しない)', async () => {
    const { link } = stubLinker()
    const rows = [
      row({ no: 1, drankOn: '2025-01-01', brandLabel: '架空酒' }),
      row({ no: 2, drankOn: '2025-01-01', brandLabel: '架空酒' }),
    ]

    const saved = await importRows(rows, link, stubTables())

    expect(saved).toHaveLength(2)
    expect(new Set(saved.map((record) => record.id)).size).toBe(2)
    expect(await getAll('records')).toHaveLength(2)
    expect(saved.map((record) => record.sourceNo)).toEqual([1, 2])
  })

  it('createdAt を No. 昇順に厳密増加で振り、表示は No. の降順になる', async () => {
    const { link } = stubLinker()
    const rows = [1, 2, 3].map((no) => row({ no, drankOn: '2025-01-01' }))

    const saved = await importRows(rows, link, stubTables())

    for (let i = 1; i < saved.length; i++) {
      expect(saved[i].createdAt > saved[i - 1].createdAt).toBe(true)
    }
    expect((await listRecords()).map((record) => record.sourceNo)).toEqual([3, 2, 1])
  })

  it('入力が No. 昇順でなくても createdAt は No. 順に振る(渡した配列は並べ替えない)', async () => {
    const { link } = stubLinker()
    const rows = [row({ no: 3 }), row({ no: 1 }), row({ no: 2 })]

    const saved = await importRows(rows, link, stubTables())

    expect(saved.map((record) => record.sourceNo)).toEqual([1, 2, 3])
    // 呼び側(取り込み画面のプレビュー)が同じ配列を持ち続けるので、副作用で並べ替えない
    expect(rows.map((r) => r.no)).toEqual([3, 1, 2])
    expect(saved[0].createdAt < saved[1].createdAt).toBe(true)
    expect(saved[1].createdAt < saved[2].createdAt).toBe(true)
  })

  it('linker の結果(brandId / brandName / status)をそのまま記録に写す', async () => {
    const { link } = stubLinker({
      自動酒: linked(11, 'さけのわ自動酒', 'auto'),
      別名酒: linked(22, 'さけのわ別名酒', 'alias'),
      未紐付け酒: UNLINKED,
      不明: { brandId: null, brandName: null, status: 'unknown', candidates: [] },
    })
    const rows = ['自動酒', '別名酒', '未紐付け酒', '不明'].map((brandLabel, i) =>
      row({ no: i + 1, brandLabel }),
    )

    const saved = await importRows(rows, link, stubTables())

    expect(saved.map((record) => record.linkStatus)).toEqual(['auto', 'alias', 'unlinked', 'unknown'])
    expect(saved.map((record) => record.sakenowaBrandId)).toEqual([11, 22, null, null])
    expect(saved.map((record) => record.brandName)).toEqual([
      'さけのわ自動酒',
      'さけのわ別名酒',
      null,
      null,
    ])
    // 生の表記は原本として残す(正規化した値で上書きしない)
    expect(saved.map((record) => record.brandLabel)).toEqual(['自動酒', '別名酒', '未紐付け酒', '不明'])
  })

  it('紐付いたら都道府県は さけのわ 由来、紐付かなければログ由来', async () => {
    const { link } = stubLinker({ 自動酒: linked(11, 'さけのわ自動酒', 'auto') })
    const rows = [
      row({ no: 1, brandLabel: '自動酒', prefecture: 'ログ県' }),
      row({ no: 2, brandLabel: '未紐付け酒', prefecture: 'ログ県' }),
    ]

    const saved = await importRows(rows, link, stubTables({ 11: 'さけのわ県' }))

    expect(saved[0].prefecture).toBe('さけのわ県')
    expect(saved[1].prefecture).toBe('ログ県')
  })

  it('紐付いても さけのわ 側の県が引けなければログの県を残す(既定の県に落とさない)', async () => {
    const { link } = stubLinker({ 自動酒: linked(11, 'さけのわ自動酒', 'auto') })

    const saved = await importRows(
      [row({ brandLabel: '自動酒', prefecture: 'ログ県' })],
      link,
      stubTables(),
    )

    expect(saved[0].prefecture).toBe('ログ県')
  })

  it('ログの都道府県が未記入(空文字)なら null にし、linker にも null を渡す', async () => {
    const { link, calls } = stubLinker()

    const saved = await importRows([row({ prefecture: '  ' })], link, stubTables())

    expect(saved[0].prefecture).toBeNull()
    expect(calls).toEqual([{ label: '架空酒', prefecture: null }])
  })

  it('未評価 / 写真なし / 場所なしで取り込む(203本は写真が1枚も無い)', async () => {
    const { link } = stubLinker()

    const saved = await importRows([row({ spec: '純米', note: '合成のメモ' })], link, stubTables())

    expect(saved[0].rating).toBeNull()
    expect(saved[0].thumbnail).toBeNull()
    expect(saved[0].place).toBe('')
    expect(saved[0].spec).toBe('純米')
    expect(saved[0].note).toBe('合成のメモ')
    expect(saved[0].updatedAt).toBe(saved[0].createdAt)
  })

  it('空配列なら0件(失敗しない)', async () => {
    const { link } = stubLinker()
    expect(await importRows([], link, stubTables())).toEqual([])
    expect(await getAll('records')).toEqual([])
  })

  it('既存の記録を消さない(全置換は呼び側が clearRecords してから呼ぶ)', async () => {
    const existing = await createRecord(newInput())
    const { link } = stubLinker()

    await importRows([row()], link, stubTables())

    expect(await getAll('records')).toHaveLength(2)
    expect(await getRecord(existing.id)).toBeDefined()
  })

  it('1行でも形が違えば1件も保存しない(203件のうち1件だけ欠けた状態を静かに作らない)', async () => {
    const { link } = stubLinker()
    const rows = [row({ no: 1 }), row({ no: 2, drankOn: '2025/01/01' }), row({ no: 3 })]

    await expect(importRows(rows, link, stubTables())).rejects.toThrow(/No\. 2/)
    expect(await getAll('records')).toEqual([])
  })

  it('203件規模でも件数と同日の並びが保たれる', async () => {
    const { link } = stubLinker()

    const saved = await importRows(syntheticRows(203), link, stubTables())
    expect(saved).toHaveLength(203)

    const listed = await listRecords()
    expect(listed).toHaveLength(203)
    expect(new Set(listed.map((record) => record.id)).size).toBe(203)
    // 同じ日付の中は sourceNo(元ログの No.)の降順に並ぶ
    const byDate = new Map<string, number[]>()
    for (const record of listed) {
      const bucket = byDate.get(record.drankOn) ?? []
      bucket.push(record.sourceNo as number)
      byDate.set(record.drankOn, bucket)
    }
    for (const [drankOn, numbers] of byDate) {
      expect(numbers, drankOn).toEqual([...numbers].sort((a, b) => b - a))
    }
    // 日付は降順
    const dates = [...byDate.keys()]
    expect(dates).toEqual([...dates].sort().reverse())
  })
})

// ---------------------------------------------------------------------------
// checkImportRows — ファイル境界の検証
// ---------------------------------------------------------------------------

describe('checkImportRows', () => {
  it('行の配列なら ok', () => {
    const check = checkImportRows([row()])
    expect(check.ok).toBe(true)
    if (check.ok) expect(check.rows).toHaveLength(1)
  })

  it('配列でなければ理由を返す(バックアップ JSON を取り込み欄に入れた場合)', () => {
    const check = checkImportRows({ schemaVersion: 1, exportedAt: '', records: [], aliases: [] })
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/配列/)
  })

  it('日付の形が違う行を弾く', () => {
    const check = checkImportRows([row({ no: 7, drankOn: '2025-1-1' })])
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/No\. 7/)
  })

  it('No. が整数でない行を弾く', () => {
    const check = checkImportRows([{ ...row(), no: '1' }])
    expect(check.ok).toBe(false)
  })

  it('文字列の項目が欠けている行を弾く', () => {
    const { note: _note, ...withoutNote } = row()
    expect(checkImportRows([withoutNote]).ok).toBe(false)
    expect(checkImportRows([{ ...row(), brandLabel: null }]).ok).toBe(false)
  })

  it('空配列は ok(0件の取り込み)', () => {
    expect(checkImportRows([]).ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// clearRecords
// ---------------------------------------------------------------------------

describe('clearRecords', () => {
  it('records だけを空にする(aliases / meta は残す)', async () => {
    await createRecord(newInput())
    const alias: StoredAlias = {
      label: 'てすとしゅ',
      prefecture: null,
      brandId: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    await put('aliases', alias, 'てすとしゅ')
    await put('meta', 'x', 'lastExportedAt')

    await clearRecords()

    expect(await getAll('records')).toEqual([])
    expect(await getAll('aliases')).toHaveLength(1)
    expect(await get('meta', 'lastExportedAt')).toBe('x')
  })
})

// **未記入の県が `''` と `null` の2通りで保存されていた(B62)。** `value ?? '未記入'` は
// `''` では発火しないので、画面にラベルの空のピルが出ていた(B37 と同じ形)。
// 新しく入る値は書き込みの入口で畳む。**既存の行は書き換えない**(更新時刻を動かさない)
describe('都道府県の未記入を書き込みの入口で畳む(B62)', () => {
  it('空文字で作った記録は null で保存される', async () => {
    const created = await createRecord(newInput({ prefecture: '' }))

    expect(created.prefecture).toBeNull()
    expect((await getRecord(created.id))?.prefecture).toBeNull()
  })

  it('空白だけの県も null にする', async () => {
    const created = await createRecord(newInput({ prefecture: '  　 ' }))
    expect(created.prefecture).toBeNull()
  })

  it('県名は前後の空白だけ落として残す(表記ゆれは吸収しない)', async () => {
    const created = await createRecord(newInput({ prefecture: ' 福島県 ' }))
    expect(created.prefecture).toBe('福島県')
  })

  it('編集で空文字にしても null で保存される', async () => {
    const created = await createRecord(newInput({ prefecture: '福島県' }))

    const updated = await updateRecord(created.id, { prefecture: '' })

    expect(updated.prefecture).toBeNull()
    expect((await getRecord(created.id))?.prefecture).toBeNull()
  })

  // **触っていない項目は畳まない。** `undefined` は「触っていない」の意味で、
  // 既存の値をそのまま残す(`patched` の契約そのもの)
  it('県に触らない編集では既存の値をそのまま残す', async () => {
    const created = await createRecord(newInput({ prefecture: '福島県' }))

    const updated = await updateRecord(created.id, { place: '架空バー' })

    expect(updated.prefecture).toBe('福島県')
  })

  // **既存の `''` を巻き添えで書き換えない。** 畳むのは「この書き込みが実際に置く値」だけで、
  // 触っていない項目まで直すと `patched` の契約(`undefined` = 触っていない)が嘘になる。
  // 過去の行を直したいなら移行として明示的にやる(黙って書き換える経路にしない)
  it('版上げ前に保存された空文字は、県に触らない編集では書き換えない', async () => {
    // `createRecord` は畳むので、古い形は DB に直接置いて作る
    const legacy = { ...stored({ id: 'legacy' }), prefecture: '' }
    await put('records', legacy)

    const updated = await updateRecord('legacy', { place: '架空バー' })

    expect(updated.prefecture).toBe('')
    expect((await getRecord('legacy'))?.prefecture).toBe('')
  })
})
