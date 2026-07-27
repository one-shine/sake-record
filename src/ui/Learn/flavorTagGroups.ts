// 味タグを読むための2つの補助データ。**どちらも同梱 JSON を数えた実測値の書き写し**で、
// 画面が計算しているわけではない（`npm run fetch:sakenowa` で取り直すとずれる → B57）。
//
// ## なぜ語を例示するのか
//
// 「味タグ」という名前だが、味覚・口当たり・比喩・温度帯・オノマトペが同じ一覧に混ざっている。
// これを文章で言うだけだと読み手は自分の頭の中で例を作れず、絞り込みの画面で
// 「なぜ『セメダイン』が味タグにあるのか」に驚く。**種類ごとに実物の語を並べる**のが早い。
//
// **例であって全部ではない。** 語彙は141語あり、ここに並べたのはその一部。画面にもそう書く
// （網羅した一覧に見えると「ここに無い語は存在しない」という別の誤解を作る）。
//
// ## 割合は「銘柄に対する割合」
//
// 分母は同梱 `brandFlavorTags` の 2,136銘柄で、**自分の記録の本数ではない**。
// 上位5語がどれも半数を超える = 押しても絞れない、が言いたいこと。

/** 語の種類。**この5つで141語を分類しきったわけではない**（例示のための括り） */
export type FlavorTagGroup = {
  readonly kind: string
  /** その種類だと分かる実物の語（141語からの抜粋） */
  readonly examples: readonly string[]
}

export const FLAVOR_TAG_GROUPS: readonly FlavorTagGroup[] = [
  { kind: '味覚', examples: ['酸味', '甘味', '苦味', '渋み'] },
  { kind: '口当たり', examples: ['なめらか', 'とろみ', 'ガス'] },
  { kind: '食べ物・飲み物の比喩', examples: ['メロン', 'ヨーグルト', '醤油', 'セメダイン'] },
  { kind: '温度帯', examples: ['冷酒', '常温', '熱燗', '燗酒', '燗冷まし'] },
  { kind: '飲む速さ', examples: ['ゴクゴク', 'ちびちび', 'スイスイ'] },
]

/** 付いている銘柄が多い順の上位5語。`percent` は 2,136銘柄に対する割合 */
export type FlavorTagShare = {
  readonly tag: string
  readonly percent: number
}

export const FLAVOR_TAG_TOP_SHARES: readonly FlavorTagShare[] = [
  { tag: '甘味', percent: 59 },
  { tag: '旨味', percent: 58 },
  { tag: '酸味', percent: 56 },
  { tag: '辛口', percent: 53 },
  { tag: 'スッキリ', percent: 51 },
]

/** 語彙の総数（同梱 `flavorTags` の行数） */
export const FLAVOR_TAG_VOCABULARY = 141
/** タグを1つ以上持つ銘柄の数（同梱 `brandFlavorTags` の行数 = 割合の分母） */
export const FLAVOR_TAG_BRANDS = 2136
/** 上流の打ち切り。銘柄あたりこの語数で切られている */
export const FLAVOR_TAG_CAP = 20
/** ちょうど `FLAVOR_TAG_CAP` 語の銘柄数（打ち切りの段差の証拠） */
export const FLAVOR_TAG_AT_CAP = 731
/** 打ち切りの1つ手前（19語）の銘柄数。731 との段差が「味の分布ではない」ことを示す */
export const FLAVOR_TAG_BELOW_CAP = 16
/** 上の数字を数えた時点 */
export const FLAVOR_TAG_COUNTED_ON = '2026-07'
