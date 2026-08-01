// `meta` ストア(out-of-line の key-value)。**バックアップ督促の起点**と
// **ストレージ永続化の要求**の2つだけを持つ。
//
// 依存方向は domain ← store ← ui。ここは store 層なので生の IndexedDB には触らず
// db.ts のラッパだけを通す。
//
// ## なぜ「最終エクスポート日時」を永続化するのか
//
// 保存先は IndexedDB だけで端末間同期が無く、**書き出した JSON が唯一のバックアップ手段**。
// SPEC はこの穴を「アプリ側で『最終エクスポートからの経過日数』を警告表示して緩和する」と
// 書いている(SPEC「受け入れるトレードオフ」)。その起点となる日時を1つだけ持つ。
//
// **これはバックアップの中身ではなく端末側の事実**なので `store/backup.ts` の `importAll` は
// `meta` を消さない(他端末で書き出した JSON を取り込んでも、この端末の督促の起点は動かない)。
//
// ## 書くのは UI の責務
//
// `exportAll()` は DB を読むだけで `meta` を書かない(Phase 3 の申し送り)。「書き出した」と
// 言えるのは Blob を組めた時点ではなく**ファイルを実際に渡せた時点**で、それを知っているのは
// UI 側だけ。ここは `setLastExportedAt` を提供するだけで、呼ぶ場所は決めない
// (配線は `ui/ImportExport/ImportExportPanel.tsx` の書き出しハンドラ)。
//
// ## `persist()` の結果を成功と偽らない
//
// `navigator.storage.persist()` は **iOS Safari では無視される**(BACKLOG B7)。真偽値の2値に
// 畳むと「要求したが拒否された」と「そもそも API が無い」が同じ `false` になり、UI は
// 「永続化できなかった理由」を言い分けられない。**3値で返す。**
// `granted` を返すのは実際に永続化されたときだけで、迷ったら格下げする
// (`granted` と偽ると、その端末では消えないという嘘の安心を渡すことになる)。

import { get, put } from './db.ts'

/** `meta` のキー。文字列を呼び側に書き散らさない(タイポで静かに別のキーを読む事故を防ぐ) */
export const META_LAST_EXPORTED_AT = 'lastExportedAt'

/**
 * 同期の設定と位置。**3つとも `meta` に置く**(記録ではないので export にも同期にも乗らない)。
 *
 * - `syncPassword` … 同期先の秘密。**貼り付け以外の入力経路を作らない**
 * - `syncCursor` … サーバから**どこまで受け取ったか**。整数。サーバが振る値で端末の時計を含まない
 * - `lastSyncedAt` … **端末の時計**。「前回の同期より後に自分が触ったか」の判定に使う
 *
 * **後ろ2つを1つに畳んではいけない。** `syncCursor` は整数、`lastSyncedAt` は ISO8601 で、
 * 取り違えると `Date.parse(42)` が 2042年として通り、送るべき変更が例外も無く空になる。
 */
export const META_SYNC_PASSWORD = 'syncPassword'
export const META_SYNC_CURSOR = 'syncCursor'
export const META_LAST_SYNCED_AT = 'lastSyncedAt'

/**
 * 永続化の状態。**2値に畳まない。**
 *
 * - `granted` … 実際に永続化されている(`persist()` が true / 既に `persisted()`)
 * - `denied` … API はあるが永続化されていない。**「要求したのに拒否された」と
 *   「まだ要求していない」の両方を含む**(`persisted()` は理由を返さないので区別できない)
 * - `unsupported` … `navigator.storage.persist()` が無い / 呼べない実行環境
 */
export type PersistStatus = 'granted' | 'denied' | 'unsupported'

// ---------------------------------------------------------------------------
// 経過日数(純関数)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * `iso` から `now` までの経過日数。**24時間単位で切り捨てる**(暦日の差ではない)。
 * 13.9日は 13 を返すので、しきい値14日は「丸1日 × 14 が経った」で切り替わる。
 *
 * - 読めない日時は `null`(**0 で埋めない** — 「今日書き出した」という嘘になる)
 * - `now` より未来の日時は `0`(端末の時計ずれや他端末で作った値。負の日数を画面に出さない)
 *
 * store 層に置いてあるが DB も `Date.now()` も触らない純関数。`now` を必須にしているのは、
 * 呼び側が暗黙の現在時刻に依存しないようにするため(テストが時計を固定できる)。
 */
export function daysSince(iso: string, now: Date): number | null {
  const then = Date.parse(iso)
  const at = now.getTime()
  if (Number.isNaN(then) || Number.isNaN(at)) return null
  const elapsed = at - then
  if (elapsed <= 0) return 0
  return Math.floor(elapsed / DAY_MS)
}

// ---------------------------------------------------------------------------
// 最終エクスポート日時
// ---------------------------------------------------------------------------

/**
 * 最終書き出し日時(ISO 8601)。まだ書き出していなければ `null`。
 *
 * **日時として読めない値も `null` に畳む**(`meta` は `unknown` を入れられるストアなので、
 * 古い版や壊れた DB から文字列以外が来得る)。`null` 側に寄せると UI は
 * 「まだ一度も書き出していない」と言う = 督促が強くなる方向で、これは安全な側。
 */
export async function getLastExportedAt(): Promise<string | null> {
  const value = await get('meta', META_LAST_EXPORTED_AT)
  if (typeof value !== 'string') return null
  if (Number.isNaN(Date.parse(value))) return null
  return value
}

/**
 * 最終書き出し日時を書く。**呼ぶのはファイルを渡せてから**(Blob を組めただけでは書かない)。
 *
 * 読めない文字列は**保存せずに例外**にする。黙って入れると `getLastExportedAt` が `null` に
 * 畳んでしまい、「書いたのに督促が消えない」が無音のまま残る。
 */
export async function setLastExportedAt(iso: string): Promise<void> {
  if (Number.isNaN(Date.parse(iso))) {
    throw new Error(`最終書き出し日時として保存できない値(ISO 8601 として読めない): ${iso}`)
  }
  await put('meta', iso, META_LAST_EXPORTED_AT)
}

// ---------------------------------------------------------------------------
// ストレージ永続化
// ---------------------------------------------------------------------------

/** 実行環境に無いことがあるので、DOM の型ではなく「あるかもしれない面」で受ける */
type MaybeStorageManager = {
  persist?: () => Promise<boolean>
  persisted?: () => Promise<boolean>
}

function storageManager(): MaybeStorageManager | null {
  const navigatorLike = (globalThis as { navigator?: { storage?: unknown } }).navigator
  const storage = navigatorLike?.storage
  // Node には `navigator` はあるが `storage` が無い。古い Safari も同様
  if (typeof storage !== 'object' || storage === null) return null
  return storage as MaybeStorageManager
}

/**
 * 永続化を要求する。**初回書き込み時に1回呼ぶ**(配線は UI 側。`ImportExportPanel` の
 * 取り込み成功時 = このアプリで最初にデータが増える地点)。
 *
 * 段取りは **(1) 既に永続化されていれば要求しない → (2) `persist()` を呼ぶ**。
 * (1) を挟むのは、許可を尋ねるブラウザ(Firefox 等)で毎回プロンプトを出さないため。
 *
 * 例外は `unsupported` に寄せる。「API を呼べたが失敗した」を `denied` と言うと
 * 「本人/ブラウザが断った」という別の事実になってしまう(打てる手も変わる)。
 * **どの経路でも `granted` を返すのは実際に永続化されたときだけ。**
 */
export async function requestPersistentStorage(): Promise<PersistStatus> {
  const storage = storageManager()
  if (typeof storage?.persist !== 'function') return 'unsupported'
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return 'granted'
    return (await storage.persist()) ? 'granted' : 'denied'
  } catch {
    return 'unsupported'
  }
}

/**
 * 今の永続化の状態を**要求せずに**読む(表示用)。`persisted()` が無ければ `unsupported`。
 *
 * `denied` は「永続化されていない」であって「拒否された」と断定はできない
 * (`PersistStatus` のコメント参照)。UI はこの値で文言を分けるが、原因を名指ししない。
 */
export async function checkPersistentStorage(): Promise<PersistStatus> {
  const storage = storageManager()
  if (typeof storage?.persisted !== 'function') return 'unsupported'
  try {
    return (await storage.persisted()) ? 'granted' : 'denied'
  } catch {
    return 'unsupported'
  }
}

// ---------------------------------------------------------------------------
// 同期(B69 / PHASE 8)
// ---------------------------------------------------------------------------

/**
 * 同期先のパスワード。**設定されていなければ `null`。**
 *
 * `null` のとき同期は何もしない(通信もしない)。同期を設定していない端末が、これまでと
 * まったく同じに動くための入口がここ(A28)。
 */
export async function getSyncPassword(): Promise<string | null> {
  const value = await get('meta', META_SYNC_PASSWORD)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * パスワードを保存する。前後の空白は落とす(貼り付けで紛れ込むと 401 になり、
 * しかも「パスワードが違う」としか出ないので原因に辿り着けない)。
 */
export async function setSyncPassword(password: string): Promise<void> {
  await put('meta', password.trim(), META_SYNC_PASSWORD)
}

export async function clearSyncPassword(): Promise<void> {
  await put('meta', '', META_SYNC_PASSWORD)
}

/** どこまで受け取ったか。読めない値は 0(最初から取り直す。取りこぼすより取り直すほうが安全) */
export async function getSyncCursor(): Promise<number> {
  const value = await get('meta', META_SYNC_CURSOR)
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

export async function setSyncCursor(cursor: number): Promise<void> {
  await put('meta', cursor, META_SYNC_CURSOR)
}

/** 前回の同期を始めた時刻(端末の時計)。まだなら `null` */
export async function getLastSyncedAt(): Promise<string | null> {
  const value = await get('meta', META_LAST_SYNCED_AT)
  if (typeof value !== 'string') return null
  return Number.isNaN(Date.parse(value)) ? null : value
}

export async function setLastSyncedAt(iso: string): Promise<void> {
  await put('meta', iso, META_LAST_SYNCED_AT)
}

/**
 * 同期の位置だけを捨てる(パスワードは残す)。**次の同期が全件のやり取りになる。**
 *
 * 取り込み(全置換)と全データ削除の後に呼ぶ。どちらも削除の記録を作らないので、位置を残したまま
 * 同期すると (a) 全置換で消えた記録が「変わっていない」扱いでサーバに残り続け、
 * (b) 取り込んだ記録は `updatedAt` が古いので1件も送られない。どちらも例外を出さず画面は正常に見える。
 */
export async function clearSyncPosition(): Promise<void> {
  await put('meta', 0, META_SYNC_CURSOR)
  await put('meta', '', META_LAST_SYNCED_AT)
}
