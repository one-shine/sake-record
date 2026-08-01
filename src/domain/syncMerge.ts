// 端末間の同期の**判断**をここ1箇所に閉じる(B69 / PHASE 8)。
//
// ## なぜ純関数なのか
//
// 同期で壊れるのは通信ではなく**突き合わせ**で、しかも壊れ方が「消した記録が復活する」
// 「片方の追加が消える」のように**気づきにくい**。fetch も IndexedDB も持たない形にしておけば、
// **2端末を用意しなくても分岐を全部テストできる**(`createLinker` / `createReadingIndex` と同じ規律)。
// `src/store/sync.ts` は「取ってくる / 書き込む」だけを持ち、判断を持たない。
//
// ## 決めごと
//
// 1. **同期の単位は記録1件。** 全文書の置き換えにしない — 端末Aが5件・端末Bが3件のとき、
//    Bが全文書を書き戻すと**Aの5件が消える**。既存の export/import(全文書)はバックアップの
//    形式であって、同期には使えない。
// 2. **新しいほうを採る(last-writer-wins)。** `SakeRecord.updatedAt` が既にあるので新しい概念を足さない。
// 3. **削除も1つの変更。** 消した事実を残さないと「Aで消す → Bと同期 → Aに復活する」が必ず起きる。
//    サーバの `deletedAt` と、**ローカルの削除ログ**の両方が要る(オフラインで消した分を
//    覚えていないと送れない)。
// 4. **同点は remote を採る。** 全端末が同じ値に収束するために、勝ち負けの向きを1つに固定する。
//    ローカルの編集が負けたときは**黙って捨てず** `conflicts` で返す(`unlinked` に推定値を
//    埋めないのと同じ規律 = 失った事実を隠さない)。
// 5. **読めない時刻は最古として扱う。** 壊れた `updatedAt` が勝つと、正しい記録が消える。

/** 突き合わせに要る最小の形。本体(`body` / サムネイル)はこの層に渡さない */
export type SyncEntry = {
  readonly id: string
  /** ISO8601。読めない値は**最古**として扱う(勝たせない) */
  readonly updatedAt: string
  /** 削除済みならその時刻。`null` / 省略で生存 */
  readonly deletedAt?: string | null
}

export type SyncInput = {
  /** この端末に**在る**記録 */
  readonly local: readonly SyncEntry[]
  /** この端末で**消した**記録。`deletedAt` は必須(消した時刻が勝ち負けを決める) */
  readonly localDeletions: readonly SyncEntry[]
  /** サーバから受け取った**変更分**(削除を含む) */
  readonly remote: readonly SyncEntry[]
  /**
   * 前回の同期が完了した時刻。`null` は**まだ一度も同期していない**。
   *
   * 「ローカルが変わったか」の判定に使う。**`updatedAt > lastSyncedAt` を「変わった」とみなす**ので、
   * ここを進めるのは push が成功した後だけにすること(先に進めると未送信の変更が二度と送られない)。
   */
  readonly lastSyncedAt: string | null
}

/** 勝ち負けが起きた記録。**負けた側を黙って捨てないため**に返す */
export type SyncConflict = {
  readonly id: string
  readonly winner: 'local' | 'remote'
  /** 勝ったほうが削除だったか。「編集したのに消えた」を画面で言い分けるために持つ */
  readonly winnerDeleted: boolean
}

export type SyncPlan = {
  /** サーバの値でローカルを**上書き**する記録のID */
  readonly applyLocal: string[]
  /** ローカルから**消す**記録のID(サーバで削除されていた) */
  readonly removeLocal: string[]
  /** サーバへ**送る**記録のID(ローカルのほうが新しい / サーバが知らない) */
  readonly push: string[]
  /** サーバへ**削除として送る**記録のID */
  readonly pushDeletions: string[]
  /** 両側が変わっていた記録。`applyLocal` / `push` にも勝ったほうが入っている */
  readonly conflicts: SyncConflict[]
}

/**
 * 更新時刻を持たない既存の行に入れる値。**読める最古**。
 *
 * 手動紐付け(`BrandAlias`)は同期を足すまで更新時刻を持っていなかった。そのまま同期に載せると
 * `updatedAt` が読めず `changedAt` が `-Infinity` になり、下の `changedAt(mine) <= since` が
 * **初回同期(`since` も `-Infinity`)でも真**になるので送られない。しかもサーバ側に削除が在ると
 * `localChanged` が偽なので `conflicts` にすら出ず、**手動紐付けが無音で消える**(実測)。
 *
 * **`new Date()` を入れてはいけない。** 「アプリを開いた瞬間に本人が紐付けを触った」という
 * 偽の事実を作り、別端末で実際に消した判断(本物の時刻)を追い越して紐付けを復活させる。
 * `unlinked` に推定値を埋めないのと同じで、「いつか分からない」は最古として正直に扱う。
 * 固定値なので2端末で同じ値になり、古い行どうしで人為的な勝者が生まれない。
 */
export const OLDEST_UPDATED_AT = '1970-01-01T00:00:00.000Z'

/** 読めない時刻は最古(`-Infinity`)。**壊れた値を勝たせない** */
function timeOf(iso: string | null | undefined): number {
  if (iso === null || iso === undefined) return Number.NEGATIVE_INFINITY
  const at = Date.parse(iso)
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at
}

/** その記録が最後に動いた時刻。削除済みなら削除の時刻 */
function changedAt(entry: SyncEntry): number {
  const deleted = timeOf(entry.deletedAt)
  return deleted === Number.NEGATIVE_INFINITY ? timeOf(entry.updatedAt) : deleted
}

const isDeleted = (entry: SyncEntry): boolean =>
  entry.deletedAt !== null && entry.deletedAt !== undefined

/**
 * ローカルとサーバの変更分から、**どちらに何をするか**を決める。
 *
 * 返すのは**IDだけ**。本体の受け渡し(JSON の組み立て・Blob の往復)は store 層の仕事で、
 * ここに持ち込むとテストがブラウザ API を要求し始める。
 */
export function planSync({ local, localDeletions, remote, lastSyncedAt }: SyncInput): SyncPlan {
  const since = timeOf(lastSyncedAt)
  const localById = new Map<string, SyncEntry>()
  // 生存と削除を1つの表に畳む。**同じIDが両方に居たら「消した」を採る**
  // (削除の直後に作り直したなら `id` が変わる = uuid なので衝突しない)
  for (const entry of local) localById.set(entry.id, entry)
  for (const entry of localDeletions) localById.set(entry.id, entry)

  const applyLocal: string[] = []
  const removeLocal: string[] = []
  const push: string[] = []
  const pushDeletions: string[] = []
  const conflicts: SyncConflict[] = []

  const seen = new Set<string>()

  for (const incoming of remote) {
    seen.add(incoming.id)
    const mine = localById.get(incoming.id)
    if (mine === undefined) {
      // サーバにだけ在る。**削除済みなら何もしない**(持っていない記録を消せない)
      if (!isDeleted(incoming)) applyLocal.push(incoming.id)
      continue
    }

    const mineAt = changedAt(mine)
    const theirsAt = changedAt(incoming)
    // **この端末で前回の同期より後に触ったか。** remote 側は `since` で絞って受け取っている
    // ので、両方が真なら競合
    const localChanged = mineAt > since
    // 同点は remote を採る(収束の向きを1つに固定する)
    const remoteWins = theirsAt >= mineAt

    if (localChanged) {
      conflicts.push({
        id: incoming.id,
        winner: remoteWins ? 'remote' : 'local',
        winnerDeleted: isDeleted(remoteWins ? incoming : mine),
      })
    }

    if (remoteWins) {
      // **既にローカルから消えているものを「消す」に入れない。** 削除ログにしか無い記録は
      // 実体が無く、store 側が空振りの削除を投げることになる
      if (isDeleted(incoming)) {
        if (!isDeleted(mine)) removeLocal.push(incoming.id)
      } else applyLocal.push(incoming.id)
    } else if (isDeleted(mine)) {
      pushDeletions.push(mine.id)
    } else {
      push.push(mine.id)
    }
  }

  // サーバの変更分に出てこなかったローカルの変更を送る。
  // **前回の同期より後に触ったものだけ**(全部送ると毎回全件が飛ぶ)。
  // 初回(`lastSyncedAt === null`)は `since` が -Infinity なので全部が対象になる —
  // **ただし `updatedAt` が読める行に限る。** 読めない行は `changedAt` も -Infinity で、
  // `-Infinity <= -Infinity` が真になるのでここで落ちる(だから `OLDEST_UPDATED_AT` を入れる)。
  for (const [id, mine] of localById) {
    if (seen.has(id)) continue
    if (changedAt(mine) <= since) continue
    if (isDeleted(mine)) pushDeletions.push(id)
    else push.push(id)
  }

  return { applyLocal, removeLocal, push, pushDeletions, conflicts }
}
