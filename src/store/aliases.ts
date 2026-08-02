// 手動紐付け(runtime)エイリアスの永続化と、組み込み表とのマージ。
//
// 依存方向は domain ← store ← ui。ここは store 層なので domain / data を import してよい(逆は不可)。
// 生の IndexedDB には触らず db.ts のラッパだけを通す。
//
// ## エイリアスの2つの出所
//
// | 出所    | 置き場所                        | 誰が決めたか |
// |---------|--------------------------------|--------------|
// | builtin | `src/data/brand-aliases.ts`(8件) | 開発者が203本の実データを見て書いた |
// | runtime | IDB `aliases` ストア             | 本人が手動紐付けUI(Phase 5)で決めた |
//
// **優先順位は runtime > builtin**(本人の判断を開発者の推測で上書きしない)。ただし
// **具体性は由来より強い**: `(label, 県あり)` は `(label, null)` より先に見られるので、
// 組み込みの県付きエイリアスは runtime のワイルドカードに勝つ。県付きを覆したいなら
// 同じ県のエイリアスを書く(= 同じキーなので runtime が勝つ)。
// 記録の都道府県が null のときはワイルドカードで書く(PHASE_5 の完了条件)。
//
// **解決そのもの(具体性の比較・銘柄の引き当て)は `createLinker` の責務。**
// ここは「同じキーの重複を1つに畳む」だけで、照合ロジックを再実装しない。
//
// Phase 3 で作るのは永続化とマージの土台だけ(手動紐付けUI は Phase 5)。

import { normalize } from '../domain/normalize.ts'
import type { BrandAlias } from '../domain/types.ts'
import { aliasKey, clear, get, getAll, req, tx } from './db.ts'
import type { AliasDeletion, StoredAlias } from './db.ts'

/** キーの作り方は db.ts の1箇所に閉じる。UI が db.ts を直接 import しないよう再輸出する */
export { aliasKey } from './db.ts'

/** `aliases` ストアのキー。`deleteAlias` / `getAlias` に渡す値はこれで作る */
export function aliasKeyOf(alias: BrandAlias): string {
  return aliasKey(alias.label, alias.prefecture)
}

/**
 * 保存・比較の前に形を揃える。**2つとも黙って壊れる経路を塞ぐための正規化**:
 *
 * - `label` を `normalize()` に通す。`createLinker` は `normalize(記録の表記)` と
 *   `alias.label` を**そのまま**突き合わせるので、生表記(`髙砂` / `ZEBRA`)のまま保存された
 *   エイリアスは例外も出さずに一度も発火しない。組み込み8件は既に正規化済みなので無変化
 *   (normalize は冪等)。インポートした JSON など外から来た行のための保険でもある。
 * - `prefecture` の空文字を `null` に畳む。`''` は `aliasKey()` ではワイルドカードと同じキーに
 *   落ちるのに、`createLinker` の県一致では「null でもないし県名でもない」ので
 *   **ワイルドカードとしても県指定としても拾われない死んだ行**になる。
 */
export function canonicalAlias(alias: BrandAlias): BrandAlias {
  const trimmed = alias.prefecture === null ? null : alias.prefecture.trim()
  return {
    label: normalize(alias.label),
    prefecture: trimmed === '' ? null : trimmed,
    brandId: alias.brandId,
  }
}

/**
 * 組み込み表と runtime を1本のエイリアス配列に畳む。**純関数**(IndexedDB に触らない)。
 *
 * 同じキー `(normalize(label), prefecture)` は **runtime が勝つ**。異なるキー
 * (同じ label でも県が違う / 県ありと県なし)は両方残り、どちらを使うかは `createLinker` が
 * 具体性で決める。
 *
 * 出力順は「builtin の並び → runtime の新規キー」。`Map.set` は既存キーの挿入位置を保つので、
 * runtime が上書きしても builtin の位置は動かない。**そのため runtime が空なら結果は
 * builtin と完全に同じ配列**(組み込み8件が壊れていないことをテストで固定できる)。
 * キーが一意なので、この順序は `createLinker` の解決結果には影響しない。
 */
export function mergeAliases(
  builtin: readonly BrandAlias[],
  runtime: readonly BrandAlias[],
): BrandAlias[] {
  const byKey = new Map<string, BrandAlias>()
  for (const alias of [...builtin, ...runtime]) {
    const canonical = canonicalAlias(alias)
    byKey.set(aliasKeyOf(canonical), canonical)
  }
  return [...byKey.values()]
}

// ---------------------------------------------------------------------------
// 永続化(runtime のみ。組み込み8件は IDB に入れない)
// ---------------------------------------------------------------------------
//
// 組み込み8件をストアへ複製しない理由: 複製すると (a) 表を直したときに古い複製が残って
// どちらが効いているか分からなくなり、(b) エクスポートした JSON に開発者の推測が混ざって
// 「本人が決めた紐付け」と区別できなくなる。ストアには本人の判断だけを置く。

/**
 * 保存済みの runtime エイリアス。IDB のキー順で返る。空なら `[]`(全件に落ちない)。
 *
 * **更新時刻ごと返す。** `mergeAliases` は正規化のときに3項目だけを書き並べるので時刻を落とすが、
 * あちらは照合に渡す値で時刻を使わない。同期(`store/sync.ts`)はこの関数から直に取る。
 */
export function listAliases(): Promise<StoredAlias[]> {
  return getAll('aliases')
}

/** 1件だけ引く。無ければ `undefined`。`key` は `aliasKeyOf()` / `aliasKey()` で作る */
export function getAlias(key: string): Promise<StoredAlias | undefined> {
  return get('aliases', key)
}

/**
 * 1件保存する(同じキーは上書き)。**正規化した形を返す** — 呼び側が実際に保存された
 * label / prefecture を UI に出したり `aliasKeyOf()` でキーを作れるようにする。
 *
 * 発火し得ない入力は**理由を言って断る**(黙って保存すると「紐付けたのに効かない」になる):
 * - 正規化後の label が空 … `createLinker` は空キーを照合前に `unknown` で返すので永久に不発
 * - `brandId` が正の整数でない … さけのわの銘柄IDは 1 以上。引き当てに失敗して無視される
 */
export async function putAlias(
  alias: BrandAlias,
  updatedAt: string = new Date().toISOString(),
): Promise<StoredAlias> {
  const canonical = canonicalAlias(alias)
  if (canonical.label === '') {
    throw new Error(`エイリアスの銘柄表記が空(正規化後): ${JSON.stringify(alias.label)}`)
  }
  if (!Number.isInteger(canonical.brandId) || canonical.brandId <= 0) {
    throw new Error(`エイリアスの銘柄IDが不正: ${String(alias.brandId)}(正の整数が必要)`)
  }
  const stored: StoredAlias = { ...canonical, updatedAt }
  const key = aliasKeyOf(stored)
  return tx(['aliases', 'aliasDeletions'], 'readwrite', async (transaction) => {
    await req(transaction.objectStore('aliases').put(stored, key), 'aliases の保存')
    // **同じ鍵の削除の記録を取り消す。** 紐付けの鍵は決定的(`aliasKey`)なので、外してから
    // 同じ表記に付け直すと生きている行と削除の記録が同じ鍵で同居する。`planSync` は同居したら
    // 時刻を見ずに「消した」を採るので、**付け直した紐付けが送られず、相手の端末では外れる**
    // (記録は id が uuid なので作り直すと別の鍵になり、この同居が起きない)
    await req(
      transaction.objectStore('aliasDeletions').delete(key),
      '紐付けの削除の記録の取り消し',
    )
    return stored
  })
}

/**
 * 1件消す。**消える行があったかを返す**(無かったら `false`)。
 *
 * IndexedDB の `delete` は存在しないキーでも成功するので、戻り値が無いと
 * 「紐付けを外したのに何も起きていない」を UI が検出できない。存在確認と削除は
 * 1トランザクションに入れる(間に別の書き込みが挟まらないようにする)。
 */
export function deleteAlias(
  key: string,
  deletedAt: string = new Date().toISOString(),
): Promise<boolean> {
  return tx(['aliases', 'aliasDeletions'], 'readwrite', async (transaction) => {
    const store = transaction.objectStore('aliases')
    // await するのは IDB の要求だけ。他の Promise を待つとトランザクションが先にコミットする
    const found = await req(store.count(key), 'aliases の存在確認')
    await req(store.delete(key), 'aliases の削除')
    // **持っていなかった紐付けの削除を送らない。** 送ると、別端末が本当に紐付けた直後の値を
    // 「こちらで消した」として倒しかねない
    if (found > 0) {
      await req(
        transaction.objectStore('aliasDeletions').put({ key, deletedAt }),
        '紐付けの削除の記録',
      )
    }
    return found > 0
  })
}

/** 未送信の紐付けの削除。`store/sync.ts` が `planSync` に渡す形へ射影する */
export function listAliasDeletions(): Promise<AliasDeletion[]> {
  return tx('aliasDeletions', 'readonly', (transaction) =>
    req(transaction.objectStore('aliasDeletions').getAll(), 'aliasDeletions の全件取得'),
  )
}

/**
 * 送信し終えた紐付けの削除を捨てる。**送信が成功したキーだけ**を渡すこと
 * (まとめて全消しすると、送れていない削除が黙って失われて紐付けが復活する)。
 */
export async function clearAliasDeletions(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return
  await tx('aliasDeletions', 'readwrite', async (transaction) => {
    const store = transaction.objectStore('aliasDeletions')
    for (const key of keys) await req(store.delete(key), 'aliasDeletions の削除')
  })
}

/**
 * サーバから降ってきた紐付けを当てる指示。`records` 側(`applyRemoteRecords`)と同じ形・同じ規律。
 * **削除の記録を書かない**(消すと決めたのはこの端末ではない)。
 */
export type RemoteAliasApply = {
  readonly upserts: readonly { key: string; alias: StoredAlias; expectedUpdatedAt: string | null }[]
  readonly removals: readonly { key: string; expectedUpdatedAt: string | null }[]
}

export type RemoteAliasApplyResult = {
  applied: string[]
  removed: string[]
  /** 同期の最中に本人が触ったので当てなかったキー */
  skipped: string[]
}

/** サーバ由来の紐付けを1トランザクションで当てる。**通信を渡せる形にしない** */
export async function applyRemoteAliases(plan: RemoteAliasApply): Promise<RemoteAliasApplyResult> {
  const result: RemoteAliasApplyResult = { applied: [], removed: [], skipped: [] }
  if (plan.upserts.length === 0 && plan.removals.length === 0) return result

  await tx('aliases', 'readwrite', async (transaction) => {
    const store = transaction.objectStore('aliases')
    for (const { key, alias, expectedUpdatedAt } of plan.upserts) {
      const current = await req<StoredAlias | undefined>(
        store.get(key) as IDBRequest<StoredAlias | undefined>,
        'aliases の取得',
      )
      if ((current?.updatedAt ?? null) !== expectedUpdatedAt) {
        result.skipped.push(key)
        continue
      }
      await req(store.put(alias, key), 'aliases の保存')
      result.applied.push(key)
    }
    for (const { key, expectedUpdatedAt } of plan.removals) {
      const current = await req<StoredAlias | undefined>(
        store.get(key) as IDBRequest<StoredAlias | undefined>,
        'aliases の取得',
      )
      if (current === undefined) continue
      if (current.updatedAt !== expectedUpdatedAt) {
        result.skipped.push(key)
        continue
      }
      await req(store.delete(key), 'aliases の削除')
      result.removed.push(key)
    }
  })
  return result
}

/**
 * runtime エイリアスを全部消す(組み込み8件は残る。マージ結果は builtin に戻る)。
 *
 * **削除の記録は作らない。** ここを通るのは「取り込みによる全置換」と「全データ削除」で、
 * どちらも同期先に対する削除の意思表示ではない(次の同期でサーバ側と突き合わせて決まる)。
 */
export function clearAliases(): Promise<void> {
  return clear('aliases')
}
