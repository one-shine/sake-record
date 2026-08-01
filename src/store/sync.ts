// 端末間同期の**配線**(B69 / PHASE 8)。**判断は持たない。**
//
// どちらを採るかは `src/domain/syncMerge.ts` の `planSync` が全部決める。ここがやるのは
// 「取ってくる / 当てる / 送る / 位置を進める」の4つだけで、勝ち負けの条件をここに書かない
// (両側に判断があると必ずずれていき、壊れ方が「片方の端末の変更が黙って消える」なので気付けない)。
//
// ## 順序に意味がある(ここを崩すと記録が消える)
//
// 1. **トークンが無ければ何もしない。** 通信もしない(A28: 同期を設定していない端末は今までどおり)
// 2. **ローカルを読む。読めなければ中止する** — 空配列に畳んで `planSync` に渡すと、
//    サーバ側の古い版がローカルの新しい版を無条件に上書きし、しかも競合として報告もされない
// 3. サーバから変更を取る(位置は整数のカーソル)
// 4. `planSync` に聞く
// 5. **写真を先に取り切ってから**、1つのトランザクションで当てる —
//    IndexedDB のトランザクションは要求が途切れた時点で自動コミットするので、途中で通信を待つと
//    以降の書き込みが黙って落ちる
// 6. **写真を先に送ってから**記録を送る — 記録が見えてから写真が届くまでの隙間に別端末が同期すると、
//    その端末は写真の無い記録を保存したまま二度と取りに来ない(記録がもう変わらないので)
// 7. **送信が成功してから**位置を進め、**送れた分だけ**削除の記録を捨てる —
//    先に進めると、送れていない変更が二度と送られない
//
// ## 2つの時刻を混ぜない
//
// - `lastSyncedAt` … **端末の時計**。`planSync` が「前回の同期より後に自分が触ったか」を見る。
//   ローカルの `updatedAt` と同じ時計なので自己整合する
// - `syncCursor` … **サーバの整数**。「どこまで受け取ったか」だけ
//
// 取り違えると `Date.parse(42)` が 2042年として通り、送るべき変更が例外も無く空になる。

import { SYNC_URL } from '../config/app.ts'
import { toDomainRecord, toExportedRecord } from '../domain/backupSchema.ts'
import { planSync, type SyncConflict, type SyncEntry } from '../domain/syncMerge.ts'
import {
  SYNC_PUSH_LIMIT_ALIASES,
  SYNC_PUSH_LIMIT_RECORDS,
  SYNC_SCHEMA_VERSION,
  checkPullResponse,
  checkPushResponse,
  type PulledChanges,
  type SyncAliasChange,
  type SyncPushRequest,
  type SyncPushResponse,
  type SyncRecordChange,
} from '../domain/syncWire.ts'
import type { SakeRecord } from '../domain/types.ts'
import {
  aliasKeyOf,
  applyRemoteAliases,
  clearAliasDeletions,
  listAliasDeletions,
  listAliases,
} from './aliases.ts'
import { getAll, type StoredAlias } from './db.ts'
import {
  getLastSyncedAt,
  getSyncCursor,
  getSyncToken,
  setLastSyncedAt,
  setSyncCursor,
} from './meta.ts'
import { applyRemoteRecords, clearDeletions, listDeletions } from './records.ts'

// ---------------------------------------------------------------------------
// 失敗の分類
// ---------------------------------------------------------------------------
//
// **「通信できない」と「トークンが違う」を同じ顔にしない。** 同じにすると、トークンを
// 間違えている本人が延々と再試行することになる(A29 は 401 を返すだけでは満たせない)。

export type SyncFailureKind =
  /** 通信できない / 同期先に届かない。オフライン、URL の誤り、CORS の設定漏れを含む */
  | 'offline'
  /** トークンが無い / 違う(401) */
  | 'unauthorized'
  /** 同期先が処理に失敗した(5xx)、または応答の形が違う */
  | 'server'
  /** 同期先とこのアプリの版が合わない */
  | 'schema'
  /** この端末の保存領域が読めない / 書けない */
  | 'local'

type TaggedError = Error & { syncKind?: SyncFailureKind }

function syncError(kind: SyncFailureKind, message: string, cause?: unknown): TaggedError {
  const error: TaggedError = new Error(message, cause === undefined ? undefined : { cause })
  error.syncKind = kind
  return error
}

/** 種別の付いていない例外は `offline` に寄せる(`fetch` の拒否は TypeError で理由を持たない) */
function kindOf(cause: unknown): SyncFailureKind {
  if (typeof cause === 'object' && cause !== null && 'syncKind' in cause) {
    const kind = (cause as TaggedError).syncKind
    if (kind !== undefined) return kind
  }
  return 'offline'
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return String(cause)
}

// ---------------------------------------------------------------------------
// 通信(差し替え可能にする)
// ---------------------------------------------------------------------------
//
// **通信と保存を別の関数に割る。** 当てる側が通信を受け取れない形にしておけば、
// 「トランザクションの中で fetch を待つ」を書こうとした時点で型が合わなくなる。

export type SyncTransport = {
  pull: (since: number) => Promise<PulledChanges>
  push: (body: SyncPushRequest) => Promise<SyncPushResponse>
  /** サーバに無ければ `null`(404)。それ以外の失敗は投げる */
  getThumbnail: (id: string) => Promise<Blob | null>
  putThumbnail: (id: string, blob: Blob) => Promise<void>
}

async function request(
  url: string,
  token: string,
  init: RequestInit & { method: string },
): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
        'X-Sync-Schema': String(SYNC_SCHEMA_VERSION),
      },
      // 同期の応答をキャッシュから返されると位置がずれて変更を取りこぼす
      cache: 'no-store',
    })
  } catch (cause) {
    // `fetch` の拒否は「オフライン」「URL が違う」「CORS が通っていない」の区別が付かない。
    // **区別が付かないことを隠さない**(3つとも打てる手が違う)
    throw syncError(
      'offline',
      '同期先に届かなかった(通信できていないか、同期先の URL / 許可の設定が違う)',
      cause,
    )
  }
  if (response.status === 401) throw syncError('unauthorized', 'トークンが違う(401)')
  if (response.status === 400) {
    throw syncError('schema', `同期先が要求を受け付けなかった(400) — ${await reasonOf(response)}`)
  }
  if (!response.ok && response.status !== 404) {
    throw syncError(
      'server',
      `同期先が処理に失敗した(${String(response.status)}) — ${await reasonOf(response)}`,
    )
  }
  return response
}

/** 断りの理由。読めなくても投げない(理由が読めないこと自体は失敗の理由ではない) */
async function reasonOf(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'error' in body) {
      return String((body as { error: unknown }).error)
    }
  } catch {
    /* 本文が JSON でない */
  }
  return '理由の記載なし'
}

/** 既定の通信。`SYNC_URL` と保存されたトークンを使う */
export function httpTransport(baseUrl: string, token: string): SyncTransport {
  const base = baseUrl.replace(/\/+$/, '')
  return {
    async pull(since) {
      const response = await request(`${base}/changes?since=${String(since)}`, token, {
        method: 'GET',
      })
      const check = checkPullResponse(await asJson(response))
      if (!check.ok) throw syncError('server', check.reason)
      return check.value
    },
    async push(body) {
      const response = await request(`${base}/changes`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const check = checkPushResponse(await asJson(response))
      if (!check.ok) throw syncError('server', check.reason)
      return check.value
    },
    async getThumbnail(id) {
      const response = await request(`${base}/thumb/${id}`, token, { method: 'GET' })
      if (response.status === 404) return null
      return response.blob()
    },
    async putThumbnail(id, blob) {
      await request(`${base}/thumb/${id}`, token, {
        method: 'PUT',
        headers: { 'Content-Type': blob.type === '' ? 'image/jpeg' : blob.type },
        body: blob,
      })
    },
  }
}

async function asJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (cause) {
    throw syncError('server', '同期先の応答を JSON として読めなかった', cause)
  }
}

// ---------------------------------------------------------------------------
// 結果
// ---------------------------------------------------------------------------

export type SyncResult = {
  /** 同期を始めた時刻(端末の時計) */
  startedAt: string
  /** サーバの値で置き換えた件数 */
  applied: number
  /** サーバで消されていたので消した件数 */
  removed: number
  /** 送った件数(記録 + 紐付け) */
  pushed: number
  /** 両側が変わっていた記録。**黙って捨てない**(A26) */
  conflicts: SyncConflict[]
  /** 断ったこと・当てられなかったこと。画面にそのまま出す */
  notes: string[]
}

export type SyncOutcome =
  /** 同期先かトークンが未設定。**何もしていない**(通信もしていない) */
  | { status: 'not-configured' }
  | { status: 'done'; result: SyncResult }
  | { status: 'failed'; kind: SyncFailureKind; message: string }

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 走っている同期。**2本同時に走らせない。**
 *
 * 起動時と保存後の両方から呼ばれるので、並走すると同じ変更を2回送り、片方が古い位置で
 * 上書きして位置が巻き戻る(= 未送信の変更が飛ぶ)。`openDb()` が接続を1本に保つのと同じ形。
 */
let running: Promise<SyncOutcome> | null = null

export type SyncOptions = {
  /** 差し替え用。既定は `SYNC_URL` + 保存されたトークンへの HTTP */
  transport?: SyncTransport
  /** 差し替え用。既定は `SYNC_URL` */
  baseUrl?: string
}

/**
 * 1回同期する。**例外を投げない**(呼び側が `catch` を書き忘れても記録の閲覧を止めないため)。
 * 既に走っていれば、そのときの Promise をそのまま返す。
 */
export function sync(options: SyncOptions = {}): Promise<SyncOutcome> {
  if (running) return running
  const started = runSync(options).finally(() => {
    running = null
  })
  running = started
  return started
}

async function runSync(options: SyncOptions): Promise<SyncOutcome> {
  const baseUrl = options.baseUrl ?? SYNC_URL
  let transport = options.transport
  if (!transport) {
    if (baseUrl === '') return { status: 'not-configured' }
    const token = await getSyncToken().catch(() => null)
    if (token === null) return { status: 'not-configured' }
    transport = httpTransport(baseUrl, token)
  }

  try {
    return { status: 'done', result: await exchange(transport) }
  } catch (cause) {
    return { status: 'failed', kind: kindOf(cause), message: messageOf(cause) }
  }
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

/** ローカルの記録・紐付けと、それぞれの削除の記録。**読めなければ同期しない** */
type LocalState = {
  records: SakeRecord[]
  deletions: SyncEntry[]
  aliases: StoredAlias[]
  aliasDeletions: SyncEntry[]
}

async function readLocal(): Promise<LocalState> {
  try {
    const [records, deletions, aliases, aliasDeletions] = await Promise.all([
      getAll('records'),
      listDeletions(),
      listAliases(),
      listAliasDeletions(),
    ])
    return {
      records,
      // `RecordDeletion` は `updatedAt` を持たないので `SyncEntry` を満たさない。
      // **射影はここ1箇所だけ**(as で潰すと壊れた形が奥まで流れる)
      deletions: deletions.map((row) => ({
        id: row.id,
        updatedAt: row.deletedAt,
        deletedAt: row.deletedAt,
      })),
      aliases,
      aliasDeletions: aliasDeletions.map((row) => ({
        id: row.key,
        updatedAt: row.deletedAt,
        deletedAt: row.deletedAt,
      })),
    }
  } catch (cause) {
    // **空配列に畳まない。** 畳むと、サーバ側の古い版がローカルの新しい版を無条件に上書きし、
    // 競合としても報告されない(IDB が一時的に開けなかっただけで記録が巻き戻る)
    throw syncError('local', `この端末の保存領域を読めなかった — ${messageOf(cause)}`, cause)
  }
}

async function exchange(transport: SyncTransport): Promise<SyncResult> {
  // **位置を進めるのは push が成功してから。** ここで捕っておくのは「同期を始めた時刻」で、
  // これより後の変更は次回に回る(先に進めると、その間の変更が二度と送られない)
  const startedAt = new Date().toISOString()
  const notes: string[] = []

  const local = await readLocal()
  const lastSyncedAt = await getLastSyncedAt().catch(() => null)
  const startCursor = await getSyncCursor().catch(() => 0)

  // --- 取ってくる ---------------------------------------------------------
  const remoteRecords: SyncRecordChange[] = []
  const remoteAliases: SyncAliasChange[] = []
  let cursor = startCursor
  let dropped = 0
  for (let page = 0; ; page++) {
    const pulled = await transport.pull(cursor)
    remoteRecords.push(...pulled.records)
    remoteAliases.push(...pulled.aliases)
    cursor = pulled.cursor
    dropped += pulled.dropped
    if (!pulled.hasMore) break
    // 位置が進まないまま続きがあると言われたら止める(無限に回り続けない)
    if (page > 200) {
      notes.push('同期先が変更を返し続けたので途中で切り上げた。もう一度同期する')
      break
    }
  }
  if (dropped > 0) {
    notes.push(`同期先から届いた ${String(dropped)} 件は形が違ったので取り込まなかった`)
  }

  // --- どうするかを決める(判断はここではなく planSync) --------------------
  const recordPlan = planSync({
    local: local.records.map((record) => ({ id: record.id, updatedAt: record.updatedAt })),
    localDeletions: local.deletions,
    remote: remoteRecords.map((change) => ({
      id: change.id,
      updatedAt: change.updatedAt,
      deletedAt: change.deletedAt,
    })),
    lastSyncedAt,
  })
  const aliasPlan = planSync({
    local: local.aliases.map((alias) => ({ id: aliasKeyOf(alias), updatedAt: alias.updatedAt })),
    localDeletions: local.aliasDeletions,
    remote: remoteAliases.map((change) => ({
      id: change.key,
      updatedAt: change.updatedAt,
      deletedAt: change.deletedAt,
    })),
    lastSyncedAt,
  })

  // --- ローカルに当てる ---------------------------------------------------
  const localById = new Map(local.records.map((record) => [record.id, record]))
  const remoteById = new Map(remoteRecords.map((change) => [change.id, change]))
  const localAliasByKey = new Map(local.aliases.map((alias) => [aliasKeyOf(alias), alias]))
  const remoteAliasByKey = new Map(remoteAliases.map((change) => [change.key, change]))

  /** 写真を取れなかった記録があると、位置を進めない(次の同期でもう一度降りてくる) */
  let thumbnailPending = false
  const upserts: { record: SakeRecord; expectedUpdatedAt: string | null }[] = []

  for (const id of recordPlan.applyLocal) {
    const change = remoteById.get(id)
    if (change?.body == null) continue
    const mine = localById.get(id)
    let thumbnail: Blob | null = null
    if (change.hasThumbnail) {
      // **同じ版なら取りに行かない。** 自分が送った記録は次の pull で戻ってくるので、
      // 毎回50KBを取り直すことになる(内容は同じ)
      if (mine?.thumbnail != null && mine.updatedAt === change.updatedAt) {
        thumbnail = mine.thumbnail
      } else {
        try {
          thumbnail = await transport.getThumbnail(id)
        } catch (cause) {
          notes.push(`記録 ${id} の写真を受け取れなかった — ${messageOf(cause)}`)
          thumbnailPending = true
          continue
        }
        if (thumbnail === null) {
          // 送り主がまだ写真を置いていない。**写真の無い記録として保存しない**(A24)
          notes.push(`記録 ${id} の写真がまだ同期先に無い。次の同期で取り直す`)
          thumbnailPending = true
          continue
        }
      }
    }
    upserts.push({
      record: toDomainRecord({ ...change.body, thumbnail: null }, thumbnail),
      expectedUpdatedAt: mine?.updatedAt ?? null,
    })
  }

  const removals = recordPlan.removeLocal.map((id) => ({
    id,
    expectedUpdatedAt: localById.get(id)?.updatedAt ?? null,
  }))

  let applied: { applied: string[]; removed: string[]; skipped: string[] }
  try {
    applied = await applyRemoteRecords({ upserts, removals })
  } catch (cause) {
    throw syncError('local', `受け取った記録を保存できなかった — ${messageOf(cause)}`, cause)
  }
  if (applied.skipped.length > 0) {
    notes.push(
      `${String(applied.skipped.length)} 件は同期の最中にこの端末で変わったので当てなかった(次の同期で決まる)`,
    )
  }

  const aliasUpserts = aliasPlan.applyLocal.flatMap((key) => {
    const change = remoteAliasByKey.get(key)
    if (change?.body == null) return []
    return [
      {
        key,
        alias: { ...change.body, updatedAt: change.updatedAt },
        expectedUpdatedAt: localAliasByKey.get(key)?.updatedAt ?? null,
      },
    ]
  })
  const aliasRemovals = aliasPlan.removeLocal.map((key) => ({
    key,
    expectedUpdatedAt: localAliasByKey.get(key)?.updatedAt ?? null,
  }))
  try {
    await applyRemoteAliases({ upserts: aliasUpserts, removals: aliasRemovals })
  } catch (cause) {
    throw syncError('local', `受け取った紐付けを保存できなかった — ${messageOf(cause)}`, cause)
  }

  // --- 送る ---------------------------------------------------------------
  // **写真を先に送る。** 記録が見えてから写真が届くまでの隙間に別端末が同期すると、
  // その端末は写真の無い記録を保存したまま二度と取りに来ない
  for (const id of recordPlan.push) {
    const mine = localById.get(id)
    if (mine?.thumbnail == null) continue
    try {
      await transport.putThumbnail(id, mine.thumbnail)
    } catch (cause) {
      throw syncError(kindOf(cause), `記録 ${id} の写真を送れなかった — ${messageOf(cause)}`, cause)
    }
  }

  const recordChanges = [
    ...recordPlan.push.flatMap((id) => {
      const mine = localById.get(id)
      if (!mine) return []
      const { thumbnail: _thumbnail, ...body } = toExportedRecord(mine, null)
      return [
        {
          id,
          updatedAt: mine.updatedAt,
          deletedAt: null,
          hasThumbnail: mine.thumbnail !== null,
          body,
        } satisfies SyncRecordChange,
      ]
    }),
    ...recordPlan.pushDeletions.flatMap((id) => {
      const gone = local.deletions.find((entry) => entry.id === id)
      if (!gone) return []
      return [
        {
          id,
          updatedAt: gone.updatedAt,
          deletedAt: gone.deletedAt ?? gone.updatedAt,
          hasThumbnail: false,
          body: null,
        } satisfies SyncRecordChange,
      ]
    }),
  ]

  const aliasChanges = [
    ...aliasPlan.push.flatMap((key) => {
      const mine = localAliasByKey.get(key)
      if (!mine) return []
      return [
        {
          key,
          updatedAt: mine.updatedAt,
          deletedAt: null,
          body: { label: mine.label, prefecture: mine.prefecture, brandId: mine.brandId },
        } satisfies SyncAliasChange,
      ]
    }),
    ...aliasPlan.pushDeletions.flatMap((key) => {
      const gone = local.aliasDeletions.find((entry) => entry.id === key)
      if (!gone) return []
      return [
        {
          key,
          updatedAt: gone.updatedAt,
          deletedAt: gone.deletedAt ?? gone.updatedAt,
          body: null,
        } satisfies SyncAliasChange,
      ]
    }),
  ]

  // **分けて送る。** 無料枠は1リクエストあたりの問い合わせ数に上限があり、越えると
  // 203件の初回投入が丸ごと失敗する(サーバも同じ数で断る)
  const sentRecordDeletions: string[] = []
  const sentAliasDeletions: string[] = []
  let pushed = 0
  for (const batch of batches(recordChanges, aliasChanges)) {
    await transport.push(batch)
    pushed += batch.records.length + batch.aliases.length
    for (const change of batch.records) {
      if (change.deletedAt !== null) sentRecordDeletions.push(change.id)
    }
    for (const change of batch.aliases) {
      if (change.deletedAt !== null) sentAliasDeletions.push(change.key)
    }
  }

  // --- 位置を進める(ここまで来て初めて) -----------------------------------
  // **送れた削除だけ捨てる。** まとめて全消しすると、送れていない削除が黙って失われて
  // その記録が次の同期で復活する
  await clearDeletions(sentRecordDeletions)
  await clearAliasDeletions(sentAliasDeletions)
  await setLastSyncedAt(startedAt)
  if (thumbnailPending) {
    // 写真を取り切れていないので位置を進めない。次の同期で同じ変更がもう一度降りてくる
    notes.push('写真を受け取れなかった記録があるので、次の同期でもう一度取りに行く')
  } else {
    await setSyncCursor(cursor)
  }

  return {
    startedAt,
    applied: applied.applied.length,
    removed: applied.removed.length,
    pushed,
    conflicts: [...recordPlan.conflicts, ...aliasPlan.conflicts],
    notes,
  }
}

/** 上限に収まる大きさに割る。記録と紐付けはそれぞれ別の上限を持つ */
function* batches(
  records: readonly SyncRecordChange[],
  aliases: readonly SyncAliasChange[],
): Generator<SyncPushRequest> {
  let recordAt = 0
  let aliasAt = 0
  while (recordAt < records.length || aliasAt < aliases.length) {
    const batch: SyncPushRequest = {
      records: records.slice(recordAt, recordAt + SYNC_PUSH_LIMIT_RECORDS),
      aliases: aliases.slice(aliasAt, aliasAt + SYNC_PUSH_LIMIT_ALIASES),
    }
    recordAt += SYNC_PUSH_LIMIT_RECORDS
    aliasAt += SYNC_PUSH_LIMIT_ALIASES
    yield batch
  }
}
