// IndexedDB の薄いラッパ。
//
// `idb` パッケージを入れない(SPEC「依存を増やさない」)ので、生の IDBRequest / IDBTransaction を
// Promise に包むのはこのファイルだけにする。store/records.ts / store/backup.ts / store/linking.ts は
// ここを通してだけ DB に触る。
//
// 依存方向は domain ← store ← ui。ここは store 層なので domain を import してよい(逆は不可)。
//
// ## スキーマ(ここと DB_VERSION の2箇所だけを触れば増やせる)
//
// | ストア    | キー                              | 索引              | 用途 |
// |----------|----------------------------------|------------------|------|
// | records  | in-line `id` (uuid v4)           | `drankOn`(非一意) | SakeRecord 本体。`thumbnail` は Blob のまま入れる |
// | aliases  | out-of-line `aliasKey(label, prefecture)` | なし     | 手動紐付けの永続化(BrandAlias) |
// | meta     | out-of-line 文字列キー             | なし             | `lastExportedAt` 等の key-value(Phase 7) |
// | deletions| in-line `id`                     | なし             | **削除の記録**(トゥームストーン。PHASE 8) |
//
// **`deletions` が要る理由**: 削除はハード削除なので、消した事実がどこにも残らない。同期を足すと
// 「Aで消す → Bと同期 → Bにはまだ在る → **Aに復活する**」が必ず起きる。オフラインで消した分を
// 次の push まで覚えておく置き場がここ(`src/domain/syncMerge.ts` の `localDeletions`)。
// **送信が成功したら消してよい**(消したことを永久に覚えている必要は無い)。
//
// **aliases を out-of-line キーにしたのは `BrandAlias.prefecture` が `null` を取るため。**
// IndexedDB のキーに `null` は使えないので `keyPath: ['label', 'prefecture']` は作れない
// (県ワイルドカードの行が静かに保存されない/索引から落ちる)。キーの作り方は aliasKey() に閉じる。
//
// **`drankOn` は一意ではない**(同日に最大6〜7件)。索引は「時系列でまとめて引く」ためのもので、
// 表示順(新しい順 / 同日は createdAt 降順)の確定は records.ts 側でやる。索引の昇順に頼らない。

import { normalize } from '../domain/normalize.ts'
import type { BrandAlias, SakeRecord } from '../domain/types.ts'

/** DB 名。**ブランド名を入れない**(改名を表示文字列だけに閉じる。scripts/check-naming.mjs が強制) */
export const DB_NAME = 'sake-record'

/** スキーマ版。SCHEMA を変えたらここを上げる(onupgradeneeded は不足分だけを作る) */
export const DB_VERSION = 2

/** ストア名 → そのストアに入る値の型。`put('records', wireRecord)` を型エラーにするための対応表 */
export type StoreValueMap = {
  records: SakeRecord
  aliases: BrandAlias
  /** key-value。値の型は使う側(Phase 7 の督促)が決める */
  meta: unknown
  deletions: RecordDeletion
}

/**
 * 消した記録の墓標。**同期先に「消した」と伝えるためだけ**に持つ。
 *
 * `deletedAt` が勝ち負けを決める(別端末の編集より新しければ削除が勝つ)ので、
 * **消した時刻をここで確定させる**(送信時刻ではない — オフラインで消してから
 * 何日も後に送ることがある)。
 */
export type RecordDeletion = {
  /** 消した記録の id */
  id: string
  /** ISO8601 */
  deletedAt: string
}

export type StoreName = keyof StoreValueMap

/** records の索引名。索引を増やしたら SCHEMA とここを一緒に更新する */
export type RecordIndexName = 'drankOn'

type StoreSchema = {
  name: StoreName
  /** `null` は out-of-line キー(put の第3引数でキーを渡す) */
  keyPath: string | null
  indexes: readonly { name: string; keyPath: string; unique: boolean }[]
}

const SCHEMA: readonly StoreSchema[] = [
  {
    name: 'records',
    keyPath: 'id',
    indexes: [{ name: 'drankOn', keyPath: 'drankOn', unique: false }],
  },
  { name: 'aliases', keyPath: null, indexes: [] },
  { name: 'meta', keyPath: null, indexes: [] },
  { name: 'deletions', keyPath: 'id', indexes: [] },
]

/** 全ストア名。clearAll の既定値・テストの後片付けに使う */
export const STORE_NAMES: readonly StoreName[] = SCHEMA.map((store) => store.name)

// ---------------------------------------------------------------------------
// エラー
// ---------------------------------------------------------------------------

/**
 * 理由の分かる Error を組む。**無音で null/undefined を返さない**
 * (IndexedDB の失敗は DOMException で名前に情報があるのでメッセージに畳み込む)。
 */
function dbError(what: string, cause?: unknown): Error {
  const reason = describeCause(cause)
  return new Error(`${DB_NAME}: ${what}${reason ? ` — ${reason}` : ''}`, { cause })
}

function describeCause(cause: unknown): string {
  if (cause === null || cause === undefined) return ''
  if (typeof cause === 'object' && 'name' in cause && 'message' in cause) {
    return `${String((cause as { name: unknown }).name)}: ${String((cause as { message: unknown }).message)}`
  }
  return String(cause)
}

// ---------------------------------------------------------------------------
// 接続
// ---------------------------------------------------------------------------

let connection: Promise<IDBDatabase> | null = null

function factory(): IDBFactory {
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB
  if (!idb) {
    throw dbError(
      'この実行環境に IndexedDB が無い' +
        '(テストは fake-indexeddb を globalThis に差してから呼ぶ。db.test.ts の installFakeIndexedDb 参照)',
    )
  }
  return idb
}

/**
 * DB を開く。同じ接続を返す(2回目以降はキャッシュ)。失敗したらキャッシュを捨てて再試行できる。
 * スキーマ作成は onupgradeneeded の1箇所(upgrade())に集約する。
 */
export function openDb(): Promise<IDBDatabase> {
  if (connection) return connection
  const opening = openConnection().catch((error: unknown) => {
    // 失敗した promise を掴んだままにすると以後ずっと同じ失敗を返す
    if (connection === opening) connection = null
    throw error
  })
  connection = opening
  return opening
}

function openConnection(): Promise<IDBDatabase> {
  let request: IDBOpenDBRequest
  try {
    request = factory().open(DB_NAME, DB_VERSION)
  } catch (cause) {
    return Promise.reject(cause instanceof Error ? cause : dbError('DB を開けない', cause))
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    request.onupgradeneeded = () => {
      try {
        upgrade(request.result, request.transaction)
      } catch (cause) {
        reject(dbError(`スキーマ(v${DB_VERSION})を作成できない`, cause))
      }
    }
    request.onsuccess = () => {
      const db = request.result
      // 別タブが新しい版へ上げようとしたら道を譲る(閉じないと相手が onblocked で止まる)
      db.onversionchange = () => {
        db.close()
        connection = null
      }
      db.onclose = () => {
        connection = null
      }
      resolve(db)
    }
    request.onerror = () => reject(dbError('DB を開けない', request.error))
    request.onblocked = () =>
      reject(dbError('DB を開けない(古い版を掴んだ別のタブが開いている。全て閉じて再読込する)'))
  })
}

function upgrade(db: IDBDatabase, transaction: IDBTransaction | null): void {
  for (const schema of SCHEMA) {
    const exists = db.objectStoreNames.contains(schema.name)
    const store = exists
      ? // 既存ストアへ索引を足す場合。version change transaction 経由でしか触れない
        (transaction?.objectStore(schema.name) ?? null)
      : db.createObjectStore(
          schema.name,
          schema.keyPath === null ? undefined : { keyPath: schema.keyPath },
        )
    if (!store) continue
    for (const index of schema.indexes) {
      if (store.indexNames.contains(index.name)) continue
      store.createIndex(index.name, index.keyPath, { unique: index.unique })
    }
  }
}

/** 接続を閉じてキャッシュを捨てる(テストの後片付け / deleteDatabase の前) */
export function closeDb(): void {
  const pending = connection
  connection = null
  if (!pending) return
  void pending.then(
    (db) => db.close(),
    () => {
      /* 開けていないなら閉じるものもない */
    },
  )
}

/** DB ごと削除する。ブラウザの「サイトデータを削除」相当(A11 の検証とテストの隔離に使う) */
export async function deleteDatabase(): Promise<void> {
  const idb = factory()
  closeDb()
  // closeDb() の close() は上のマイクロタスクで走るので、削除要求より前に確実に流す
  await Promise.resolve()
  await new Promise<void>((resolve, reject) => {
    const request = idb.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(dbError('DB を削除できない', request.error))
    request.onblocked = () =>
      reject(dbError('DB を削除できない(接続が残っている。closeDb() を呼んだか確認する)'))
  })
}

// ---------------------------------------------------------------------------
// 要求 / トランザクション
// ---------------------------------------------------------------------------

/** IDBRequest を Promise にする。`what` は失敗時のメッセージに入るので何をしていたかを書く */
export function req<T>(request: IDBRequest<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(dbError(`${what}に失敗した`, request.error))
  })
}

/**
 * トランザクションを1つ張って `run` を回す。complete まで待ってから解決する。
 *
 * **`run` は同期に呼ばれる。`run` の中で IDB 以外の await を挟まないこと** —
 * IndexedDB のトランザクションは要求が途切れた時点で自動コミットされるので、
 * 途中で他の Promise を待つと後続の要求が TransactionInactiveError になる。
 * 複数要求は `req()` を並べて `Promise.all` で待つ(要求の発行自体は同期に済むので安全)。
 */
export async function tx<T>(
  stores: StoreName | readonly StoreName[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => T | Promise<T>,
): Promise<T> {
  const db = await openDb()
  const names = typeof stores === 'string' ? [stores] : [...stores]
  const where = `${names.join(', ')} / ${mode}`

  let transaction: IDBTransaction
  try {
    transaction = db.transaction(names, mode)
  } catch (cause) {
    throw dbError(`トランザクションを開けない (${where})`, cause)
  }

  const finished = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(dbError(`トランザクションが中断された (${where})`, transaction.error))
    // onerror は abort に続くので、拒否は onabort の1箇所に寄せる
  })

  let result: T
  try {
    result = await run(transaction)
  } catch (cause) {
    try {
      transaction.abort()
    } catch {
      /* 既に complete/abort 済み */
    }
    // abort 由来の拒否を未処理のまま残さない
    void finished.catch(() => {})
    throw cause instanceof Error ? cause : dbError(`トランザクションが失敗した (${where})`, cause)
  }
  await finished
  return result
}

async function one<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  what: string,
  run: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return tx(store, mode, (transaction) => req(run(transaction.objectStore(store)), what))
}

// ---------------------------------------------------------------------------
// 単体操作
// ---------------------------------------------------------------------------

/** records は in-line キー(`id`)。aliases / meta は out-of-line なのでキーが必須 */
export function put(store: 'records', value: SakeRecord): Promise<IDBValidKey>
export function put(store: 'aliases', value: BrandAlias, key: string): Promise<IDBValidKey>
export function put(store: 'meta', value: unknown, key: string): Promise<IDBValidKey>
export function put(store: StoreName, value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
  return one(store, 'readwrite', `${store} の保存`, (objectStore) =>
    key === undefined ? objectStore.put(value) : objectStore.put(value, key),
  )
}

/**
 * 1トランザクションでまとめて保存する(203件のインポートを203トランザクションに割らない)。
 * aliases のキーは aliasKey() から導くので、呼び側がキーを組み立てる必要はない。
 */
export function putAll(store: 'records', values: readonly SakeRecord[]): Promise<number>
export function putAll(store: 'aliases', values: readonly BrandAlias[]): Promise<number>
export async function putAll(
  store: 'records' | 'aliases',
  values: readonly (SakeRecord | BrandAlias)[],
): Promise<number> {
  if (values.length === 0) return 0
  return tx(store, 'readwrite', (transaction) => {
    const objectStore = transaction.objectStore(store)
    const pending = values.map((value, i) => {
      const request =
        store === 'aliases'
          ? objectStore.put(
              value,
              aliasKey((value as BrandAlias).label, (value as BrandAlias).prefecture),
            )
          : objectStore.put(value)
      return req(request, `${store} の一括保存(${i + 1}/${values.length}件目)`)
    })
    return Promise.all(pending).then(() => values.length)
  })
}

/** 見つからなければ `undefined`。**定義域外のキーで全件に落ちてはならない** */
export function get<S extends StoreName>(
  store: S,
  key: IDBValidKey,
): Promise<StoreValueMap[S] | undefined> {
  return one(store, 'readonly', `${store} の取得`, (objectStore) => objectStore.get(key)) as Promise<
    StoreValueMap[S] | undefined
  >
}

export function getAll<S extends StoreName>(store: S): Promise<StoreValueMap[S][]> {
  return one(store, 'readonly', `${store} の全件取得`, (objectStore) =>
    objectStore.getAll(),
  ) as Promise<StoreValueMap[S][]>
}

/**
 * 索引で引く。**`query` は必須で、全件が要るときは `null` を明示する。**
 *
 * 省略可能にすると「ルックアップのキーが定義域外だったので undefined を渡してしまい、
 * 絞り込みのつもりが静かに全件になる」という事故が型でも実行時でも止まらない。
 * 一致が無いときは空配列を返す(全件にフォールバックしない)。
 */
export function getAllByIndex(
  store: 'records',
  index: RecordIndexName,
  query: IDBValidKey | IDBKeyRange | null,
): Promise<SakeRecord[]> {
  if (query === undefined) {
    // 型では止まる(引数が必須)。JS 側 / 型を緩めた呼び出しのための実行時の歯止め。
    throw dbError(
      `索引 ${store}.${index} の絞り込みキーが undefined(全件が要るなら null を明示する。` +
        '定義域外のキーで全件に落ちるのを防ぐため)',
    )
  }
  return one(store, 'readonly', `${store}.${index} の索引取得`, (objectStore) =>
    objectStore.index(index).getAll(query ?? undefined),
  ) as Promise<SakeRecord[]>
}

export async function del(store: StoreName, key: IDBValidKey): Promise<void> {
  await one(store, 'readwrite', `${store} の削除`, (objectStore) => objectStore.delete(key))
}

export async function clear(store: StoreName): Promise<void> {
  await one(store, 'readwrite', `${store} の全消去`, (objectStore) => objectStore.clear())
}

/**
 * 複数ストアを1トランザクションで消す(途中で失敗したら全部戻る)。
 * 既定は全ストア。インポートの「全置換」では `meta` を残したいので明示的に選べるようにしてある。
 */
export async function clearAll(stores: readonly StoreName[] = STORE_NAMES): Promise<void> {
  if (stores.length === 0) return
  await tx(stores, 'readwrite', (transaction) =>
    Promise.all(
      stores.map((store) =>
        req(transaction.objectStore(store).clear(), `${store} の全消去`),
      ),
    ),
  )
}

// ---------------------------------------------------------------------------
// aliases のキー
// ---------------------------------------------------------------------------

/** 合成キーの区切り。銘柄名にも県名にも現れ得ない制御文字を使う */
const ALIAS_KEY_SEPARATOR = '\u0000'

/**
 * aliases ストアのキー。`(normalize(label), prefecture)` の組を1本の文字列にする。
 *
 * - `label` は normalize() を通す(BrandAlias.label は正規化済みの値だが、
 *   UI から来た生の表記をそのまま渡しても同じキーに落ちるようにしておく。normalize は冪等)
 * - `prefecture` の `null` は「県を問わない」ワイルドカード。**`null` と `'県あり'` は別のキー**
 * - 空文字は `null` と同じ扱いにする(県名が空文字になることは無いので曖昧さは生じない)
 */
export function aliasKey(label: string, prefecture: string | null): string {
  return `${normalize(label)}${ALIAS_KEY_SEPARATOR}${prefecture ?? ''}`
}
