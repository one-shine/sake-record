// 産地の話に使う材料。**蔵の数は同梱データ（さけのわ）を数えた値の書き写し**で、
// 画面が計算しているわけではない。
//
// 数え方: `breweries.json` の各行 `[id, 名前, エリアID]` を `areas.json` の索引で県名に直して数える。
// **`facts.test.ts` が同じ数え方で数え直して一致を要求する**ので、上流が動けば CI が赤になる
// （月次の `update-sakenowa.yml` は commit の前にテストを通す）。赤にしたら実測に合わせて直す。
//
// 米と水の話は一般に言われていることをまとめたもの。**「この県はこの味」と言い切らない** —
// いまは蔵ごとの差のほうが大きく、県で決まるわけではない。

/** 同梱データに載っている蔵の数 */
export const BREWERY_TOTAL = 1749

export type PrefectureCount = {
  readonly name: string
  readonly count: number
}

/** 蔵が多い順の上位。**棒で見せるので数値も持つ** */
export const BREWERY_TOP: readonly PrefectureCount[] = [
  { name: '新潟県', count: 113 },
  { name: '兵庫県', count: 97 },
  { name: '長野県', count: 93 },
  { name: '山形県', count: 76 },
  { name: '福島県', count: 70 },
  { name: '福岡県', count: 57 },
]

/** 少ないほうの県（比較用。0の県は無い＝47都道府県すべてに蔵がある） */
export const BREWERY_FEW: readonly PrefectureCount[] = [
  { name: '宮崎県', count: 8 },
  { name: '香川県', count: 8 },
  { name: '沖縄県', count: 11 },
]

export type AreaNote = {
  readonly title: string
  readonly note: string
}

/** 産地の手がかり。**県名を味に直結させない**言い方でまとめる */
export const AREA_NOTES: readonly AreaNote[] = [
  {
    title: '灘（兵庫）と伏見（京都）',
    note: '生産量が特に大きい2つの産地。灘は硬い水で発酵が力強く進み、伏見はやわらかい水でおだやかな酒になると言われてきた。',
  },
  {
    title: '寒い地域',
    note: '新潟・東北・長野は蔵の数が多い。冬の低温を生かして時間をかけて発酵させる造りがしやすい。',
  },
  {
    title: '新潟の淡麗辛口',
    note: '軽くてすっきりした味の代名詞として知られる。ただし今は同じ県でも蔵ごとの差が大きく、県名から味は決まらない。',
  },
  {
    title: '西日本',
    note: '九州は焼酎の文化が強く、日本酒の蔵は相対的に少ない。広島の西条、山口、福岡は蔵が集まっている土地。',
  },
]

/** 代表的な酒米と、よく結びつけられる産地 */
export const SAKE_RICE: readonly AreaNote[] = [
  { title: '山田錦', note: '兵庫が主産地。大吟醸によく使われ、香りが出やすいとされる。' },
  { title: '五百万石', note: '新潟をはじめ北陸で多く作られる。すっきりした味になりやすいとされる。' },
  { title: '美山錦', note: '長野・東北で多く作られる。寒さに強い品種。' },
  { title: '雄町', note: '岡山が主産地。古くからある品種で、味に厚みが出るとされる。' },
]
