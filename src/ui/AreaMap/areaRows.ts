// 産地マップの行を組む純関数。**`@svg-maps/japan` を import するのはこのファイルだけ**
// (パッケージの形が変わったときに直す場所を1箇所にする)。React も DOM も触らない。
//
// ## 県コードの対応表を再定義しない
//
// 地図の `location.id` は **romaji**(`fukushima`)で、JIS 順でも日本語名でもない。
// 変換は `src/domain/prefecture.ts` の `codeFromRomaji` / `prefectureName` だけを通す。
// ここに romaji → 県名の表を書くと 47対47 の全単射が2箇所になり、
// `prefecture.test.ts`(Phase 2)が守っている対応と静かにずれる。
//
// ## 解決できない id を黙って飛ばさない
//
// `codeFromRomaji` が `null` を返す location を `continue` で捨てると、**地図から県が1つ消え、
// 本数の合計だけが合わなくなる**(どの県が消えたかは画面から分からない)。形は必ず返し、
// `unresolvedIds` に id を積んで画面が名指しで出す。定義域外のキーで「全件」や既定の県に
// 落とすのも同じ理由で禁止(絶対ルール2)。
//
// ## 未出現の県は「0本」、県が不明な記録は「0本ではない」
//
// `byPrefectureCode` は未出現の県のキーを持たない(`computeStats` の約束)。読む側は `?? 0`。
// 一方で県が確定していない記録は**どの県のバケツにも足さない** — 地図の外に別立てで出す
// (`AreaMap.tsx` が `unresolvedPrefectures` / `noPrefectureCount` から組む)。

import japan from '@svg-maps/japan'
import { PREFECTURE_NAMES, codeFromRomaji, prefectureName } from '../../domain/prefecture.ts'
import type { PrefectureCount } from '../../domain/stats.ts'
import { FILL_STEPS, fillStepIndex } from './fillSteps.ts'

/**
 * `@svg-maps/japan` の location を**構造型で受ける**。パッケージの型(`svg-maps__common`)に
 * 依存しないので、テストが合成の location 配列(解決できない id を含む形)を直接渡せる。
 */
export type MapLocation = {
  readonly id: string
  readonly name?: string | undefined
  readonly path: string
}

/** `0 0 438 516`。SVG の座標系はパッケージ側の値をそのまま使う(自前で書き写さない) */
export const JAPAN_VIEW_BOX: string = japan.viewBox

/** 47件。**並びはアルファベット順**(JIS 順ではない)。描画順として使うだけで意味を持たせない */
export const JAPAN_LOCATIONS: readonly MapLocation[] = japan.locations

/** 都道府県の総数(47)。`PREFECTURE_NAMES` から取る — 画面に 47 をリテラルで書かない */
export const PREFECTURE_TOTAL: number = PREFECTURE_NAMES.length

/** 地図の1形。`code === null` は県コードに解決できなかった形(色を付けず、本数も持たない) */
export type MapShape = {
  /** `location.id`(romaji)。そのまま `data-romaji` に出す */
  readonly id: string
  /** JIS コード 1..47。解決できなければ `null` */
  readonly code: number | null
  /** 日本語県名。`code` が `null` なら `null` */
  readonly name: string | null
  readonly path: string
  /** 本数。**`code` が `null` のときは `null`**(「0本」と混ぜると未進出に見える) */
  readonly count: number | null
  /** `FILL_STEPS` の添字。`code` が `null` なら `null` */
  readonly step: number | null
}

export type MapShapes = {
  /** **入力と同じ件数・同じ順**。1件も落とさない */
  readonly shapes: readonly MapShape[]
  /** 県コードに解決できなかった `location.id`。空でなければ画面が名指しで出す */
  readonly unresolvedIds: readonly string[]
}

/**
 * 地図の形 + 本数。`byPrefectureCode` は `computeStats` の戻り値をそのまま渡す
 * (この画面は本数を数え直さない — 数える実装は `src/domain/stats.ts` の1箇所だけ)。
 */
export function buildMapShapes(
  locations: readonly MapLocation[],
  byPrefectureCode: ReadonlyMap<number, number>,
): MapShapes {
  const shapes: MapShape[] = []
  const unresolvedIds: string[] = []

  for (const location of locations) {
    const code = codeFromRomaji(location.id)
    if (code === null) {
      // 形は残す。飛ばすと地図から県が1つ消えるだけで、画面には何の痕跡も出ない
      unresolvedIds.push(location.id)
      shapes.push({ id: location.id, code: null, name: null, path: location.path, count: null, step: null })
      continue
    }
    const count = byPrefectureCode.get(code) ?? 0
    shapes.push({
      id: location.id,
      code,
      name: prefectureName(code),
      path: location.path,
      count,
      step: fillStepIndex(count),
    })
  }

  return { shapes, unresolvedIds }
}

/** 一覧の並び。`count` = 本数の多い順、`jis` = 北から南(JIS コード順) */
export type PrefectureOrder = 'count' | 'jis'

/** 一覧の1行。**0本の県も行として返す**(未進出が読めることが一覧の存在理由) */
export type PrefectureRow = {
  readonly code: number
  readonly name: string
  readonly count: number
  readonly step: number
}

/**
 * 47県ぶんの行。`PREFECTURE_NAMES` を土台にするので**本数0の県も必ず1行になる**
 * (`byPrefectureCode` の側から組むと、飲んだ県だけの表になって未進出が消える)。
 *
 * `count` 順の第2キーは JIS コード昇順で、`computeStats` の `prefectures` と同じ全順序。
 * ここで別の第2キーを使うと、統計画面の並びと産地画面の並びが同数県で入れ替わる。
 */
export function buildPrefectureRows(
  byPrefectureCode: ReadonlyMap<number, number>,
  order: PrefectureOrder,
): readonly PrefectureRow[] {
  const rows: PrefectureRow[] = PREFECTURE_NAMES.map((name, index) => {
    const code = index + 1
    const count = byPrefectureCode.get(code) ?? 0
    return { code, name, count, step: fillStepIndex(count) }
  })
  if (order === 'jis') return rows
  return rows.sort((a, b) => (a.count !== b.count ? b.count - a.count : a.code - b.code))
}

/**
 * 段ごとの県数(凡例に併記する)。**0段目は「47 - 出現した県数」で出す** —
 * `prefectures` は0本の県を含まないので、そこから数えると未進出が常に0県になる。
 *
 * `prefectures` に万一0本の行が混ざっても二重に数えない(0本は0段目の計算にだけ効かせる)。
 */
export function countPrefecturesByStep(
  prefectures: readonly PrefectureCount[],
  prefectureTotal: number = PREFECTURE_TOTAL,
): readonly number[] {
  const counts = FILL_STEPS.map(() => 0)
  let visited = 0
  for (const prefecture of prefectures) {
    if (prefecture.count <= 0) continue
    visited += 1
    counts[fillStepIndex(prefecture.count)] += 1
  }
  counts[0] = Math.max(0, prefectureTotal - visited)
  return counts
}
