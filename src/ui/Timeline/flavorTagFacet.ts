// 味タグの絞り込みが要る計算。**React に触らない純TS**で、Timeline から切り出してあるのは
// 帯分けの規則(何を既定で見せて何を畳むか)を単体テストで固定するため。
//
// ## この画面だけのバケツ定義(A10「本数を数える実装は stats.ts の1箇所」との関係)
//
// 味タグの件数は**統計タブに出ない**。年 / 都道府県 / 写真 と同じで**この画面だけが数える軸**
// なので `stats.ts` には置かない(Timeline.tsx 冒頭の決定5と同じ線引き)。`computeStats` は
// 記録だけを入力に取る純関数で、そこに非同期で届く表を引数として足すと、統計と産地の集計まで
// 味タグの到着に依存することになる(あちらは記録だけで描けるのが要件)。
//
// ## 単位は「記録の本数」。銘柄数ではない
//
// 他のファセット(年 / 県 / 評価 / スペック)と単位を揃える。同じ銘柄を2回飲んだら2本。
// 銘柄数で数えると、押した結果の行数(本数)とピルの数字が食い違う。
//
// ## 解決経路と、当たらない記録
//
// `record.sakenowaBrandId` → `tagIdsByBrandId` → `tagNameById`。この経路が途切れる記録は
// **どのタグにも当たらない**:
//   - 紐付いていない記録(`sakenowaBrandId === null`)
//   - 紐付いたがさけのわ側にタグの行が無い銘柄(3264銘柄中 1128件)
//   - 語彙に無いタグID(同梱データでは0件だが、上流が語彙だけ縮めたら起きる)
// **推定で埋めない**(`unlinked` に値を入れないのと同じ規律)。代わりに呼び側が
// 「タグを引けた N本 / 全 M本」を常設して、絞ると消える本数を先に見せる。
//
// ## 非目標: 複数選択(今回やらない)
//
// タグは AND したくなる軸だが、**1つだけ選べる**形に留める。複数選択を入れると
// (a) チップのモデル(1軸1チップ) (b)「もう一度押して解除」 (c) 選んだ語の AND/OR の意味論
// が全部変わる。他の5軸と別のモデルを1軸だけに持ち込む価値が、203本の規模では出ない。

import type { DecodedFlavorTags } from '../../data/tables.ts'
import type { SakeRecord } from '../../domain/types.ts'

/**
 * 味タグの取得状態。**`idle`(まだ要求していない)を持つのがこの資源の要点** —
 * 記録とさけのわ4表は起動時に読むが、味タグは本人が絞り込みパネルを開くまで取らない。
 */
export type FlavorTagState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; value: DecodedFlavorTags }
  | { status: 'error'; message: string }

/**
 * 味タグの入手経路。**起動時には取らない**ので、要る画面が「要る」と言ったときに初めて取る。
 *
 * 絞り込みパネルと記録の詳細の**両方**が使う。状態だけを渡せる形にすると再試行の無い配線を
 * 作れてしまうので、状態と2つの導線を1つのオブジェクトにまとめてある。
 */
export type FlavorTagSource = {
  state: FlavorTagState
  /** その画面が味タグを要ったときに呼ぶ(呼ばれた側は `idle` のときだけ取得を始める) */
  onNeeded: () => void
  /** 取得に失敗したときの再試行。押した側が `loading` を立てる */
  onRetry: () => void
}

/** 語と、その語が付いた**記録の本数** */
export type FlavorTagCount = { tag: string; count: number }

export type FlavorTagBands = {
  /** 既定で見せる語。件数降順 */
  narrowing: FlavorTagCount[]
  /** 畳む語(タグを引けた記録の半数より多くに付く語)。件数降順。**捨てない** */
  broad: FlavorTagCount[]
}

export type FlavorTagFacet = FlavorTagBands & {
  /** タグを1つ以上引けた記録の本数。**この行の分母の分子**(全体の分母は records.length) */
  taggedCount: number
  /**
   * 記録ID → その記録が持つタグ名。絞り込みの述語がこれを引く。
   * **キーが無い記録はどのタグにも当たらない**(全件へフォールバックしない)。
   */
  tagsByRecordId: ReadonlyMap<string, readonly string[]>
}

/**
 * 記録の集合から味タグのファセットを組む。
 *
 * 語彙は141語全部ではなく**自分の記録が実際に持つ語だけ**(他のファセットと同じ規則。
 * 押しても0件の行き止まりのピルを作らない)。
 */
export function buildFlavorTagFacet(
  records: readonly SakeRecord[],
  tags: DecodedFlavorTags,
): FlavorTagFacet {
  const tagsByRecordId = new Map<string, readonly string[]>()
  const counts = new Map<string, number>()

  for (const record of records) {
    const names = resolveTagNames(record, tags)
    if (names.length === 0) continue
    tagsByRecordId.set(record.id, names)
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  const ordered = [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort(compareTagCount)

  return {
    taggedCount: tagsByRecordId.size,
    tagsByRecordId,
    ...splitTagBands(ordered, tagsByRecordId.size),
  }
}

/**
 * 1件のタグ名。**同じ語が2回入らない**ようにする(語彙側で名前が重複していても
 * 1本を2回数えない。ピルは語で1つなので、数え方も語で1回に揃える)。
 */
function resolveTagNames(record: SakeRecord, tags: DecodedFlavorTags): readonly string[] {
  if (record.sakenowaBrandId === null) return []
  const tagIds = tags.tagIdsByBrandId.get(record.sakenowaBrandId)
  if (tagIds === undefined) return []
  const names: string[] = []
  for (const id of tagIds) {
    const name = tags.tagNameById.get(id)
    if (name === undefined || names.includes(name)) continue
    names.push(name)
  }
  return names
}

/**
 * 件数降順 → 語順。**全順序にする**(件数が同じ語の並びが描画ごとに揺れないように)。
 * 語順の比較は UTF-16 の符号単位で、辞書順としての正しさは要求していない — 要るのは決定性。
 */
function compareTagCount(a: FlavorTagCount, b: FlavorTagCount): number {
  if (a.count !== b.count) return b.count - a.count
  return a.tag < b.tag ? -1 : 1
}

/**
 * 帯分け。**入力は件数降順、出力も入力の順序を保つ。**
 *
 * ## しきい値: タグを引けた記録の「半数より多く」に付くか
 *
 * 実測(自分の186本)では 旨味 99% / 酸味 98% / 甘味 98% / 苦味 98% / フルーティ 97% が並び、
 * **件数降順に素直に出すと先頭10個が全部これになって絞り込みとして機能しない**。
 * かといってデータを消して UI を綺麗に見せるのは禁じ手なので、**畳んで残数を出す**。
 *
 * 境界は**ちょうど半数は残す**(`count * 2 <= taggedCount` が narrowing)。境界で語を消す方向に
 * 丸めない。半数という値を選んだ理由は、押した結果が半分より多く残るなら「絞り込み」としては
 * ほとんど効いていないから(さけのわ側でも 甘味 59% / 旨味 58% / 酸味 56% / 辛口 53% /
 * スッキリ 51% が銘柄の半数以上に付いている)。
 *
 * ## 畳んでも語は消えない
 *
 * 呼び側は残数付きのトグルを出して**必ず開ける**導線を持ち、件数は畳んだ側にも出すこと。
 * さらに、**畳んだ結果 narrowing が空になるなら畳まない** — 記録が数本しか無い集合では
 * どの語も「半数より多く」に付くので、空の行に「残り N語を出す」だけが残る行き止まりになる
 * (排他軸の `narrowingOnly` が「バケツ1つの行を出さない」と決めているのと同じ判断)。
 */
export function splitTagBands(
  items: readonly FlavorTagCount[],
  taggedCount: number,
): FlavorTagBands {
  const narrowing = items.filter((item) => item.count * 2 <= taggedCount)
  const broad = items.filter((item) => item.count * 2 > taggedCount)
  if (narrowing.length === 0) return { narrowing: [...broad], broad: [] }
  return { narrowing, broad }
}
