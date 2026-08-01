// 同期先(Cloudflare Worker + D1)。**運ぶだけで、判断はしない。**
//
// 突き合わせ(どちらを採るか)はクライアントの `src/domain/syncMerge.ts` が持つ。ここが持つのは
// 「新しいほうだけ採る」という**保管の一貫性**だけで、それも SQL の1行(`WHERE ... >`)で書ける
// 範囲に留める。両側に判断を置くと必ずドリフトし、壊れ方が「片方の端末の変更が黙って消える」
// なので気付けない。
//
// ## 変更1件の形はアプリと同じファイルから引く
//
// `src/domain/syncWire.ts` を直に import する(単一の出所)。ただし**中身(`body`)は見ない** —
// 記録の形をサーバが知ると、項目を1つ足すたびに再デプロイするまで新しい記録が保存できなくなる。
// 検証は外側だけ(`isSyncRecordChangeShape`)。
//
// ## 無料枠の効く数字(実装がこれに縛られている)
//
// - **1リクエストあたり D1 クエリ 50個**。だから push は分割して送る(`SYNC_PUSH_LIMIT_RECORDS`)。
//   ここで弾かずに受けると、203件の初回投入が上限を越えて丸ごと失敗する。
// - **1値あたり 2,000,000 バイト**。サムネイルは長辺400px / 50KB 以下なので余裕だが、
//   原寸が誤って来たときのために PUT で明示的に断る(413)。
// - **BLOB は読むと `number[]` で返る**(D1 の型変換)。`Uint8Array` に戻してから返す。
// - **CPU 10ms / 呼び出し**。pull は件数を区切って返す(`PULL_LIMIT` + `hasMore`)。

import {
  SYNC_SCHEMA_VERSION,
  isSyncAliasChangeShape,
  isSyncRecordChangeShape,
  type SyncAliasChange,
  type SyncRecordChange,
} from '../../src/domain/syncWire.ts'
import { bearerToken, tokenMatches } from './auth.ts'

export type Env = {
  DB: D1Database
  /** `wrangler secret put SYNC_TOKEN`。**無い / 短いときは誰も通さない**(auth.ts) */
  SYNC_TOKEN?: string
  /**
   * 許可するオリジンをカンマ区切りで。**未設定なら全オリジンを許す。**
   *
   * CORS はここでは**安全の境界ではない** — Cookie を一切使わないので、他所のページが
   * 勝手にこの API を呼んでも `Authorization` を持っていない(ブラウザが自動で付ける
   * 資格情報が無い)。守っているのはトークン1本で、それは変わらない。
   * 絞りたくなったら `https://one-shine.github.io` を入れる(絞ると LAN の実機確認で詰まる)。
   */
  ALLOWED_ORIGINS?: string
}

/** 1回の pull で返す件数の上限。CPU 10ms と応答サイズの両方のため。続きは `hasMore` */
const PULL_LIMIT = 100

/**
 * 1回の push で受ける件数の上限。**無料枠の「1リクエスト50クエリ」から逆算した値。**
 * 内訳: 位置の予約1 + 記録ごとに最大2(upsert と写真の後始末) + 別名ごとに1 + 位置の読み1。
 */
const PUSH_LIMIT_RECORDS = 15
const PUSH_LIMIT_ALIASES = 15

/** サムネイルの上限。長辺400px / 50KB 以下の仕様に対する安全側の余裕 */
const MAX_THUMB_BYTES = 400_000

// ---------------------------------------------------------------------------
// CORS / 応答
// ---------------------------------------------------------------------------

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin')
  const configured = (env.ALLOWED_ORIGINS ?? '').trim()
  if (configured === '') return origin ?? '*'
  if (origin === null) return null
  const allowed = configured.split(',').map((value) => value.trim())
  return allowed.includes(origin) ? origin : null
}

/**
 * **すべての応答に CORS ヘッダを付ける。401 や 404 にも。**
 *
 * 付け忘れると、ブラウザは本当のステータスコードを読ませてくれず `fetch` が TypeError で
 * reject する = **オフラインと見分けが付かない**。「トークンが違う」と言えなくなり、
 * 本人が延々と再試行することになる(A29 は 401 を返すだけでは足りない)。
 */
function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = allowedOrigin(request, env)
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Sync-Schema',
    'Access-Control-Max-Age': '86400',
    // オリジンごとに応答が変わる。付けないと CDN / ブラウザが別オリジン向けの応答を返す
    Vary: 'Origin',
  }
  if (origin !== null) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function json(body: unknown, request: Request, env: Env, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request, env),
      'content-type': 'application/json; charset=utf-8',
      // 同期の応答は絶対にキャッシュさせない(位置がずれると変更を取りこぼす)
      'cache-control': 'no-store',
    },
  })
}

/** 断り。**本文に理由を入れる**(画面に出すのはクライアントの仕事だが、curl で切り分けられる) */
function fail(reason: string, request: Request, env: Env, status: number): Response {
  return json({ error: reason }, request, env, status)
}

// ---------------------------------------------------------------------------
// 位置(seq)
// ---------------------------------------------------------------------------
//
// **1行ごとに別の seq を振る。** push 単位でまとめて同じ値にすると、pull を件数で区切ったときに
// 「同じ seq の行が途中で切れる」状態が作れてしまう(位置をそこまで進めると残りを永久に飛ばす)。
//
// 予約は `UPDATE cursor SET n = n + <件数>` の1文で行い、各行は `(SELECT n FROM cursor) - <逆順の添字>`
// で自分の番号を引く。**同じ batch = 同じトランザクション**なので、途中で他のリクエストが
// 割り込んで番号が飛び越すことはない。

const SEQ_EXPR = '(SELECT n FROM cursor WHERE only_row = 1) - ?'

// ---------------------------------------------------------------------------
// pull
// ---------------------------------------------------------------------------

type RecordRow = {
  id: string
  seq: number
  updated_at: string
  deleted_at: string | null
  has_thumb: number
  body: string | null
}

type AliasRow = {
  key: string
  seq: number
  updated_at: string
  deleted_at: string | null
  body: string | null
}

/**
 * `body` は保管時に文字列にしてあるので、返すときにオブジェクトへ戻す。
 * **壊れていたらその1件ごと落とす**(サーバが不透明に扱う代償として、ここだけは形を見る)。
 */
function parseBody(body: string | null): unknown {
  if (body === null) return null
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

async function handlePull(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const rawSince = url.searchParams.get('since')
  const parsed = rawSince === null ? 0 : Number(rawSince)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fail('since は 0 以上の整数で渡す', request, env, 400)
  }

  // **`since` がサーバの位置より先なら 0 に落とす。** サーバを作り直した / 別の DB を指した
  // ときに、端末が「もう全部受け取った」と思い込んだまま何も降りてこない状態を防ぐ。
  const sinceExpr = '(SELECT CASE WHEN ? > n THEN 0 ELSE ? END FROM cursor WHERE only_row = 1)'

  const [recordResult, aliasResult, cursorResult] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, seq, updated_at, deleted_at, has_thumb, body FROM records
       WHERE seq > ${sinceExpr} ORDER BY seq LIMIT ?`,
    ).bind(parsed, parsed, PULL_LIMIT + 1),
    env.DB.prepare(
      `SELECT key, seq, updated_at, deleted_at, body FROM aliases
       WHERE seq > ${sinceExpr} ORDER BY seq LIMIT ?`,
    ).bind(parsed, parsed, PULL_LIMIT + 1),
    env.DB.prepare('SELECT n FROM cursor WHERE only_row = 1'),
  ])

  const recordRows = (recordResult.results ?? []) as RecordRow[]
  const aliasRows = (aliasResult.results ?? []) as AliasRow[]
  const globalCursor = ((cursorResult.results ?? [])[0] as { n: number } | undefined)?.n ?? 0

  // seq は表をまたいで一意なので、2つの表の行を1本の並びに畳んで先頭から切れる
  const merged: { seq: number; record?: RecordRow; alias?: AliasRow }[] = [
    ...recordRows.map((row) => ({ seq: row.seq, record: row })),
    ...aliasRows.map((row) => ({ seq: row.seq, alias: row })),
  ].sort((a, b) => a.seq - b.seq)

  const hasMore = merged.length > PULL_LIMIT
  const taken = hasMore ? merged.slice(0, PULL_LIMIT) : merged
  // 途中で切ったなら、位置は**返した最後の行まで**。全部返したならサーバの現在位置
  const cursor = hasMore ? (taken[taken.length - 1]?.seq ?? 0) : globalCursor

  const records: SyncRecordChange[] = []
  const aliases: SyncAliasChange[] = []
  for (const entry of taken) {
    if (entry.record) {
      records.push({
        id: entry.record.id,
        updatedAt: entry.record.updated_at,
        deletedAt: entry.record.deleted_at,
        hasThumbnail: entry.record.has_thumb === 1,
        body: parseBody(entry.record.body) as SyncRecordChange['body'],
      })
    } else if (entry.alias) {
      aliases.push({
        key: entry.alias.key,
        updatedAt: entry.alias.updated_at,
        deletedAt: entry.alias.deleted_at,
        body: parseBody(entry.alias.body) as SyncAliasChange['body'],
      })
    }
  }

  return json({ cursor, hasMore, records, aliases }, request, env)
}

// ---------------------------------------------------------------------------
// push
// ---------------------------------------------------------------------------

/**
 * **新しいほうだけ採る。** `changedAt` は「削除済みなら削除の時刻、そうでなければ更新の時刻」で、
 * クライアントの `syncMerge.ts` の `changedAt()` と同じ定義。ISO8601 は辞書順 = 時系列なので
 * 文字列比較でよい。
 *
 * **同点は採らない**(サーバの値を残す)。クライアント側も「同点は remote を採る」なので
 * 向きが揃い、2端末のあいだで押し合いにならない。
 */
const UPSERT_RECORD = `
INSERT INTO records (id, seq, updated_at, deleted_at, has_thumb, body)
VALUES (?, ${SEQ_EXPR}, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  seq = excluded.seq,
  updated_at = excluded.updated_at,
  deleted_at = excluded.deleted_at,
  has_thumb = excluded.has_thumb,
  body = excluded.body
WHERE COALESCE(excluded.deleted_at, excluded.updated_at)
    > COALESCE(records.deleted_at, records.updated_at)`

const UPSERT_ALIAS = `
INSERT INTO aliases (key, seq, updated_at, deleted_at, body)
VALUES (?, ${SEQ_EXPR}, ?, ?, ?)
ON CONFLICT(key) DO UPDATE SET
  seq = excluded.seq,
  updated_at = excluded.updated_at,
  deleted_at = excluded.deleted_at,
  body = excluded.body
WHERE COALESCE(excluded.deleted_at, excluded.updated_at)
    > COALESCE(aliases.deleted_at, aliases.updated_at)`

/**
 * 写真の後始末。**upsert の後に走らせる**ので、勝ったほうの状態を見て決まる
 * (こちらの upsert が古くて負けたなら、サーバの写真は消えない)。
 */
const DROP_THUMB = `
DELETE FROM thumbs WHERE id = ?
  AND NOT EXISTS (SELECT 1 FROM records r WHERE r.id = ? AND r.has_thumb = 1 AND r.deleted_at IS NULL)`

async function handlePush(request: Request, env: Env): Promise<Response> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return fail('本文を JSON として読めない', request, env, 400)
  }
  if (typeof payload !== 'object' || payload === null) {
    return fail('本文が JSON オブジェクトでない', request, env, 400)
  }
  const { records: rawRecords, aliases: rawAliases } = payload as Record<string, unknown>
  if (!Array.isArray(rawRecords) || !Array.isArray(rawAliases)) {
    return fail('本文に records / aliases の配列が無い', request, env, 400)
  }
  if (rawRecords.length > PUSH_LIMIT_RECORDS || rawAliases.length > PUSH_LIMIT_ALIASES) {
    // 分割して送るのは端末側の責務(`SYNC_PUSH_LIMIT`)。黙って切り捨てない
    return fail(
      `1回に送れるのは records ${String(PUSH_LIMIT_RECORDS)}件 / aliases ${String(PUSH_LIMIT_ALIASES)}件まで`,
      request,
      env,
      413,
    )
  }

  const records: SyncRecordChange[] = []
  for (const entry of rawRecords) {
    if (!isSyncRecordChangeShape(entry)) return fail('records の形が違う', request, env, 400)
    records.push(entry)
  }
  const aliases: SyncAliasChange[] = []
  for (const entry of rawAliases) {
    if (!isSyncAliasChangeShape(entry)) return fail('aliases の形が違う', request, env, 400)
    aliases.push(entry)
  }

  const total = records.length + aliases.length
  if (total === 0) {
    const row = await env.DB.prepare('SELECT n FROM cursor WHERE only_row = 1').first<{ n: number }>()
    return json({ cursor: row?.n ?? 0, accepted: 0, rejected: 0 }, request, env)
  }

  // 位置をまとめて予約する。各行は「予約後の値 - 逆順の添字」で自分の番号を引く
  const statements: D1PreparedStatement[] = [
    env.DB.prepare('UPDATE cursor SET n = n + ? WHERE only_row = 1').bind(total),
  ]
  /** upsert 文が `statements` の何番目にあるか。採否の集計に使う */
  const upsertAt: number[] = []
  let index = 0

  for (const change of records) {
    const back = total - 1 - index
    index++
    upsertAt.push(statements.length)
    statements.push(
      env.DB
        .prepare(UPSERT_RECORD)
        .bind(
          change.id,
          back,
          change.updatedAt,
          change.deletedAt,
          change.hasThumbnail ? 1 : 0,
          change.body === null ? null : JSON.stringify(change.body),
        ),
    )
    // 写真が要らなくなった記録だけ後始末する(クエリ数を無駄に使わない)
    if (!change.hasThumbnail || change.deletedAt !== null) {
      statements.push(env.DB.prepare(DROP_THUMB).bind(change.id, change.id))
    }
  }

  for (const change of aliases) {
    const back = total - 1 - index
    index++
    upsertAt.push(statements.length)
    statements.push(
      env.DB
        .prepare(UPSERT_ALIAS)
        .bind(
          change.key,
          back,
          change.updatedAt,
          change.deletedAt,
          change.body === null ? null : JSON.stringify(change.body),
        ),
    )
  }

  statements.push(env.DB.prepare('SELECT n FROM cursor WHERE only_row = 1'))

  const results = await env.DB.batch(statements)

  let accepted = 0
  for (const at of upsertAt) {
    if ((results[at]?.meta.changes ?? 0) > 0) accepted++
  }
  const cursorRow = (results[results.length - 1]?.results ?? [])[0] as { n: number } | undefined

  return json(
    { cursor: cursorRow?.n ?? 0, accepted, rejected: upsertAt.length - accepted },
    request,
    env,
  )
}

// ---------------------------------------------------------------------------
// サムネイル
// ---------------------------------------------------------------------------

async function handleGetThumb(id: string, request: Request, env: Env): Promise<Response> {
  const row = await env.DB.prepare('SELECT bytes FROM thumbs WHERE id = ?')
    .bind(id)
    .first<{ bytes: number[] }>()
  if (!row) return fail('この記録の写真は保管されていない', request, env, 404)
  // **D1 の BLOB は読むと配列で返る。** そのまま JSON に入れると 50KB が数十万文字になる
  return new Response(new Uint8Array(row.bytes), {
    headers: {
      ...corsHeaders(request, env),
      'content-type': 'image/jpeg',
      'cache-control': 'no-store',
    },
  })
}

async function handlePutThumb(id: string, request: Request, env: Env): Promise<Response> {
  const buffer = await request.arrayBuffer()
  if (buffer.byteLength === 0) return fail('写真の中身が空', request, env, 400)
  if (buffer.byteLength > MAX_THUMB_BYTES) {
    return fail(
      `写真が大きすぎる(${String(buffer.byteLength)} バイト。上限 ${String(MAX_THUMB_BYTES)})`,
      request,
      env,
      413,
    )
  }
  await env.DB.prepare('INSERT OR REPLACE INTO thumbs (id, updated_at, bytes) VALUES (?, ?, ?)')
    .bind(id, new Date().toISOString(), new Uint8Array(buffer))
    .run()
  return json({ ok: true }, request, env)
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

const THUMB_PATH = /^\/thumb\/([A-Za-z0-9-]{1,64})$/

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // **認証より先に OPTIONS を返す。** preflight には `Authorization` が載らないので、
    // 先に認証を見ると preflight が 401 になり、ブラウザからは「CORS エラー」としか見えない
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    }

    const schema = request.headers.get('X-Sync-Schema')
    if (schema !== null && Number(schema) > SYNC_SCHEMA_VERSION) {
      return fail(
        `この同期先が知らない版(${schema})。サーバを更新する`,
        request,
        env,
        400,
      )
    }

    if (!(await tokenMatches(bearerToken(request.headers.get('Authorization')), env.SYNC_TOKEN))) {
      // **本文に記録を1件も入れない**(A29)。理由も「合わない」までに留める
      return fail('トークンが違う', request, env, 401)
    }

    const url = new URL(request.url)
    const thumb = THUMB_PATH.exec(url.pathname)

    try {
      if (url.pathname === '/changes' && request.method === 'GET') return await handlePull(request, env)
      if (url.pathname === '/changes' && request.method === 'POST') return await handlePush(request, env)
      if (thumb && request.method === 'GET') return await handleGetThumb(thumb[1], request, env)
      if (thumb && request.method === 'PUT') return await handlePutThumb(thumb[1], request, env)
    } catch (cause) {
      // **記録の中身をログにも応答にも出さない**(Cloudflare 側に飲酒記録を残さない)
      const reason = cause instanceof Error ? cause.name : '不明'
      return fail(`同期先で処理に失敗した(${reason})`, request, env, 500)
    }

    return fail('そのような窓口は無い', request, env, 404)
  },
} satisfies ExportedHandler<Env>
