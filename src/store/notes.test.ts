// @vitest-environment node
//
// **node 環境で回す(aliases.test.ts と同じ理由)。** store 層は DOM を要らないので、
// node で回すこと自体が「notes.ts に window/document が混ざっていない」ことの実証になる。
//
// テストデータはすべて合成。実際の飲酒記録を転記しない。**日付は1つも出てこない**(B22 の台帳ガード)。

import { indexedDB as fakeIndexedDB, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb'
import { clear, closeDb } from './db.ts'
import {
  applyRemoteNotes,
  clearNoteDeletions,
  clearNotes,
  deleteNote,
  getNote,
  indexNotes,
  listNoteDeletions,
  listNotes,
  lookupNote,
  noteKey,
  noteKeyOf,
  putNote,
} from './notes.ts'

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

const T1 = '2020-01-01T00:00:00.000Z'
const T2 = '2020-01-02T00:00:00.000Z'

beforeEach(async () => {
  await clear('notes')
  await clear('noteDeletions')
})

afterEach(() => {
  closeDb()
})

describe('キーは宛先の種類を焼き込む', () => {
  // **これが型を1つにしても安全な理由そのもの。** 銘柄IDと蔵元IDは別の名前空間なのに
  // 値域が重なる(実データで銘柄ID 3264件のうち1352個が蔵元IDとしても存在する)。
  // 番号だけを鍵にすると、蔵元のメモが同じ番号の銘柄のメモを例外なしに消す
  it('同じ番号でも銘柄と蔵元で別のキーになる', () => {
    expect(noteKey('brand', 123)).not.toBe(noteKey('brewery', 123))
  })

  it('同じ番号の銘柄と蔵元に別々のメモを持てる', async () => {
    await putNote({ target: 'brand', targetId: 123, text: '銘柄のメモ' }, T1)
    await putNote({ target: 'brewery', targetId: 123, text: '蔵元のメモ' }, T1)

    expect((await getNote(noteKey('brand', 123)))?.text).toBe('銘柄のメモ')
    expect((await getNote(noteKey('brewery', 123)))?.text).toBe('蔵元のメモ')
    expect(await listNotes()).toHaveLength(2)
  })

  it('保存した行から同じキーを作れる', async () => {
    const stored = await putNote({ target: 'brewery', targetId: 7, text: 'あ' }, T1)
    expect(noteKeyOf(stored)).toBe(stored.key)
  })
})

describe('putNote', () => {
  it('前後の空白を落として保存する', async () => {
    const stored = await putNote({ target: 'brand', targetId: 1, text: '  書いた  ' }, T1)
    expect(stored.text).toBe('書いた')
  })

  // **空文字の生きている行を作らない。** 作ると「消した」の表現が2通りになり、
  // 同期の勝ち負けで別端末で消したメモが空の行として復活する
  it('空白だけのメモは保存せずに断る', async () => {
    await expect(putNote({ target: 'brand', targetId: 1, text: '   ' }, T1)).rejects.toThrow(
      /空/,
    )
    expect(await listNotes()).toEqual([])
  })

  it('宛先IDが正の整数でなければ断る', async () => {
    await expect(putNote({ target: 'brand', targetId: 0, text: 'あ' }, T1)).rejects.toThrow(/宛先/)
    await expect(putNote({ target: 'brand', targetId: -1, text: 'あ' }, T1)).rejects.toThrow(/宛先/)
  })

  it('同じ宛先は上書きし、行を増やさない', async () => {
    await putNote({ target: 'brand', targetId: 1, text: '古い' }, T1)
    await putNote({ target: 'brand', targetId: 1, text: '新しい' }, T2)
    const all = await listNotes()
    expect(all).toHaveLength(1)
    expect(all[0]?.text).toBe('新しい')
    expect(all[0]?.updatedAt).toBe(T2)
  })
})

describe('deleteNote', () => {
  it('消すと削除の記録が残る(同期先に「消した」と伝えるため)', async () => {
    await putNote({ target: 'brand', targetId: 1, text: 'あ' }, T1)
    expect(await deleteNote(noteKey('brand', 1), T2)).toBe(true)

    expect(await listNotes()).toEqual([])
    expect(await listNoteDeletions()).toEqual([{ key: noteKey('brand', 1), deletedAt: T2 }])
  })

  // **持っていなかったメモの削除を送らない。** 送ると、別端末が本当に書いた直後の値を
  // 「こちらで消した」として倒しかねない
  it('持っていなかったメモを消しても削除の記録を書かない', async () => {
    expect(await deleteNote(noteKey('brand', 999), T2)).toBe(false)
    expect(await listNoteDeletions()).toEqual([])
  })

  // **消してから書き直すと、生きている行と削除の記録が同じ鍵で同居する。**
  // メモの鍵は決定的(`noteKey`)なので、記録(id が uuid)と違ってこれが起きる。
  // 同居すると `planSync` が時刻を見ずに「消した」を採り、書き直した本文が送られないまま
  // 相手の端末からメモが消える
  it('消したあとに書き直すと、削除の記録が取り消される', async () => {
    await putNote({ target: 'brand', targetId: 1, text: '最初' }, T1)
    await deleteNote(noteKey('brand', 1), T2)
    expect(await listNoteDeletions()).toHaveLength(1)

    await putNote({ target: 'brand', targetId: 1, text: '書き直した' }, T2)

    expect(await listNoteDeletions()).toEqual([])
    expect((await getNote(noteKey('brand', 1)))?.text).toBe('書き直した')
  })

  it('別の宛先を書き直しても、他の宛先の削除の記録は残る', async () => {
    await putNote({ target: 'brand', targetId: 1, text: 'あ' }, T1)
    await deleteNote(noteKey('brand', 1), T2)
    await putNote({ target: 'brand', targetId: 2, text: 'い' }, T2)

    expect((await listNoteDeletions()).map((row) => row.key)).toEqual([noteKey('brand', 1)])
  })

  it('送信し終えた削除だけを捨てる', async () => {
    await putNote({ target: 'brand', targetId: 1, text: 'あ' }, T1)
    await putNote({ target: 'brand', targetId: 2, text: 'い' }, T1)
    await deleteNote(noteKey('brand', 1), T2)
    await deleteNote(noteKey('brand', 2), T2)

    await clearNoteDeletions([noteKey('brand', 1)])
    expect((await listNoteDeletions()).map((row) => row.key)).toEqual([noteKey('brand', 2)])
  })
})

describe('applyRemoteNotes — サーバ由来を当てる', () => {
  // **削除の記録を書かない。** 消すと決めたのはこの端末ではないので、書くと押し返して往復する
  it('リモートの削除を当てても、こちらの削除の記録は増えない', async () => {
    await putNote({ target: 'brand', targetId: 1, text: 'あ' }, T1)
    const result = await applyRemoteNotes({
      upserts: [],
      removals: [{ key: noteKey('brand', 1), expectedUpdatedAt: T1 }],
    })

    expect(result.removed).toEqual([noteKey('brand', 1)])
    expect(await listNotes()).toEqual([])
    expect(await listNoteDeletions()).toEqual([])
  })

  // **通信の間に本人が保存した編集を消さない。** 同期を始めた時点の時刻と一致するときだけ当てる
  it('同期の最中にこの端末で変わっていたら当てずに skipped に積む', async () => {
    await putNote({ target: 'brand', targetId: 1, text: '手元' }, T2)
    const result = await applyRemoteNotes({
      upserts: [
        {
          key: noteKey('brand', 1),
          note: { key: noteKey('brand', 1), target: 'brand', targetId: 1, text: 'サーバ', updatedAt: T2 },
          // 同期を始めた時点では T1 だった、という状況
          expectedUpdatedAt: T1,
        },
      ],
      removals: [],
    })

    expect(result.skipped).toEqual([noteKey('brand', 1)])
    expect((await getNote(noteKey('brand', 1)))?.text).toBe('手元')
  })

  it('存在しない行の削除は例外にせず黙って飛ばす', async () => {
    const result = await applyRemoteNotes({
      upserts: [],
      removals: [{ key: noteKey('brand', 404), expectedUpdatedAt: T1 }],
    })
    expect(result.removed).toEqual([])
    expect(result.skipped).toEqual([])
  })
})

describe('引く', () => {
  it('宛先の種類とIDで引ける', async () => {
    await putNote({ target: 'brand', targetId: 1, text: '銘柄' }, T1)
    await putNote({ target: 'brewery', targetId: 1, text: '蔵元' }, T1)
    const index = indexNotes(await listNotes())

    expect(lookupNote(index, 'brand', 1)?.text).toBe('銘柄')
    expect(lookupNote(index, 'brewery', 1)?.text).toBe('蔵元')
    // 定義域外は undefined。**全件のどれかに落ちない**
    expect(lookupNote(index, 'brand', 999)).toBeUndefined()
  })
})

describe('clearNotes', () => {
  // 取り込みの全置換と全データ削除がここを通る。**どちらも同期先への削除の意思表示ではない**
  it('全部消しても削除の記録は作らない', async () => {
    await putNote({ target: 'brand', targetId: 1, text: 'あ' }, T1)
    await clearNotes()

    expect(await listNotes()).toEqual([])
    expect(await listNoteDeletions()).toEqual([])
  })
})
