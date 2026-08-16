// 紐付け先の銘柄が**いまも上流(さけのわ)に在るか**(B31)。
//
// ## なぜ `linkStatus` と別の軸にするのか
//
// `linkStatus` は**紐付けの由来**(誰がどう決めたか)で、`auto` / `alias` / `manual` /
// `unlinked` / `unknown` の5値。「上流から消えた」は由来ではなく**上流の現在の状態**で、
// 由来と直交する(手動で紐付けた銘柄も、機械が当てた銘柄も、同じように消えうる)。
// 6値目に足すと**バッジ表と紐付けの判定が両方とも意味を変える**ので、別の軸として持つ。
//
// ## 何が壊れていたのか
//
// 記録の詳細が `sakenowaBrandId !== null` だけを見て
// 「さけのわにこの銘柄のフレーバーデータが無い。**紐付け自体は済んでいる。**」と言っていた。
// 上流から消えた銘柄にも同じ文が出るので、**打てる手が違うのに同じことを言う**:
//
//   - チャートが無いだけ … 打てる手は無い(上流にデータが無い)
//   - 上流から消えた     … 手動で紐付け直せば直る
//
// 蔵元の欄も同じで、引けない蔵元が「記録なし」(= 本人が書かなかった)として出ていた。
//
// ## 上流から消えても記録は書き換えない
//
// `sakenowaBrandId` を自動でクリアしない/非正規化した `brandName` で表示を続ける、は今までどおり
// (`types.ts` の `brandName` の設計)。**判定するだけで、記録には触らない。**

import type { SakeRecord } from './types.ts'

/**
 * 紐付け先の銘柄の在り処。
 *
 * - `present` … 紐付いていて、上流のマスタにも在る
 * - `gone`    … 紐付いているが、**上流のマスタから消えている**(打てる手は紐付け直し)
 * - `none`    … そもそも紐付いていない(`unlinked` / `unknown`)
 */
export type BrandPresence = 'present' | 'gone' | 'none'

/**
 * @param hasBrand 銘柄IDが上流のマスタに在るか。**`brandById.has` を渡す**
 *   (テーブルそのものを受けると、この関数のテストが3264件の実データを要求し始める)
 */
export function brandPresence(
  record: Pick<SakeRecord, 'sakenowaBrandId'>,
  hasBrand: (brandId: number) => boolean,
): BrandPresence {
  if (record.sakenowaBrandId === null) return 'none'
  return hasBrand(record.sakenowaBrandId) ? 'present' : 'gone'
}
