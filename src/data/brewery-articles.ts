// 蔵元 → ja.wikipedia の記事名。**人が目視で確定した行だけを置く**(B78)。
//
// ## この表が唯一の入口
//
// 蔵元名から記事を自動で引く経路は**実行時にもビルド時にも1本も無い**。
// `npm run fetch:brewery-notes -- --review` が候補を並べるところまでをやり、
// **採るかどうかは人が記事を読んで決める**。理由は `src/domain/breweryNote.ts` の頭にある
// (`獺祭` → カワウソの習性、`月桂冠` → 月桂樹の冠、`小林酒造` → 4県の曖昧さ回避)。
//
// ## 足しかた
//
//   1. `npm run fetch:brewery-notes -- --review`
//      → `data/brewery-article-candidates.tsv`(gitignore)に候補が出る
//   2. **1行ずつ記事を開いて確かめる。** その蔵元の記事か / 曖昧さ回避でないか /
//      書き出しが都道府県の言い換え以上を言っているか
//   3. 確かめた行だけをこの表に写す(`brewery` と `prefecture` は**目で照合するための欄**で、
//      実行時には使わない。書いておくと次に見た人が記事を開き直さずに疑える)
//   4. `npm run fetch:brewery-notes` → `public/data/wikipedia/breweries.json`
//   5. `npm run wikipedia:check` → 確定した行が全部取れているか(記事名が動くと減る)
//
// ## 記事名は動く
//
// `旭酒造` は `獺祭 (企業)` に改名された。放っておくと説明が黙って消えるので、
// **取れた行数が確定した行数に足りなければ検査が落ちる**(`scripts/check-brewery-notes.mjs`)。
// 落ちたら記事名を追い直してこの表を直す。

export type BreweryArticleEntry = {
  /** さけのわの蔵元ID(`public/data/sakenowa/breweries.json`) */
  breweryId: number
  /** 目視照合用の蔵元名。**実行時には使わない** */
  brewery: string
  /** 目視照合用の都道府県。**実行時には使わない** */
  prefecture: string
  /** ja.wikipedia の記事名(リダイレクトではなく**確定した先の名前**を書く) */
  title: string
}

/**
 * 確定済みの行。**空のまま出荷してよい** — 1行も無ければ蔵元の説明の節が出ないだけで、
 * 他の機能は何も変わらない。取得はネットに出られる環境でしか回せないので、
 * ここが空なのは「まだ確定していない」という正直な状態を表す。
 */
export const BREWERY_ARTICLES: readonly BreweryArticleEntry[] = []
