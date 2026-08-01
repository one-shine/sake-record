// エクスポート / インポートの **wire 型**(JSON に載る形)と、その検証。
//
// ここは domain 層なので React も Blob 変換も持たない純TS。**Blob ↔ data URL の変換は
// store/backup.ts 側**(非同期でブラウザ API を要する)。この分割の意図は下の1点に尽きる:
//
//   **ドメイン型と配線型は別物であり、型で区別を強制する。**
//   `SakeRecord.thumbnail` は `Blob | null`、`ExportedRecord.thumbnail` は data URL の
//   `string | null`。片方をもう片方の場所に入れると型エラーになる(spread で静かに混ざらない)。
//   Blob は JSON.stringify で `{}` になって**例外を出さずに写真だけ消える**ので、
//   ここが緩いと A11(往復で失われない)が黙って壊れる。

import { OLDEST_UPDATED_AT } from './syncMerge.ts'
import type { BrandAlias, LinkStatus, Rating, SakeRecord } from './types.ts'

/**
 * バックアップ JSON のスキーマ版。**上げるのは形を変えたときだけ。**
 * 読む側は「これより新しい版は拒否」「同じか古い版は受ける」。
 *
 * v2 で `aliases` に `updatedAt` が入った(端末間同期の勝ち負けを決める値。B69 / PHASE 8)。
 * **v1 のファイルも読める** — 時刻が無い行は `OLDEST_UPDATED_AT` で埋める(取り込んだ時刻で
 * 埋めない。古いバックアップが別端末の新しい削除に勝ってしまう)。
 */
export const SCHEMA_VERSION = 2

/**
 * ペイロードのアプリ識別子。**ブランド名を入れない**
 * (改名を表示文字列だけに閉じる方針。scripts/check-naming.mjs が強制する)。
 * 他アプリの JSON を読み込んだときに理由を言って断るための札で、
 * 無い(古い/手書きの)ペイロードは受け入れる。
 */
export const APP_ID = 'sake-record'

/** ダウンロードファイル名の接頭辞。ここも中立名にする */
export const EXPORT_FILE_PREFIX = 'sake-record-backup'

/**
 * 1件の記録の wire 形。`thumbnail` だけがドメイン型と違い、
 * 長辺400px JPEG の **data URL 文字列**(`data:image/jpeg;base64,...`)になる。
 */
export type ExportedRecord = Omit<SakeRecord, 'thumbnail'> & { thumbnail: string | null }

/**
 * 1件の手動紐付けの wire 形。**`updatedAt` は任意** — v1 のファイルには無いため。
 *
 * 保存側(`store/aliases.ts` の `StoredAlias`)では必須で、読むときだけ欠落を許して
 * `OLDEST_UPDATED_AT` で埋める。**取り込んだ時刻で埋めない**(古いバックアップから戻した
 * 紐付けが、別端末で実際に消した判断を追い越して復活する)。
 */
export type ExportedAlias = BrandAlias & { updatedAt?: string }

/** 保存されている紐付け(更新時刻つき)。domain から store の型を参照しないための構造的な写し */
export type TimestampedAlias = BrandAlias & { updatedAt: string }

/**
 * エクスポートの中身。
 *
 * `aliases` を必ず含める: SPEC の A11 は records しか言っていないが、含めないと
 * `manual` で紐付けた根拠が往復で失われ、A6(手動紐付けの永続化)が壊れる。
 * 手動紐付けは「銘柄表記 → brandId」の判断であって記録1件に閉じないので、
 * records だけ戻しても 5本の `寫楽` は再び `unlinked` に落ちる。
 */
export type ExportPayload = {
  schemaVersion: number
  /** ISO8601 */
  exportedAt: string
  records: ExportedRecord[]
  aliases: ExportedAlias[]
  /** APP_ID。**任意** — 手書きの最小ペイロードやこの版より前の出力でも読めるようにする */
  app?: string
}

/** 検証の結果。理由を文字列で返し、呼び側(store/backup.ts)が `{ok, errors, applied}` に畳む */
export type PayloadCheck =
  | { ok: true; payload: ExportPayload }
  | { ok: false; reason: string }

// ---------------------------------------------------------------------------
// 型ガード
// ---------------------------------------------------------------------------

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * `linkStatus` の実行時列挙。**型から漏れなく導く**ため Record で書く
 * (5値のどれかを書き忘れる/型に6値目を足すと、この行がコンパイルエラーになる)。
 * UI のバッジ対応表はこの5値を単一の出所として引く。
 */
const LINK_STATUS_KEYS: Record<LinkStatus, true> = {
  auto: true,
  alias: true,
  manual: true,
  unlinked: true,
  unknown: true,
}

/** `linkStatus` の実行時の全列挙(表示順ではない。並べ方は表示層の関心) */
export const LINK_STATUSES = Object.keys(LINK_STATUS_KEYS) as readonly LinkStatus[]

export function isLinkStatus(value: unknown): value is LinkStatus {
  return typeof value === 'string' && Object.hasOwn(LINK_STATUS_KEYS, value)
}

const RATINGS: Record<Rating, true> = { 1: true, 2: true, 3: true, 4: true, 5: true }

export function isRating(value: unknown): value is Rating {
  return typeof value === 'number' && Object.hasOwn(RATINGS, String(value))
}

const DRANK_ON_RE = /^\d{4}-\d{2}-\d{2}$/

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableInt(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value))
}

/**
 * 1件が wire 形として読めるか。**`thumbnail` は data URL の文字列のみ**
 * (Blob が紛れ込んでいたら JSON 経由で `{}` に化けた壊れた入力なので受けない)。
 *
 * 記録の粒度で判定できるようにしてあるのは**部分インポートのため** —
 * 1件壊れていても残りは取り込めるようにする(brain: 全滅させない)。
 */
export function isExportedRecord(value: unknown): value is ExportedRecord {
  if (!isRecordObject(value)) return false
  if (typeof value.id !== 'string' || value.id === '') return false
  if (typeof value.drankOn !== 'string' || !DRANK_ON_RE.test(value.drankOn)) return false
  if (typeof value.brandLabel !== 'string') return false
  if (!isNullableInt(value.sakenowaBrandId)) return false
  if (!isNullableString(value.brandName)) return false
  if (!isLinkStatus(value.linkStatus)) return false
  if (!isNullableString(value.prefecture)) return false
  if (typeof value.spec !== 'string') return false
  if (!(value.rating === null || isRating(value.rating))) return false
  if (typeof value.place !== 'string') return false
  if (typeof value.note !== 'string') return false
  if (!isDataUrlOrNull(value.thumbnail)) return false
  if (!isNullableInt(value.sourceNo)) return false
  if (typeof value.createdAt !== 'string' || value.createdAt === '') return false
  if (typeof value.updatedAt !== 'string' || value.updatedAt === '') return false
  return true
}

function isDataUrlOrNull(value: unknown): value is string | null {
  if (value === null) return true
  return typeof value === 'string' && value.startsWith('data:')
}

export function isBrandAlias(value: unknown): value is BrandAlias {
  if (!isRecordObject(value)) return false
  if (typeof value.label !== 'string' || value.label === '') return false
  if (!isNullableString(value.prefecture)) return false
  return typeof value.brandId === 'number' && Number.isInteger(value.brandId)
}

/**
 * 紐付け1件が wire 形として読めるか。`updatedAt` は**無くてもよいが、あるなら文字列**
 * (数値や null が入っていたら形が壊れているので断る)。
 */
export function isExportedAlias(value: unknown): value is ExportedAlias {
  if (!isBrandAlias(value)) return false
  const updatedAt = (value as Record<string, unknown>).updatedAt
  return updatedAt === undefined || typeof updatedAt === 'string'
}

/**
 * 保存形 → wire。**spread を使わず4項目を書き並べる**のは `toExportedRecord` と同じ理由で、
 * `StoredAlias` に項目が増えたらここがコンパイルエラーになって判断を強制するため。
 */
export function toExportedAlias(alias: TimestampedAlias): ExportedAlias {
  return {
    label: alias.label,
    prefecture: alias.prefecture,
    brandId: alias.brandId,
    updatedAt: alias.updatedAt,
  }
}

/** wire → 保存形。**時刻が無い行は最古で埋める**(取り込んだ時刻では埋めない) */
export function toStoredAlias(row: ExportedAlias, alias: BrandAlias): TimestampedAlias {
  return { ...alias, updatedAt: row.updatedAt ?? OLDEST_UPDATED_AT }
}

/**
 * ファイル全体の形として読めるか。**要素の中身までは見ない**(`records` / `aliases` が配列であることだけ)。
 * 1件ずつの判定は isExportedRecord / isBrandAlias で行い、壊れた行だけを弾いて残りを取り込む。
 * 版の検査もしない(それは checkExportPayload)。
 */
export function isExportPayload(value: unknown): value is ExportPayload {
  if (!isRecordObject(value)) return false
  if (typeof value.schemaVersion !== 'number' || !Number.isInteger(value.schemaVersion)) return false
  if (typeof value.exportedAt !== 'string' || value.exportedAt === '') return false
  if (!Array.isArray(value.records)) return false
  if (!Array.isArray(value.aliases)) return false
  if (!(value.app === undefined || typeof value.app === 'string')) return false
  return true
}

/**
 * インポートの入口。ファイル全体の形 → アプリ識別子 → スキーマ版 の順に見て、
 * 断るときは**理由を返す**(無音で空を返さない)。
 *
 * - 未来の版は拒否する: この版が知らないフィールドを黙って捨てると、
 *   ユーザーは「復元できた」と思ったまま情報を失う
 * - 古い版は受ける(現状 v1 しか無いので移行はまだ無い。増えたらここに移行を足す)
 */
export function checkExportPayload(value: unknown): PayloadCheck {
  if (!isExportPayload(value)) {
    return {
      ok: false,
      reason:
        'バックアップの形が違う(schemaVersion / exportedAt / records / aliases が必要)。' +
        'このアプリが書き出した JSON か確認する',
    }
  }
  if (value.app !== undefined && value.app !== APP_ID) {
    return { ok: false, reason: `別のアプリのバックアップ(app: ${value.app})` }
  }
  if (value.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `新しい形式のバックアップ(v${value.schemaVersion})。このアプリが読めるのは v${SCHEMA_VERSION} まで。アプリを更新する`,
    }
  }
  if (value.schemaVersion < 1) {
    return { ok: false, reason: `schemaVersion が不正(v${value.schemaVersion})` }
  }
  return { ok: true, payload: value }
}

// ---------------------------------------------------------------------------
// ドメイン型 ↔ wire 型
// ---------------------------------------------------------------------------

/**
 * ドメイン → wire。`thumbnail` の data URL は呼び側(store/backup.ts)が Blob から作って渡す。
 *
 * **spread ではなく全フィールドを書き並べているのは意図的** — `SakeRecord` に項目を足したとき、
 * ここがコンパイルエラーになって「エクスポートに含めるか」を必ず判断させる。
 * spread だと新項目が静かに漏れる/静かに載る。
 */
export function toExportedRecord(record: SakeRecord, thumbnail: string | null): ExportedRecord {
  return {
    id: record.id,
    drankOn: record.drankOn,
    brandLabel: record.brandLabel,
    sakenowaBrandId: record.sakenowaBrandId,
    brandName: record.brandName,
    linkStatus: record.linkStatus,
    prefecture: record.prefecture,
    spec: record.spec,
    rating: record.rating,
    place: record.place,
    note: record.note,
    thumbnail,
    sourceNo: record.sourceNo,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** wire → ドメイン。data URL を復号した Blob は呼び側が渡す(復号は非同期なので domain に置かない) */
export function toDomainRecord(record: ExportedRecord, thumbnail: Blob | null): SakeRecord {
  return {
    id: record.id,
    drankOn: record.drankOn,
    brandLabel: record.brandLabel,
    sakenowaBrandId: record.sakenowaBrandId,
    brandName: record.brandName,
    linkStatus: record.linkStatus,
    prefecture: record.prefecture,
    spec: record.spec,
    rating: record.rating,
    place: record.place,
    note: record.note,
    thumbnail,
    sourceNo: record.sourceNo,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
