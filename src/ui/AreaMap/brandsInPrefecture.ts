// 県を選んだときに出す「その県で飲んだ銘柄の一覧」。**React に触らない純TS。**
//
// ## なぜ `stats.ts` に置かないか
//
// この一覧は**産地タブだけが使う**。`computeStats` は記録だけを入力に取る純関数で、統計タブと
// 産地タブが同じ戻り値を共有している(数を2箇所で数えないための約束)。そこに1画面しか使わない
// 銘柄の内訳を足すと、統計タブの集計まで巻き添えで重くなる。
// 味タグの帯分けを `Timeline/flavorTagFacet.ts` に置いたのと同じ線引き。
//
// ## 地図の本数と、この一覧の合計は必ず一致させる
//
// 県の突き合わせは `normalizePrefecture` → `prefectureCode` の**同じ経路**を通す。ここを
// 自前で書くと、地図に「22本」と出ているのに一覧の合計が21本、という状態が作れてしまう
// (どちらが正しいのか画面からは判定できない)。テストで合計の一致を固定する。
//
// ## 重複をどう畳むか
//
// **紐付いている銘柄は `sakenowaBrandId` で畳む。** 表記が揺れていても(`寫楽` と `冩楽`)
// 同じ銘柄なら1行になる。紐付いていない記録は id を持たないので、**本人の表記そのもの**で畳む
// — ここで正規化して畳むと、本人が別物として書き分けたものが勝手に1つになる。

import { normalizePrefecture, prefectureCode } from '../../domain/prefecture.ts'
import type { LinkStatus, SakeRecord } from '../../domain/types.ts'

export type PrefectureBrand = {
  /** 一覧の key。紐付いていれば `b<銘柄ID>`、いなければ `l<本人の表記>` */
  key: string
  /** 画面に出す名前。紐付いていればさけのわの銘柄名、いなければ本人の表記 */
  name: string
  /** さけのわの銘柄名と本人の表記が違うとき、その表記(`冩楽` に対する `寫楽`)。同じなら `null` */
  label: string | null
  /** その県でその銘柄を飲んだ本数 */
  count: number
  /**
   * 代表の紐付けの状態。**同じ銘柄IDの記録は同じ状態になる**ので代表で足りる。
   * 紐付いていない側は表記ごとに1行なので、こちらも一意。
   */
  linkStatus: LinkStatus
  /** 紐付いていれば銘柄ID。押して記録を絞るときの鍵になる */
  brandId: number | null
}

/**
 * その県で飲んだ銘柄を、本数の多い順に返す。**重複は畳む。**
 *
 * 並びは「本数の降順 → 名前の昇順」で**全順序**にする。同値で 0 を返す比較にすると
 * 端末や件数で並びが変わる(`byNewestFirst` と同じ規律)。
 *
 * `code` に当たる記録が1件も無ければ空配列。**全件に落ちない。**
 */
export function brandsInPrefecture(
  records: readonly SakeRecord[],
  code: number,
): PrefectureBrand[] {
  const byKey = new Map<string, PrefectureBrand>()

  for (const record of records) {
    const label = normalizePrefecture(record.prefecture)
    if (label === null) continue
    if (prefectureCode(label) !== code) continue

    const key =
      record.sakenowaBrandId === null
        ? `l${record.brandLabel}`
        : `b${String(record.sakenowaBrandId)}`
    const found = byKey.get(key)
    if (found) {
      found.count += 1
      continue
    }
    const name = record.brandName ?? record.brandLabel
    byKey.set(key, {
      key,
      name,
      // 表記が銘柄名と違うときだけ添える(同じなら重ねて出しても情報が増えない)
      label: name === record.brandLabel ? null : record.brandLabel,
      count: 1,
      linkStatus: record.linkStatus,
      brandId: record.sakenowaBrandId,
    })
  }

  return [...byKey.values()].sort(
    (a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  )
}
