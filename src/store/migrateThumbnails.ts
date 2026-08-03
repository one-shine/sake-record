// 既に端末に入っているサムネイルを Blob → ArrayBuffer に移す(B72)。
//
// ## なぜ onupgradeneeded でやらないのか
//
// **Blob からバイト列を取るのは非同期**(`blob.arrayBuffer()`)で、IndexedDB の version change
// transaction は要求が途切れた時点で自動コミットされる。await を挟んだ後の書き込みは
// **例外も出さずに落ちる**(`db.ts` の `tx` の doc と同じ話)。だから版上げでは器だけを作り、
// 中身の詰め替えは接続が開いた後にここでやる。
//
// ## 何度呼んでも安全
//
// ArrayBuffer になっている行は触らない。途中で失敗しても、次の起動でもう一度同じ行に来る。
//
// ## 更新時刻を動かさない
//
// `updatedAt` を今にすると、203件すべてが「本人がいま編集した」ことになり、
// **次の同期で全件が送られて別端末の新しい編集を追い越す**。移し替えは保存形の変換であって
// 記録の変更ではない。
//
// ## 読めなかった写真を黙って消さない
//
// 移行の時点で実体が失われている Blob がありうる(まさに B72 で踏んだ状態)。読めない以上
// バイト列にはできないので `thumbnail: null` にするしかないが、**その id を meta に積む**。
// 次の同期がそれを見て同期先から取り直す(`sync.ts`)。積まないと、同期先に良い複製が
// 残っているのに二度と取りに行かない = 写真が黙って消える。

import type { SakeRecord } from '../domain/types.ts'
import { getAll, req, tx } from './db.ts'
import { addThumbnailRepairs } from './meta.ts'

/**
 * 一度でも走らせたら結果を使い回す。**呼ぶ側ごとに書かない**ための入口。
 *
 * 記録を読む道は `listRecords` の1本、同期は `sync` の1本しかないので、そこから呼べば
 * 「移行より先に古い形を掴む」経路が構造的に無くなる。呼び側に判断を持たせると、
 * 経路を足した日に1箇所だけ抜ける(メモの同期で実際に踏んだ形)。
 */
let migrating: Promise<ThumbnailMigration> | null = null

/**
 * 移行を1回だけ走らせる。**失敗しても呼び側を止めない**(結果は `moved: 0` として返る) —
 * 移行できないことと記録が読めないことは別で、後者にしてはいけない。
 * 失敗した promise は掴んだままにせず、次の呼び出しでもう一度試す。
 */
export function ensureThumbnailsMigrated(): Promise<ThumbnailMigration> {
  migrating ??= migrateThumbnailsToBytes().catch(() => {
    migrating = null
    return { moved: 0, lost: [] }
  })
  return migrating
}

/** テストの隔離用。**本番から呼ばない**(呼ぶと1セッションで何度も走る) */
export function resetThumbnailMigrationForTest(): void {
  migrating = null
}

export type ThumbnailMigration = {
  /** バイト列に移した件数 */
  moved: number
  /** 実体を読めず `thumbnail: null` にした記録の id。同期先から取り直す対象 */
  lost: string[]
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob === 'function' && value instanceof Blob
}

/**
 * `records` の `thumbnail` を Blob からバイト列に移す。**移す行が無ければ書き込みもしない。**
 *
 * 段取りは `sync.ts` と同じ「**読み切る → 通信/変換を待つ → 1つのトランザクションで当てる**」。
 * 読みながら書くと、変換の await でトランザクションが閉じて以降の書き込みが黙って落ちる。
 */
export async function migrateThumbnailsToBytes(): Promise<ThumbnailMigration> {
  const records = await getAll('records')
  // 型の上では `ArrayBuffer | null` だが、**版上げ前に保存された行は Blob を持っている**。
  // その事実をここでだけ認め、以降の層には持ち込まない
  const stale = records.filter((record) => isBlob(record.thumbnail as unknown))
  if (stale.length === 0) return { moved: 0, lost: [] }

  const converted: SakeRecord[] = []
  const lost: string[] = []
  for (const record of stale) {
    const blob = record.thumbnail as unknown as Blob
    let bytes: ArrayBuffer | null = null
    try {
      const read = await blob.arrayBuffer()
      // 0バイトは「読めた」ではない。送ると同期先の良い複製を壊すので失った扱いにする
      if (read.byteLength > 0) bytes = read
    } catch {
      bytes = null
    }
    if (bytes === null) lost.push(record.id)
    converted.push({ ...record, thumbnail: bytes })
  }

  await tx('records', 'readwrite', (transaction) => {
    const store = transaction.objectStore('records')
    return Promise.all(
      converted.map((record) => req(store.put(record), `記録 ${record.id} のサムネイルの移行`)),
    )
  })

  if (lost.length > 0) await addThumbnailRepairs(lost)
  return { moved: converted.length - lost.length, lost }
}

/**
 * 移行の結果を画面に出す1行。**移せたことは言わない**(本人が頼んだ操作ではないので雑音になる)。
 * **読めなかったときだけ言う** — 写真が減ったのに画面が何も言わないのが一番まずい。
 */
export function describeThumbnailMigration(result: ThumbnailMigration): string | null {
  if (result.lost.length === 0) return null
  return `${String(result.lost.length)} 件の写真をこの端末で読めなかった。同期を設定していれば次の同期で同期先から取り直す。設定していなければバックアップから取り込み直す。`
}
