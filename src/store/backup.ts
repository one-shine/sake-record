// 全記録の JSON エクスポート / インポート(SPEC スコープ5 / A11)。
//
// 依存方向は domain ← store ← ui。ここは store 層なので domain / 他の store を import してよい。
// 生の IndexedDB には触らず db.ts のラッパだけを通し、**wire 型の定義と検証は
// domain/backupSchema.ts に置く**(純TS で単体テストできる形に保つ)。このファイルの責務は
// 「Blob ↔ data URL の変換」と「IndexedDB への読み書き」の2つだけ。
//
// ## このアプリでは JSON エクスポートが唯一のバックアップ手段
//
// 保存先は IndexedDB だけで端末間同期が無いので、ブラウザの「サイトデータを削除」で記録は消える。
// つまりここが壊れると復旧手段が無い。**黙って一部だけ落とす経路を作らない**:
//
// - エクスポートは1件でもサムネイルが読めなければ**失敗する**(写真だけ欠けた
//   バックアップを「成功」として渡さない)。
// - インポートは形が違う行を飛ばして続けるが、飛ばしたことを必ず `errors` に積む。
// - `aliases` も往復させる。A11 は records しか言っていないが、含めないと手動紐付け(`manual`)の
//   根拠が失われ、復元後に同じ銘柄表記が再び `unlinked` に落ちる(A6 が壊れる)。
//
// ## 巨大文字列を1本作らない
//
// サムネイルは1件50KB以下だが、base64 は約1.37倍に膨らむ(203件フルなら 10.2MB → 13.6MB)。
// `JSON.stringify(payload)` で全体を1本の文字列にすると、その瞬間だけピークメモリが倍になり
// 端末によっては落ちる。**`new Blob(parts)` に部品配列(外側の見出し + 1件1部品)で組む。**
//
// ## rehydrate / reload は呼ばない
//
// 取り込み後に画面を作り直すのは呼び出し側(UI)の責務。ここが React を触ると依存方向が壊れる。

import {
  APP_ID,
  EXPORT_FILE_PREFIX,
  SCHEMA_VERSION,
  checkExportPayload,
  isExportedAlias,
  isExportedNote,
  isExportedRecord,
  toDomainRecord,
  toExportedAlias,
  toExportedNote,
  toExportedRecord,
  toStoredAlias,
  toStoredNote,
} from '../domain/backupSchema.ts'
import type {
  ExportedRecord,
  TimestampedAlias,
  TimestampedNote,
} from '../domain/backupSchema.ts'
import type { SakeRecord } from '../domain/types.ts'
import { aliasKeyOf, canonicalAlias } from './aliases.ts'
import { noteKeyOf } from './notes.ts'
import { getAll, req, tx } from './db.ts'
import { clearSyncPosition } from './meta.ts'
import type { StoreName } from './db.ts'

/** 書き出す Blob の MIME。ダウンロード時に拡張子と食い違わせない */
export const EXPORT_MIME = 'application/json'

// ---------------------------------------------------------------------------
// Blob → data URL
// ---------------------------------------------------------------------------

/**
 * サムネイルを `data:image/jpeg;base64,...` にする。**接頭辞を残す**
 * (MIME を別項目に持たせず、1つの文字列で自己記述的にする。復号は fetch の1行で済む)。
 *
 * ブラウザでは `FileReader.readAsDataURL` を使う — base64 化がネイティブ側で走り、
 * `btoa(String.fromCharCode(...new Uint8Array(buf)))` のような**引数展開でスタックを飛ばす**
 * 経路を通らない(50KB でも十数万要素の展開になり、端末によって落ちる)。
 *
 * `FileReader` が無い実行環境(Node — store 層のテストは jsdom では Blob が
 * structuredClone で `{}` に潰れるため node 環境で回す)では自前で組む。展開ではなく
 * **3の倍数の塊ごとに btoa する**ので、塊の境界にパディングが入らず引数展開も起きない。
 */
async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader === 'function') return readAsDataUrl(blob)
  return encodeDataUrl(blob)
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error('サムネイルの読み取り結果が data URL ではない'))
    }
    reader.onerror = () =>
      reject(new Error(`サムネイルを読み取れない — ${describeCause(reader.error)}`))
    reader.readAsDataURL(blob)
  })
}

/** btoa に渡す塊の大きさ。**3の倍数**(base64 は3バイト→4文字なので、途中でパディングを挟まない) */
const BASE64_CHUNK_BYTES = 3 * 8192

async function encodeDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let base64 = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    const end = Math.min(offset + BASE64_CHUNK_BYTES, bytes.length)
    let binary = ''
    // 1バイトずつ足す。`String.fromCharCode(...chunk)` は塊を小さくしても引数上限に近づくので使わない
    for (let i = offset; i < end; i++) binary += String.fromCharCode(bytes[i])
    base64 += btoa(binary)
  }
  return `data:${blob.type === '' ? 'application/octet-stream' : blob.type};base64,${base64}`
}

/** data URL → Blob。`data:` は fetch がオフラインでも解決するので1行で済む(MIME も復元される) */
async function decodeDataUrl(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob()
}

// ---------------------------------------------------------------------------
// エクスポート
// ---------------------------------------------------------------------------

/**
 * records と aliases を1つの JSON Blob にする。**DB は読むだけ**(何度呼んでも副作用が無い)。
 *
 * 部品の組み立ては「外側の見出し + 記録1件ごとに1部品 + 閉じ括弧」。1件ずつ
 * `JSON.stringify` するので、文字列の最大長は「最も大きい1件」で止まる。
 * 記録は1行1件で並べるので、生成物を人が grep できる。
 *
 * 並び順は IndexedDB のキー順(= `id` 順)。表示順(新しい順)はここでは作らない —
 * 復元は `id` で行うので順序に意味を持たせない(順序に意味を持たせると
 * 表示順の変更がバックアップ形式の変更になってしまう)。
 */
export async function exportAll(): Promise<Blob> {
  const [records, aliases, memos] = await Promise.all([
    getAll('records'),
    getAll('aliases'),
    getAll('notes'),
  ])

  const parts: BlobPart[] = [
    '{' +
      `"schemaVersion":${String(SCHEMA_VERSION)},` +
      `"app":${JSON.stringify(APP_ID)},` +
      `"exportedAt":${JSON.stringify(new Date().toISOString())},` +
      // **`aliases` をそのまま stringify しない。** 保存形に項目が増えたとき、
      // 書き出しに載せるかを判断せず黙って載る(記録側が `toExportedRecord` で
      // 全項目を書き並べているのと同じ理由)
      `"aliases":${JSON.stringify(aliases.map(toExportedAlias))},` +
      // 銘柄・蔵元のメモ(v3〜)。**載せないと、取り込みの全置換でメモだけが消える**
      `"notes":${JSON.stringify(memos.map(toExportedNote))},` +
      '"records":[',
  ]

  for (const [index, record] of records.entries()) {
    let thumbnail: string | null = null
    if (record.thumbnail !== null) {
      try {
        thumbnail = await blobToDataUrl(record.thumbnail)
      } catch (cause) {
        // 写真だけ欠けたバックアップを黙って作らない。どの記録かを言って止まる
        throw new Error(
          `エクスポートを中止した(記録 ${record.id} のサムネイルを読み取れない) — ${describeCause(cause)}`,
          { cause },
        )
      }
    }
    parts.push(`${index === 0 ? '\n' : ',\n'}${JSON.stringify(toExportedRecord(record, thumbnail))}`)
  }

  parts.push('\n]}\n')
  return new Blob(parts, { type: EXPORT_MIME })
}

/**
 * ダウンロードのファイル名。`sake-record-backup-YYYY-MM-DD.json`。
 * 日付は**端末のローカル日付**(ユーザーが「いつ取ったか」で探すのは手元の日付)。
 */
export function exportFileName(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${EXPORT_FILE_PREFIX}-${year}-${month}-${day}.json`
}

// ---------------------------------------------------------------------------
// インポート
// ---------------------------------------------------------------------------

/**
 * `replace` … ファイルの状態に戻す(既存の records / aliases を消してから入れる)。
 * `merge`   … 既存を残し、同じ `id`(aliases は同じ `(label, prefecture)`)だけ上書きする。
 *
 * **既定は `replace`** — バックアップからの復元は「ファイルの状態に戻る」が予測可能な意味で、
 * merge は2つの履歴を無言で混ぜる(`id` が違えば同じ1本が2件になる)。
 * 破壊的なので、確認を取るのは呼び出し側(UI)の責務。
 */
export type ImportMode = 'replace' | 'merge'

export const DEFAULT_IMPORT_MODE: ImportMode = 'replace'

export type ImportOptions = { mode?: ImportMode }

export type ImportResult = {
  /** 1つ以上のストアに反映できたか。**`errors` が空でなくても部分的に成功していれば true** */
  ok: boolean
  /** 断った理由・飛ばした行。UI はこれをそのまま出す(無音で捨てない) */
  errors: string[]
  /** 反映できたストアと件数(表示用の文字列) */
  applied: string[]
  /** 実際に書き込んだ件数。UI の「203件を取り込んだ」に使う */
  imported: { records: number; aliases: number; notes: number }
}

/**
 * JSON(文字列 or File)を検証して IndexedDB に書き戻す。
 *
 * 段取りは **(1) 全部検証して Blob に戻す → (2) 1トランザクションで書く**。
 * 復号(fetch)を書き込みトランザクションの中で待つと IndexedDB が先に自動コミットするし、
 * 検証を後回しにすると「消したのに入らなかった」が起きる。
 *
 * 部分インポートを許す(1件壊れていても残りは入れる)が、**「ファイルに行はあるのに1件も
 * 読めなかった」ときはそのストアに触らない** — replace で既存を消してから空を書くと、
 * 壊れたファイルを1回読み込んだだけで全記録が消える。さらに、そういうファイルでは
 * **もう一方のストアの「0件で置き換える」も実行しない**(全消しは、ファイル全体が
 * 信用できるときだけ意味を持つ操作)。触ったストアが1つも無ければ `ok: false`。
 */
export async function importAll(
  source: string | Blob,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const mode = options.mode ?? DEFAULT_IMPORT_MODE
  const errors: string[] = []
  const applied: string[] = []
  const imported = { records: 0, aliases: 0, notes: 0 }
  const refuse = (reason: string): ImportResult => ({
    ok: false,
    errors: [reason],
    applied,
    imported,
  })

  let text: string
  try {
    text = typeof source === 'string' ? source : await source.text()
  } catch (cause) {
    return refuse(`ファイルを読み取れない — ${describeCause(cause)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    return refuse(`JSON として読み取れない — ${describeCause(cause)}`)
  }

  const check = checkExportPayload(parsed)
  if (!check.ok) return refuse(check.reason)
  const payload = check.payload

  // (1) 検証と復号。DB にはまだ触らない。
  //     **キーで畳む** — IndexedDB の `put` は同じキーを上書きするので、行数をそのまま
  //     「取り込んだ件数」として報告すると画面が実際より多く言う。黙って畳まず errors に積む。
  const records = new Map<string, SakeRecord>()
  for (const [index, row] of payload.records.entries()) {
    if (!isExportedRecord(row)) {
      errors.push(`records[${String(index)}] は形が違うので取り込まなかった`)
      continue
    }
    if (records.has(row.id)) {
      errors.push(`records[${String(index)}] は id が重複しているので後の行で上書きした`)
    }
    records.set(row.id, await toRecordWithThumbnail(row, errors))
  }

  const aliases = new Map<string, TimestampedAlias>()
  for (const [index, row] of payload.aliases.entries()) {
    if (!isExportedAlias(row)) {
      errors.push(`aliases[${String(index)}] は形が違うので取り込まなかった`)
      continue
    }
    // 正規化していない label は createLinker と一度も一致しない(黙って効かないエイリアスになる)
    const alias = canonicalAlias(row)
    if (alias.label === '' || !Number.isInteger(alias.brandId) || alias.brandId <= 0) {
      errors.push(
        `aliases[${String(index)}] は照合に使えないので取り込まなかった(正規化後の銘柄表記が空 / 銘柄IDが正の整数でない)`,
      )
      continue
    }
    const key = aliasKeyOf(alias)
    if (aliases.has(key)) {
      errors.push(
        `aliases[${String(index)}] は銘柄表記と都道府県の組が重複しているので後の行で上書きした`,
      )
    }
    // v1 のファイルには更新時刻が無い。**取り込んだ時刻で埋めない** —
    // 埋めると、古いバックアップから戻した紐付けが、別端末で実際に消した判断を追い越して復活する
    aliases.set(key, toStoredAlias(row, alias))
  }

  // v2 以前のファイルには `notes` が無い。**無いことと空であることは別**
  // (無い = メモを知らない版が書いた → 既存のメモに触らない / 空 = 意図して0件)
  const memoRows = payload.notes
  const memos = new Map<string, TimestampedNote>()
  if (memoRows !== undefined) {
    for (const [index, row] of memoRows.entries()) {
      if (!isExportedNote(row)) {
        errors.push(`notes[${String(index)}] は形が違うので取り込まなかった`)
        continue
      }
      const key = noteKeyOf(row)
      if (memos.has(key)) {
        errors.push(`notes[${String(index)}] は宛先が重複しているので後の行で上書きした`)
      }
      // **取り込んだ時刻で埋めない**(古いバックアップが別端末の削除を追い越す)
      memos.set(key, toStoredNote(row, { target: row.target, targetId: row.targetId, text: row.text }))
    }
  }

  // 行はあるのに1件も読めなかったストアは触らない(壊れたファイルで既存を消さない)
  const recordsRefused = payload.records.length > 0 && records.size === 0
  const aliasesRefused = payload.aliases.length > 0 && aliases.size === 0
  const memosRefused = memoRows !== undefined && memoRows.length > 0 && memos.size === 0
  if (recordsRefused) errors.push('records を1件も読めなかったので既存の記録には触っていない')
  if (aliasesRefused) errors.push('aliases を1件も読めなかったので既存の紐付けには触っていない')
  if (memosRefused) errors.push('notes を1件も読めなかったので既存のメモには触っていない')

  // **どこかが読めなかったファイルでは、中身の無いストアにも触らない。**
  // `replace` の「0件で置き換える」は全消しで、それが正しいのは**ファイル全体が信用できる**
  // とき(意図して空のバックアップを戻すとき)だけ。records が全滅したファイルで aliases 側の
  // 0件置き換えを実行すると、壊れたファイルを1回読むだけで手動紐付けの根拠が消える(A6)。
  const fileBroken = recordsRefused || aliasesRefused || memosRefused
  const writeRecords = !recordsRefused && (records.size > 0 || !fileBroken)
  const writeAliases = !aliasesRefused && (aliases.size > 0 || !fileBroken)
  // **`notes` を持たないファイル(v2 以前)では既存のメモに触らない。** 0件で置き換えると、
  // 古いバックアップを1回戻すだけで全部のメモが消える
  const writeMemos = memoRows !== undefined && !memosRefused && (memos.size > 0 || !fileBroken)

  // (2) 書き込み。records と aliases を1トランザクションに入れる
  //    (途中で失敗したら全部戻る = 「消えただけ」の状態を作らない)
  try {
    await write(
      mode,
      writeRecords ? [...records.values()] : null,
      writeAliases ? [...aliases.values()] : null,
      writeMemos ? [...memos.values()] : null,
    )
  } catch (cause) {
    errors.push(`保存に失敗した(取り込みは反映されていない) — ${describeCause(cause)}`)
    return { ok: false, errors, applied, imported }
  }

  // **同期の位置を捨てる(次の同期を全件のやり取りにする)。**
  //
  // 取り込みは削除の記録を作らない — 全置換はバックアップの復元であって、同期先に対する
  // 削除の意思表示ではないから。ところが位置を残したまま同期すると:
  //   (a) 全置換で消えた記録は `local` にも削除の記録にも居ないので突き合わせの対象にならず、
  //       サーバと別端末には残り続けてこの端末には二度と戻らない
  //   (b) 取り込んだ記録の `updatedAt` はファイル内の古い値なので、1件も送られない
  // どちらも例外を出さず画面も正常に見える。位置を捨てれば両方向で突き合わせ直せる。
  // **失敗しても取り込みは成功として返す**(記録はもう入っている)。理由は errors に積む。
  try {
    await clearSyncPosition()
  } catch (cause) {
    errors.push(
      `同期の位置を初期化できなかった(取り込みは成功している)。次の同期の前に手で同期し直す — ${describeCause(cause)}`,
    )
  }

  if (writeRecords) {
    imported.records = records.size
    applied.push(`records ${String(records.size)}件`)
  }
  if (writeAliases) {
    imported.aliases = aliases.size
    applied.push(`aliases ${String(aliases.size)}件`)
  }
  if (writeMemos) {
    imported.notes = memos.size
    applied.push(`notes ${String(memos.size)}件`)
  }
  // 触ったストアが1つも無ければ失敗。**「1件も入らなかった」を成功として返さない**
  // (UI は ok をそのまま「取り込んだ」の表示に使う)
  return { ok: applied.length > 0, errors, applied, imported }
}

/**
 * 1件を wire 型からドメイン型に戻す。**サムネイルの復号だけが失敗し得る。**
 *
 * 失敗しても記録そのものは取り込む(写真1枚のために記録を落とさない)。ただし
 * `thumbnail: null` にしたことを `errors` に積む — 黙って写真だけ消すと
 * 「復元できた」と思ったまま失っていることになる。
 */
async function toRecordWithThumbnail(row: ExportedRecord, errors: string[]): Promise<SakeRecord> {
  if (row.thumbnail === null) return toDomainRecord(row, null)
  try {
    return toDomainRecord(row, await decodeDataUrl(row.thumbnail))
  } catch (cause) {
    errors.push(
      `記録 ${row.id} のサムネイルを復元できなかった(記録は写真なしで取り込んだ) — ${describeCause(cause)}`,
    )
    return toDomainRecord(row, null)
  }
}

/** `null` を渡したストアには触らない。`replace` は書く前にそのストアだけを空にする */
async function write(
  mode: ImportMode,
  records: readonly SakeRecord[] | null,
  aliases: readonly TimestampedAlias[] | null,
  memos: readonly TimestampedNote[] | null,
): Promise<void> {
  const stores: StoreName[] = []
  if (records) stores.push('records')
  if (aliases) stores.push('aliases')
  if (memos) stores.push('notes')
  // meta は消さない(最終エクスポート日時などは端末側の事実であってバックアップの中身ではない)
  if (stores.length === 0) return

  await tx(stores, 'readwrite', (transaction) => {
    // 要求は同期に並べる。await を挟むとトランザクションが先にコミットしてしまう
    const pending: Promise<unknown>[] = []
    if (records) {
      const store = transaction.objectStore('records')
      if (mode === 'replace') pending.push(req(store.clear(), 'records の全消去'))
      for (const record of records) {
        pending.push(req(store.put(record), `records の保存(${record.id})`))
      }
    }
    if (aliases) {
      const store = transaction.objectStore('aliases')
      if (mode === 'replace') pending.push(req(store.clear(), 'aliases の全消去'))
      for (const alias of aliases) {
        pending.push(req(store.put(alias, aliasKeyOf(alias)), 'aliases の保存'))
      }
    }
    if (memos) {
      const store = transaction.objectStore('notes')
      if (mode === 'replace') pending.push(req(store.clear(), 'notes の全消去'))
      // in-line キー(`keyPath: 'key'`)なのでキーを渡さない
      for (const memo of memos) {
        pending.push(req(store.put({ ...memo, key: noteKeyOf(memo) }), 'notes の保存'))
      }
    }
    return Promise.all(pending)
  })
}

// ---------------------------------------------------------------------------

/** 例外・DOMException を人が読める1行にする(理由を落とさない) */
function describeCause(cause: unknown): string {
  if (cause === null || cause === undefined) return '原因不明'
  if (typeof cause === 'object' && 'name' in cause && 'message' in cause) {
    return `${String((cause as { name: unknown }).name)}: ${String((cause as { message: unknown }).message)}`
  }
  return String(cause)
}
