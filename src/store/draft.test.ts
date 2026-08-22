// @vitest-environment node
//
// **node 環境で回す。** jsdom では `structuredClone` が Blob を例外も出さずに `{}` へ潰すので、
// バイト列が値として往復することを検査できない(`sync.test.ts` と同じ理由)。
//
// ここが守っているのは「書きかけが消えても戻せる」(B88)。守っていた `dirty` の確認は
// アプリ内の閉じる操作にしか効かず、iOS の PWA 破棄・SW 更新のリロード・タブ閉じでは
// 打った内容が黙って消えていた。

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { indexedDB as fakeIndexedDB, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb'
import { clearAll, closeDb, put } from './db.ts'
import {
  clearFormDraft,
  loadFormDraft,
  saveFormDraft,
  META_FORM_DRAFT,
  type FormDraft,
} from './draft.ts'

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

function draft(over: Partial<FormDraft> = {}): FormDraft {
  return {
    editingId: null,
    drankOn: '2026-08-22',
    brandLabel: 'てすとしゅ',
    link: null,
    linkCleared: false,
    spec: '',
    rating: null,
    place: '',
    note: '',
    thumbnail: null,
    savedAt: '2026-08-22T10:00:00.000Z',
    ...over,
  }
}

beforeEach(async () => {
  await clearAll()
})

afterAll(() => {
  closeDb()
})

describe('書きかけの退避(B88)', () => {
  it('退避したものがそのまま戻る', async () => {
    const value = draft({
      brandLabel: '紀土',
      spec: '純米大吟醸',
      rating: 4,
      place: '自宅',
      note: 'めも',
      link: {
        brandId: 101,
        brandName: '紀土',
        prefecture: '和歌山県',
        breweryName: '平和酒造',
        origin: 'picked',
      },
    })

    await saveFormDraft(value)

    expect(await loadFormDraft()).toEqual(value)
  })

  // **バイト列で持つ**(B72)。`Blob` は IndexedDB に参照として入り、iOS が実体を回収する
  it('サムネイルがバイト列として往復する', async () => {
    const bytes = new Uint8Array([255, 216, 255, 1]).buffer
    await saveFormDraft(draft({ thumbnail: bytes }))

    const back = await loadFormDraft()

    expect(back?.thumbnail).toBeInstanceOf(ArrayBuffer)
    expect([...new Uint8Array(back?.thumbnail ?? new ArrayBuffer(0))]).toEqual([255, 216, 255, 1])
  })

  // 同時に開けるフォームは1つ。溜め込むと消し忘れが残り、どれが最新か分からなくなる
  it('新しい下書きが古いものを上書きする', async () => {
    await saveFormDraft(draft({ note: 'ふるい' }))
    await saveFormDraft(draft({ note: 'あたらしい' }))

    expect((await loadFormDraft())?.note).toBe('あたらしい')
  })

  it('捨てたら残らない', async () => {
    await saveFormDraft(draft())
    await clearFormDraft()

    expect(await loadFormDraft()).toBeNull()
  })

  it('何も退避していなければ null', async () => {
    expect(await loadFormDraft()).toBeNull()
  })

  // **部分的に復元しない。** 途中まで入った値のほうが、何も無いより危ない
  // (本人は全部戻ったつもりで保存する)
  it.each([
    ['形が違う値', 'ただの文字列'],
    ['時刻が無い', { drankOn: '2026-08-22' }],
    ['日付が無い', { savedAt: '2026-08-22T10:00:00.000Z' }],
    ['編集対象が文字列でも null でもない', { savedAt: 'x', drankOn: 'y', editingId: 7 }],
  ])('読めない下書きは %s でも null を返す', async (_name, stored) => {
    await put('meta', stored, META_FORM_DRAFT)

    expect(await loadFormDraft()).toBeNull()
  })

  // 壊れた入れ子は「無かったこと」にして本文だけ戻す。ここで全部捨てると、
  // 紐付けの1項目が壊れただけで打った本文まで失う
  it('紐付けだけが壊れていたら、紐付けを外して本文は戻す', async () => {
    await put(
      'meta',
      { ...draft({ note: 'のこす' }), link: { brandName: '名前だけ' } },
      META_FORM_DRAFT,
    )

    const back = await loadFormDraft()

    expect(back?.link).toBeNull()
    expect(back?.note).toBe('のこす')
  })

  // 評価は 1..5 だけ。範囲外が入っていたら未評価に落とす(嘘の評価を台帳に入れない)
  it('範囲外の評価は未評価に落とす', async () => {
    await put('meta', { ...draft(), rating: 9 }, META_FORM_DRAFT)

    expect((await loadFormDraft())?.rating).toBeNull()
  })
})
