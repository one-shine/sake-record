// 端末間同期で**やり取りする形**(HTTP に載る形)と、その検証(B69 / PHASE 8)。
//
// ここは domain 層なので純TS。`fetch` も IndexedDB も持たない(往復は `src/store/sync.ts`、
// どちらを採るかの判断は `src/domain/syncMerge.ts`)。
//
// ## このファイルはサーバとクライアントの**単一の出所**
//
// `server/src/index.ts`(Cloudflare Worker)がこのファイルを直接 import する。同じ形を両側に
// 書き写すと必ずずれていき、しかも壊れ方が「片方の端末の変更が黙って消える」なので気付けない
// (`linkBrand` を scripts 側に再実装しない、と同じ規律)。
//
// ## 「変更1件」に何が入るか
//
// 記録の中身だけを送っても同期は成立しない。**いつ更新したか / 消されたか / 写真が在るか**を
// 一緒に運ぶ必要がある。この3つを添えた1件を `SyncRecordChange` と呼ぶ。
//
// **記録の中身(`body`)はサーバにとって不透明**にしてある。サーバは `id` / `updatedAt` /
// `deletedAt` しか読まず、中身の検証はクライアント側(`isSyncRecordBody`)が行う。
// サーバに記録の形を教えると、項目を1つ足すたびにサーバを再デプロイするまで
// 新しい記録が保存できなくなる。
//
// ## どこまで受け取ったかに端末の時刻を使わない
//
// 位置は **ISO 時刻ではなく整数のカーソル**で持つ。`updatedAt` は**端末が書いた値**なので、
// 時計がずれた端末が過去の時刻で書き込むと、そこを通り過ぎた端末はその行を**二度と受け取らない**
// (片方の端末にだけ見えない記録ができ、例外は何も出ない)。カーソルはサーバ側で単調増加させる
// ので、どの端末の時計にも依存しない。
//
// `updatedAt`(端末の時計)が要るのは**勝ち負けの判定だけ**で、そちらは last-writer-wins の
// 定義そのものなので消せない。2つの役割を1つの値に兼ねさせていたのが危うかった。
// **`planSync` の `lastSyncedAt`(ISO・端末の時計)とこのカーソル(整数・サーバ)は別の値。**
// 取り違えると `Date.parse(42)` が 2042年として通り、push が例外も無く空になる。
//
// ## サムネイルは中身に載せない
//
// 1件50KBの JPEG を base64 にすると 1.37倍に膨らみ、変更のまとめ取りで一気に十数MBの文字列に
// なる(`store/backup.ts` が巨大文字列を作らない理由と同じ)。載せるのは `hasThumbnail` だけで、
// 実体は `GET/PUT /thumb/{id}` でバイト列のまま運ぶ。

import type { ExportedRecord } from './backupSchema.ts'
import { isBrandAlias, isBrandNote, isExportedRecord } from './backupSchema.ts'
import type { BrandAlias, BrandNote } from './types.ts'

/**
 * 同期のやり取りの版。サーバは `X-Sync-Schema` で受け取り、知らない版を断る。
 *
 * v2 で `notes`(銘柄・蔵元のメモ。B76)が入った。**上げないと壊れ方が無音になる** —
 * 旧サーバは push の本体から `records` / `aliases` しか読まないので、`notes` は知らないキーとして
 * 捨てられて 200 が返る。すると端末側は位置を進めてしまい、そのメモは
 * 「前回より後に自分が触ったか」の条件から外れて**二度と送られない**(例外も出ず画面は正常)。
 * 上げれば旧サーバが明示的に断るので、無音の欠落が見える失敗に変わる。
 *
 * **デプロイの順はサーバが先、アプリが後。**
 */
export const SYNC_SCHEMA_VERSION = 2

/**
 * 1回の push で送れる件数の上限。**無料枠の「1リクエストあたり D1 クエリ50個」から逆算した値。**
 *
 * サーバも同じ数で断る(`server/src/index.ts`)。多すぎる push を黙って切り捨てると、
 * 203件の初回投入が「成功したのに一部しか入っていない」状態になる。
 */
export const SYNC_PUSH_LIMIT_RECORDS = 12
export const SYNC_PUSH_LIMIT_ALIASES = 6
export const SYNC_PUSH_LIMIT_NOTES = 6

// ---------------------------------------------------------------------------
// 合言葉の運び方
// ---------------------------------------------------------------------------
//
// **合言葉をそのまま `Authorization` に載せられない。** HTTP のヘッダの値は1バイト文字しか
// 許されず、日本語を入れると `fetch` が例外を投げる(ブラウザも Node も同じ。実測: `日` は
// 値 26085 なので「ByteString に変換できない」)。**合言葉を英数字に限る**という手もあるが、
// それは「覚えられる言葉を使えるようにする」という判断そのものを捨てることになる。
//
// なので UTF-8 のバイト列にしてから base64 にして運ぶ。**秘匿ではない**(base64 は誰でも
// 元に戻せる)。通信路の秘匿は HTTPS が担っていて、これは**文字を通せる形にするためだけ**の変換。

/**
 * 合言葉の最小の長さ(バイト)。**日本語なら8文字ちょうど。** これより短い秘密は総当たりで割れる。
 * **サーバとアプリで同じ値を見る**(片方だけ緩めると、保存できるのに 401 になる値が作れる)。
 */
export const MIN_PASSWORD_BYTES = 24

/** 合言葉を `Authorization` に載せられる形にする。**秘匿ではない**(文字を通すための変換) */
export function encodeSyncCredential(password: string): string {
  const bytes = new TextEncoder().encode(password)
  // `String.fromCharCode(...bytes)` にしない(引数展開で長い値がスタックを飛ばす)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * 受け取った値を合言葉に戻す。**戻せなければ `null`**(例外にしない — 形の違う値が来るのは
 * 総当たりの一部で、その都度例外を投げると失敗の理由が「サーバの不具合」に化ける)。
 */
export function decodeSyncCredential(value: string): string | null {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    // 壊れた UTF-8 を黙って置換文字にしない(別の値として通ってしまう)
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * 記録の中身。**バックアップの形からサムネイルだけを抜いたもの。**
 *
 * `ExportedRecord` を土台にするのは、`SakeRecord` に項目が増えたときに
 * **バックアップと同期の両方が同時に追随する**ようにするため(片方だけ古い形のまま残ると、
 * 同期した端末とバックアップから戻した端末で内容が食い違う)。
 */
export type SyncRecordBody = Omit<ExportedRecord, 'thumbnail'>

/**
 * 記録の変更1件。**削除も1件の変更として同じ形で運ぶ**(`deletedAt` が入り `body` が `null`)。
 *
 * `hasThumbnail` は「この記録に写真が**在るべきか**」であって「サーバが持っているか」ではない。
 * サーバはこれが `false` のとき保管中の写真を消す — そうしないと、本人が写真を外した記録の
 * 写真が別端末で復活する。
 */
export type SyncRecordChange = {
  id: string
  /** ISO8601。**端末の時計**。勝ち負けの判定にだけ使う */
  updatedAt: string
  /** 消したならその時刻。生きているなら `null` */
  deletedAt: string | null
  hasThumbnail: boolean
  /** 削除のときは `null`。サーバはここを解釈しない(不透明な文字列として保管する) */
  body: SyncRecordBody | null
}

/**
 * 手動紐付けの変更1件。**キーは `aliasKey(label, prefecture)`**(`store/db.ts`)。
 *
 * records だけ同期すると、片方の端末でだけ `寫楽` が未紐付けに戻る
 * (紐付けは「銘柄表記 → brandId」の判断で、記録1件に閉じないため)。
 */
export type SyncAliasChange = {
  key: string
  updatedAt: string
  deletedAt: string | null
  body: BrandAlias | null
}

/**
 * メモの変更1件。**キーは `noteKey(target, targetId)`**(`store/db.ts`)。
 *
 * 銘柄IDと蔵元IDは値域が重なる(銘柄ID 3264件のうち1352個が蔵元IDとしても在る)ので、
 * 鍵には**必ず種類を焼き込む**。裸の数値だと蔵元のメモが同じ番号の銘柄のメモを消す。
 */
export type SyncNoteChange = {
  key: string
  updatedAt: string
  deletedAt: string | null
  body: BrandNote | null
}

/**
 * `GET /changes?since=<cursor>` の返り。
 *
 * `cursor` は**この応答に含まれるところまで**を指す。次回はこれを `since` に渡す。
 * `hasMore` が真なら続きがある(1回で返す件数に上限があるため)。
 *
 * **クライアントがこれを保存するのは push が成功したあとだけ**(先に保存すると、
 * 送れていない変更が二度と送られない)。
 */
export type SyncPullResponse = {
  cursor: number
  hasMore: boolean
  records: SyncRecordChange[]
  aliases: SyncAliasChange[]
  notes: SyncNoteChange[]
}

/** `POST /changes` の本体。空配列でもよい(受け取るだけの同期) */
export type SyncPushRequest = {
  records: SyncRecordChange[]
  aliases: SyncAliasChange[]
  notes: SyncNoteChange[]
}

/**
 * `POST /changes` の返り。`accepted` は**実際にサーバの値を更新した**件数で、
 * `rejected` はサーバ側のほうが新しかったので採らなかった件数。
 *
 * **0件でも失敗ではない**(相手のほうが新しかっただけ)。次回の pull でサーバの値が降りてくる。
 */
export type SyncPushResponse = {
  cursor: number
  accepted: number
  rejected: number
}

// ---------------------------------------------------------------------------
// 検証(ネットワークから来た値を信じない)
// ---------------------------------------------------------------------------
//
// **サーバは自分のものだが、応答は境界の外から来る。** 形が違う応答を素通しすると、
// `undefined` が記録の項目に入って IndexedDB に保存され、以降その記録が画面で壊れる
// (しかも例外が出ないので原因が同期だと気付けない)。1件ずつ判定して**壊れた行だけ捨てる**。

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function isNullableIso(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value)
}

/**
 * 記録の中身として読めるか。**サムネイル以外は `isExportedRecord` と同じ判定を通す** —
 * 判定を書き写すと、片方だけ緩めたときに同期経由でだけ壊れた記録が入る。
 * `thumbnail: null` を差し込んで既存の判定器を再利用する。
 */
export function isSyncRecordBody(value: unknown): value is SyncRecordBody {
  if (!isObject(value)) return false
  if ('thumbnail' in value) return false // 中身に写真を載せる経路は作らない
  return isExportedRecord({ ...value, thumbnail: null })
}

/**
 * **外側だけ**を見る(サーバ用)。
 *
 * **深さを2段に分けているのは意図的。** サーバが記録の中身まで検証すると、`SakeRecord` に
 * 項目を1つ足すたびに**サーバを再デプロイするまで新しい記録が保存できない**
 * (しかも断られ方は 400 なので、端末側には「同期できない」としか見えない)。
 * サーバは運ぶだけ、中身の責任はクライアント、と分ける。
 *
 * ただし**外側は厳密に見る** — `id` や `updatedAt` が壊れた行を保管すると、
 * 突き合わせの鍵が壊れて全端末に伝播する。
 */
export function isSyncRecordChangeShape(value: unknown): value is SyncRecordChange {
  if (!isObject(value)) return false
  if (!isNonEmptyString(value.id)) return false
  if (!isNonEmptyString(value.updatedAt)) return false
  if (!isNullableIso(value.deletedAt)) return false
  if (typeof value.hasThumbnail !== 'boolean') return false
  // **削除なら中身は無い / 生きているなら中身が要る。** 片方だけ来る行はどちらとも解釈できる
  // (生きていると扱えば中身が空の記録が増え、削除と扱えば生きている記録が消える)
  if (value.deletedAt === null) return isObject(value.body)
  return value.body === null
}

/** 中身まで見る(クライアント用)。`id` が外側と中身で食い違う行も断る */
export function isSyncRecordChange(value: unknown): value is SyncRecordChange {
  if (!isSyncRecordChangeShape(value)) return false
  if (value.deletedAt !== null) return true
  return isSyncRecordBody(value.body) && value.body.id === value.id
}

export function isSyncAliasChangeShape(value: unknown): value is SyncAliasChange {
  if (!isObject(value)) return false
  if (!isNonEmptyString(value.key)) return false
  if (!isNonEmptyString(value.updatedAt)) return false
  if (!isNullableIso(value.deletedAt)) return false
  if (value.deletedAt === null) return isObject(value.body)
  return value.body === null
}

export function isSyncAliasChange(value: unknown): value is SyncAliasChange {
  if (!isSyncAliasChangeShape(value)) return false
  if (value.deletedAt !== null) return true
  return isBrandAlias(value.body)
}

export function isSyncNoteChangeShape(value: unknown): value is SyncNoteChange {
  if (!isObject(value)) return false
  if (!isNonEmptyString(value.key)) return false
  if (!isNonEmptyString(value.updatedAt)) return false
  if (!isNullableIso(value.deletedAt)) return false
  if (value.deletedAt === null) return isObject(value.body)
  return value.body === null
}

export function isSyncNoteChange(value: unknown): value is SyncNoteChange {
  if (!isSyncNoteChangeShape(value)) return false
  if (value.deletedAt !== null) return true
  return isBrandNote(value.body)
}

/**
 * pull の応答を検証して**読めた変更だけ**を返す。壊れた行は捨てて `dropped` に数える
 * (黙って捨てない — 呼び側が画面に出す)。
 *
 * 変更が1件も読めなくても失敗にしない。**`cursor` が読めないときだけ失敗**にする —
 * 位置が分からないまま先へ進むと、次回の `since` が狂って変更を取りこぼす。
 */
export type PulledChanges = {
  cursor: number
  hasMore: boolean
  records: SyncRecordChange[]
  aliases: SyncAliasChange[]
  notes: SyncNoteChange[]
  /** 形が違って捨てた行の数 */
  dropped: number
}

export type PullCheck = { ok: true; value: PulledChanges } | { ok: false; reason: string }

export function checkPullResponse(value: unknown): PullCheck {
  if (!isObject(value)) return { ok: false, reason: '同期先の応答が JSON オブジェクトでない' }
  const cursor = value.cursor
  if (typeof cursor !== 'number' || !Number.isInteger(cursor) || cursor < 0) {
    return { ok: false, reason: '同期先の応答に位置(cursor)が無い、または整数でない' }
  }
  if (!Array.isArray(value.records) || !Array.isArray(value.aliases)) {
    return { ok: false, reason: '同期先の応答に records / aliases の配列が無い' }
  }
  let dropped = 0
  const records: SyncRecordChange[] = []
  for (const entry of value.records as unknown[]) {
    if (isSyncRecordChange(entry)) records.push(entry)
    else dropped++
  }
  const aliases: SyncAliasChange[] = []
  for (const entry of value.aliases as unknown[]) {
    if (isSyncAliasChange(entry)) aliases.push(entry)
    else dropped++
  }
  // **`notes` が無い応答を失敗にしない。** アプリとサーバは別々にデプロイされるので、
  // 必須にすると片方だけ古い間は同期が丸ごと止まる(記録も紐付けも降りてこない)。
  // 落とすなら「メモだけ運ばれない」に留める
  const notes: SyncNoteChange[] = []
  if (Array.isArray(value.notes)) {
    for (const entry of value.notes as unknown[]) {
      if (isSyncNoteChange(entry)) notes.push(entry)
      else dropped++
    }
  }
  return {
    ok: true,
    value: { cursor, hasMore: value.hasMore === true, records, aliases, notes, dropped },
  }
}

export type PushCheck = { ok: true; value: SyncPushResponse } | { ok: false; reason: string }

export function checkPushResponse(value: unknown): PushCheck {
  if (!isObject(value)) return { ok: false, reason: '同期先の応答が JSON オブジェクトでない' }
  const { cursor, accepted, rejected } = value
  if (typeof cursor !== 'number' || !Number.isInteger(cursor) || cursor < 0) {
    return { ok: false, reason: '同期先の応答に位置(cursor)が無い、または整数でない' }
  }
  if (!Number.isInteger(accepted) || !Number.isInteger(rejected)) {
    return { ok: false, reason: '同期先の応答に件数(accepted / rejected)が無い' }
  }
  return {
    ok: true,
    value: { cursor, accepted: accepted as number, rejected: rejected as number },
  }
}
