// SakeRecord の CRUD と一覧取得。
//
// 依存方向は domain ← store ← ui。ここは store 層なので domain を import してよい(逆は不可)。
// 生の IndexedDB には触らず db.ts のラッパだけを通す(トランザクションの張り方はあちら1箇所)。
//
// ## この層が引き受けている2つの不変条件
//
// 1. **表示順を決定的にする。** `drankOn` は同日に最大6〜7件あり、表/裏ラベルの2組は日付も
//    銘柄も完全に同じで内容では区別できない。日付だけで並べると 2 本が engine 依存で入れ替わる
//    (B4)。順序は `byNewestFirst` の1本に集約し、`drankOn` → `createdAt` → `sourceNo` → `id`
//    まで見て**全順序**にする(同値で 0 を返す比較関数にしないと Array.sort の結果が安定しない)。
// 2. **203件を「静かに202件」にしない。** 取り込みは形の検証を先に済ませ、1行でも壊れていれば
//    1件も保存しない(部分保存で欠けた1件は画面を見ても気付けない)。dedupe は一切しない。
//
// **紐付けはここで実装しない。** `linker`(src/domain/linkBrand.ts の createLinker の戻り)を
// 引数で受け取って結果を写すだけにする。ここに独自の照合を書くと二重実装になり、
// 片方だけ直したときに実測値(auto 173 / alias 13)が静かにずれる。

import type { SakeLogRow } from '../domain/parseSakeLog.ts'
import type { Linker, SakeRecord } from '../domain/types.ts'
import { clear, get, getAll, put, putAll, req, tx, type RecordDeletion } from './db.ts'
import { ensureThumbnailsMigrated } from './migrateThumbnails.ts'

/**
 * 新規作成の入力。`id` / `createdAt` / `updatedAt` はこの層が振るので受け取らない
 * (呼び側が渡せると、UI から来た値で id が衝突したり createdAt が巻き戻ったりする)。
 */
export type NewRecord = Omit<SakeRecord, 'id' | 'createdAt' | 'updatedAt'>

/**
 * 部分更新。**`undefined` は「指定なし」、`null` は「明示的に消す」**。
 * `id` / `createdAt` は変えられない(`updatedAt` は updateRecord が自分で進める)。
 */
export type RecordPatch = Partial<NewRecord>

/** 並べ替えに必要な項目だけ。UI が絞り込んだ後の配列にもそのまま使えるようにしてある */
export type RecordOrderKeys = Pick<SakeRecord, 'id' | 'drankOn' | 'createdAt' | 'sourceNo'>

// ---------------------------------------------------------------------------
// id / 時刻
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * uuid v4。**`crypto.randomUUID` は secure context でしか存在しない**
 * (LAN の `http://192.168.x.x:5173` で実機確認するときが該当。ここで例外を投げると
 * 「実機だと1件も保存できない」になる)ので `getRandomValues` から自分で組む道を持つ。
 * Math.random には落とさない(id の衝突は行が静かに消える事故に直結する)。
 */
function newId(): string {
  const webCrypto: Crypto | undefined = globalThis.crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()
  if (typeof webCrypto?.getRandomValues !== 'function') {
    throw new Error('この実行環境に crypto.getRandomValues が無いので記録の id を作れない')
  }
  const bytes = webCrypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10xx
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * 入力から保存する形を組む。**spread で済ませず全項目を書き並べる**のは:
 * (a) `SakeRecord` に項目が増えたらここがコンパイルエラーになって取り込み漏れに気付ける
 * (b) 呼び側が余計なキー(古い版の JSON など)を混ぜても DB に流れ込まない
 */
function toRecord(input: NewRecord, id: string, createdAt: string, updatedAt: string): SakeRecord {
  return {
    id,
    drankOn: input.drankOn,
    brandLabel: input.brandLabel,
    sakenowaBrandId: input.sakenowaBrandId,
    brandName: input.brandName,
    linkStatus: input.linkStatus,
    prefecture: input.prefecture,
    spec: input.spec,
    rating: input.rating,
    place: input.place,
    note: input.note,
    thumbnail: input.thumbnail,
    sourceNo: input.sourceNo,
    createdAt,
    updatedAt,
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** 1件作る。`id` と `createdAt` / `updatedAt` はここで振る(作成直後は両者が同値) */
export async function createRecord(input: NewRecord): Promise<SakeRecord> {
  const at = nowIso()
  const record = toRecord(input, newId(), at, at)
  await put('records', record)
  return record
}

/** 無ければ `undefined`。**未知の id で全件に落ちない**(db.get がキー1件だけを引く) */
export function getRecord(id: string): Promise<SakeRecord | undefined> {
  return get('records', id)
}

/**
 * 表示順に並べた全件。空なら `[]`
 *
 * **読む前に保存形の移行を済ませる(B72)。** 先に読むと、画面が古い形(Blob)の写真を掴んだまま
 * 編集して保存に回し、せっかく移した行が書き戻る。
 */
export async function listRecords(): Promise<SakeRecord[]> {
  await ensureThumbnailsMigrated()
  // **`drankOn` 索引経由で引かない。** 索引は `drankOn` を持たない行を静かに落とすので、
  // 壊れた1件が「保存できているのに一覧に出ない」形で消える(まさに避けたい事故)。
  // 全件を取って JS で全順序に並べる(203件では計測上の差が無い。B4)。
  // 期間で絞る必要が出たら db.getAllByIndex('records','drankOn', IDBKeyRange...) を使う。
  const records = await getAll('records')
  return records.sort(byNewestFirst)
}

/**
 * 表示順の比較関数(新しい順)。**全順序**: `drankOn` 降順 → `createdAt` 降順 →
 * `sourceNo` 降順(= 元ログの No. 逆順) → `id` 昇順。
 *
 * 第2キー以降が無いと、同日6〜7件や内容が同一の表/裏ラベル2組の並びが engine 依存になる。
 * 最後の `id` は「表示を安定させるための最終手段」で意味は無いが、これが無いと
 * 全項目が同値の2件で Array.sort の結果が入力順に依存してしまう。
 * `sourceNo` は 1 以上なので、アプリで作った記録(`null`)は同日同時刻なら後ろに来る。
 */
export function byNewestFirst(a: RecordOrderKeys, b: RecordOrderKeys): number {
  if (a.drankOn !== b.drankOn) return a.drankOn < b.drankOn ? 1 : -1
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
  const aNo = a.sourceNo ?? 0
  const bNo = b.sourceNo ?? 0
  if (aNo !== bNo) return bNo - aNo
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  return 0
}

/**
 * 指定した項目だけを差し替える。**存在しない id は理由を言って失敗する**
 * (put だけで済ませると存在しない id が黙って新規作成になり、`createdAt` も `sourceNo` も
 * 欠けた行が増える)。存在確認と書き込みは1トランザクションに入れる。
 */
export function updateRecord(id: string, patch: RecordPatch): Promise<SakeRecord> {
  return tx('records', 'readwrite', async (transaction) => {
    const store = transaction.objectStore('records')
    // await するのは IDB の要求だけ(他の Promise を待つとトランザクションが先にコミットする)
    const current = await req<SakeRecord | undefined>(
      store.get(id) as IDBRequest<SakeRecord | undefined>,
      'records の取得',
    )
    if (!current) throw new Error(`更新する記録が見つからない: id=${id}`)
    // **`{...current, ...patch}` にしない。** patch の `undefined` は「触っていない項目」の意味だが、
    // spread では既存の値を上書きして消してしまう(`prefecture: undefined` で県が消える)。
    // 項目ごとに patched(patch) を通し、`null`(明示的な消去)だけを反映する。
    // ここも全項目を書き並べる: `SakeRecord` に項目が増えたらコンパイルエラーになる。
    const next: SakeRecord = {
      // id / createdAt は patch では変えられない(型で禁じているが実行時にも固定する)
      id: current.id,
      drankOn: patched(patch.drankOn, current.drankOn),
      brandLabel: patched(patch.brandLabel, current.brandLabel),
      sakenowaBrandId: patched(patch.sakenowaBrandId, current.sakenowaBrandId),
      brandName: patched(patch.brandName, current.brandName),
      linkStatus: patched(patch.linkStatus, current.linkStatus),
      prefecture: patched(patch.prefecture, current.prefecture),
      spec: patched(patch.spec, current.spec),
      rating: patched(patch.rating, current.rating),
      place: patched(patch.place, current.place),
      note: patched(patch.note, current.note),
      thumbnail: patched(patch.thumbnail, current.thumbnail),
      sourceNo: patched(patch.sourceNo, current.sourceNo),
      createdAt: current.createdAt,
      updatedAt: nowIso(),
    }
    await req(store.put(next), 'records の保存')
    return next
  })
}

/** `undefined` は「指定なし」なので現在値を残す。`null` は値として採用する(明示的な消去) */
function patched<T>(value: T | undefined, current: T): T {
  return value === undefined ? current : value
}

/**
 * 1件消す。**存在しない id は理由を言って失敗する** —
 * IndexedDB の `delete` は空振りでも成功するので、自分で存在を見ないと
 * 「消したのに消えていない / 別の id を消したつもり」が無音で通る。
 */
/**
 * 記録を消す。**削除の記録を同じトランザクションで書く**(PHASE 8)。
 *
 * 別々に書くと「records からは消えたが `deletions` に残らなかった」状態が作れてしまい、
 * その記録は**次の同期でサーバから復活する**(しかも画面上は正常に見える)。
 * 消したことを送るまでが削除なので、原子性はここで担保する。
 *
 * 削除の記録は**送信が成功したら捨ててよい**(`clearDeletions`)。同期を設定していない端末では
 * 溜まり続けるが、1件あたり数十バイトなので実害は無い。
 */
export async function deleteRecord(id: string, deletedAt = new Date().toISOString()): Promise<void> {
  await tx(['records', 'deletions'], 'readwrite', async (transaction) => {
    const store = transaction.objectStore('records')
    const found = await req(store.count(id), 'records の存在確認')
    if (found === 0) throw new Error(`削除する記録が見つからない: id=${id}`)
    await req(store.delete(id), 'records の削除')
    await req(transaction.objectStore('deletions').put({ id, deletedAt }), '削除の記録')
  })
}

/** 未送信の削除。`syncMerge` の `localDeletions` にそのまま渡せる形 */
export async function listDeletions(): Promise<RecordDeletion[]> {
  return tx('deletions', 'readonly', (transaction) =>
    req(transaction.objectStore('deletions').getAll(), 'deletions の全件取得'),
  )
}

/**
 * 送信し終えた削除の記録を捨てる。**送信が成功した id だけ**を渡すこと
 * (まとめて全消しすると、送れていない削除が黙って失われて記録が復活する)。
 */
export async function clearDeletions(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  await tx('deletions', 'readwrite', async (transaction) => {
    const store = transaction.objectStore('deletions')
    for (const id of ids) await req(store.delete(id), 'deletions の削除')
  })
}

// ---------------------------------------------------------------------------
// 同期からの反映(B69 / PHASE 8)
// ---------------------------------------------------------------------------

/**
 * サーバから降ってきた変更を当てる指示。**本人の操作とは別の経路にする。**
 *
 * `deleteRecord` / `updateRecord` を再利用してはいけない理由が2つある:
 *
 * 1. `deleteRecord` は**必ず削除の記録を書く**。自分が消したわけでもないのに書くと、その時刻は
 *    端末の「今」なのでサーバの削除時刻より新しくなり、次の同期で押し返す。
 * 2. どちらも**存在しない id で例外を投げる**(本人の操作では正しい)。同期中に本人が同じ記録を
 *    消していると、同期全体がそこで止まる。
 *
 * `expectedUpdatedAt` は**同期を始めた時点でローカルにあった値**(無ければ `null`)。
 * これと現在値が食い違っていたら、通信の途中で本人が保存したということなので当てない
 * (`planSync` はその編集を知らずに判断しているので、当てると保存したばかりの編集が消える)。
 */
export type RemoteRecordApply = {
  readonly upserts: readonly { record: SakeRecord; expectedUpdatedAt: string | null }[]
  readonly removals: readonly { id: string; expectedUpdatedAt: string | null }[]
}

export type RemoteApplyResult = {
  applied: string[]
  removed: string[]
  /** 同期の最中に本人が触ったので当てなかった id。**黙って捨てない**(次の同期で決まる) */
  skipped: string[]
}

/**
 * サーバ由来の変更を1トランザクションで当てる。
 *
 * **`run` の中でネットワークを待たない。** IndexedDB のトランザクションは要求が途切れた時点で
 * 自動コミットするので、途中で fetch を挟むと以降の書き込みが黙って落ちる(先頭のN件だけ入って、
 * 残りは入らないまま位置だけ進む = その記録は二度と降りてこない)。だからこの関数は
 * **値の配列しか受け取らない**(通信を渡せる形にしない)。
 */
export async function applyRemoteRecords(plan: RemoteRecordApply): Promise<RemoteApplyResult> {
  const result: RemoteApplyResult = { applied: [], removed: [], skipped: [] }
  if (plan.upserts.length === 0 && plan.removals.length === 0) return result

  await tx('records', 'readwrite', async (transaction) => {
    const store = transaction.objectStore('records')
    for (const { record, expectedUpdatedAt } of plan.upserts) {
      const current = await req<SakeRecord | undefined>(
        store.get(record.id) as IDBRequest<SakeRecord | undefined>,
        'records の取得',
      )
      if ((current?.updatedAt ?? null) !== expectedUpdatedAt) {
        result.skipped.push(record.id)
        continue
      }
      await req(store.put(record), 'records の保存')
      result.applied.push(record.id)
    }
    for (const { id, expectedUpdatedAt } of plan.removals) {
      const current = await req<SakeRecord | undefined>(
        store.get(id) as IDBRequest<SakeRecord | undefined>,
        'records の取得',
      )
      // 既に無いなら何もしない(空振りの削除は失敗ではない)
      if (current === undefined) continue
      if (current.updatedAt !== expectedUpdatedAt) {
        result.skipped.push(id)
        continue
      }
      // **削除の記録を書かない。** 消すと決めたのはこの端末ではない
      await req(store.delete(id), 'records の削除')
      result.removed.push(id)
    }
  })
  return result
}

/** records だけを空にする(`aliases` / `meta` は残す。全置換は呼び側がこれを呼んでから取り込む) */
export function clearRecords(): Promise<void> {
  return clear('records')
}

// ---------------------------------------------------------------------------
// インポート(sake-log-rows.json 相当の行配列 → SakeRecord)
// ---------------------------------------------------------------------------

/** 紐付いた銘柄の都道府県を引くのに必要な最小の面。`DecodedTables` がそのまま満たす */
export type BrandPrefectureLookup = {
  /** 都道府県に落ちないものは `null`(既定の県に落とさない) */
  prefectureOfBrand: (brandId: number) => string | null
}

export type ImportRowsCheck = { ok: true; rows: SakeLogRow[] } | { ok: false; reason: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 行の文字列項目。未記入は空文字で、キー自体が無いのは形が違う */
const STRING_KEYS = ['brandLabel', 'prefecture', 'spec', 'note'] as const

/**
 * ファイル境界の検証。**`unknown` を受ける**(取り込み欄に来るのは JSON.parse の結果で、
 * 型は何も保証していない)。1件でも形が違えば `ok: false` を返し、呼び側は1件も保存しない。
 *
 * ここで弾けるのは「形」だけ。件数(203)や No. の連番はデータ固有の期待値なので
 * `scripts/import-sake-log.mjs` と `parseSakeLog` 側の関心にする。
 */
export function checkImportRows(value: unknown): ImportRowsCheck {
  if (!Array.isArray(value)) {
    return {
      ok: false,
      reason: `取り込むデータが行の配列でない(${typeName(value)})。バックアップ JSON はインポート側で読む`,
    }
  }
  // Array.isArray は unknown を any[] に narrow するので、unknown[] に落として any を漏らさない
  const entries: unknown[] = value
  const rows: SakeLogRow[] = []
  for (const [index, entry] of entries.entries()) {
    const where = rowLabel(entry, index)
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, reason: `${where}: 行がオブジェクトでない(${typeName(entry)})` }
    }
    const row = entry as Record<string, unknown>
    if (!Number.isInteger(row.no)) {
      return { ok: false, reason: `${where}: No. が整数でない(${typeName(row.no)})` }
    }
    for (const key of STRING_KEYS) {
      if (typeof row[key] !== 'string') {
        return { ok: false, reason: `${where}: ${key} が文字列でない(${typeName(row[key])})` }
      }
    }
    if (typeof row.drankOn !== 'string' || !DATE_RE.test(row.drankOn)) {
      return { ok: false, reason: `${where}: 日付が YYYY-MM-DD でない(${typeName(row.drankOn)})` }
    }
    rows.push({
      no: row.no as number,
      drankOn: row.drankOn,
      brandLabel: row.brandLabel as string,
      prefecture: row.prefecture as string,
      spec: row.spec as string,
      note: row.note as string,
    })
  }
  return { ok: true, rows }
}

/** エラーメッセージの位置表示。No. が読めるならそれを使う(元ログと突き合わせられる) */
function rowLabel(entry: unknown, index: number): string {
  if (typeof entry === 'object' && entry !== null) {
    const no = (entry as Record<string, unknown>).no
    if (Number.isInteger(no)) return `No. ${String(no)}`
  }
  return `${index + 1}行目`
}

/** 値の中身は出さずに型だけ言う(取り込み失敗のメッセージに台帳の内容を混ぜない) */
function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return '配列'
  return typeof value
}

/** 未記入の県は空文字で来る。`''` は「県が無い」ではなく「手がかりが無い」なので null に畳む */
function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * 行配列を記録に変換して**1トランザクションで**保存する。既存の記録は消さない
 * (全置換は呼び側が `clearRecords()` してから呼ぶ)。返すのは No. 昇順の保存済み記録。
 *
 * ここで決めていること:
 * - 紐付けは `linker` に委譲し、`brandId` / `brandName` / `linkStatus` をそのまま写す
 *   (`unlinked` / `unknown` に推定値を埋めない)
 * - 都道府県は**紐付いたらさけのわ由来、紐付かなければログ由来**。さけのわ側が県に落ちない
 *   (海外蔵など)ときはログの県を残す — 既定の県には落とさない
 * - `createdAt` を **No. 昇順に 1ms 刻みで厳密増加**させる。同日6〜7件の並びを決めるのは
 *   これだけで、同値だと表/裏ラベルの2組が入れ替わる(B4)。最後の行が「今」になるように
 *   過去へ遡って振る(未来の時刻を作らない)
 * - `thumbnail: null` / `rating: null` / `place: ''`(203本は写真も評価も場所も無い)
 * - **dedupe しない**。同日同銘柄の2行は2件として保存する
 */
export async function importRows(
  rows: readonly SakeLogRow[],
  linker: Linker,
  tables: BrandPrefectureLookup,
): Promise<SakeRecord[]> {
  const check = checkImportRows(rows)
  if (!check.ok) {
    // 1件も保存しない。203件のうち1件だけ欠けた状態は画面を見ても気付けない
    throw new Error(`取り込めない行がある: ${check.reason}`)
  }
  // 入力配列は書き換えない(呼び側の配列の順序を副作用で変えない)
  const ordered = [...check.rows].sort((a, b) => a.no - b.no)
  if (ordered.length === 0) return []

  const lastAt = Date.now()
  const records = ordered.map((row, index) => {
    const logPrefecture = blankToNull(row.prefecture)
    const link = linker(row.brandLabel, logPrefecture)
    const prefecture =
      link.brandId === null
        ? logPrefecture
        : (tables.prefectureOfBrand(link.brandId) ?? logPrefecture)
    const at = new Date(lastAt - (ordered.length - 1 - index)).toISOString()
    return toRecord(
      {
        drankOn: row.drankOn,
        // 生の表記を原本として残す(正規化した値で上書きしない。`寫楽` はそのまま)
        brandLabel: row.brandLabel,
        sakenowaBrandId: link.brandId,
        brandName: link.brandName,
        linkStatus: link.status,
        prefecture,
        spec: row.spec,
        rating: null,
        place: '',
        note: row.note,
        thumbnail: null,
        sourceNo: row.no,
      },
      newId(),
      at,
      at,
    )
  })

  await putAll('records', records)
  return records
}
