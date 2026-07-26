// 都道府県の 日本語名 ⇄ JIS コード(1..47) ⇄ romaji の相互変換。
//
// 日本語県名は さけのわ areas.json を**単一の出所**にする。県名テーブルを自前で持つと、
// 紐付け側(蔵元 → areaId → 県名 と辿る経路)が使う名前と二重管理になり、
// 同じ県が2種類の文字列で存在する状態にドリフトする。ここでは並べ替えも改名もしない。
//
// areas.json を相対パスで import している。public/ 配下は Vite が「変換せず dist へコピーする」
// 領域だが、相対パス import は通常のファイルとして解決されバンドルに inline される
// (vitest での解決と tsc の JSON 型推論の両方を実測して確認した)。
// 代替案の「テーブル注入」を採らないのは、prefectureCode/prefectureName が UI・store・集計から
// 同期的に呼ばれる素の関数で、注入形にすると呼び出し側全員が areas を持ち回ることになるため。
// import で解決するので fetch も jsdom も不要 = domain の純度(react/window/document/process 非依存)は保てる。
// 619バイトが二重に出荷される(バンドル + dist/data/sakenowa/areas.json)のは許容する。

import type { AreasFile } from './types.ts'
import areasJson from '../../public/data/sakenowa/areas.json'

const areas: AreasFile = areasJson

/**
 * JIS コード順の romaji。**添字 = code - 1**(47要素。areas.json の添字とは1ずれる)。
 *
 * `@svg-maps/japan` の location id 47件と完全一致する(prefecture.test.ts が固定する)。
 * パッケージ側はアルファベット順で JIS 順の情報を持たないので、そこから派生させずここに並べる。
 */
export const PREFECTURE_ROMAJI: readonly string[] = [
  'hokkaido',
  'aomori',
  'iwate',
  'miyagi',
  'akita',
  'yamagata',
  'fukushima',
  'ibaraki',
  'tochigi',
  'gunma',
  'saitama',
  'chiba',
  'tokyo',
  'kanagawa',
  'niigata',
  'toyama',
  'ishikawa',
  'fukui',
  'yamanashi',
  'nagano',
  'gifu',
  'shizuoka',
  'aichi',
  'mie',
  'shiga',
  'kyoto',
  'osaka',
  'hyogo',
  'nara',
  'wakayama',
  'tottori',
  'shimane',
  'okayama',
  'hiroshima',
  'yamaguchi',
  'tokushima',
  'kagawa',
  'ehime',
  'kochi',
  'fukuoka',
  'saga',
  'nagasaki',
  'kumamoto',
  'oita',
  'miyazaki',
  'kagoshima',
  'okinawa',
]

/** JIS コードの上限。県は47。areas.json は48行あるが**添字0は「その他」で県ではない** */
const PREFECTURE_COUNT = PREFECTURE_ROMAJI.length

/**
 * 日本語県名。**添字 = code - 1**。areas.json の rows[1..47] をそのまま採る
 * (rows[0] の「その他」は落とす)。件数が47であることは prefecture.test.ts が固定する。
 */
export const PREFECTURE_NAMES: readonly string[] = areas.rows.slice(1, 1 + PREFECTURE_COUNT)

const CODE_BY_NAME = new Map<string, number>(
  PREFECTURE_NAMES.map((name, index) => [name, index + 1]),
)

const CODE_BY_ROMAJI = new Map<string, number>(
  PREFECTURE_ROMAJI.map((romaji, index) => [romaji, index + 1]),
)

function isPrefectureCode(code: number): boolean {
  return Number.isInteger(code) && code >= 1 && code <= PREFECTURE_COUNT
}

/**
 * 県名 → JIS コード(1..47)。**未知・空・「その他」・`静岡県または京都府` は null**。
 *
 * 定義域外のキーを「全件」や「その他(0)」に落としてはいけない。ここが緩むと
 * 都道府県の絞り込みが無効化され、別県の同名銘柄に誤紐付けする(`Beau Michelle` の実例)。
 * 表記ゆれの吸収もしない(ログの県名は5本の空欄と `静岡県または京都府` 1本以外すべて
 * areas.json と完全一致するので、一致しない値は「県が確定していない」記録である)。
 */
export function prefectureCode(name: string | null | undefined): number | null {
  if (!name) return null
  return CODE_BY_NAME.get(name) ?? null
}

/**
 * 記録の `prefecture` を「県の表記」か「未記入(`null`)」の2値に寄せる。**未記入の判定の唯一の実装。**
 *
 * `SakeRecord.prefecture` は同じ「未記入」を3通りの形で持つ:
 *   - `null`  … 取り込み(`store/records.ts` の `blankToNull`)が畳んだ形
 *   - `''`    … バックアップ JSON をそのまま復元した形(`backupSchema` は nullable string を通す)
 *   - 空白のみ … 手入力・コピー&ペースト由来
 * 呼ぶ側が `value ?? '未記入'` と書くと `''` では発火せず、**ラベルが空の要素**が画面に出る
 * (記録タブのピルと詳細の都道府県欄で実測)。集計側(`computeStats`)は3通りを畳んでいるので、
 * 表示側が畳まないと**同じ記録の集合が画面ごとに別の数・別の名前になる**。
 *
 * **表記ゆれは吸収しない。** 落とすのは前後の空白だけで、`静岡県または京都府` のような
 * 「県が1つに決まらない表記」は原文のまま返す(未記入と曖昧は別の束。数え分けるのは `stats.ts`)。
 */
export function normalizePrefecture(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * 未記入の束(`normalizePrefecture` が `null` を返す記録)の表示名。**画面をまたぐ単一の出所。**
 *
 * 同じ束を記録タブが「県なし」、産地タブが「県の記入なし」、統計タブが「都道府県が未記入」と
 * 3通りに呼んでいて、別の概念に見えていた。県名の出所(`PREFECTURE_NAMES`)の隣に置いて、
 * 「県が無い場合の名前」も県名テーブルと同じ1箇所から引く。
 */
export const NO_PREFECTURE_LABEL = '都道府県が未記入'

/** JIS コード → 日本語県名。範囲外・非整数・0(その他) は null */
export function prefectureName(code: number): string | null {
  if (!isPrefectureCode(code)) return null
  // areas.json が上流で縮んでも undefined を string として返さないための ?? null
  return PREFECTURE_NAMES[code - 1] ?? null
}

/** JIS コード → romaji。範囲外・非整数・0(その他) は null */
export function prefectureRomaji(code: number): string | null {
  if (!isPrefectureCode(code)) return null
  return PREFECTURE_ROMAJI[code - 1] ?? null
}

/**
 * romaji → JIS コード。`@svg-maps/japan` の location.id をそのまま渡す前提なので
 * 大文字・別表記(`Hokkaido` / `tōkyō`)は吸収しない。未知は null。
 */
export function codeFromRomaji(romaji: string): number | null {
  return CODE_BY_ROMAJI.get(romaji) ?? null
}
