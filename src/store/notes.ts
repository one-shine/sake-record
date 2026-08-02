// 銘柄・蔵元のメモ(B76)の永続化。
//
// 依存方向は domain ← store ← ui。ここは store 層なので domain / data を import してよい(逆は不可)。
// 生の IndexedDB には触らず db.ts のラッパだけを通す。
//
// ## `aliases` と同じ形を写している
//
// メモは「銘柄(または蔵元) → 本人が書いた文字列」で、手動紐付けと同じく**記録1件に閉じない判断**。
// 保存・削除の記録・リモート由来の反映は `store/aliases.ts` と同じ規律で書く:
//
// - **書き直したら削除の記録を取り消す**(`putNote`)。鍵が決定的なので、消してから書き直すと
//   生きている行と削除の記録が同じ鍵で同居し、`planSync` は同居したら「消した」を採る
// - 削除は `noteDeletions` に**別ストアで**書く(`deletions` / `aliasDeletions` に相乗りさせない —
//   送信に成功した分を捨てるときに巻き添えで消え、消したメモが復活する)
// - **持っていなかったメモの削除を送らない**(送ると別端末が書いた直後の値を倒しかねない)
// - リモート由来の反映に `putNote` / `deleteNote` を再利用しない。前者は削除の記録を書かず、
//   後者は**同期を始めた時点の `updatedAt` と一致するときだけ**当てる(通信の間に本人が
//   書いた編集を消さない)
//
// ## 空文字を保存しない
//
// 本文が空になったら**削除**に落とす(`putNote` が断る)。「空文字のまま生きている行」を作ると
// 消したことの表現が2通りになり、同期の勝ち負けで**別端末で消したメモが空の行として復活する**。

import type { BrandNote, NoteTarget } from '../domain/types.ts'
import { clear, get, getAll, noteKey, req, tx } from './db.ts'
import type { NoteDeletion, StoredNote } from './db.ts'

/** キーの作り方も保存形も db.ts が持つ。UI が db.ts を直接 import しないよう再輸出する */
export { noteKey } from './db.ts'
export type { StoredNote } from './db.ts'

/** 保存されている行からキーを作る(呼び側が組み立て方を知らなくて済む) */
export function noteKeyOf(note: BrandNote): string {
  return noteKey(note.target, note.targetId)
}

export function listNotes(): Promise<StoredNote[]> {
  return getAll('notes')
}

/** 1件だけ引く。無ければ `undefined` */
export function getNote(key: string): Promise<StoredNote | undefined> {
  return get('notes', key)
}

/**
 * 1件保存する(同じキーは上書き)。
 *
 * **前後の空白を落とす。** 落とさないと、見た目が空のメモが「空でない行」として保存され、
 * 削除の経路に落ちなくなる。落とした結果が空なら**保存せずに断る** — 空にする操作は
 * `deleteNote` に行かせる(消したことの表現を1つに保つ)。
 */
export async function putNote(
  note: BrandNote,
  updatedAt: string = new Date().toISOString(),
): Promise<StoredNote> {
  const text = note.text.trim()
  if (text === '') {
    throw new Error('メモが空。空にするなら deleteNote を使う(空の行を保存しない)')
  }
  if (!Number.isInteger(note.targetId) || note.targetId <= 0) {
    throw new Error(`メモの宛先IDが不正: ${String(note.targetId)}(正の整数が必要)`)
  }
  const stored: StoredNote = {
    key: noteKey(note.target, note.targetId),
    target: note.target,
    targetId: note.targetId,
    text,
    updatedAt,
  }
  return tx(['notes', 'noteDeletions'], 'readwrite', async (transaction) => {
    await req(transaction.objectStore('notes').put(stored), 'notes の保存')
    // **同じ鍵の削除の記録を取り消す。** メモの鍵は決定的(`noteKey`)なので、消してから
    // 書き直すと生きている行と削除の記録が同じ鍵で同居する。`planSync` は同居したら
    // 時刻を見ずに「消した」を採るので、**書き直した本文が送られず、相手の端末では消える**
    // (記録は id が uuid なので作り直すと別の鍵になり、この同居が起きない)
    await req(
      transaction.objectStore('noteDeletions').delete(stored.key),
      'メモの削除の記録の取り消し',
    )
    return stored
  })
}

/**
 * 1件消す。**消える行があったかを返す**(無かったら `false`)。
 *
 * 存在確認と削除は1トランザクションに入れる(間に別の書き込みが挟まらないようにする)。
 */
export function deleteNote(
  key: string,
  deletedAt: string = new Date().toISOString(),
): Promise<boolean> {
  return tx(['notes', 'noteDeletions'], 'readwrite', async (transaction) => {
    const store = transaction.objectStore('notes')
    // await するのは IDB の要求だけ。他の Promise を待つとトランザクションが先にコミットする
    const found = await req(store.count(key), 'notes の存在確認')
    await req(store.delete(key), 'notes の削除')
    // **持っていなかったメモの削除を送らない**
    if (found > 0) {
      await req(
        transaction.objectStore('noteDeletions').put({ key, deletedAt }),
        'メモの削除の記録',
      )
    }
    return found > 0
  })
}

/** 未送信のメモの削除。`store/sync.ts` が `planSync` に渡す形へ射影する */
export function listNoteDeletions(): Promise<NoteDeletion[]> {
  return tx('noteDeletions', 'readonly', (transaction) =>
    req(transaction.objectStore('noteDeletions').getAll(), 'noteDeletions の全件取得'),
  )
}

/**
 * 送信し終えたメモの削除を捨てる。**送信が成功したキーだけ**を渡すこと
 * (まとめて全消しすると、送れていない削除が黙って失われてメモが復活する)。
 */
export async function clearNoteDeletions(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return
  await tx('noteDeletions', 'readwrite', async (transaction) => {
    const store = transaction.objectStore('noteDeletions')
    for (const key of keys) await req(store.delete(key), 'noteDeletions の削除')
  })
}

/**
 * サーバから降ってきたメモを当てる指示。`aliases` 側(`applyRemoteAliases`)と同じ形・同じ規律。
 * **削除の記録を書かない**(消すと決めたのはこの端末ではない)。
 */
export type RemoteNoteApply = {
  readonly upserts: readonly { key: string; note: StoredNote; expectedUpdatedAt: string | null }[]
  readonly removals: readonly { key: string; expectedUpdatedAt: string | null }[]
}

export type RemoteNoteApplyResult = {
  applied: string[]
  removed: string[]
  /** 同期の最中に本人が触ったので当てなかったキー */
  skipped: string[]
}

/** サーバ由来のメモを1トランザクションで当てる。**通信を渡せる形にしない** */
export async function applyRemoteNotes(plan: RemoteNoteApply): Promise<RemoteNoteApplyResult> {
  const result: RemoteNoteApplyResult = { applied: [], removed: [], skipped: [] }
  if (plan.upserts.length === 0 && plan.removals.length === 0) return result

  await tx('notes', 'readwrite', async (transaction) => {
    const store = transaction.objectStore('notes')
    for (const { key, note, expectedUpdatedAt } of plan.upserts) {
      const current = await req<StoredNote | undefined>(
        store.get(key) as IDBRequest<StoredNote | undefined>,
        'notes の取得',
      )
      if ((current?.updatedAt ?? null) !== expectedUpdatedAt) {
        result.skipped.push(key)
        continue
      }
      await req(store.put(note), 'notes の保存')
      result.applied.push(key)
    }
    for (const { key, expectedUpdatedAt } of plan.removals) {
      const current = await req<StoredNote | undefined>(
        store.get(key) as IDBRequest<StoredNote | undefined>,
        'notes の取得',
      )
      if (current === undefined) continue
      if (current.updatedAt !== expectedUpdatedAt) {
        result.skipped.push(key)
        continue
      }
      await req(store.delete(key), 'notes の削除')
      result.removed.push(key)
    }
  })
  return result
}

/**
 * メモを全部消す。
 *
 * **削除の記録は作らない。** ここを通るのは「取り込みによる全置換」と「全データ削除」で、
 * どちらも同期先に対する削除の意思表示ではない(次の同期でサーバ側と突き合わせて決まる)。
 */
export function clearNotes(): Promise<void> {
  return clear('notes')
}

/** 一覧を引きやすい形に畳む。UI は宛先の種類とIDで引く */
export function indexNotes(notes: readonly StoredNote[]): ReadonlyMap<string, StoredNote> {
  return new Map(notes.map((note) => [note.key, note]))
}

/** 宛先から引くときの鍵。`indexNotes` の戻りと組で使う */
export function lookupNote(
  index: ReadonlyMap<string, StoredNote>,
  target: NoteTarget,
  targetId: number,
): StoredNote | undefined {
  return index.get(noteKey(target, targetId))
}
