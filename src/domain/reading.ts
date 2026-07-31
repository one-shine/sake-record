// 銘柄名を**読み**で照合する層(B68)。
//
// ## なぜ要るのか
//
// ラベルの銘柄名は筆文字・草書で刷られていることが多く、**字形からは OCR で読めない**
// (2026-07-31 に tesseract と PP-OCRv4 の2種で実測して確定 = B67)。一方で**読みは別の形で
// 写真に写っている**: 宮泉のふりがな `みやいずみ` は現行の tesseract が正確に読めていて、
// 照合できるデータが無いという理由だけで捨てていた。打って探す経路も同じ穴で塞がっている
// (`きど` で `紀土` に届かない)。**1つのデータで OCR と手打ちの両方が同時に伸びる**。
//
// ## 読みを「展開」しない
//
// 銘柄ごとに読みを列挙すると **3264銘柄で 409,875通り**になる(実測)。だから展開はせず、
// **「与えられたかなを銘柄名の読みに分解できるか」を判定する向き**だけを持つ。字ごとの読みは
// 音+訓+名乗りを畳んで 1231字 / gzip 15.9KB(`scripts/fetch-kanji-readings.mjs`)。
//
// ## 2つの入口を分けてある(門の強さが違う)
//
// - `search(かな)` … **人が打った**文字列。1文字から効く。誤爆しても本人が見て選ぶだけなので
//   門を設けない。
// - `find(文字列)` … **OCR が読んだ**文字列。こちらは雑音の海なので**5文字以上の読みしか
//   採らない**(下の `MIN_TEXT_READING_LENGTH` の実測を読む)。
//
// これは「候補の門を緩めるのではなく人が押す道を用意する」という既存の規律と同じ形で、
// **自動で出す側だけを締める**。

/** `public/data/kanji/readings.json` の形。値はカンマ区切りのカタカナ */
export type KanjiReadingsFile = {
  readonly copyright: string
  readonly chars: Readonly<Record<string, string>>
}

/** 漢字 → その字の読み(カタカナ)。定義域外は `undefined`。**全件に落ちない** */
export type KanjiReadings = ReadonlyMap<string, readonly string[]>

export function decodeKanjiReadings(raw: KanjiReadingsFile): KanjiReadings {
  const out = new Map<string, readonly string[]>()
  for (const [char, joined] of Object.entries(raw.chars)) {
    const list = joined.split(',').filter((r) => r !== '')
    if (list.length > 0) out.set(char, list)
  }
  return out
}

/**
 * OCR が読んだ文字列から候補を出すときの**読みの最短の長さ**(カタカナの文字数)。
 *
 * **実測で決めた値**。利用者の実写真5枚の読み取り(403〜1,620字の誤読を含む)から、かなの
 * 連なりの全ての部分文字列を銘柄名の読みに照合した結果:
 *
 *   2文字以上 … 読み 19〜89通りが当たり、**銘柄 35〜129件**が候補になる(`ココ` `ササ` `カカ` など)
 *   3文字以上 … 2〜15通り / 3〜18件。まだ `マイイ` `タリフ` のような当てずっぽうが残る
 *   4文字以上 … 0〜3通り。5枚で誤りが1件だけ残る(`トトサト`)
 *   5文字以上 … **5枚を通して当たったのは `ミヤイズミ` → 宮泉 の1件だけ**(誤り 0)
 *
 * → 5。`ビキニ娘` の再発(2文字の雑音が4文字の銘柄を通す)を数字で防いでいる。
 * **緩めるなら同じ手順で測り直すこと** — 4文字にすると実写真1枚で誤りが出る。
 */
export const MIN_TEXT_READING_LENGTH = 5

/** 繰り返し記号。**直前の字の読みを引き継ぐ**(`佐々成政` = サ + サ) */
const ITERATION_MARK = '々'

const HIRAGANA_RE = /[ぁ-ゖ]/gu
/** かな(カタカナに寄せたあと)と長音符の連なり。**`g` 付きなので `test` に使わない** */
const KANA_RUN_RE = /[ァ-ヺー]+/gu
/** 上と同じ字種の1文字判定。`lastIndex` を持つ正規表現を `test` に使い回すと結果が1回おきに化ける */
const KANA_CHAR_RE = /^[ァ-ヺー]+$/u

/** ひらがな → カタカナ。読み表はカタカナで持つので、突き合わせる両側をここに通す */
export function toKatakana(s: string): string {
  return s.replace(HIRAGANA_RE, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
}

export type ReadingHit = {
  readonly brandId: number
  /** 当たった読み(カタカナ)。UI が「なぜ出たか」を見せられるように返す */
  readonly reading: string
  /** 読みの**先頭**から一致したか。並び順の根拠になる */
  readonly isPrefix: boolean
}

export type ReadingIndex = {
  /**
   * **人が打ったかな**で引く。読みの先頭一致と途中一致の両方を返す(`きど` → `紀土` /
   * `はっせん` → `陸奥八仙`)。**一致0件なら空配列** — 全件に落ちない。
   */
  search: (query: string) => ReadingHit[]
  /**
   * **OCR が読んだ文字列**から引く。銘柄名の読み**全体**がかなの連なりの中に現れるものだけを
   * 返し、`MIN_TEXT_READING_LENGTH` 未満の読みは採らない。`isPrefix` は常に true
   * (全体一致しか作らないため)。
   */
  find: (text: string) => ReadingHit[]
}

/** 索引を張る対象。`SakenowaBrand` をそのまま渡せる最小形 */
export type ReadableBrand = { readonly id: number; readonly name: string }

/** 「この銘柄の `start` 字目から読み始める」候補。`byFirstChar` の値 */
type Start = { entry: Entry; start: number }

type Entry = {
  brandId: number
  /** 1字ずつの読みの候補。`々` は解決済み。**空の段が1つでもあれば読みを作れない** */
  steps: readonly (readonly string[])[]
}

/**
 * 銘柄マスタと読み表を閉じ込めて照合関数を返す(`createLinker` / `createSuggester` と同じ注入形)。
 *
 * 索引はここで1回だけ張る。`search` は1キーストロークごとに走るので、構築時に
 * 「1字ずつの読みの候補」まで解いておき、以降は文字列比較だけにする。
 */
export function createReadingIndex(
  brands: readonly ReadableBrand[],
  readings: KanjiReadings,
): ReadingIndex {
  const entries: Entry[] = []
  // 読みの**1文字目** → そこから始まりうる (銘柄, 何字目) の組。`search` が1キーストロークごとに
  // 3264件 × 名前の字数だけ DP を回すのを避ける(実測で素の走査は1000クエリ 1,455ms、
  // この索引で 100ms 台に落ちる)。当たらないクエリほど効く
  const byFirstChar = new Map<string, Start[]>()
  // 読みの先頭 → その読みで始まりうる銘柄。`find` が長い文字列を走査するために要る
  // (位置ごとに3264件を試すと実用にならない)
  const byFirstReading = new Map<string, Entry[]>()
  let maxFirstReadingLength = 0

  for (const brand of brands) {
    const chars = [...brand.name]
    const steps: (readonly string[])[] = []
    let usable = true
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i]
      // `々` は直前の**解決済みの段**をそのまま複製する(直前が読めなければこの字も読めない)
      const list =
        char === ITERATION_MARK
          ? (steps[i - 1] ?? [])
          : (readings.get(char) ?? fallbackReadings(char))
      if (list.length === 0) {
        usable = false
        break
      }
      steps.push(list)
    }
    // 読みを1つも作れない銘柄は索引に入れない。**推定で埋めない**(読めないことを隠さない)
    if (!usable || steps.length === 0) continue
    const entry: Entry = { brandId: brand.id, steps }
    entries.push(entry)
    for (const first of steps[0]) {
      const bucket = byFirstReading.get(first)
      if (bucket) bucket.push(entry)
      else byFirstReading.set(first, [entry])
      if (first.length > maxFirstReadingLength) maxFirstReadingLength = first.length
    }
    for (let start = 0; start < steps.length; start++) {
      const heads = new Set<string>()
      for (const reading of steps[start]) heads.add(reading[0])
      for (const head of heads) {
        const bucket = byFirstChar.get(head)
        if (bucket) bucket.push({ entry, start })
        else byFirstChar.set(head, [{ entry, start }])
      }
    }
  }

  return {
    search: (query) => searchByReading(byFirstChar, query),
    find: (text) => findInText(byFirstReading, maxFirstReadingLength, text),
  }
}

/**
 * 表に無い字の読み。**かなはその字自身**(銘柄名にかなが混ざるので、そこで分解を止めない)。
 * 漢字・ラテン・記号は空 = その銘柄は読みで引けない。
 */
function fallbackReadings(char: string): readonly string[] {
  const kata = toKatakana(char)
  return KANA_CHAR_RE.test(kata) ? [kata] : []
}

/**
 * `steps[from]` 以降を使って `query` を `at` から食べ切れるか。
 * 返すのは**食べ切った位置の集合**(空なら不成立)。
 */
function consume(steps: readonly (readonly string[])[], from: number, query: string, at: number) {
  let positions = [at]
  for (let i = from; i < steps.length; i++) {
    const next: number[] = []
    for (const p of positions) {
      for (const reading of steps[i]) {
        if (query.startsWith(reading, p)) {
          const to = p + reading.length
          if (!next.includes(to)) next.push(to)
        }
      }
    }
    if (next.length === 0) return []
    positions = next
  }
  return positions
}

/**
 * `steps[start]` から順に読みを当てて `key` を説明できるか。
 *
 * **打ち途中を通す**のがここの要点で、成立の形が2つある:
 * - `key` を丁度食べ切った(`きど` → `紀`+`土`)
 * - `key` が読みの**途中で尽きた**(`きゅ` → `宮`(キュウ)の頭)。これが無いと1字ずつの
 *   入力でサジェストが点滅する
 */
function matchesFrom(steps: readonly (readonly string[])[], start: number, key: string): boolean {
  let positions = [0]
  for (let i = start; i < steps.length; i++) {
    const next: number[] = []
    for (const p of positions) {
      for (const reading of steps[i]) {
        if (reading.startsWith(key.slice(p))) return true
        if (key.startsWith(reading, p)) {
          const to = p + reading.length
          if (to === key.length) return true
          if (!next.includes(to)) next.push(to)
        }
      }
    }
    if (next.length === 0) return false
    positions = next
  }
  return false
}

/**
 * 人が打ったかなで引く。読みの**先頭一致**と**途中一致**(銘柄名の途中の字から始まる)の
 * 両方を見る(`きど` → `紀土` / `はっせん` → `陸奥八仙`)。
 *
 * ここに長さの門は無い。**押すのは本人**なので、外した候補は見て飛ばせばよく、
 * 1文字目から反応しないほうが害が大きい(自動で出す `find` とは非対称でよい)。
 */
function searchByReading(
  byFirstChar: ReadonlyMap<string, readonly Start[]>,
  query: string,
): ReadingHit[] {
  const key = toKatakana(query.trim())
  if (key === '') return []
  // 1文字目で候補を絞る。**先頭一致を優先して残す**ので、同じ銘柄が2度出ない
  const best = new Map<number, boolean>()
  for (const { entry, start } of byFirstChar.get(key[0]) ?? []) {
    if (best.get(entry.brandId) === true) continue
    if (!matchesFrom(entry.steps, start, key)) continue
    const isPrefix = start === 0
    if (!best.has(entry.brandId) || isPrefix) best.set(entry.brandId, isPrefix)
  }
  return [...best].map(([brandId, isPrefix]) => ({ brandId, reading: key, isPrefix }))
}

/**
 * OCR が読んだ文字列から引く。かなの連なりを切り出し、位置ごとに
 * 「その位置から始まりうる銘柄」だけを索引で絞ってから分解を試す。
 */
function findInText(
  byFirstReading: ReadonlyMap<string, readonly Entry[]>,
  maxFirstReadingLength: number,
  text: string,
): ReadingHit[] {
  const best = new Map<number, ReadingHit>()
  const kana = toKatakana(text)
  for (const run of kana.match(KANA_RUN_RE) ?? []) {
    for (let at = 0; at < run.length; at++) {
      for (let len = 1; len <= maxFirstReadingLength && at + len <= run.length; len++) {
        const candidates = byFirstReading.get(run.slice(at, at + len))
        if (candidates === undefined) continue
        for (const entry of candidates) {
          for (const end of consume(entry.steps, 1, run, at + len)) {
            const reading = run.slice(at, end)
            // **短い読みは採らない。** 雑音の中の2〜3文字は当てずっぽうにしかならない(実測)
            if (reading.length < MIN_TEXT_READING_LENGTH) continue
            const current = best.get(entry.brandId)
            // 同じ銘柄が複数の位置で当たったら**長いほうを残す**(証拠が強い)
            if (current === undefined || reading.length > current.reading.length) {
              best.set(entry.brandId, {
                brandId: entry.brandId,
                reading,
                isPrefix: true,
              })
            }
          }
        }
      }
    }
  }
  return [...best.values()]
}
