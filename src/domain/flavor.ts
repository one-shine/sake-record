// 記録の集合 → フレーバー6軸の平均 / 散布図の点 / 空白地帯。
//
// React 非依存の純TS(`react` / `window` / `document` / `process` を参照しない)。
//
// ## この層の最重要の規則: 分母を戻り値に含める
//
// **紐付け済み(実測186) ≠ フレーバー取得済み(実測185)。** 差の1本は「紐付いてはいるが
// さけのわにフレーバーチャートが無い銘柄」で、`unlinked` と同じ袋に入れると 186 と 185 の差が
// 説明できなくなる。そこで未取得を3種に分けて数える(`FlavorMissing`)。
//
// 分母(`denominator`)と総数(`total`)を戻り値に含めるのは、呼び出し側が数え直さないため。
// 分母を画面側で再計算すると規則(status で除外するのか brandId で除外するのか)が二重実装になり、
// 手動紐付けで分母が動いたときに画面のどこかだけ古い数字が残る(BACKLOG B29 / B1(3))。
//
// **`unlinked` / `unknown` にフレーバー値を推定で埋めない**(`types.ts` の `LinkStatus` 参照)。
// 6軸の集計から外し、件数だけを数える。0 で埋めると平均が静かに下振れする。
//
// ## 前提: チャートの表が読めているときだけ呼ぶ
//
// `flavorChartByBrandId` は `src/data/tables.ts` の `flavorChartByBrandId` をそのまま渡す。
// **テーブルの取得に失敗したときにこの関数を呼んではいけない** — 空の Map を渡すと紐付いた全件が
// `linkedWithoutChart` になり、「さけのわにチャートが無い」と嘘をつくことになる(実際は
// 「まだ読めていない」)。取得失敗は画面側で先に出す(`ImportSummary.withFlavor` が
// `number | null` で同じ区別をしている)。

import type { FlavorAxisKey, FlavorChart, SakeRecord } from './types.ts'

/** 6軸を走査する唯一の順序。ラベル(華やか等)は表示層に置く */
export const FLAVOR_AXIS_KEYS: readonly FlavorAxisKey[] = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6']

/**
 * 6軸の値の組。`FlavorChart` から `brandId` を落とした形。
 *
 * **単位は 0-100**(`FlavorChart` と同じ)。平均は**丸めない**で返す:
 * (a) 丸めると 185本と190本の平均の差(1本増減で 0.5 未満動く)が見えなくなる
 * (b) レーダーの半径は 0-100 を長さに写すので、整数に丸める意味がない
 * (c) 表示の桁数は画面ごとに違う(要約は整数・比較は小数第1位)ので表示層の関心
 */
export type FlavorAxes = Record<FlavorAxisKey, number>

/** 散布図の1点 = 記録1本。**銘柄では重複排除しない**(集計の単位は飲んだ本数) */
export type FlavorPoint = {
  /** 点から記録に戻るためのキー。日付は持たせない(台帳の結合キーを作らない) */
  recordId: string
  brandId: number
  /** 点に添える名前。紐付いた銘柄名を優先し、無ければ本人の表記 */
  label: string
  axes: FlavorAxes
}

/**
 * 6軸を集計できなかった記録の内訳。**3種を1つに潰さない。**
 * `denominator + unlinked + unknown + linkedWithoutChart === total` が常に成り立つ。
 */
export type FlavorMissing = {
  /** 銘柄は分かるがさけのわに無い / 候補を絞れない(実測12本) */
  unlinked: number
  /** 記録時点で銘柄が判読できていない(実測5本) */
  unknown: number
  /** 紐付いているのにチャートが無い(実測1本 = 186 と 185 の差) */
  linkedWithoutChart: number
}

/** ビンの閉区間。値は整数なので上限も含める */
export type FlavorBinRange = { min: number; max: number }

/**
 * 空白地帯の1セル。**2軸の射影**(散布図が実際に描く面)で数える。
 *
 * 6軸の直積で数えない理由: 4分割なら 4^6 = 4096 セルに対し記録は203本しかないので、
 * 空白の大半が「まだ飲んでいない」ではなく「次元が高い」ことの帰結になる(疎性は原理的で、
 * 全部飲んでも埋まらない)。それを「空白地帯」として出すのは不確実性の誇張。
 * 15面 × 16セル = 240セルなら 203本 × 15面 = 3045 の当たりが載るので、
 * 「1件も無い」は偏りを意味する。
 */
export type FlavorGap = {
  axes: readonly [FlavorAxisKey, FlavorAxisKey]
  /** 各軸のビン番号(0..3)。`FLAVOR_BINS` の添字 */
  bins: readonly [number, number]
  /** ビン番号に対応する値域。UI が `FLAVOR_BINS` を引き直さないで済むように含める */
  ranges: readonly [FlavorBinRange, FlavorBinRange]
}

/**
 * 2軸射影1面の度数。`counts[xBin][yBin]`。
 *
 * `gaps`(件数0のセル)と同じ1回の走査から作る。**「なぞっている領域」を濃淡で描く材料**で、
 * これが無いと UI が `flavorBinIndex` を使ってビン分けを二重実装する。
 */
export type FlavorGrid = {
  axes: readonly [FlavorAxisKey, FlavorAxisKey]
  counts: readonly (readonly number[])[]
}

export type FlavorSummary = {
  /** 取得済みだけで取った6軸の平均。**分母0のときは `null`**(0 を平均として返さない) */
  axes: FlavorAxes | null
  /** 6軸を集計した本数。実測185(手動紐付け後190) */
  denominator: number
  /** 渡された記録の総数。実測203 */
  total: number
  missing: FlavorMissing
  points: readonly FlavorPoint[]
  /** 記録が1件も無い2軸セル。`grids` の件数0のセルと同一集合 */
  gaps: readonly FlavorGap[]
  grids: readonly FlavorGrid[]
}

/**
 * 0-100 を4等分に近い閉区間で覆う。
 *
 * 分割数を4にした理由: 2だと「高いか低いか」しか言えず空白がほぼ出ない(= 何も分からない)。
 * 5以上だと1面 25セル以上になり、203本でも端のセルが空くのが当たり前になる。
 * 4は 0-100 の読み(四分位)と一致し、1面16セルに対して記録が15面ぶん載るので
 * 「1件も無い」が偶然ではなく傾向を意味する最小の粗さ。
 * 100 は4で割れないので最上位ビンだけ1広い(0-24 / 25-49 / 50-74 / 75-100)。
 */
export const FLAVOR_BINS: readonly FlavorBinRange[] = [
  { min: 0, max: 24 },
  { min: 25, max: 49 },
  { min: 50, max: 74 },
  { min: 75, max: 100 },
]

/**
 * 6軸から2つ取る15面。`FLAVOR_AXIS_KEYS` の順で `i < j` だけを採る
 * (`f1/f2` と `f2/f1` は同じ面なので片方だけ)。
 */
export const FLAVOR_AXIS_PAIRS: readonly (readonly [FlavorAxisKey, FlavorAxisKey])[] =
  FLAVOR_AXIS_KEYS.flatMap((x, index) =>
    FLAVOR_AXIS_KEYS.slice(index + 1).map((y) => [x, y] as const),
  )

/**
 * 値 → ビン番号。**数でない値は `null`**(でたらめなセルに落とさない)。
 *
 * 0-100 の外は端のビンに寄せる: 105 は依然「高い側」であって不明ではない。
 * ただし 0.0-1.0 の原値をそのまま渡すと全点が最下位ビンに潰れる
 * (単位の取り違えは例外を出さずにこの形で現れる。`FlavorChart` の単位の注意書きを参照)。
 */
export function flavorBinIndex(value: number): number | null {
  if (!Number.isFinite(value)) return null
  for (const [index, bin] of FLAVOR_BINS.entries()) {
    if (value <= bin.max) return index
  }
  return FLAVOR_BINS.length - 1
}

function axesOf(chart: FlavorChart): FlavorAxes {
  return { f1: chart.f1, f2: chart.f2, f3: chart.f3, f4: chart.f4, f5: chart.f5, f6: chart.f6 }
}

function zeroAxes(): FlavorAxes {
  return { f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0 }
}

/**
 * 記録の集合をフレーバーの要約にする。純関数(引数以外を読まない)。
 *
 * 1本ごとの行き先は**排他**で、分母と未取得3種の合計が必ず総数になる:
 * `unlinked` / `unknown` → 件数のみ(brandId を持っていてもチャートを引かない) /
 * 紐付き & チャート有り → 分母と点 / 紐付き & チャート無し → `linkedWithoutChart`。
 */
export function computeFlavor(
  records: readonly SakeRecord[],
  flavorChartByBrandId: ReadonlyMap<number, FlavorChart>,
): FlavorSummary {
  const missing: FlavorMissing = { unlinked: 0, unknown: 0, linkedWithoutChart: 0 }
  const points: FlavorPoint[] = []
  const sums = zeroAxes()

  for (const record of records) {
    // status を先に見るので、`unlinked` / `unknown` が brandId を持っていてもチャートを引かない
    // (実データでは起きない: `createLinker` はこの2値で brandId を null にする。壊れた JSON から
    // 来た記録に対しても「推定値で埋めない」を守る)。
    // 列挙外の値は `ui/Timeline/linkStatus.ts` の `isLinkedStatus` と同じく「紐付いている」側に
    // 寄せる = ここを素通りする。あちらを import しないのは依存方向 `domain ← store ← ui` のため。
    if (record.linkStatus === 'unlinked') {
      missing.unlinked += 1
      continue
    }
    if (record.linkStatus === 'unknown') {
      missing.unknown += 1
      continue
    }

    const brandId = record.sakenowaBrandId
    // 定義域外のキーは `undefined`。**表の別の行にフォールバックしない。**
    // brandId が null の紐付き(壊れた記録)もここに落ちる = 推定で埋めずに件数だけ数える。
    const chart = brandId === null ? undefined : flavorChartByBrandId.get(brandId)
    if (brandId === null || chart === undefined) {
      missing.linkedWithoutChart += 1
      continue
    }

    const axes = axesOf(chart)
    points.push({
      recordId: record.id,
      brandId,
      // 上流のマスタから銘柄が消えても表示が消えないよう、記録に非正規化保存した名前を使う(B4)
      label: record.brandName ?? record.brandLabel,
      axes,
    })
    for (const key of FLAVOR_AXIS_KEYS) sums[key] += axes[key]
  }

  const denominator = points.length
  // 分母0で 0/0 = NaN を返さない。「平均を出せない」は null で言う(0 は「軸が全部0」の意味になる)
  const axes =
    denominator === 0
      ? null
      : FLAVOR_AXIS_KEYS.reduce<FlavorAxes>((acc, key) => {
          acc[key] = sums[key] / denominator
          return acc
        }, zeroAxes())

  const { grids, gaps } = buildCoverage(points)

  return { axes, denominator, total: records.length, missing, points, gaps, grids }
}

/**
 * 2軸射影15面の度数と、そこから漏れたセル(空白地帯)を1回の走査で作る。
 *
 * 記録が0件なら全240セルが空白になる。**空配列を返して「空白は無い」と言わない**
 * (何もなぞっていない状態こそ全域が空白)。
 */
function buildCoverage(points: readonly FlavorPoint[]): {
  grids: FlavorGrid[]
  gaps: FlavorGap[]
} {
  const binCount = FLAVOR_BINS.length
  const grids: FlavorGrid[] = []
  const gaps: FlavorGap[] = []

  for (const [x, y] of FLAVOR_AXIS_PAIRS) {
    const counts: number[][] = Array.from({ length: binCount }, () =>
      new Array<number>(binCount).fill(0),
    )
    for (const point of points) {
      const xBin = flavorBinIndex(point.axes[x])
      const yBin = flavorBinIndex(point.axes[y])
      // どちらかがビンに落ちない点(数でない値)は面に載せない。存在しないセルを作らない
      if (xBin === null || yBin === null) continue
      counts[xBin][yBin] += 1
    }
    for (const [xBin, row] of counts.entries()) {
      for (const [yBin, count] of row.entries()) {
        if (count !== 0) continue
        gaps.push({
          axes: [x, y],
          bins: [xBin, yBin],
          ranges: [FLAVOR_BINS[xBin], FLAVOR_BINS[yBin]],
        })
      }
    }
    grids.push({ axes: [x, y], counts })
  }

  return { grids, gaps }
}
