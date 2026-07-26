// 記録1件を検索語に当てる述語。**Timeline から出してある**のは、正規化の分岐と
// 「正規化後に空になる needle」のガードが CI で走る単体テストを要るロジックだから
// (`src/integration/` の実データ依存テストは `data/seed/` が無い CI では skip されるので、
//  検索の正しさを CI で守る場所がそこにしか無い)。
//
// 純TS。`react` / `window` / `document` / `process` を参照しない(domain 層の規約)。
//
// ## 検索対象は5フィールド
//
// **銘柄(記録の生の表記とさけのわの銘柄名の両方) / スペック / 場所 / メモ**。
// スペックは `RecordCard` と `RecordDetail` が画面に出しているのに検索できていなかった
// (見えている文字列が打てないのは「入っているのに出ない」の一種)。
//
// ## 生一致 OR 正規化一致(和集合)
//
// 以前この述語は正規化を通していなかった。理由として「括弧内除去や異体字畳み込みが効くと
// 『打った文字が入っているのに出ない』が起きる」と書いてあったが、それは**正規化一致で
// 生一致を置き換えた場合**の話で、和集合にすれば起きない:
//
//   - 生一致は残るので、**画面に見えている文字列で当たる保証は失われない**
//     (`寒菊(OCEAN99)` の `OCEAN99` は正規化すると括弧ごと消えるが、生一致で当たる)
//   - 増えるのは「打っていない表記でも当たる」側だけで、その増分が表記ゆれの吸収そのもの
//     (`写楽` で `寫楽` の記録が出る / 半角カナで打っても出る)
//
// 述語の追加は単調なので、和集合にして取りこぼしが増えることは構造的に起きない。
//
// ## 正規化は**フィールドごとに**行う(結合してからでは駄目)
//
// `normalize()` は `\s+ → ''` なので、フィールドを `\n` で結合してから正規化すると区切りの
// 改行まで消える。`place: '自宅'` + `note: '酒'` が `自宅酒` という1つの文字列になり、
// **フィールドを跨いだ部分一致**(`宅酒` で当たる)が生まれる。各フィールドを正規化してから
// 結合する。

import { normalize } from './normalize.ts'
import type { SakeRecord } from './types.ts'

/**
 * フィールドの区切り。**検索語には現れない文字**でなければならない
 * (`<input type="search">` に改行は打てない)。
 */
const FIELD_SEPARATOR = '\n'

/**
 * 1件ぶんの検索テキスト。**生と正規化の2本**を持つ。
 *
 * 記録の集合ごとに1回だけ組んで使い回すための形(打鍵ごとに 203本 × 5フィールドの NFKC を
 * 回さない)。呼び側は `buildSearchText` の戻り値をそのまま持ち回す。
 */
export type SearchText = {
  /** 各フィールドを lowercase して `\n` で連ねたもの。**見えている文字列そのまま** */
  raw: string
  /** 各フィールドを `normalize()` してから `\n` で連ねたもの */
  norm: string
}

/**
 * 検索対象のフィールド。**「何を検索できるか」を決めるのはこの1箇所**
 * (増やしたら `Timeline` の `aria-label` / `placeholder` も直す — 打てる場所と
 *  当たる場所が食い違うと、本人は「入っているのに出ない」としか観測できない)。
 */
function fieldsOf(record: SakeRecord): readonly string[] {
  return [record.brandName ?? '', record.brandLabel, record.spec, record.place, record.note]
}

export function buildSearchText(record: SakeRecord): SearchText {
  const fields = fieldsOf(record)
  return {
    raw: fields.map((field) => field.toLowerCase()).join(FIELD_SEPARATOR),
    // **結合前に1フィールドずつ正規化する**(結合してからでは区切りの改行が消える)
    norm: fields.map((field) => normalize(field)).join(FIELD_SEPARATOR),
  }
}

/**
 * 検索語に当たるか。空(空白だけ)の検索語は**絞り込みなし**なので true。
 *
 * ★ **正規化後の needle が空になる入力を通してはいけない。** `()` や `【】` だけを打つと
 * `normalize()` は空文字を返し、`''.includes` は常に true = **全件が一致**する。
 * 「ルックアップのキーが定義域外のとき結果が全件にフォールバックしてはならない」の直撃違反
 * なので、空になった時点で正規化側の枝を捨てる(生一致だけで判定する)。
 */
export function matchesQuery(text: SearchText, query: string): boolean {
  const raw = query.trim().toLowerCase()
  if (raw === '') return true
  if (text.raw.includes(raw)) return true
  const norm = normalize(query)
  if (norm === '') return false
  return text.norm.includes(norm)
}
