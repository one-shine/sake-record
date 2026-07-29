// OCR が吐いた雑なテキストから**銘柄の候補を絞る**。決めるのは人で、ここは候補と
// 「絞れなかった」という事実だけを返す(自動確定しない)。
//
// この層は純TS。OCR エンジン(tesseract.js = ブラウザ API 依存)は `src/lib/ocr/` に置き、
// ここには**読めた文字列**だけが渡ってくる。`createLinker` / `createSuggester` と同じ注入形
// (`createBrandMatcher(tables)` → 照合関数)にしてあるので、テーブルを import せず受け取る。
//
// ---------------------------------------------------------------------------
// 設計は実測から決めた。合成ラベル(clean な明朝体)に対する tesseract.js の出力はこうだった:
//   横書き「獺祭」  jpn      + PSM SINGLE_BLOCK → "獅祭"      (期待文字 1/2)
//   縦書き「獺祭」  jpn_vert + PSM AUTO        → "猟祭"      (期待文字 1/2)
//   縦書き「紀土」  jpn_vert + PSM AUTO        → "新十純米大吟醒" (期待文字 0/2)
// **実ラベルはこれより悪い**。つまりこの関数の入力は「1文字ずつ別の字に化けた短い文字列」で、
// 連続部分文字列も編集距離も当てにならない。**文字集合の重なりで照合するしかない。**
//
// そのうえで実測が突き付けた事実が3つある:
//   1. 一致文字数の単純な和で並べると、ありふれた誤読が候補欄を汚す。
//      "新十" は1文字共有で39件に一致し、上位は 新十津川 / 新政 / 三十六人衆 / 十四代 だった。
//      → **銘柄マスタ内の文字出現頻度の逆数(IDF)で重み付ける**(下の `idfOf`)。
//   2. ラベルにはスペックが必ず写り、**スペック語は銘柄名として実在する**。
//      "純米大吟醒"(醸→醒 の誤読)を素で照合すると117件に一致する(`純米大吟醸` という銘柄が
//      実在し「〜の純米大吟醸」も多い)。→ スペック語彙とラベル常出語を**先に除外する**。
//      語彙は `STYLE_TERMS` を import して再利用する(二重に持たない)。
//   3. 正解が候補に無いことがある。"新十" の正解「紀土」は39件のどこにも居ない。
//      → 閾値に届かなければ**候補を出さず** `tooWeak` で手動へ誘導する。
//      もっともらしい別銘柄を1位に出すのが最悪の挙動。
//
// ---------------------------------------------------------------------------
// **ブラウザで9枚を通した実測(2回とも同一)で、上の3つでは足りないことが分かった。**
// 正解を出せなかった5枚のうち**3枚で別銘柄を自信ありげに1位に出した**:
//   v2(紀土)→ 花垣 / shichiken(七賢)→ 一品 / kariho(刈穂)→ 渡辺あさ 山廃
// 原因は「希少性はゴミへの防御にならない」こと。**OCR のゴミ文字はまさに稀な字**なので、
// IDF は弾くどころか通す(実データで異なり字1418のうち932字 = 65.7% が df≤4、
// **3264銘柄のうち1270件(38.9%)が1文字一致だけで候補に上がれた**)。足した歯止めが2つ:
//   4. **部分一致は銘柄名の半分以上が読めているときだけ証拠にする**(`MIN_PARTIAL_COVERAGE`)。
//      1文字で上がれる銘柄が 1270件 → 472件(14.5%)に落ち、上の3枚は全部 `tooWeak` になる。
//      `獅祭` → `獺祭`(2字の1字 = 半分)は残る。
//   5. **ラベルのスペック語彙を足す**(`LABEL_SPEC_TERMS`)。`山廃` が語彙に無かったために
//      廃(df=1)+山 で「渡辺あさ 山廃」を全字一致として出していた。
// なお**信頼度の低いパスの出力を照合に流さない**のは OCR 側の責務で `src/lib/ocr/recognize.ts`
// の `selectMatchableResults` が持つ(この層に信頼度は渡ってこない)。
// ---------------------------------------------------------------------------

import { normalize } from './normalize.ts'
import { STYLE_TERMS } from './stats.ts'
import type { SakenowaBrand, SakenowaTables } from './types.ts'

// ---------------------------------------------------------------------------
// 除外語彙
// ---------------------------------------------------------------------------

/**
 * スペック語以外のラベル常出語。**銘柄名ではないのに必ず写るもの**だけを入れる。
 *
 * スペック語(`純米大吟醸` `無濾過` …)は `STYLE_TERMS` を再利用するのでここには書かない。
 * 数値と単位(`720ml` `1800ml` `15度` `精米歩合50%`)は語ではなく `NUMERIC_RE` で落とす。
 *
 * **除外の効きどころは「稀な字を含む常出語」**。`杜氏` の `杜` のようにマスタでは稀な字が
 * ラベルには必ず写るので、残すと**誤って自信のある候補**(越後杜氏 / 秋田杜氏 …)を作る。
 * 希少性で通してしまう語を先に落とすのがこの表の役割で、ありふれた字は IDF が勝手に沈める。
 *
 * **既知の代償**: これらの語を**銘柄名に含む銘柄は候補に上がりにくくなる**
 * (`酒造` 9件 = `町田酒造` `田中酒造` … / `杜氏` 8件 / `清酒` 4件。残った `町田` は部分一致に
 * なり希少性の閾値に届かない)。蔵元名の接尾語としての「酒造」はほぼ全てのラベルに写るので
 * ノイズを取るほうを選んだ。落ちたときは `tooWeak` = 手動サジェストに回るだけで、
 * **別の銘柄を1位に出すことはない**(外したときのコストを候補欄に載せない)。
 * なお**完全に語と同じ銘柄名は1件も無い**(`日本酒` `清酒` `酒造` … いずれも0件)ので、
 * 銘柄そのものを消してしまう組み合わせは今のマスタには存在しない。
 */
export const LABEL_TERMS = [
  '醸造アルコール',
  'アルコール分',
  'アルコール',
  '原材料名',
  '原材料',
  '精米歩合',
  '製造年月',
  '株式会社',
  '有限会社',
  '合資会社',
  '合名会社',
  '一升瓶',
  '四合瓶',
  '内容量',
  '使用米',
  '醸造元',
  '製造者',
  '日本酒',
  '清酒',
  '酒造',
  '精米',
  '歩合',
  '米麹',
  '蔵元',
  '杜氏',
  '度数',
] as const

/**
 * ラベルに写る**スペック語のうち `STYLE_TERMS` に無いもの**。除外したうえで `specTerms` に返す
 * (スペック欄に貼れる語なので `LABEL_TERMS` ではなくこちら)。
 *
 * **なぜ `STYLE_TERMS` に足さないか。** あれは統計の集計語彙で、実測値
 * (43 / 45 / 51 / 112 / … / 延べ314)がその11語に対する値として固定されている。
 * 銘柄照合の都合で語を足すと、無関係な統計の数字が黙って動く。集計語彙と
 * 「ラベルから除きたい語」は別の関心なので、表を分けて `TERM_TABLE` で合流させる。
 *
 * 収録の根拠は実測。`kariho.png`(刈穂)のラベルの「山廃純米」の `山廃` が照合に流れ、
 * **廃(3264件中1件) + 山 の全字一致**で「渡辺あさ 山廃」を1位に出した。同じ穴で
 * `特別純米` が `伯楽星 特別純米 限定` `龍の鼓動 特別純米酒` を候補欄に混ぜていた。
 *
 * `特別純米` ではなく `特別` で持つ。4文字以上の語には1文字の置換を許すので(下の `TERM_TABLE`)、
 * `特別純米` を入れると「特撰純米」が1置換で一致して**銘柄名の `特撰` まで食う**。
 * 2文字なら置換を許さないので、`特別` + `純米` の2語で同じ範囲を安全に覆える。
 *
 * **既知の代償**は `LABEL_TERMS` と同じで、これらを名前に含む銘柄は候補に上がりにくくなる
 * (`山廃` 1件 / `生酛` 2件 / `特別` 2件)。落ちたときは `tooWeak` = 手動サジェストに回るだけで、
 * 別の銘柄を1位に出すことはない。完全に語と同じ銘柄名は1件も無い。
 */
export const LABEL_SPEC_TERMS = ['特別', '山廃', '生酛', '生もと'] as const

/**
 * 数値と単位。**normalize() の後に当てる**(NFKC で全角数字と `ＭＬ` は畳まれ、lowercase 済み)。
 * `720ml` `1800ml` `15.5度` `50%` `180cc` を1つの塊として落とす。
 * 単位だけが残ると `ml` の `m`/`l` が照合文字として紛れ込む(ラテン1文字は銘柄名の同定に効かない)。
 *
 * **代償**: `666` `N-888` `UK-01` のように数字を含む銘柄名は数字の側では絞れなくなる。
 * ラベルの数字は容量・度数・精米歩合・年号が大半なので、ノイズを取るほうを選んだ。
 */
const NUMERIC_RE = /\d+(?:\.\d+)?(?:ml|l|cc|g|%|度)?/gu

/**
 * 照合に使う文字。**約物・記号は落とす。**
 *
 * 落とさないと記号だけの読み取りが候補を作る: `-` は3264件中4件の銘柄名にしか出ない
 * (`N-888` `UK-01` …)ので、希少性で見ると「非常に稀な一致」に化ける。記号は銘柄の同定に
 * 寄与しないので照合前に除く。`\p{L}` は漢字・かな・ラテン文字に加えて `ー` `々` `ヶ`(Lm)も含む。
 */
const CONTENT_RE = /\p{L}/u

type TermEntry = {
  /** 表示・返却する語(語彙の表記そのまま) */
  term: string
  /** 照合用に `normalize()` した文字配列 */
  key: readonly string[]
  /** 許容する置換数 */
  allow: number
  /** スペック欄に直接使える語か(`STYLE_TERMS` 由来なら true) */
  isSpec: boolean
}

/**
 * 除外語の照合表。**長い語から当てる**(`純米大吟醸` を消してから `純米` を当てないと、
 * 同じ場所が2回数えられて `specTerms` が `['純米大吟醸','純米','大吟醸']` に膨れる)。
 *
 * 許容置換数は **4文字以上の語だけ1文字**。実測の "純米大吟醒" は `純米大吟醸` の1文字置換
 * (5文字→5文字)なので、これが無いと117件のノイズが出る。**3文字以下を0にしているのは、
 * 3文字語に1文字の許容を与えると3文字の銘柄名を丸ごと食う危険があるから**
 * (除去は不可逆で、取りこぼしより過剰除去のほうが害が大きい)。
 *
 * 窓は**語と同じ長さに固定し、置換のみ**(ハミング距離)を許す。挿入・削除を許す編集距離だと
 * 長さ±1の窓が当たって**隣の銘柄文字を食う**: `土純米大吟醸` が `純米大吟醸` に距離1で
 * 一致して `土` まで消え、「紀土 純米大吟醸 平和酒造株式会社」から `紀土` が消えた(実測)。
 * OCR の誤りは1グリフ1文字の置換が主なので、置換だけ許すのが実測にも合っている。
 */
const TERM_TABLE: readonly TermEntry[] = [
  ...STYLE_TERMS.map((term) => ({ term, isSpec: true })),
  ...LABEL_SPEC_TERMS.map((term) => ({ term, isSpec: true })),
  ...LABEL_TERMS.map((term) => ({ term, isSpec: false })),
]
  .map(({ term, isSpec }) => {
    const key = [...normalize(term)]
    return { term, key, allow: key.length >= 4 ? 1 : 0, isSpec }
  })
  .sort((a, b) => b.key.length - a.key.length)

// ---------------------------------------------------------------------------
// 閾値
// ---------------------------------------------------------------------------

/**
 * 一致を信用する上限「期待件数」。**この1つの定数が `tooWeak` の全てを決める。**
 *
 * 一致した文字集合の希少性を「その文字を(独立と仮定して)全部含む銘柄が3264件中に何件
 * 期待されるか」に読み替えた値。IDF の和 `Σlog(N/df)` は `期待件数 = N·e^(-Σidf)` と
 * 一対一なので、閾値を「件数」で書ける(1文字なら期待件数 = その文字の df そのもの)。
 *
 * 4.5 に置いたのは実測の境界がここにあるから: df(祭)=2 / df(獅)=3 は通し、**df(新)=5 は
 * 落とす**。これで "獅祭" は `祭` が生き残り、"新十" は0件 = `tooWeak` になる。
 * **この門だけでは足りない**(稀な字はゴミからも出る)ので、部分一致には下の被覆率の門も掛ける。
 */
const MAX_EXPECTED_BRANDS = 4.5

/**
 * 部分一致に要求する被覆率の下限。**銘柄名の異なり字のうち、これだけ読めていなければ
 * 「その銘柄を見た」とは言わない。**
 *
 * 希少性(`MAX_EXPECTED_BRANDS`)だけでは足りないことが実測で分かった。**OCR のゴミ文字は
 * 稀な字**なので IDF はそれを弾かない — ブラウザでの9枚の実測で、conf 15 の1文字「垣」(df=4)や
 * conf 53 の「七覧」の `覧`(df=1)が閾値を通り、正解が候補に無いまま
 * 花垣 / 天覧山 を自信ありげに1位に出した。df≤4 の字は異なり字1418のうち932字(65.7%)あり、
 * **3264銘柄のうち1270件(38.9%)が1文字一致だけで候補に上がれる**状態だった。
 * まず 1/2 に置き(1270 → 472件)、**2026-07-28 に 2/3 へ上げた**。
 *
 * ## なぜ 1/2 では足りなかったか(利用者の実機報告)
 *
 * 実物の `宮泉` のラベルで **`ビキニ娘` が候補に出た**。4字の銘柄なので 1/2 は**雑音2字**で
 * 満たせてしまい、`ビ`(3264件中1件) `ニ`(2件) `キ`(7件) はどれも希少性の門を素通りする
 * (`ビキ` / `ニ娘` / `ビニ` のどれでも1位に出る)。一方**正解の `宮泉` は出せない** —
 * `宮`(11件) も `泉`(64件) も1字では希少性に届かないため。
 * **誤りだけが通り、正解は通らない**という最悪の非対称がここにあった。
 *
 * ## 2/3 にした根拠(実測)
 *
 *   1文字一致だけで候補に上がれる銘柄  472件 → **50件**(14.5% → 1.5%)
 *   マスタの字から一様に選んだ2文字で候補が出る率  48.7% → **6.9%**(4000回)
 *   写真ふうのラベル9枚: **誤った候補を出した枚数 2 → 0**、正解への到達は **6/9 のまま**
 *
 * 到達が落ちないのは、**落ちた分を「読めた字で絞る」(`createCharNarrower`)が拾うから**。
 * 1/2 を選んだ当時の記録には「2/3 に上げると `獺祭` が消えて再現率 4/9 → 2/9」とあるが、
 * それは**受け皿が無かった時点の話**で、いまは `獺祭` は `祭` のチップ1タップで1位に出る。
 * **門を緩めるのではなく人が押す道を用意する**という方針の帰結がこの数値。
 *
 * 残る 50件は**1字の銘柄名**(`作` `閃` `曙` …)で、全字一致なのでこの門では切れない
 * (希少性の門だけが効く)。ここは原理的な限界として受け入れる(→ B49)。
 */
const MIN_PARTIAL_COVERAGE = 2 / 3

/**
 * 一致した字が**読み取り文字列のどれだけ狭い範囲に収まっていなければならないか**。
 * 一致字数 `k` に対して、許す窓の長さは `k * MAX_MATCH_SPREAD + MATCH_SPREAD_SLACK`。
 *
 * ## なぜ要るか(利用者の実機報告。2026-07-28(5))
 *
 * 実物の写真で読めた文字は**異なり字 87**の雑音だった。この規模になると
 * **文字集合の重なりという模型そのものが壊れる** — 銘柄名の字が「読めた」のではなく、
 * 雑音がたまたま全部の字を含んでしまう。実測でこの1枚が
 * `Bange Yamada Hanjukunama`(12字中12字!) / `カフェSAKEしろいスパークリング`(17字中14字) /
 * `Wakanami Sparkling`(11字中11字) を**自信ありげに1位**に出した。
 * とくに**ラテン文字は26字しかない**ので、雑音にラテンが少し混ざるだけでローマ字表記の
 * 銘柄名(141件ある)が丸ごと覆われる。希少性(IDF)は全字一致では**和**を取るため、
 * 12字も当たれば必ず閾値を超える = 希少性の門はここで完全に無力。
 *
 * ## 何を見れば切れるか
 *
 * **位置。** ラベルに印字された銘柄名は1か所に固まって読まれる(`光會津-` のように隣接)。
 * 雑音が覆った銘柄名は、当たった字が87字の全域に散らばる。いままでこの層は文字を
 * **集合**としてしか見ておらず、位置の情報を丸ごと捨てていた。
 *
 * ## 値の根拠(実測)
 *
 * 正しい側の窓/一致字数は 1.0〜1.5(`會津` 2字が窓2 / `田酒` 2字が窓3)。
 * 雑音側は 5〜30。2.0 + 余裕2 に置くと、9枚の実測で正解を1件も落とさずに
 * 上の3件を含む雑音の候補が全部落ちる。
 */
export const MAX_MATCH_SPREAD = 2
export const MATCH_SPREAD_SLACK = 2

/**
 * ラテン文字と数字。**normalize() の後に当てる**(NFKC + lowercase 済み)。
 *
 * 近接の門を通っても**ローマ字表記の銘柄名だけは別の穴が残る**: 実機の読みには
 * `Femiurmsake` のような**連続したラテンのゴミ**(ラベルの小さな英字を誤読したもの)が
 * 出て、そこに `MIRU` `USUKI` `SUMI` `afs` の字が全部収まってしまう。原因は
 * **ラテンの字種が26しかない**こと — 漢字なら「その字が読めた」ことが強い証拠になるが、
 * ラテンでは連続した8字ほどのゴミが3〜5字の名前をほぼ必ず覆う。
 * 文字集合という模型がそもそも成り立たない字種なので、**綴りそのもの**を要求する。
 */
const LATIN_RE = /[a-z0-9]/u

/**
 * ラテンだけの銘柄名を候補にできる最短の長さ。**3字以下は綴りを要求しても足りない** —
 * 実測で `1ゃyurテラば` という誤読の中の `yu` が2字の銘柄 `Yu` に一致した。
 * 2〜3字の綴りは雑音にありふれて出るので、綴り一致は同定の証拠にならない。
 *
 * **代償**: 3字以下のラテンだけの銘柄(`Yu` `afs` など)は写真からは候補に上がらない。
 * 打って探す経路と「一覧から選ぶ」では従来どおり届くので、辿れなくなるわけではない
 * (`LABEL_TERMS` の除外で `酒造` を含む銘柄が上がりにくくなるのと同じ扱い)。
 */
const MIN_LATIN_ONLY_LENGTH = 4

/** 漢字・かな。1つでもあれば「文字集合で照合してよい字種」を含む銘柄名 */
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

/**
 * `seq` の中で、`needed` の字を**すべて含む最短の窓の長さ**を返す(古典的な最小窓)。
 * 1つでも現れない字があれば `Infinity`。
 */
export function minimumWindow(seq: readonly string[], needed: ReadonlySet<string>): number {
  if (needed.size === 0) return 0
  const have = new Map<string, number>()
  let satisfied = 0
  let best = Number.POSITIVE_INFINITY
  let left = 0
  for (let right = 0; right < seq.length; right++) {
    const ch = seq[right]
    if (!needed.has(ch)) continue
    const next = (have.get(ch) ?? 0) + 1
    have.set(ch, next)
    if (next === 1) satisfied += 1
    while (satisfied === needed.size) {
      best = Math.min(best, right - left + 1)
      const out = seq[left]
      left += 1
      if (!needed.has(out)) continue
      const rest = have.get(out)! - 1
      have.set(out, rest)
      if (rest === 0) satisfied -= 1
    }
  }
  return best
}

/**
 * 既定の候補上限。**人が見比べて選べる長さに切る**のが目的で、一致件数は行数で伝えない
 * (39件出すのは「絞れなかった」を隠したまま候補欄を汚すのと同じ)。
 */
export const DEFAULT_BRAND_MATCH_LIMIT = 5

// ---------------------------------------------------------------------------
// 戻り値の形
// ---------------------------------------------------------------------------

/**
 * 候補1件。**銘柄名だけでは足りない**: 同名4件の `高砂` を選び分けるには県と蔵元が要る
 * (`createSuggester` の `SuggestHit` と同じ理由)。
 */
export type BrandMatchCandidate = {
  brand: SakenowaBrand
  /** 銘柄 → 蔵 → エリアの都道府県名。蔵が引けない / areaId 0(その他) は `null` */
  prefecture: string | null
  /**
   * **表示できる蔵元名があるときだけ非 null。** さけのわの蔵元マスタには名前が空の行が
   * 48件あり(県ごとの「蔵元不明」の受け皿)、262件の銘柄がそこに属している。空文字を返すと
   * UI が空白を描いて「取得できている」ように見えるのでここで畳む(`SuggestHit` と同じ)。
   */
  breweryName: string | null
  /**
   * 並び順の根拠。**IDF の和 × 銘柄名の被覆率**(単位は nat)。
   * 絶対値に意味を持たせないこと(閾値判定は `score` ではなく希少性で行う。下の理由を参照)。
   */
  score: number
  /** 一致した文字。**稀な順**に並ぶので、UI はそのまま「この字で絞った」と出せる */
  matchedChars: string[]
  /**
   * 銘柄名の**異なり字**の数(`normalize()` 後)。`matchedChars.length / brandCharCount` が被覆率で、
   * これが**候補の強さそのもの**(全字読めた `田酒` と、2字のうち1字だけの `獺祭` は同じ重さではない)。
   * UI が「2字のうち1字が一致」と添えられるように返す — 行の見た目が全部同じだと、
   * 当たった候補と外れた候補を人が見分ける手がかりが無くなる。
   */
  brandCharCount: number
}

export type BrandMatchResult = {
  /** 得点降順。**`tooWeak` のときは空**(もっともらしい別銘柄を出さない) */
  candidates: BrandMatchCandidate[]
  /**
   * 希少性の閾値に届かなかった。UI は「読み取れなかった。手で選ぶ」を出して
   * **手動サジェストへ誘導する**。`candidates.length === 0` と常に等価。
   */
  tooWeak: boolean
  /**
   * 除外した**スペック語**(`STYLE_TERMS` 由来)。テキストに現れた順で重複なし。
   * 誤読していても**語彙の表記**を返す("純米大吟醒" → `純米大吟醸`)ので、UI はそのまま
   * スペック欄の補助入力に使える。
   */
  specTerms: string[]
  /**
   * 除外した**ラベル常出語**(`LABEL_TERMS` 由来)。`酒造` `株式会社` `精米歩合` など、
   * 除外はしたがスペック欄に入れるべきではないもの。**捨てずに分けて返す**
   * (UI が「ラベルからはこれも読めた」と出す材料。`specTerms` に混ぜると
   * `株式会社` がスペック欄に貼られる)。
   */
  labelTerms: string[]
}

/** `createBrandMatcher` が要求する最小の束。フレーバーは照合に要らないので含めない */
export type BrandMatcherTables = Pick<SakenowaTables, 'brands' | 'breweries' | 'areas'>

/**
 * 照合の入力。**配列は「1回の読み取り(パス)ごとの塊」**で、塊をまたいだ近さは見ない
 * (別々の読みから1字ずつ拾って銘柄名を組み立てるのは、近接の証拠にならない)。
 * 文字列を渡せば1つの塊として扱う。
 */
export type BrandMatchInput = string | readonly string[]

export type BrandMatcher = (text: BrandMatchInput, limit?: number) => BrandMatchResult

// ---------------------------------------------------------------------------

type IndexEntry = {
  brand: SakenowaBrand
  /** `normalize()` 済みの銘柄名。**ローマ字表記の銘柄はこの綴りで照合する** */
  key: string
  /**
   * 漢字もかなも含まない = **ラテン(と数字)だけの銘柄名**。3264件中の該当数は
   * `brandFromText.test.ts` が固定している。この銘柄は文字集合では照合しない。
   */
  latinOnly: boolean
  /** `normalize()` 済みの銘柄名の**異なる文字**。同じ字が2回出ても1回として数える */
  chars: ReadonlySet<string>
  /** クエリに依存しない部分。1回組んだら複製せずに使い回す(`brandCharCount` は `chars` から出す) */
  base: Omit<BrandMatchCandidate, 'score' | 'matchedChars' | 'brandCharCount'>
}

/**
 * 銘柄マスタを閉じ込めて照合関数を返す。**文字頻度表と転置索引はここで1回だけ構築する。**
 *
 * 3264件の `normalize()` を呼び出しごとに走らせない(写真1枚につき1回の経路とはいえ、
 * 頻度表は照合結果の重みそのものなので、作り直すたびに同じ値を再計算するのは無駄)。
 * 照合は「クエリの文字 → その字を含む銘柄」の転置索引を引くだけで、**全件走査もしない**。
 * `df`(その字を含む銘柄数)は転置索引の長さそのものなので、頻度表と索引は同じ1つの構造。
 */
export function createBrandMatcher({ brands, breweries, areas }: BrandMatcherTables): BrandMatcher {
  // areaId 0 は「その他」(海外蔵など)で都道府県ではない。県名として引けるようにすると
  // JIS 1..47 前提の産地マップや県一致の紐付けに定義域外の値が流れ込む(linkBrand と同じ規則)。
  const areaNameById = new Map(
    areas.filter((area) => area.id !== 0).map((area) => [area.id, area.name]),
  )
  const breweryById = new Map(breweries.map((brewery) => [brewery.id, brewery]))

  const index: IndexEntry[] = brands.map((brand) => {
    const brewery = breweryById.get(brand.breweryId)
    const breweryName = brewery?.name.trim() ?? ''
    const key = normalize(brand.name)
    return {
      brand,
      key,
      latinOnly: LATIN_RE.test(key) && !CJK_RE.test(key),
      chars: new Set(key),
      base: {
        brand,
        prefecture: brewery ? (areaNameById.get(brewery.areaId) ?? null) : null,
        breweryName: breweryName === '' ? null : breweryName,
      },
    }
  })

  /** 文字 → その字を含む銘柄の添字。**これが頻度表**(`df` = 配列の長さ) */
  const postings = new Map<string, number[]>()
  for (const [at, entry] of index.entries()) {
    for (const ch of entry.chars) {
      const bucket = postings.get(ch)
      if (bucket) bucket.push(at)
      else postings.set(ch, [at])
    }
  }

  const total = index.length
  /** `log(N/df)`。df は必ず1以上(索引に無い字は照合前に落ちる)なので 0 除算は起きない */
  const idfOf = (ch: string): number => Math.log(total / postings.get(ch)!.length)
  /**
   * 信用の下限。**マスタの件数に対する相対値**なので、月次更新で件数が動いても意味が変わらない
   * (「期待件数 4.5 件以下」という読みが保たれる)。テストの小さなテーブルでは負になり得るが、
   * それは「3件のマスタなら何を出しても4.5件以下」という定義どおりの帰結。
   */
  const minEvidence = Math.log(total / MAX_EXPECTED_BRANDS)

  return (text, limit = DEFAULT_BRAND_MATCH_LIMIT) => {
    // 塊(パス)ごとに正規化する。**塊をまたいだ近さは見ない**ので、ここで連結しない。
    // 正規化は normalize() に任せる(NFKC → 括弧内除去 → 空白除去 → 異体字 → lowercase)。
    // 銘柄名側も同じ関数を通しているので、ここで独自の前処理を足すと両側がずれる。
    const segments = typeof text === 'string' ? [text] : text
    const specTerms: string[] = []
    const labelTerms: string[] = []
    const seen = new Set<string>()
    /** 塊ごとの「索引に在る文字の並び」。**順序を保つ**(近接の判定に位置が要る) */
    const sequences: string[][] = []
    /** 塊ごとの正規化済み全文。ローマ字表記の銘柄名を綴りで照合するために持つ */
    const normalizedSegments: string[] = []

    for (const segment of segments) {
      const normalized = normalize(segment)
      normalizedSegments.push(normalized)
      const excluded = excludeTerms([...normalized.replace(NUMERIC_RE, '')])
      for (const hit of excluded.hits) {
        if (seen.has(hit.term)) continue
        seen.add(hit.term)
        ;(hit.isSpec ? specTerms : labelTerms).push(hit.term)
      }
      // 照合に使う文字。索引に無い字(誤読で生まれた字・記号・ラテン)はここで落ちる。
      const seq = [...excluded.rest].filter((ch) => CONTENT_RE.test(ch) && postings.has(ch))
      if (seq.length > 0) sequences.push(seq)
    }

    // **空になっても「全件」に広げない**(定義域外のキーでルックアップが全件に落ちてはならない)。
    const queryChars = [...new Set(sequences.flat())]
    if (queryChars.length === 0) {
      return { candidates: [], tooWeak: true, specTerms, labelTerms }
    }

    // 転置索引を引いて「1文字以上共有する銘柄」だけを集める。全件走査はしない。
    const matchedByBrand = new Map<number, string[]>()
    for (const ch of queryChars) {
      for (const at of postings.get(ch)!) {
        const bucket = matchedByBrand.get(at)
        if (bucket) bucket.push(ch)
        else matchedByBrand.set(at, [ch])
      }
    }

    const candidates: BrandMatchCandidate[] = []
    for (const [at, matched] of matchedByBrand) {
      const entry = index[at]
      const matchedIdf = matched.reduce((sum, ch) => sum + idfOf(ch), 0)
      // 銘柄名の**全ての字**が読み取れた文字集合に含まれているか。
      //
      // **ここで証拠の数え方を変えるのが `tooWeak` の設計の核**:
      //   - 全字一致は IDF の**和**で見る。銘柄名の字を全部見たのだから、複数の字の希少性を
      //     掛け合わせた(= 和を取った)証拠に意味がある。`大山`(和 7.02) `田酒`(7.05) のように
      //     ありふれた2字の銘柄も、和で見れば期待件数3件相当になって通る。
      //   - 部分一致は**最も稀な1字**で見る。読めなかった字が残っている = テキストと銘柄名は
      //     食い違っているのだから、共有した字が**その銘柄にほぼ固有**でなければ証拠にならない。
      //     和で見ると "新十" が `新十津川` に2字一致して和 11.02(期待件数 0.05)になり、
      //     正解「紀土」が候補に無いまま1位を自信ありげに出してしまう(実測)。
      //
      // **閾値を「得点の絶対値」や「1位と2位の差」に置く案は実測で否定された**:
      //   得点(IDF和×被覆率)  "獅祭"→獺祭 3.70 < "新十"→新十津川 5.51 … 出したい側が低い
      //   1位/2位の比          "獅祭" 1.59 < "新十" 1.70               … 同じく逆転する
      //   つまり `新十` は「証拠が弱い」のではなく「弱くない証拠が誤読から出ている」ので、
      //   強さの絶対値でも順位差でも切れない。切れるのは**共有した字の希少性**だけだった。
      const isFullCover = matched.length === entry.chars.size
      // 部分一致は**銘柄名の半分以上が読めている**ことを先に要求する。読めた字が稀かどうかは
      // その後の話で、順序を逆にすると「稀な1字」だけで長い銘柄名が上がってくる(実測の
      // 天覧山 / 渡辺あさ 山廃)。全字一致にこの門は要らない(被覆率は定義上 1)。
      if (!isFullCover && matched.length < entry.chars.size * MIN_PARTIAL_COVERAGE) continue
      const evidence = isFullCover ? matchedIdf : Math.max(...matched.map(idfOf))
      if (evidence < minEvidence) continue
      // **当たった字が1か所に固まっているか。** ここまでの門は文字を集合としてしか見て
      // いないので、読めた文字が多いほど「たまたま全部含む」銘柄が増える(実機の87字で
      // 12字の銘柄名が丸ごと覆われた)。ラベルの銘柄名は1か所に印字されるので、
      // **どれか1つの塊の中で近接している**ことを要求する。塊をまたいだ寄せ集めは
      // 近接の証拠にならない = 別々の読みから1字ずつ拾って名前を組み立てさせない。
      const needed = new Set(matched)
      let window = Number.POSITIVE_INFINITY
      for (const seq of sequences) window = Math.min(window, minimumWindow(seq, needed))
      if (window > matched.length * MAX_MATCH_SPREAD + MATCH_SPREAD_SLACK) continue
      // **ローマ字表記の銘柄名は綴りが読めたときだけ。** 字種が26しかないので、
      // 連続したラテンのゴミ(実機の `Femiurmsake`)が短い名前をほぼ必ず覆う。
      if (entry.latinOnly) {
        if (entry.key.length < MIN_LATIN_ONLY_LENGTH) continue
        if (!normalizedSegments.some((seg) => seg.includes(entry.key))) continue
      }
      candidates.push({
        ...entry.base,
        // 被覆率で割り引く: 読めた1字が2字の銘柄を指すのと5字の銘柄を指すのは同じ重さでない。
        // 門(`MIN_PARTIAL_COVERAGE`)を通った候補どうしの**順位**をここで決める —
        // 全字読めた `大山`(和 7.03 × 1.00)が、より稀な1字だけの `獺祭`(7.39 × 0.50)より上に来る。
        score: matchedIdf * (matched.length / entry.chars.size),
        // 稀な順。同じ希少性ならコードポイント順で並びを決定的にする
        matchedChars: [...matched].sort((a, b) => idfOf(b) - idfOf(a) || (a < b ? -1 : 1)),
        brandCharCount: entry.chars.size,
      })
    }

    // 得点降順 → 銘柄ID昇順。ID を最後に挟むのは同点の並びを決定的にするため
    // (`獅子の里` と `上田獅子` は共有字も被覆率も同じで、他のキーで区別できない)。
    candidates.sort((a, b) => b.score - a.score || a.brand.id - b.brand.id)

    // 上限は1未満に落とさない。**0件は「読み取れなかった」の意味に予約されている**ので、
    // 表示上限のせいで 0件 = tooWeak と見分けが付かない状態を作らない。
    const max = Number.isFinite(limit)
      ? Math.max(1, Math.floor(limit))
      : DEFAULT_BRAND_MATCH_LIMIT
    return {
      candidates: candidates.slice(0, max),
      // 候補が空 ⟺ tooWeak。UI はどちらを見ても同じ判断になる
      tooWeak: candidates.length === 0,
      specTerms,
      labelTerms,
    }
  }
}

type ExcludeHit = { term: string; isSpec: boolean; at: number }

/**
 * 除外語をテキストから抜き、抜いた語と残りを返す。
 *
 * 消した位置は `null` で埋めて**語の一致が重ならないようにする**(`純米大吟醸` を消した跡に
 * `純米` を当てない)。返す語の順序は**テキストに現れた順**にする — UI が
 * 「純米大吟醸 無濾過 生原酒」のようにそのまま並べてスペック欄に入れられる形が要るので、
 * 語彙の定義順ではなくラベルの読み順に従う。
 */
function excludeTerms(chars: readonly string[]): { rest: string; hits: ExcludeHit[] } {
  const rest: (string | null)[] = [...chars]
  const hits: ExcludeHit[] = []
  for (const { term, key, allow, isSpec } of TERM_TABLE) {
    for (let at = 0; at + key.length <= rest.length; at++) {
      let diff = 0
      let ok = true
      for (let k = 0; k < key.length; k++) {
        const ch = rest[at + k]
        // 既に別の語で消えた位置は跨がない(語が重ならないことの担保)
        if (ch === null) {
          ok = false
          break
        }
        if (ch !== key[k] && ++diff > allow) {
          ok = false
          break
        }
      }
      if (!ok) continue
      hits.push({ term, isSpec, at })
      for (let k = 0; k < key.length; k++) rest[at + k] = null
    }
  }
  hits.sort((a, b) => a.at - b.at)
  // 同じ語が2箇所に出たら1回だけ返す(先に現れた位置の順序を保つ)
  const seen = new Set<string>()
  const unique: ExcludeHit[] = []
  for (const hit of hits) {
    if (seen.has(hit.term)) continue
    seen.add(hit.term)
    unique.push(hit)
  }
  return { rest: rest.filter((ch) => ch !== null).join(''), hits: unique }
}

// ---------------------------------------------------------------------------
// 読めた字で絞る(候補が出せなかったときの受け皿)
// ---------------------------------------------------------------------------

/**
 * 候補を出す門(`MAX_EXPECTED_BRANDS` / `MIN_PARTIAL_COVERAGE`)は**わざと厳しい**ので、
 * 写真ふうのラベル9枚の実測では 2〜3枚しか候補が出ない。門を緩めるのは筋が悪い —
 * 緩めた分だけ「正解が候補に無いまま別銘柄を1位に出す」が増えるだけで、そこは
 * 実測で否定済み(この節の上の説明)。
 *
 * **足りないのは候補ではなく、読めた1字を使う道**だった。同じ9枚で、読めた字のどれかを
 * 鍵にして銘柄名の部分一致を引くと、**5枚で正解が上位20件に入る**(獺祭 #1 / 七賢 #1 /
 * 刈穂 #2 / 紀土 #6 / 黒龍 #18)。候補の門を通らなかった `穂` や `竜` が、絞り込みの鍵としては
 * 十分に効くということ。
 *
 * だから**押すのは人**という形にする。この関数が返すのは「押せる字」だけで、
 * 押した先に出るのは**手動サジェストと同じ `createSuggester` の結果**(この層は候補を作らない)。
 * 自動で1位を出すわけではないので、`unlinked` に推定値を埋めない規律とも衝突しない。
 */
export type NarrowChar = {
  /** `normalize()` 後の1文字。**これをそのまま `Suggester` に渡す** */
  char: string
  /** その字を含む銘柄の数。**押す前に絞り込みの効き目が分かる**ように返す */
  brandCount: number
}

/** 既定の上限。390px に2段までで収まる数(1つ 5〜6字幅) */
export const DEFAULT_NARROW_CHAR_LIMIT = 8

export type CharNarrower = (text: string, limit?: number) => NarrowChar[]

/**
 * 読めたテキストから「絞り込みの鍵に使える字」を選ぶ。**純関数を返す。**
 *
 * 除外はこの層の他の判断と同じ語彙(`TERM_TABLE`)を通す — スペック語とラベル常出語で
 * 絞っても銘柄は絞れない。**銘柄マスタに1件も無い字も出さない**: 押しても0件になる字を
 * 押せる形で並べると、絞り込みが効かないことを押してから知ることになる。
 *
 * 並びは**含む銘柄が少ない順**(= 絞り込みが強い順)。同数のときはコードポイント順で決定的にする。
 * 誤読で生まれた字は稀なので先頭に来やすいが、件数を併記するので**押す前に選び分けられる**し、
 * 押した結果は手動サジェストの一覧そのもの(外れたら別の字を押すだけ)。
 *
 * **信頼度で絞ったテキストではなく、読めた全部を渡してよい。** 押すのは人なので、
 * 低信頼のパスの字が混ざっても「もっともらしい候補が勝手に1位に出る」ことは起きない
 * (実測で 七賢 の `賢` と 黒龍 の `竜` は信頼度0のパスからしか出ていない)。
 */
export function createCharNarrower(brands: readonly SakenowaBrand[]): CharNarrower {
  const df = new Map<string, number>()
  for (const brand of brands) {
    for (const ch of new Set(normalize(brand.name))) df.set(ch, (df.get(ch) ?? 0) + 1)
  }

  return (text, limit = DEFAULT_NARROW_CHAR_LIMIT) => {
    const rest = excludeTerms([...normalize(text).replace(NUMERIC_RE, '')]).rest
    const chars: NarrowChar[] = []
    for (const char of new Set(rest)) {
      const brandCount = df.get(char)
      // 定義域外の字は出さない(押しても0件。`postings` を引く照合側と同じ規律)
      if (brandCount === undefined || !CONTENT_RE.test(char)) continue
      chars.push({ char, brandCount })
    }
    chars.sort((a, b) => a.brandCount - b.brandCount || (a.char < b.char ? -1 : 1))
    const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : DEFAULT_NARROW_CHAR_LIMIT
    return chars.slice(0, max)
  }
}
