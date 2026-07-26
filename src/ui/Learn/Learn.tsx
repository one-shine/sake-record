// 「知る」タブ。**このアプリのデータと語彙を説明する面**で、日本酒の入門書ではない。
//
// ## 何を載せ、何を載せないか（この線引きが画面の質を決めている）
//
// 載せるのは次の3つだけ:
//   1. **このアプリ自身の数え方** … スタイル分布の規則・紐付けの5値・6軸・味タグの性質。
//      いずれも実装から引くか、実装と同じ言葉で書く（凡例と実物がドリフトしないように）
//   2. **出典のある逐語** … 国税庁告示（`seishuMeisho.ts`）
//   3. **クレジットとライセンス** … さけのわ / CC-BY の産地マップ / OCR の Apache-2.0
//
// 載せない: 日本酒の歴史・造りの一般解説・テイスティング指南・酒器・料理との相性。
// **出典を持たない一般論を1文でも混ぜると、同じページの逐語表まで同じ確かさに見える。**
// この理由は画面にも書いてある（読者が「なぜ薄いのか」を推測しなくて済むように）。
//
// ## 凡例を実装から引く
//
// 紐付けの5値は `LINK_STATUS_BADGES` を、6軸は `FLAVOR_AXIS_LABELS` を、スペック欄の11語は
// `STYLE_TERMS` を走査して描く。**このファイルに新しい語を書かない** — 凡例に語を書き写すと、
// 実装側が変わったときに凡例だけが古い語のまま残る（しかも画面は正しく見える）。
//
// ## 数字の扱い
//
// 味タグの節にだけ実測値（141語 / 2,136銘柄 / 上位5語の割合 / 20語の打ち切り）を書いている。
// これは同梱 JSON を数えた値で、`npm run fetch:sakenowa` で取り直すと変わる。
// 再計測は `public/data/sakenowa/{flavorTags,brandFlavorTags}.json` の `rows` を数えれば出る
// （前者は語彙の長さ、後者は各行が `[銘柄ID, ...タグID]`）。画面には取得時期を併記する。

import { SAKENOWA_URL, SAKENOWA_DATA_URL } from '../../config/app.ts'
import { STYLE_TERMS } from '../../domain/stats.ts'
import { FLAVOR_AXIS_KEYS } from '../../domain/flavor.ts'
import { MapCredit } from '../Attribution/Attribution.tsx'
import { FLAVOR_AXIS_LABELS } from '../FlavorMap/flavorAxes.ts'
import { LINK_STATUS_BADGES, LINK_STATUS_ORDER } from '../Timeline/linkStatus.ts'
import { LinkStatusBadge } from '../Timeline/LinkStatusBadge.tsx'
import {
  NO_REQUIREMENT,
  NTA_FETCHED_ON,
  NTA_GAIYO_URL,
  NTA_KOKUJI_URL,
  SEISHU_MEISHO,
  SEISHU_MEISHO_COLUMNS,
  SEISHU_MEISHO_DEFINITIONS,
} from './seishuMeisho.ts'
import {
  STYLE_TERM_ORIGINS,
  STYLE_TERM_ORIGIN_CLASSES,
  STYLE_TERM_ORIGIN_LABELS,
  type StyleTermOrigin,
} from './styleTermOrigin.ts'

/** Timeline / Dashboard と同じ器。1280px でも本文が左端に張り付かない(B16) */
const CONTAINER = 'mx-auto w-full max-w-3xl px-4'

const SECTION_HEADING = 'text-sm font-semibold'
const SUB_HEADING = 'text-xs font-semibold text-ink-muted'
const BODY = 'mt-1 text-xs leading-relaxed text-ink-muted'
const NOTE = 'mt-2 text-xs leading-relaxed text-ink-faint'
const LINK = 'text-link underline decoration-link-underline underline-offset-2'
/** 表のセル。`align-top` は行の高さが揃わない多列の表で1行目を読ませるため */
const CELL = 'border border-line px-1.5 py-1 text-left align-top font-normal'

export function Learn() {
  return (
    <section aria-label="知る" className={`${CONTAINER} flex flex-col gap-7 py-4`}>
      <Scope />
      <CountingSection />
      <MeishoSection />
      <StyleTermSection />
      <SourcesSection />
    </section>
  )
}

/**
 * ページの範囲。**最初に読ませる。** 一般的な日本酒入門を期待して開いた人が、
 * 薄いページだと誤解しないため（載せていないのは手を抜いたからではなく、
 * 出典が無い話を出典のある表と同じページに置かない、という判断による）。
 */
function Scope() {
  return (
    <div>
      <h2 className={SECTION_HEADING}>このページの範囲</h2>
      <p className={BODY}>
        この画面に出る数字と語が、どこから来ていて何を意味するのかを書いたもの。日本酒の歴史・造りの解説・テイスティングの指南・料理との相性は載せない。出典を持たない一般論を混ぜると、同じページにある告示の逐語表まで同じ確かさに見えてしまう。
      </p>
      <p className={NOTE}>
        数字はすべて、自分が記録に入れた値か、同梱した さけのわデータから引いた値のどちらか。推定で埋めた値は無い。
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 節1. このアプリの数え方
// ---------------------------------------------------------------------------

function CountingSection() {
  return (
    <div>
      <h2 className={SECTION_HEADING}>このアプリの数え方</h2>
      <div className="mt-2 flex flex-col gap-5">
        <StyleCounting />
        <LinkStatusLegend />
        <FlavorAxisLegend />
        <FlavorTagNotes />
      </div>
    </div>
  )
}

/** 統計タブのスタイル分布の規則。画面に出ている短文（`Dashboard.tsx`）の長い版 */
function StyleCounting() {
  return (
    <div>
      <h3 className={SUB_HEADING}>スタイル分布（統計タブ）</h3>
      <ul className={`${BODY} list-disc pl-4`}>
        <li>
          対象は記録の「スペック」欄の文字列<b>だけ</b>。備考（メモ）は数えない。備考を混ぜると、味の話として書いた語が製法の集計に入る。
        </li>
        <li>
          判定は<b>部分一致</b>。下の11語について、スペック欄にその語が含まれるかを見るだけで、表記ゆれを吸収する処理（括弧の中身を落とす・異体字を畳む）は挟まない。生の文字列に当てる。
        </li>
        <li>
          1本を<b>複数の語に重複計上する</b>。「純米大吟醸」の1本は「大吟醸」にも「純米」にも数える。だから延べ本数は総本数を超える。これは数え間違いではない。
        </li>
        <li>
          11語のどれにも当たらない記録は、どの行にも入らない。その本数は統計タブに数字で出る（スペック未記入か、この語彙の外）。
        </li>
        <li>
          0本の語も行として残す。行を消すと「0本だった」と「そもそも数えていない」が同じ見た目になる。
        </li>
      </ul>
    </div>
  )
}

/**
 * 紐付けの5値。**`LINK_STATUS_BADGES` と `LinkStatusBadge` から描く。**
 * ラベルも説明もバッジの見た目も、時系列タブに出る実物とまったく同じものが出る
 * （凡例のためにここで書き写すと、対応表を直したときに凡例だけが古くなる）。
 */
function LinkStatusLegend() {
  return (
    <div>
      <h3 className={SUB_HEADING}>紐付けの状態（記録タブ・記録の詳細）</h3>
      <p className={BODY}>
        記録に書いた銘柄名を、さけのわの銘柄マスタに突き合わせた結果。記録1件ごとに次の5つのどれかが付く。
      </p>
      <dl className="mt-2 flex flex-col gap-1.5">
        {LINK_STATUS_ORDER.map((status) => (
          <div key={status} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <dt>
              <LinkStatusBadge status={status} />
            </dt>
            <dd className="text-xs leading-relaxed text-ink-muted">
              {LINK_STATUS_BADGES[status].help}
            </dd>
          </div>
        ))}
      </dl>
      <p className={NOTE}>
        紐付かなかった記録に、似た名前の銘柄を当てて埋めることはしない。当たっていないことを出すほうを選んでいる。上の並びは確信の高い順。
      </p>
    </div>
  )
}

/** 6軸。ラベルの出所は `FLAVOR_AXIS_LABELS`、順序の出所は `FLAVOR_AXIS_KEYS` */
function FlavorAxisLegend() {
  return (
    <div>
      <h3 className={SUB_HEADING}>フレーバー6軸（味タブ・記録の詳細）</h3>
      <p className={BODY}>
        さけのわが銘柄ごとに持つ6つの値。順に{' '}
        {FLAVOR_AXIS_KEYS.map((key, index) => (
          <span key={key}>
            {index > 0 ? '・' : null}
            <b className="whitespace-nowrap">{FLAVOR_AXIS_LABELS[key]}</b>
          </span>
        ))}
        。
      </p>
      <ul className={`${BODY} list-disc pl-4`}>
        <li>
          値は<b>0〜100 の整数</b>。さけのわの原値は 0.0〜1.0 の小数で、100倍して整数にしている。
        </li>
        <li>
          <b>銘柄に紐づく値で、自分の評価ではない。</b>
          同じ銘柄を何度飲んでも6つの数字は同じ。味について自分が入れるのは5段階の評価と備考だけで、6軸は入力しない。
        </li>
        <li>
          6軸の分母は<b>「フレーバー取得済み」の本数</b>で、「紐付け済み」の本数ではない。紐付いてもさけのわ側にチャートが無い銘柄がある。味タブはこの分母を数字で出す。
        </li>
      </ul>
    </div>
  )
}

/**
 * 味タグ。**打ち切りの話を弁別力の話より前に出す。**
 * 「タグが無い＝その味がない」と読まれるのが一番害の大きい誤解で、
 * `unlinked` に推定値を埋めないのと同じ種類の問題（偽陰性を沈黙させない）。
 */
function FlavorTagNotes() {
  return (
    <div>
      <h3 className={SUB_HEADING}>味タグ</h3>
      <p className={BODY}>
        さけのわが銘柄ごとに持つ短い語。同梱データの語彙は141語ある。以下の数字は同梱データ（2026-07 取得）を数えたもので、データを取り直すと変わる。
      </p>
      <ul className={`${BODY} list-disc pl-4`}>
        <li>
          <b>タグが無いことは「その味がない」ことを意味しない。</b>
          上流が銘柄あたり20語で打ち切っている。20語ちょうどの銘柄が2,136件中731件（34%）ある一方、19語の銘柄は16件しかない。この段差は味の分布ではなく上限。だから「熱燗」でタグを絞ると、熱燗が合うのに21番目に押し出された銘柄は黙って落ちる。
        </li>
        <li>
          語によって<b>絞り込みの効き方が大きく違う</b>。多い順に 甘味 59% / 旨味 58% / 酸味 56% / 辛口 53% / スッキリ 51% の銘柄に付く。上位5語はどれも半分以上の銘柄に付くので、選んでもほとんど絞れない。
        </li>
        <li>
          <b>語の種類が混ざっている。</b>
          味覚（酸味・甘味・苦味・渋み）、口当たり（なめらか・とろみ・ガス）、食べ物や飲み物の比喩（メロン・ヨーグルト・醤油・セメダイン）、温度帯（冷酒・常温・熱燗・燗酒・燗冷まし）、飲む速さのオノマトペ（ゴクゴク・ちびちび・スイスイ）。「味タグ」という名前だが、味ではない語も同じ一覧に入っている。
        </li>
        <li>
          6軸のラベルのうち4つ（華やか・芳醇・穏やか・軽快）は、味タグにも同じ語がある。
          <b>別のデータ</b>なので混ぜて読めない。軸は 0〜100 の連続量、タグは付いているかいないかだけ。
        </li>
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 節2. 特定名称の8種類
// ---------------------------------------------------------------------------

/**
 * 告示の逐語表。**390px でも読めることが要件**なので、表は親の
 * `overflow-x-auto` の中に置いて `min-w` で下限を切る。
 * 表を折り返して縦に潰すと5列の対応が読めなくなる一方、`body` を横に溢れさせるのは論外
 * （画面全体が横に揺れる）。**溢れるのはこの箱の中だけ**にする。
 */
function MeishoSection() {
  const [rowHead, ...dataColumns] = SEISHU_MEISHO_COLUMNS

  return (
    <div>
      <h2 className={SECTION_HEADING}>特定名称の8種類</h2>
      <p className={BODY}>
        スペック欄に書かれる語のうち、純米大吟醸・大吟醸・純米吟醸・純米・本醸造は、国税庁の告示が要件を定めた「特定名称」の名前。8種の要件は次のとおり。
      </p>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-xs leading-relaxed">
          <thead>
            <tr>
              {SEISHU_MEISHO_COLUMNS.map((column) => (
                <th key={column.field} scope="col" className={`${CELL} bg-surface text-ink-muted`}>
                  {column.head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SEISHU_MEISHO.map((row) => (
              <tr key={row.name}>
                <th scope="row" className={`${CELL} font-medium`}>
                  <span className="whitespace-nowrap">{row[rowHead.field]}</span>
                </th>
                {dataColumns.map((column) => (
                  <td key={column.field} className={CELL}>
                    {row[column.field]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 記号の凡例。これが無いと `−` が「調べていない」と読める */}
      <p className={NOTE}>
        {`精米歩合の「${NO_REQUIREMENT}」は要件が無いことを示す（未確認や記入漏れではない）。純米酒に精米歩合の要件は無い — かつての「70%以下」は改正で削除された。こうじ米使用割合15%以上は8種すべてに共通する。`}
      </p>

      <h3 className={`${SUB_HEADING} mt-4`}>表の語の定義</h3>
      <dl className={`${BODY} flex flex-col gap-1`}>
        {SEISHU_MEISHO_DEFINITIONS.map(({ term, definition }) => (
          <div key={term}>
            <dt className="inline font-medium text-ink">{term}</dt>
            <dd className="inline">{` — ${definition}`}</dd>
          </div>
        ))}
      </dl>

      <p className={NOTE}>
        告示 第1項の表が挙げる特定名称は3つ（吟醸酒・純米酒・本醸造酒）で、残る5つは第2項の各号から派生する。8行に整えた上の形は国税庁の「概要」ページの表。
      </p>
      <p className={NOTE}>
        出典（{NTA_FETCHED_ON} 取得）:{' '}
        <a href={NTA_KOKUJI_URL} target="_blank" rel="noreferrer" className={LINK}>
          清酒の製法品質表示基準を定める件
        </a>
        （告示本文）/{' '}
        <a href={NTA_GAIYO_URL} target="_blank" rel="noreferrer" className={LINK}>
          「清酒の製法品質表示基準」の概要
        </a>
        。手で写したもので、改正に追随する仕組みは無い。だから取得日を出している。
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 節3. スペック欄の11語の出所
// ---------------------------------------------------------------------------

/**
 * 11語 × 出所の3値。**この節の要点は3つ目の状態**（このアプリが決めたルール）で、
 * 告示由来の表の隣に出所を書かずに並べると、アプリ独自の規則が法令由来に見える。
 * 語と出所の対応は `styleTermOrigin.ts` が持ち、ここは描画だけ。
 */
function StyleTermSection() {
  return (
    <div>
      <h2 className={SECTION_HEADING}>スペック欄の11語はどこから来た語か</h2>
      <p className={BODY}>
        統計タブのスタイル分布が数える11語。この11語は同じ出所から来ていない。告示に定義がある語、語そのものは告示に無く要件の組み合わせとして読める語、告示に定義を確認できていない語が混ざっている。さらに<b>11語を数える規則そのものはこのアプリが決めたもの</b>で、告示とは関係がない（下の帯）。
      </p>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[30rem] border-collapse text-xs leading-relaxed">
          <thead>
            <tr>
              <th scope="col" className={`${CELL} bg-surface text-ink-muted`}>
                語
              </th>
              <th scope="col" className={`${CELL} bg-surface text-ink-muted`}>
                出所
              </th>
              <th scope="col" className={`${CELL} bg-surface text-ink-muted`}>
                定義
              </th>
            </tr>
          </thead>
          <tbody>
            {STYLE_TERMS.map((term) => {
              const origin = STYLE_TERM_ORIGINS[term]
              return (
                <tr key={term}>
                  <th scope="row" className={`${CELL} font-medium`}>
                    <span className="whitespace-nowrap">{term}</span>
                  </th>
                  <td className={CELL}>
                    <span
                      className={`whitespace-nowrap rounded border px-1.5 py-px text-[11px] leading-4 ${STYLE_TERM_ORIGIN_CLASSES[origin.kind]}`}
                    >
                      {STYLE_TERM_ORIGIN_LABELS[origin.kind]}
                    </span>
                  </td>
                  <td className={CELL}>{originDefinition(origin)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className={NOTE}>
        「確認できていない」の4語（無濾過・ひやおろし・しぼりたて・にごり）は、上の告示の本文に1度も出てこない。ここでは定義を書かない。かわりに「法令上の定義は無い」と断定もしない
        —
        他の法令・通達・業界の自主基準まで網羅して調べたわけではないので、無いと言えるだけの根拠がこちらに無い。
      </p>

      {/* 3つ目の状態。**法令の表と地続きに見えないよう帯にする**(notice-* は注記の箱にだけ使う) */}
      <p className="mt-2 rounded border border-notice-line bg-notice-surface px-2.5 py-2 text-xs leading-relaxed text-notice-ink">
        この11語という語彙の選び方、部分一致で判定すること、1本を複数の語に重複計上すること、スペック欄だけを見ることは、<b>すべてこのアプリが決めたルール</b>で、どの法令にも書いていない。告示は「この名称を表示できる条件」を定めているだけで、記録の数え方は定めていない。
      </p>

      <p className={NOTE}>
        特定名称の正式な名前には「酒」が付き（純米酒・大吟醸酒）、11語のほうは付かない。部分一致なので、スペック欄に「純米酒」と書いてあれば「純米」に当たる。
      </p>
    </div>
  )
}

/**
 * 出所ごとの「定義」列。**`unconfirmed` には定義を書かない**（推測で埋めない）。
 * `switch` を網羅させているので、`StyleTermOrigin` に状態が増えると
 * 戻り値が `undefined` を含んで型エラーになる（分類し忘れが空セルとして出ない）。
 */
function originDefinition(origin: StyleTermOrigin): string {
  switch (origin.kind) {
    case 'meisho':
      return `上の表の「${origin.meishoName}」の要件。`
    case 'kokuji':
      return origin.definition
    case 'composite':
      return origin.note
    case 'unconfirmed':
      return '国税庁告示に定義を確認できていない。'
  }
}

// ---------------------------------------------------------------------------
// 節4. 出典とライセンス
// ---------------------------------------------------------------------------

/**
 * クレジットの置き場。**フッタから外した CC-BY の4項目がここと産地タブにある。**
 * CC-BY-4.0 §3(a)(1) は作者・タイトル・ライセンスへのリンク・改変した旨の表示を求め、
 * §3(a)(2) の「URI で必要情報の場所を示す」枝はこのアプリでは使えない
 * （URL ルーティングを持たないので、この画面を指す URL が作れない）。
 * だから**地図を描く産地タブに併記し、ここにも同じものを置く**。
 *
 * 4項目そのものは `MapCredit` が持ち、このファイルでは書き直さない
 * （同じ義務の文面を2箇所に書くと、片方だけ直したときに義務違反に気付けない）。
 */
function SourcesSection() {
  return (
    <div>
      <h2 className={SECTION_HEADING}>出典とライセンス</h2>

      <h3 className={`${SUB_HEADING} mt-2`}>さけのわデータ</h3>
      <p className={BODY}>
        銘柄・蔵元・フレーバー6軸・味タグは{' '}
        <a href={SAKENOWA_DATA_URL} target="_blank" rel="noreferrer" className={LINK}>
          さけのわデータ
        </a>
        （
        <a href={SAKENOWA_URL} target="_blank" rel="noreferrer" className={LINK}>
          さけのわ
        </a>
        ）から取ってビルド時に同梱したもの。利用条件はクレジットの表示と sakenowa.com
        へのリンクで、データを使っている箇所に併記することが求められている。5つのタブはすべてこのデータを使うので、どの画面にもフッタに1行を残している。
      </p>
      <p className={NOTE}>
        実行時に取りに行くことはしない（API が CORS
        ヘッダを返さないため取得できない）。表示している値は同梱した時点のもので、さけのわ側の最新とは限らない。
      </p>

      {/* 見出しで「県形状」を繰り返さない。MapCredit の文が「産地マップの県形状は…」で始まる */}
      <h3 className={`${SUB_HEADING} mt-4`}>産地マップ</h3>
      <div className="mt-1">
        <MapCredit />
      </div>
      {/* リンクを張り直さない。作者・タイトル・ライセンス・改変の4項目は MapCredit の担当で、
          ここに同じリンクを足すと同名のリンクが2本になる(義務の文面が2箇所に散る) */}
      <p className={NOTE}>
        同じクレジットを産地タブにも出している。CC BY
        4.0
        は作品を使っている場所での表示を求めるので、地図を描く画面に併記するのが素直な満たし方。この画面を指す URL
        は作れない（このアプリは画面ごとの URL を持たない）ので、リンクで参照先を示す形は使えない。
      </p>

      <h3 className={`${SUB_HEADING} mt-4`}>端末内 OCR（tesseract.js）</h3>
      <p className={BODY}>
        ラベル写真から銘柄の候補を出す処理は、tesseract.js を使って端末内で動かしている。写真を端末の外に出さないため、実行に必要な wasm・worker・学習データは同一オリジンから配信している（クラウドの OCR や第三者の CDN は使わない）。tesseract.js
        本体・コア・学習データはいずれも Apache-2.0。
      </p>
      <p className={NOTE}>
        Apache-2.0 が求めるのは配布物への告知で、画面での表示義務は無い（さけのわデータや CC BY
        4.0 と違って、表示を条件にする条項が無い）。それでもここに書いておく。同梱している成果物・入手元・改変の一覧はリポジトリの docs/THIRD_PARTY.md にある。
      </p>

      <h3 className={`${SUB_HEADING} mt-4`}>国税庁の告示</h3>
      <p className={BODY}>
        特定名称の表と「原酒」の定義は、国税庁の告示と概要ページから逐語で写した（
        {NTA_FETCHED_ON} 取得。リンクは上の節にある）。法令・告示は著作権法13条により著作権の目的とならないので利用の許諾は要らないが、原文に戻れるように出典と取得日を書いている。
      </p>
    </div>
  )
}
