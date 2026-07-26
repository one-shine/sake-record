// 記録集合 → 数。**アプリの中で「本数を数える」実装はここ1箇所**(受け入れ基準 A10)。
//
// 同じ数を2箇所で数えると必ずドリフトする。取り込みスクリプトにも画面にも年別ヒストグラムや
// スタイル分布を書かない(画面はこの戻り値をそのまま並べるだけにする)。
//
// **ここが数えないもの**(境界を書いておかないと重複実装が生える):
//   - 紐付け状態の内訳と「フレーバー取得済み」の分母 …
//     `src/ui/ImportExport/importActions.ts` の `summarize()` と `src/domain/flavor.ts` が持つ。
//     **紐付け済み ≠ フレーバー取得済み**(実測 186 ≠ 185)という区別はあちら側の関心なので、
//     こちらに `linkStatus` の集計を足さない。
//   - 47都道府県の一覧(未進出県を含む) … `PREFECTURE_NAMES` と `byPrefectureCode` から
//     表示側が組む。0件の県をここが行として吐くと「未進出(0本)」と「集計の対象外(県が不明)」が
//     同じ形で並んでしまう。0本と不明は別物なので混ぜない。
//
// 純TS。`react` / `window` / `document` / `process` を参照しない(domain 層の規約)。

import { normalizePrefecture, prefectureCode, prefectureName } from './prefecture.ts'
import type { Rating, SakeRecord } from './types.ts'

// ---------------------------------------------------------------------------
// スタイル分布の語彙
// ---------------------------------------------------------------------------

/**
 * スタイル分布のカウント対象語。**配列の順が表示順**(細かい語 → 粗い語)。
 *
 * 数え方は**排他バケツではなく「重複あり」の部分一致**: `純米大吟醸` の1本は `大吟醸` にも
 * `純米` にも数える。したがって **件数の合計は総本数を超える**(実台帳203本で314)。
 * これは不具合ではなく定義なので、表示側は必ず「重複計上」と明記する(PHASE_6)。
 *
 * 対象は **`spec`(スペック列)だけ**。`note`(備考)を混ぜると数が変わる
 * (実台帳では `にごり` が 4 → 5 にずれる)。対象列はここと `computeStats` で固定し、
 * テスト(`stats.test.ts`)が「備考は数えない」を合成データで押さえている。
 *
 * 語を足す/直すと各件数と合計が動く。`stats.test.ts` の期待表(実台帳の実測値)も一緒に直すこと。
 * とくに**語の文字を打ち間違えると、その語だけが例外を出さずに永久に0件になる**
 * (`無濾過` の `濾`)。これを捕まえるのは `stats.test.ts` の3点で、**いずれもこの配列を
 * 出所にしない独立したリテラル**であることが検出力の条件:
 *   1. 「全語が発火する」 … 手書きの `STYLE_TERM_SAMPLE_SPECS`(語ごとのスペック例)を
 *      入力にして全語 ≥ 1 を見る。**この配列から入力を作ると恒真になる**(語をその語自身に
 *      当てるので綴りが何であれ一致する)。
 *   2. `noStyles()` と `EXPECTED_STYLE_COUNTS` … 語をリテラルキーで持つので綴りが動くと
 *      `toEqual` とキー突合(`Object.keys(...).sort()` vs `[...STYLE_TERMS].sort()`)が落ちる。
 *   3. `Dashboard.test.tsx` … 表示ラベルをリテラルで持つ。
 * なお**実台帳の件数そのもの**(43 / 45 / 51 / 112 / … / 延べ314)を実装に対して固定して
 * いるのは `src/integration/screens.test.tsx` の1箇所だけで、そこは `data/seed/` を持つ
 * 環境でしか走らない(CI では skip)。規則(重複計上 / `spec` 列のみ / 備考除外)は合成データで
 * CI でも守られている。
 */
export const STYLE_TERMS = [
  '純米大吟醸',
  '大吟醸',
  '純米吟醸',
  '純米',
  '本醸造',
  '生原酒',
  '無濾過',
  '原酒',
  'ひやおろし',
  'しぼりたて',
  'にごり',
] as const

export type StyleTerm = (typeof STYLE_TERMS)[number]

// スペックは `normalize()` に通さない。あれは銘柄名の照合キー用で、括弧内除去・空白除去・
// 異体字畳み・lowercase を行う(`純米大吟醸(限定)` の括弧の中身が消える)。スタイルの実測値
// (43 / 45 / 51 / 112 / …)は**生のスペック文字列に対する部分一致**で得た値なので、前処理を
// 挟むとその基準と合わなくなる。表記ゆれの吸収が必要になったらここに理由を書いて足す。
//
// (検索欄の方は生一致 OR 正規化一致の和集合で表記ゆれを吸収する。あちらは「打った文字が
//  含まれるか」で、こちらは「分布の定義」なので同じ規則にしない。実装は `searchRecord.ts`。)

/**
 * 1本がスタイル語に当たるか。**分布の集計(`computeStats`)と絞り込み(Timeline のピル)が
 * 同じ述語を通る**ための切り出し。別々に書くと、ピルで絞った行数とピルに出ている件数が
 * 静かに食い違う(どちらも例外を出さないので誰も気付けない)。
 *
 * 対象は `spec` だけ。`note` を混ぜると数が変わる(実台帳では `にごり` が 4 → 5)。
 */
export function matchesStyleTerm(record: SakeRecord, term: StyleTerm): boolean {
  return record.spec.includes(term)
}

/** 語彙は `STYLE_TERMS` の1箇所から引く(列挙を2箇所に書くと必ずドリフトする) */
const STYLE_TERM_SET: ReadonlySet<string> = new Set<string>(STYLE_TERMS)

/**
 * 表示層が受け取った文字列キーを `StyleTerm` に絞るための番人。
 * **定義域外のキーで「全件」に戻さない**(呼び側は無視する)ためにここを通す。
 */
export function isStyleTerm(value: string): value is StyleTerm {
  return STYLE_TERM_SET.has(value)
}

// ---------------------------------------------------------------------------
// 戻り値の形
// ---------------------------------------------------------------------------

/** `year` は 'YYYY'(`drankOn` の先頭4桁) */
export type YearCount = { year: string; count: number }

/** `code` は JIS 1..47、`name` は areas.json の日本語県名 */
export type PrefectureCount = { code: number; name: string; count: number }

/** 県名として解決できなかった表記。記録の値をそのまま入れる(`静岡県または京都府` など) */
export type UnresolvedPrefectureCount = { label: string; count: number }

export type StyleCount = { term: StyleTerm; count: number }

export type RatingCount = { rating: Rating; count: number }

export type Stats = {
  /** 記録の総数。下の「別枠」も含めた全件 */
  total: number
  /**
   * 年別。**昇順(古い年が先)** — 画面は左から右に時間が流れる並びで描く。
   *
   * **観測された年だけを返し、間の年を0件で埋めない。** 埋めると `drankOn` に誤入力の年が
   * 1つ入った瞬間に空の年が数十行生まれてヒストグラムが読めなくなる。等間隔に並べたい
   * 表示側が `year` の値から補完する(どの範囲を描くかは表示の関心)。
   */
  years: readonly YearCount[]
  /**
   * `drankOn` が 'YYYY-MM-DD' でない件数。**年のバケツに入れない**
   * (先頭4桁を無条件に年として使うと、空文字や壊れた値からでっち上げの年ができる)。
   */
  undatedCount: number
  /**
   * `prefectureCode()` で解決できた県だけ。**件数の降順 → JIS コードの昇順**。
   * 0件の県は含まない(未進出県の行は表示側が47県の表から組む)。
   */
  prefectures: readonly PrefectureCount[]
  /**
   * `prefectures` と同じ値の JIS コード索引(地図の塗り分け用)。
   * **未出現の県はキーを持たない。** 読む側は `?? 0` で0本として扱う
   * (定義域外のキーに「全件」や既定の県を返さない)。
   */
  byPrefectureCode: ReadonlyMap<number, number>
  /**
   * 空ではないが県名として解決できなかった表記。**件数の降順 → 表記のコードポイント昇順**。
   * 実台帳では `静岡県または京都府` の1本。**「その他」や近い県に丸めない**(不確実性を残す)。
   */
  unresolvedPrefectures: readonly UnresolvedPrefectureCount[]
  /** 県が空(`null` / 空文字 / 空白のみ)の件数。実台帳では5本 */
  noPrefectureCount: number
  /** `STYLE_TERMS` の順。**重複計上**なので合計は `total` を超える */
  styles: readonly StyleCount[]
  /** `styles` の件数の合計。**`total` を超えるのが正しい**(重複計上の見出し用) */
  styleTotal: number
  /** 1語以上に一致した記録数。`total - styleMatchedCount` が「スペック未記入か語彙の外」 */
  styleMatchedCount: number
  /** 1..5 の昇順。**0件の段も行として返す**(棒が消えると分布が読めない) */
  ratings: readonly RatingCount[]
  /** 1..5 のどれでもない件数(`rating: null` の未評価。壊れた値もここに落ちる) */
  unratedCount: number
}

// ---------------------------------------------------------------------------

/** 'YYYY-MM-DD' 全体に一致させる。先頭4桁を切るだけでは日付でない文字列も年になる */
const DRANK_ON_RE = /^(\d{4})-\d{2}-\d{2}$/

/**
 * 空の評価分布。**`Record<Rating, number>` のリテラルなので、`Rating` に段が増えたら
 * ここがコンパイルエラーになる**(列挙を別の配列で持つと、増えた段が例外を出さずに
 * 未評価へ混ざって分布が静かに嘘になる)。
 */
function emptyRatingCounts(): Record<Rating, number> {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
}

function bump<K>(counts: Map<K, number>, key: K): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

/**
 * 文字列の並び。**件数の降順で同数になったときの第2キー**にも使う。
 * 第2キーを置かないと同数バケツの順序が入力の並び任せになり(実台帳には3本の県が6つ、
 * 1本の県が8つある)、記録を1件足しただけで画面の行が入れ替わる。
 */
function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * 記録の集合を数える純関数。**入力を変更しない / 入力の並びに依存しない**
 * (同じ多重集合なら並びが違っても同じ戻り値になる)。
 */
export function computeStats(records: readonly SakeRecord[]): Stats {
  const yearCounts = new Map<string, number>()
  let undatedCount = 0

  const prefectureCounts = new Map<number, { name: string; count: number }>()
  const unresolvedCounts = new Map<string, number>()
  let noPrefectureCount = 0

  // 0で初期化しておく。出現しなかった語も行として返す
  // (`本醸造` の0は「壊れている」ではなく実測値。語ごと消すと0と未検査が区別できない)
  const styleCounts = new Map<StyleTerm, number>(STYLE_TERMS.map((term) => [term, 0]))
  let styleTotal = 0
  let styleMatchedCount = 0

  const ratingCounts = emptyRatingCounts()
  let unratedCount = 0

  for (const record of records) {
    // --- 年 ---
    const year = DRANK_ON_RE.exec(record.drankOn)?.[1]
    if (year === undefined) undatedCount += 1
    else bump(yearCounts, year)

    // --- 都道府県 ---
    // 空文字・空白のみは「県が未記入」。県名として引けないのは `静岡県または京都府` と同じだが、
    // 同じ枠に混ぜると**本当に曖昧な表記**が未記入に埋もれる(実台帳では 5 と 1)。数え分ける。
    // 未記入の判定は `normalizePrefecture` の1箇所に持つ(表示側も同じ関数を通す)。
    const label = normalizePrefecture(record.prefecture)
    if (label === null) {
      noPrefectureCount += 1
    } else {
      const code = prefectureCode(label)
      if (code === null) {
        bump(unresolvedCounts, label)
      } else {
        const bucket = prefectureCounts.get(code)
        if (bucket) bucket.count += 1
        // 表示名はコードから引き直して areas.json 由来の表記に揃える(記録側の前後空白を落とす)
        else prefectureCounts.set(code, { name: prefectureName(code) ?? label, count: 1 })
      }
    }

    // --- スタイル(重複あり部分一致。**`spec` だけを見る**。`note` を足さない) ---
    let matched = false
    for (const term of STYLE_TERMS) {
      // 1本の中に同じ語が2回出ても1件。分布の単位は「本数」なので出現回数では数えない。
      // 述語は絞り込み側と共有する(2つ書くと件数と行数が食い違う)
      if (!matchesStyleTerm(record, term)) continue
      styleCounts.set(term, (styleCounts.get(term) ?? 0) + 1)
      styleTotal += 1
      matched = true
    }
    if (matched) styleMatchedCount += 1

    // --- 評価 ---
    // 列挙外の値(壊れた DB からの 0 や 7)は段に足さない。undefined + 1 = NaN を画面に出さない
    const rating = record.rating
    if (rating !== null && Object.hasOwn(ratingCounts, rating)) ratingCounts[rating] += 1
    else unratedCount += 1
  }

  const prefectures: PrefectureCount[] = [...prefectureCounts.entries()]
    .map(([code, bucket]) => ({ code, name: bucket.name, count: bucket.count }))
    .sort((a, b) => b.count - a.count || a.code - b.code)

  return {
    total: records.length,
    years: [...yearCounts.entries()]
      .map(([year, count]) => ({ year, count }))
      // 'YYYY' は固定長なのでコードポイント順 = 年の昇順
      .sort((a, b) => byCodePoint(a.year, b.year)),
    undatedCount,
    prefectures,
    byPrefectureCode: new Map(prefectures.map((entry) => [entry.code, entry.count])),
    unresolvedPrefectures: [...unresolvedCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || byCodePoint(a.label, b.label)),
    noPrefectureCount,
    styles: STYLE_TERMS.map((term) => ({ term, count: styleCounts.get(term) ?? 0 })),
    styleTotal,
    styleMatchedCount,
    // キーは emptyRatingCounts() のリテラル由来。数値キーの列挙順に依らせず昇順に並べ直す
    ratings: Object.entries(ratingCounts)
      .map(([rating, count]) => ({ rating: Number(rating) as Rating, count }))
      .sort((a, b) => a.rating - b.rating),
    unratedCount,
  }
}
