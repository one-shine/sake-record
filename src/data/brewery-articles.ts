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
//      説明が都道府県の言い換え以上を言っているか
//   3. 確かめた行だけをこの表に写す(`brewery` と `prefecture` は**目で照合するための欄**で、
//      実行時には使わない。書いておくと次に見た人が記事を開き直さずに疑える)
//   4. `npm run fetch:brewery-notes` → `public/data/wikipedia/brewery-articles.json`
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
 *
 * ## 採った基準(2026-08-08。台帳に出てくる76蔵を `--review` に掛けて34蔵)
 *
 * **説明が県と社名以外の事実を1つでも言っていること**を要求した。代表銘柄・創業・
 * 製法・受賞・建造物のどれかが在れば採り、「◯◯県◯◯市にある日本酒の蔵元。」で終わる
 * 記事は採らない — 県も蔵元名もアプリが既に画面に出しているので、読み手に何も足さない。
 *
 * **最初はリード(`exintro`)しか採っておらず、それだと40蔵中19蔵が上の1文で終わっていた。**
 * 記事が薄いのではなく**こちらが本文を捨てていた**(`黒龍酒造` の1804年創業も
 * `八海醸造` の『八海山』も「概要」節にある)。リードと「概要」節まで採るように変えて
 * 13蔵が採用に転じた。残る6蔵(`西田酒造店` `花泉酒造` `高千代酒造` `花の舞酒造`
 * `花の香酒造` `苗場酒造`)は**記事に「概要」節が無い**ので今も1文のまま。
 *
 * 同定が誤りで落としたのは `澄川酒造場` の1件だけ。蔵元名からのリダイレクト先が
 * 銘柄「東洋美人」の記事で、**蔵ではなく酒の記事**だった。
 *
 * **蔵元名で引けなかった37蔵も別名で洗った**(曖昧さ回避・改名・旧社名・代表銘柄)。
 * 拾えたのは `小林酒造 (栃木県)` と `獺祭 (企業)` の2件だけで、残る35蔵は
 * **本当に記事が無い**(一覧記事の赤リンクや他記事からの言及しか無い)。
 */
export const BREWERY_ARTICLES: readonly BreweryArticleEntry[] = [
  { breweryId: 10, brewery: '八戸酒造', prefecture: '青森県', title: '八戸酒造' },
  { breweryId: 42, brewery: '新澤醸造店', prefecture: '宮城県', title: '新澤醸造店' },
  { breweryId: 76, brewery: '新政酒造', prefecture: '秋田県', title: '新政酒造' },
  { breweryId: 96, brewery: '高木酒造', prefecture: '山形県', title: '高木酒造' },
  { breweryId: 135, brewery: '廣木酒造本店', prefecture: '福島県', title: '廣木酒造本店' },
  { breweryId: 148, brewery: '大木代吉本店', prefecture: '福島県', title: '大木代吉本店' },
  // 曖昧さ回避の先。小林酒造 は北海道・栃木・福岡に実在する(B78 が例に挙げた組)
  { breweryId: 183, brewery: '小林酒造', prefecture: '栃木県', title: '小林酒造 (栃木県)' },
  { breweryId: 229, brewery: '小澤酒造', prefecture: '東京都', title: '小澤酒造' },
  { breweryId: 273, brewery: '八海醸造', prefecture: '新潟県', title: '八海醸造' },
  { breweryId: 313, brewery: '皇国晴酒造', prefecture: '富山県', title: '皇国晴酒造' },
  { breweryId: 328, brewery: '車多酒造', prefecture: '石川県', title: '車多酒造' },
  { breweryId: 371, brewery: '黒龍酒造', prefecture: '福井県', title: '黒龍酒造' },
  { breweryId: 395, brewery: '宮坂醸造', prefecture: '長野県', title: '宮坂醸造' },
  { breweryId: 458, brewery: '萬乗醸造', prefecture: '愛知県', title: '萬乗醸造' },
  { breweryId: 488, brewery: '木屋正酒造', prefecture: '三重県', title: '木屋正酒造' },
  { breweryId: 523, brewery: '松本酒造', prefecture: '京都府', title: '松本酒造' },
  { breweryId: 589, brewery: '油長酒造', prefecture: '奈良県', title: '油長酒造' },
  { breweryId: 603, brewery: '世界一統', prefecture: '和歌山県', title: '世界一統' },
  { breweryId: 609, brewery: '吉村秀雄商店', prefecture: '和歌山県', title: '吉村秀雄商店' },
  // 改名の先。さけのわの蔵元名 獺祭 で引くと故事成語の記事に当たるので、記事名で指す
  // (2025年5月に 旭酒造 → 株式会社獺祭。銘柄側の記事「獺祭 (日本酒)」ではない)
  { breweryId: 679, brewery: '獺祭', prefecture: '山口県', title: '獺祭 (企業)' },
  { breweryId: 716, brewery: '亀泉酒造', prefecture: '高知県', title: '亀泉酒造' },
  { breweryId: 756, brewery: '天吹酒造', prefecture: '佐賀県', title: '天吹酒造' },
  { breweryId: 874, brewery: '寒菊銘醸', prefecture: '千葉県', title: '寒菊銘醸' },
  { breweryId: 898, brewery: '赤武酒造', prefecture: '岩手県', title: '赤武酒造' },
  { breweryId: 920, brewery: '加藤吉平商店', prefecture: '福井県', title: '加藤吉平商店' },
  { breweryId: 922, brewery: '三浦酒造', prefecture: '青森県', title: '三浦酒造' },
  { breweryId: 924, brewery: '新谷酒造', prefecture: '山口県', title: '新谷酒造' },
  { breweryId: 990, brewery: '岡崎酒造', prefecture: '長野県', title: '岡崎酒造' },
  { breweryId: 1168, brewery: 'せんきん', prefecture: '栃木県', title: 'せんきん' },
  { breweryId: 1199, brewery: '渡邊佐平商店', prefecture: '栃木県', title: '渡邊佐平商店' },
  { breweryId: 1514, brewery: '岩手銘醸', prefecture: '岩手県', title: '岩手銘醸' },
  { breweryId: 1585, brewery: '上川大雪酒造', prefecture: '北海道', title: '上川大雪酒造' },
  { breweryId: 1850, brewery: '長州酒造', prefecture: '山口県', title: '長州酒造' },
  { breweryId: 1902, brewery: 'LAGOON BREWERY', prefecture: '新潟県', title: 'LAGOON BREWERY' },
]
