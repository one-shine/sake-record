// 候補から選ばれた銘柄の最小の形。**紐付けの入口が3つあるので、型を1つにしておく。**
//
// `BrandSuggest`(手で打って選ぶ) / `OcrAssist`(写真から絞る) / 最近飲んだ銘柄 のどれも
// 同じ `handlePick` に入る。入口ごとに受け口を分けると「写真から選んだときだけ県が入らない」
// 類の食い違いが黙って生まれるので、`SuggestHit` と `BrandMatchCandidate` の**共通部分**を
// ここに置いて全員がこれを渡す。
//
// domain に置かないのは、これが `suggest.ts` と `brandFromText.ts` の2つの型の交差であって
// どちらか一方の持ち物ではないから(片方に置くともう片方が domain 内で相互参照する)。

import type { SakenowaBrand } from '../../domain/types.ts'

export type PickedBrand = {
  brand: SakenowaBrand
  /** 銘柄 → 蔵 → エリアの都道府県名。引けない / areaId 0(その他)は `null`。**推定で埋めない** */
  prefecture: string | null
  /** 表示できる蔵元名があるときだけ非 null(さけのわには名前が空の蔵元行が48件ある) */
  breweryName: string | null
}
