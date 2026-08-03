// 蔵元の説明(B78)。ja.wikipedia の記事の**書き出しだけ**を同梱して出す。
//
// ## なぜ ja.wikipedia だけなのか
//
// 2026-08-02 に出所を全部当たった結論(`docs/BACKLOG.md` B79)。**説明文そのものを
// 再配布可能な形で出せるのはここ1つしかない**。Wikidata は CC0 で義務がゼロだが中身が無く
// (74蔵中20件しか説明が無く、うち15件は「〈地名〉の酒造メーカー」= 画面が既に出している
// 都道府県の言い換え)、OSM は日本全国の `craft=brewery` が144件で description が1件、
// 国税庁の各データは集計統計か産地単位で蔵元の記述が無い。
//
// ## 名前から自動で引く経路を1本も残さない
//
// **入口は `src/data/brewery-articles.ts` の「人が目視で確定した表」だけ。** 蔵元名で
// 記事を引くと、門を通しても誤配が残る(実測: `獺祭` は記事「獺祭魚」にリダイレクトして
// **カワウソが魚を並べる習性**の説明が出る / `月桂冠` は月桂樹の冠 / `菊姫` は武家の女性名 /
// `小林酒造` は曖昧さ回避で4県すべてを列挙するので**県一致でも弾けない**)。
// `linkBrand` が銘柄紐付けの唯一の実装であるのと同じ規律で、ここも表の1本に閉じる。
//
// **銘柄には使わない。** 正しく付くのが 79銘柄中10〜22件しかない(銘柄名は普通名詞や
// 別の固有名詞と衝突しやすい)。蔵元は法人名なので当たりが安定する。
//
// ## ライセンス
//
// CC BY-SA 4.0。表示義務は**記事URLとライセンスURI**で、継承(§3(b))は
// "if You Share Adapted Material" なので**無改変の抜粋には及ばない**。だから
// **書き出しを一字も変えずに載せる**(要約・言い換えをした時点で Adapted Material になる)。
// クレジットは地図と同じ扱い = **使用箇所(記録の詳細)と「知る」の両方**に出す。

/** `public/data/wikipedia/breweries.json` の形。行は [蔵元ID, 記事名, 書き出し] */
export type BreweryArticlesFile = {
  readonly copyright: string
  readonly rows: readonly (readonly [breweryId: number, title: string, extract: string])[]
}

/** 1蔵ぶんの説明。`url` は `title` から導く(別に持つとずれる) */
export type BreweryArticle = {
  readonly breweryId: number
  /** ja.wikipedia の記事名。**表示にも出す** — 何を出典にしたかを読み手が確認できる形にする */
  readonly title: string
  /** 記事の書き出し。**一字も変えない**(変えると CC BY-SA の継承が発生する) */
  readonly extract: string
  readonly url: string
}

/** 蔵元ID → 説明。定義域外は `undefined`。**全件にフォールバックしない** */
export type BreweryArticles = ReadonlyMap<number, BreweryArticle>

const ARTICLE_BASE = 'https://ja.wikipedia.org/wiki/'

/**
 * 記事名から記事URLを作る。**表示にも出典にも同じ1本を使う。**
 *
 * `encodeURIComponent` だと `/` まで潰れて記事名に `/` を含む項目に届かなくなるので、
 * パスとして意味のある文字は残す。空白は `_` にする(ja.wikipedia の正規形)。
 */
export function breweryArticleUrl(title: string): string {
  return ARTICLE_BASE + encodeURI(title.replace(/ /g, '_')).replace(/\?/g, '%3F')
}

/**
 * 同梱 JSON を解く。**壊れた行は落として残りを通す**(1行のために説明が全部消えない)。
 *
 * 落とす条件は「蔵元IDが正の整数でない」「記事名か書き出しが空」の3つだけ。
 * ここで内容の妥当性(その蔵の記事か)は見ない — それは人が確定した表の役目で、
 * ここに書くと**二重実装になって必ずずれる**。
 */
export function decodeBreweryArticles(raw: BreweryArticlesFile): BreweryArticles {
  const out = new Map<number, BreweryArticle>()
  for (const row of raw.rows) {
    const [breweryId, title, extract] = row
    if (!Number.isInteger(breweryId) || breweryId <= 0) continue
    if (typeof title !== 'string' || title === '') continue
    if (typeof extract !== 'string' || extract === '') continue
    out.set(breweryId, { breweryId, title, extract, url: breweryArticleUrl(title) })
  }
  return out
}
