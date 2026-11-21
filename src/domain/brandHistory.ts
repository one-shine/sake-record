// 同じ銘柄の他の記録。記録の詳細から「この銘柄をいつ・何点で飲んだか」を見返すため(B125)。
//
// React 非依存の純TS。
//
// **何を「同じ銘柄」とするかは記録の状態で変える。**
// - 紐付いた記録: 同じ `sakenowaBrandId`。表記は見ない(`寫楽` と `冩楽` は同じ銘柄)。
// - 未紐付け: 正規化した表記が同じ**未紐付け**の記録。紐付いた記録とは混ぜない —
//   同じ表記でも紐付け先が決まった側は別の銘柄かもしれない(`高砂` は4県にある)。
// - 銘柄不明・表記が空: 何も返さない。空の表記どうしを同じ銘柄と数えると、
//   銘柄の分からない記録が全部「同じ銘柄」として並ぶ(定義域外で全件に落ちない)。

import { normalize } from './normalize.ts'
import type { SakeRecord } from './types.ts'

/** 列挙外の状態は `flavor.ts` と同じく紐付いている側に寄せる */
function isLinked(record: SakeRecord): boolean {
  return record.linkStatus !== 'unlinked' && record.linkStatus !== 'unknown'
}

function newestFirst(a: SakeRecord, b: SakeRecord): number {
  if (a.drankOn !== b.drankOn) return a.drankOn < b.drankOn ? 1 : -1
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
  return 0
}

export function sameBrandRecords(
  records: readonly SakeRecord[],
  target: SakeRecord,
): SakeRecord[] {
  let matches: (record: SakeRecord) => boolean
  if (isLinked(target) && target.sakenowaBrandId !== null) {
    const brandId = target.sakenowaBrandId
    matches = (record) => isLinked(record) && record.sakenowaBrandId === brandId
  } else if (target.linkStatus === 'unlinked') {
    const label = normalize(target.brandLabel)
    if (label === '') return []
    matches = (record) => record.linkStatus === 'unlinked' && normalize(record.brandLabel) === label
  } else {
    return []
  }
  return records.filter((record) => record.id !== target.id && matches(record)).sort(newestFirst)
}
