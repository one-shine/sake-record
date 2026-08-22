// 書きかけの記録の退避(B88)。
//
// ## なぜ要るのか
//
// `RecordForm` の入力はメモリ上の `useState` にしかない。守っているのは
// 「閉じようとしたら確認を出す」だけで、これは**アプリ内の閉じる操作にしか効かない**。
// モバイルで一番よく起きる喪失経路は別にある:
//
//   - iOS がバックグラウンドの PWA を破棄する(記録の途中で写真アプリへ切り替えるのは通常の使い方)
//   - Service Worker の更新でリロードが走る(B87 で本人に委ねる形にしたが、本人が押せばやはり消える)
//   - タブを閉じる / 端末が落ちる
//
// `beforeunload` はモバイルで当てにならないので、**「消えないようにする」ではなく
// 「消えても戻せる」**に倒す。書きかけを1件だけ端末に退避し、次に同じ対象のフォームを
// 開いたときに「復元する / 破棄する」を出す。
//
// ## 置き場が `meta` である理由
//
// これは**記録ではなく「この端末のやり残し」**なので、書き出しにも同期にも乗せない
// (`thumbnailRepairs` と同じ扱い)。`records` に混ぜると、保存していないものが
// 一覧・集計・同期に現れる。
//
// ## 1件しか持たない
//
// 同時に開けるフォームは1つなので、複数持つ意味が無い。溜め込むと消し忘れた下書きが
// 端末に残り続け、どれが最新か分からなくなる。**新しい下書きは古いものを上書きする。**
//
// ## 自動で本文に戻さない
//
// 復元は**本人の操作**にする。開いた瞬間に流し込むと、新規作成を始めたつもりの人に
// 前回の書きかけが混ざる(しかも `dirty` が立つので、閉じるときに確認まで出る)。

import { get, put } from './db.ts'
import type { Rating } from '../domain/types.ts'

/** `meta` のキー。**1件だけ**なので対象ごとに分けない */
export const META_FORM_DRAFT = 'formDraft'

/**
 * 退避した紐付け。`RecordForm` の `LinkState` と同じ形を持つ。
 *
 * **銘柄IDだけにしない。** 表示名・県・蔵元名を捨てると、復元したときに銘柄マスタを
 * 引き直すことになり、上流から消えた銘柄では表示まで消える(`brandName` を非正規化保存
 * している理由と同じ)。
 */
export type DraftLink = {
  brandId: number
  brandName: string | null
  prefecture: string | null
  breweryName: string | null
  origin: 'initial' | 'picked'
}

/**
 * 書きかけの記録。`RecordForm` が持つ state のうち**保存に効くものだけ**。
 *
 * OCR に渡す原寸の元ファイルは入れない(記録にも入らないので、復元しても意味が無い)。
 * 確認ダイアログの開閉のような一時的な状態も入れない。
 */
export type FormDraft = {
  /** どの記録の編集か。**新規は `null`** — 開いたフォームと突き合わせて、別物に混ぜない */
  editingId: string | null
  drankOn: string
  brandLabel: string
  link: DraftLink | null
  /** 紐付けを外したことを本人に伝えている最中か(注意文の表示に効く) */
  linkCleared: boolean
  spec: string
  rating: Rating | null
  place: string
  note: string
  /** サムネイル。**バイト列で持つ**(B72。`Blob` は IndexedDB で参照になり後から読めなくなる) */
  thumbnail: ArrayBuffer | null
  /** 退避した時刻(ISO8601)。復元するか決めるときに「いつのものか」を出す */
  savedAt: string
}

const isRating = (value: unknown): value is Rating =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5

function readLink(value: unknown): DraftLink | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (typeof row.brandId !== 'number' || !Number.isFinite(row.brandId)) return null
  return {
    brandId: row.brandId,
    brandName: typeof row.brandName === 'string' ? row.brandName : null,
    prefecture: typeof row.prefecture === 'string' ? row.prefecture : null,
    breweryName: typeof row.breweryName === 'string' ? row.breweryName : null,
    origin: row.origin === 'picked' ? 'picked' : 'initial',
  }
}

/**
 * 退避してある書きかけ。**形が読めなければ `null`**。
 *
 * 読めない下書きを部分的に復元しない — 途中まで入った値のほうが、何も無いより危ない
 * (本人は全部戻ったつもりで保存する)。
 */
export async function loadFormDraft(): Promise<FormDraft | null> {
  const value = await get('meta', META_FORM_DRAFT)
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (typeof row.savedAt !== 'string' || row.savedAt === '') return null
  if (typeof row.drankOn !== 'string') return null
  if (row.editingId !== null && typeof row.editingId !== 'string') return null
  return {
    editingId: row.editingId,
    drankOn: row.drankOn,
    brandLabel: typeof row.brandLabel === 'string' ? row.brandLabel : '',
    link: readLink(row.link),
    linkCleared: row.linkCleared === true,
    spec: typeof row.spec === 'string' ? row.spec : '',
    rating: isRating(row.rating) ? row.rating : null,
    place: typeof row.place === 'string' ? row.place : '',
    note: typeof row.note === 'string' ? row.note : '',
    thumbnail: row.thumbnail instanceof ArrayBuffer ? row.thumbnail : null,
    savedAt: row.savedAt,
  }
}

/** 上書きで1件だけ持つ */
export async function saveFormDraft(draft: FormDraft): Promise<void> {
  await put('meta', draft, META_FORM_DRAFT)
}

/** 保存できた / 破棄した / 復元した後に捨てる。**残すと次に開いたとき古いものを勧める** */
export async function clearFormDraft(): Promise<void> {
  await put('meta', null, META_FORM_DRAFT)
}
