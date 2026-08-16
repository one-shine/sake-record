// 「知る」に**リテラルで書いてある数値**が、同梱データを数え直した値と一致するかを見る。
//
// ## なぜ要るのか（B64）
//
// 味タグの割合（甘味 59% など）と蔵の数（新潟 113 など）は、同梱 JSON を人が数えて
// 書き写した値。**`update-sakenowa.yml` が月次でデータを取り直す**ので、誰も画面を触らない
// まま数字だけが黙ってずれる。しかも**図（棒）にしたぶん、実データを計算しているように見える**。
//
// → このリポジトリが銘柄数などで採っている作法と同じにする: **固定値をテストで留め、
// 上流が動いたら赤で止めて人が判断する**。月次ジョブは commit の前に `npm run test` を通すので、
// **ずれたデータが main に入る前にここで落ちる**（自動でこっそり書き換わることもない）。
//
// 数え方はこのファイルの中で完結させる（`decodeTables` を通さない）。画面の説明は
// 「同梱データを数えた値」であって、アプリの解釈を通した値ではないため。

import breweriesJson from '../../../public/data/sakenowa/breweries.json'
import areasJson from '../../../public/data/sakenowa/areas.json'
import flavorTagsJson from '../../../public/data/sakenowa/flavorTags.json'
import brandFlavorTagsJson from '../../../public/data/sakenowa/brandFlavorTags.json'
import { BREWERY_FEW, BREWERY_TOP, BREWERY_TOTAL } from './areaFacts.ts'
import {
  FLAVOR_TAG_AT_CAP,
  FLAVOR_TAG_BELOW_CAP,
  FLAVOR_TAG_BRANDS,
  FLAVOR_TAG_CAP,
  FLAVOR_TAG_TOP_SHARES,
  FLAVOR_TAG_VOCABULARY,
} from './flavorTagGroups.ts'

// JSON からは `(string | number)[][]` としか推論されないので、行の形をここで1度だけ絞る。
// **絞るときに実際の値を検査する**ので、上流が行の形を変えたら型ではなくテストで落ちる
// （黙って `undefined` を数えて 0件になる、という壊れ方をしない）。
const BREWERY_ROWS: readonly (readonly [number, string, number])[] = breweriesJson.rows.map(
  (row) => {
    const [id, name, areaId] = row
    if (typeof id !== 'number' || typeof name !== 'string' || typeof areaId !== 'number') {
      throw new Error(`breweries の行の形が変わった: ${JSON.stringify(row)}`)
    }
    return [id, name, areaId] as const
  },
)

const TAG_ROWS: readonly (readonly [number, string])[] = flavorTagsJson.rows.map((row) => {
  const [id, name] = row
  if (typeof id !== 'number' || typeof name !== 'string') {
    throw new Error(`flavorTags の行の形が変わった: ${JSON.stringify(row)}`)
  }
  return [id, name] as const
})

/** 蔵の行 `[id, 名前, エリアID]` を県名で数える。**エリア0は「その他」**なので県には数えない */
function breweriesByPrefecture(): Map<string, number> {
  const areas = areasJson.rows
  const counts = new Map<string, number>()
  for (const [, , areaId] of BREWERY_ROWS) {
    const name = areas[areaId]
    if (name === undefined || name === 'その他') continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return counts
}

/** 銘柄ごとのタグ数 */
function tagCountsPerBrand(): number[] {
  return brandFlavorTagsJson.rows.map((row) => row.length - 1)
}

/** タグ名 → 付いている銘柄数 */
function brandsPerTag(): Map<string, number> {
  const names = new Map<number, string>(TAG_ROWS)
  const counts = new Map<string, number>()
  for (const [, ...tagIds] of brandFlavorTagsJson.rows) {
    for (const id of tagIds) {
      const name = names.get(id)
      if (name === undefined) continue
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return counts
}

describe('「知る」の数値と同梱データ', () => {
  describe('蔵の数（産地タブ）', () => {
    it('合計が同梱データの行数と一致する', () => {
      expect(BREWERY_TOTAL).toBe(breweriesJson.rows.length)
    })

    // ★ 画面に「47都道府県すべてに蔵がある」と書いてある。**その主張ごと検査する**
    it('47都道府県すべてに蔵がある', () => {
      const counts = breweriesByPrefecture()

      expect(counts.size).toBe(47)
      for (const [name, count] of counts) {
        expect(count, `${name} の蔵が0`).toBeGreaterThan(0)
      }
    })

    it('上位6県が数え直した順と件数で一致する', () => {
      const counts = [...breweriesByPrefecture()].sort((a, b) => b[1] - a[1])
      const top = counts.slice(0, BREWERY_TOP.length).map(([name, count]) => ({ name, count }))

      expect(BREWERY_TOP).toEqual(top)
    })

    it('少ない側として挙げた県の件数が一致する', () => {
      const counts = breweriesByPrefecture()
      for (const { name, count } of BREWERY_FEW) {
        expect(counts.get(name), name).toBe(count)
      }
    })
  })

  // **ここだけ完全一致を要求しない(B41)。** 味タグの数は上流が銘柄を足すたびに動き、
  // 一致を求めると**さけのわが1件増えるだけで月次更新ジョブが止まる**(あのジョブは
  // テストが緑のときだけコミットする)。一方これらは画面が読み上げている数字なので、
  // 離れすぎたら直す必要がある。→ **2%の幅**で見る。幅を超えたら数え直して
  // `flavorTagGroups.ts` を書き換える(値は失敗メッセージに出る)。
  //
  // 上流の件数に依存しない性質(打ち切りが20語であること・段差があること)は完全一致のまま。
  describe('味タグ（味タブ）', () => {
    /** 画面に出す数として許す誤差。1件2件のずれで自動更新を止めない */
    const TOLERANCE = 0.02
    const near = (literal: number, actual: number) =>
      Math.abs(literal - actual) <= Math.max(1, actual * TOLERANCE)

    it('語彙とタグを持つ銘柄の数が同梱データと 2% 以内で一致する', () => {
      expect(near(FLAVOR_TAG_VOCABULARY, flavorTagsJson.rows.length), 
        `語彙 ${String(FLAVOR_TAG_VOCABULARY)} → 実データ ${String(flavorTagsJson.rows.length)}`,
      ).toBe(true)
      expect(near(FLAVOR_TAG_BRANDS, brandFlavorTagsJson.rows.length),
        `分母 ${String(FLAVOR_TAG_BRANDS)} → 実データ ${String(brandFlavorTagsJson.rows.length)}`,
      ).toBe(true)
    })

    // **打ち切りの語数だけは完全一致。** 上流の設定であって増え続ける数ではなく、
    // 動いたら「20語」と書いた画面の文も直す必要がある = 人が判断すべき変化
    it('上流の打ち切りが 20語である', () => {
      expect(Math.max(...tagCountsPerBrand())).toBe(FLAVOR_TAG_CAP)
    })

    // 段差（20語ちょうどが731件 / 19語が16件）が画面の主張の根拠になっている。
    // **主張は「桁違いに多い」ことなので、件数ではなく差の大きさを見る**
    it('段差の件数が 2% 以内で一致し、桁違いの差が保たれている', () => {
      const sizes = tagCountsPerBrand()
      const atCap = sizes.filter((n) => n === FLAVOR_TAG_CAP).length
      const belowCap = sizes.filter((n) => n === FLAVOR_TAG_CAP - 1).length

      expect(near(FLAVOR_TAG_AT_CAP, atCap), `${String(FLAVOR_TAG_AT_CAP)} → ${String(atCap)}`).toBe(true)
      expect(near(FLAVOR_TAG_BELOW_CAP, belowCap), `${String(FLAVOR_TAG_BELOW_CAP)} → ${String(belowCap)}`).toBe(true)
      expect(atCap).toBeGreaterThan(belowCap * 10)
    })

    it('上位5語の順序が一致し、割合が 2ポイント以内で一致する', () => {
      const total = brandFlavorTagsJson.rows.length
      const top = [...brandsPerTag()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, FLAVOR_TAG_TOP_SHARES.length)
        .map(([tag, count]) => ({ tag, percent: Math.round((count / total) * 100) }))

      // 語と順序は完全一致(入れ替わったら画面の主張が変わる)
      expect(FLAVOR_TAG_TOP_SHARES.map((s) => s.tag)).toEqual(top.map((s) => s.tag))
      for (const [i, share] of FLAVOR_TAG_TOP_SHARES.entries()) {
        expect(Math.abs(share.percent - top[i].percent), share.tag).toBeLessThanOrEqual(2)
      }
    })
  })
})
