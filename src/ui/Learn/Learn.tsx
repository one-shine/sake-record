// 「知る」タブ。**このアプリのデータと語彙を説明する面**で、日本酒の入門書ではない。
//
// ## 何を載せ、何を載せないか（この線引きが画面の質を決めている）
//
// 載せるのは次の3つだけ:
//   1. **このアプリ自身の数え方** … スタイル分布の規則・紐付けの5値・6軸・味タグ・産地の塗り分け。
//      いずれも実装から引くか、実装と同じ言葉で書く（凡例と実物がドリフトしないように）
//   2. **出典のある逐語** … 国税庁告示（`seishuMeisho.ts`）
//   2'. **慣習の語**（季節の呼び名。`seasonalTerms.ts`）… 法令ではないので**語ごとに「慣習」の
//      バッジを付けて逐語表と見た目で割る**。割らずに並べると告示の表まで同じ根拠に見える
//   3. **クレジットとライセンス** … さけのわ / CC-BY の産地マップ / OCR の Apache-2.0
//
// 載せない: 日本酒の歴史・造りの一般解説・テイスティング指南・酒器・料理との相性。
// **出典を持たない一般論を1文でも混ぜると、同じページの逐語表まで同じ確かさに見える。**
//
// ## 6つの下位タブ（利用者の要望「下にスクロールだから見にくい」）
//
// 1枚に積むと 390px で 5,000px を超え、読みたい1トピックに着くまでが全部スクロールだった。
// **割って1画面に1トピックだけ出す**（数え方 / 味 / 産地 / 名称 / 季節 / 出典）。
// タブ帯は `sticky` で上端に貼り付くので、どこまで読んでも別のトピックへ移れる。
// 切り替えたら**スクロール位置を先頭へ戻す**（`AppShell` が上位タブでやっているのと同じ理由 —
// 前のタブの位置で開いても着地点に意味が無い）。
//
// **義務のある表示が畳んだ側に落ちないこと。** さけのわのクレジットは全画面のフッタ（`Attribution`）
// にあり、地図の CC-BY 4項目は**使用箇所である産地タブ**に併記してある。この面の「出典」タブは
// その再掲なので、既定で開いていなくても義務は満たされる。フッタの「出典とライセンス」は
// **その出典タブを開いた状態で**「知る」に着く（`initialPanel`）。
//
// ## 文字の羅列にしない
//
// 6軸は**軸の配置図**（`AxisMap`）で、味タグは**種類ごとの語のチップと上位語の棒**で見せる。
// 産地は**塗り分けの5段そのもの**（`FILL_STEPS`）をスウォッチ付きで出す。いずれも実装・
// 同梱データから引いた値で、説明のために作った数字は無い。
//
// ## 凡例を実装から引く
//
// 紐付けの5値は `LINK_STATUS_BADGES`、6軸は `FLAVOR_AXIS_LABELS` と `FLAVOR_AXIS_UNITS`、
// スペック欄の11語は `STYLE_TERMS`、産地の段は `FILL_STEPS` を走査して描く。
// **このファイルに語や段を書き写さない**（実装が変わったときに凡例だけが古く残る）。
// タブと小見出しの文言も同じ理由で `outline.ts` の1箇所にしか無い。

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SAKENOWA_URL, SAKENOWA_DATA_URL } from '../../config/app.ts'
import { STYLE_TERMS } from '../../domain/stats.ts'
import { DB_NAME } from '../../store/db.ts'
import { MAX_THUMBNAIL_BYTES, EDGE_LADDER } from '../../lib/image/resize.ts'
import { MapCredit } from '../Attribution/Attribution.tsx'
import { BACKUP_NOTICE_DAYS, BACKUP_STRONG_DAYS } from '../ImportExport/BackupNag.tsx'
import { FILL_STEPS } from '../AreaMap/fillSteps.ts'
import { PREFECTURE_TOTAL } from '../AreaMap/areaRows.ts'
import { LINK_STATUS_BADGES, LINK_STATUS_ORDER } from '../Timeline/linkStatus.ts'
import { LinkStatusBadge } from '../Timeline/LinkStatusBadge.tsx'
import { AxisMap } from './AxisMap.tsx'
import { SEASONAL_ORIGIN_LABEL, SEASONAL_TERMS } from './seasonalTerms.ts'
import {
  FLAVOR_TAG_AT_CAP,
  FLAVOR_TAG_BELOW_CAP,
  FLAVOR_TAG_BRANDS,
  FLAVOR_TAG_CAP,
  FLAVOR_TAG_COUNTED_ON,
  FLAVOR_TAG_GROUPS,
  FLAVOR_TAG_TOP_SHARES,
  FLAVOR_TAG_VOCABULARY,
} from './flavorTagGroups.ts'
import {
  LEARN_DEFAULT_PANEL,
  LEARN_PANELS,
  LEARN_SUB_TITLES,
  panelDomId,
  subDomId,
  tabDomId,
  type LearnPanelId,
  type LearnSubId,
} from './outline.ts'
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

/** 見出し > 小見出し > 本文。**3つの大きさが実際に違うこと**が構造の見え方を作っている */
const PANEL_HEADING = 'text-base font-semibold tracking-tight text-ink'
const SUB_HEADING = 'text-sm font-semibold text-ink'
const BODY = 'mt-1 text-xs leading-relaxed text-ink-muted'
const NOTE = 'mt-2 text-xs leading-relaxed text-ink-faint'
const LINK = 'text-link underline decoration-link-underline underline-offset-2'
/** 表のセル。`align-top` は行の高さが揃わない多列の表で1行目を読ませるため */
const CELL = 'border border-line px-1.5 py-1 text-left align-top font-normal'
/** 語のチップ。原子ラベルなので必ず `whitespace-nowrap`（日本語は語中で折れる） */
const CHIP =
  'whitespace-nowrap rounded-full border border-line-strong bg-surface-raised px-2 py-0.5 text-[11px] text-ink'
/** サムネイルの長辺（`EDGE_LADDER` の先頭 = SPEC の既定値。落とし込みの段は説明に出さない） */
const THUMBNAIL_EDGE = EDGE_LADDER[0]

type Props = {
  /**
   * 開いた直後に見せる下位タブ。フッタの「出典とライセンス」から `sources` で来る。
   * **記録には依存しない**（この面が props で受け取るのはどこを開くかだけ）。
   */
  initialPanel?: LearnPanelId
}

export function Learn({ initialPanel }: Props) {
  const [panel, setPanel] = useState<LearnPanelId>(initialPanel ?? LEARN_DEFAULT_PANEL)
  const rootRef = useRef<HTMLElement>(null)
  const firstRender = useRef(true)

  // 下位タブを切り替えたらスクロールを先頭へ戻す。**スクロールするのは `AppShell` の `<main>`**
  // なので、自分の祖先を辿って持ち主に頼む（この面は自分ではスクロールしない）。
  // `scrollTop` への代入にしてあるのは jsdom で無害な no-op になるため（`scrollTo` は未実装で
  // 例外になる。実測は `AppShell.test.tsx` の頭注）。初回は動かさない — 開いた瞬間に
  // 上位タブ側のリセットと二重に効かせる必要が無い。
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const main = rootRef.current?.closest('main')
    if (main) main.scrollTop = 0
  }, [panel])

  return (
    <section ref={rootRef} aria-label="知る" className="flex flex-col">
      <PanelTabs panel={panel} onSelect={setPanel} />
      <div className={`${CONTAINER} pb-4`}>
        <Intro />
        {LEARN_PANELS.map((entry) =>
          entry.id === panel ? <Panel key={entry.id} id={entry.id} /> : null,
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 器（タブ帯・パネル・小見出し）
// ---------------------------------------------------------------------------

/**
 * 下位タブの帯。**上端に貼り付ける**（長いパネルの途中からでも移れる）。
 *
 * `role="tablist"` にして左右キーで移動できるようにする。**下端の主タブ（`AppShell`）は
 * `aria-current="page"` の素のボタン**で、あちらは画面そのものの切り替え、こちらは
 * 1画面の中の切り替え、と役割が違うので同じ形にしない。
 */
function PanelTabs({ panel, onSelect }: { panel: LearnPanelId; onSelect: (id: LearnPanelId) => void }) {
  const index = LEARN_PANELS.findIndex((entry) => entry.id === panel)

  function move(delta: number) {
    const next = LEARN_PANELS[(index + delta + LEARN_PANELS.length) % LEARN_PANELS.length]
    if (next === undefined) return
    onSelect(next.id)
    document.getElementById(tabDomId(next.id))?.focus()
  }

  return (
    <div className="sticky top-0 z-10 border-b border-line bg-canvas">
      <div className={CONTAINER}>
        <div
          role="tablist"
          aria-label="知るの内容"
          className="grid grid-cols-6"
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') move(1)
            else if (event.key === 'ArrowLeft') move(-1)
            else return
            event.preventDefault()
          }}
        >
          {LEARN_PANELS.map((entry) => {
            const active = entry.id === panel
            return (
              <button
                key={entry.id}
                id={tabDomId(entry.id)}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={panelDomId(entry.id)}
                tabIndex={active ? 0 : -1}
                onClick={() => onSelect(entry.id)}
                className={`whitespace-nowrap border-b-2 py-2 text-xs ${
                  active ? 'border-ink font-semibold text-ink' : 'border-transparent text-ink-muted'
                }`}
              >
                {entry.tab}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** 開いているパネルの器。見出し・1行の説明・中身をこの1箇所で組む */
function Panel({ id }: { id: LearnPanelId }) {
  const entry = LEARN_PANELS.find((panel) => panel.id === id)
  if (entry === undefined) throw new Error(`下位タブ「${id}」が LEARN_PANELS に無い`)

  return (
    <section
      id={panelDomId(id)}
      role="tabpanel"
      aria-labelledby={tabDomId(id)}
      tabIndex={-1}
      className="mt-4"
    >
      <h2 className={PANEL_HEADING}>{entry.title}</h2>
      <p className={BODY}>{entry.summary}</p>
      <div className="mt-4 flex flex-col gap-6">
        {id === 'counting' && (
          <>
            <StyleCounting />
            <LinkStatusLegend />
            <StorageNotes />
          </>
        )}
        {id === 'flavor' && (
          <>
            <FlavorAxisLegend />
            <FlavorTagNotes />
          </>
        )}
        {id === 'area' && (
          <>
            <AreaSource />
            <AreaFillLegend />
            <AreaUnmapped />
          </>
        )}
        {id === 'meisho' && (
          <>
            <MeishoTable />
            <MeishoDefinitions />
            <OtherSeishu />
            <StyleTermOrigins />
          </>
        )}
        {id === 'season' && <SeasonalTermList />}
        {id === 'sources' && (
          <>
            <SakenowaSource />
            <MapSource />
            <OcrSource />
            <NtaSource />
          </>
        )}
      </div>
    </section>
  )
}

/** 小見出し。文言は `outline.ts` にしか無い（タブ帯の説明と同じ文字列が出る） */
function SubHeading({ id }: { id: LearnSubId }) {
  return (
    <h3 id={subDomId(id)} className={SUB_HEADING}>
      {LEARN_SUB_TITLES[id]}
    </h3>
  )
}

/** 節を1つ組む（小見出し + 中身）。パネルの中の並びを揃えるためだけの器 */
function Block({ id, children }: { id: LearnSubId; children: ReactNode }) {
  return (
    <div>
      <SubHeading id={id} />
      {children}
    </div>
  )
}

/**
 * ページの範囲。**どのタブでも最初に読ませる**（一般的な日本酒入門を期待して開いた人が、
 * 薄いページだと誤解しないため。載せていないのは手を抜いたからではなく、出典が無い話を
 * 出典のある表と同じ画面に置かない、という判断による）。
 *
 * **2文に抑える。** 5つのタブすべての先頭に出るので、ここが長いと**どのタブでも本題が
 * 折り返しの下に落ちる**（下位タブに割った意味が消える）。数え方の断り書き（推定で
 * 埋めた値は無い）は「数え方」タブへ移した — 数字の話はそこで読むほうが近い。
 */
function Intro() {
  return (
    <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
      この画面に出る数字と語が、どこから来て何を意味するのかだけを書いた面。日本酒の歴史・造りの解説やテイスティングの指南は載せない
      — 出典を持たない一般論を混ぜると、同じ画面にある告示の逐語表まで同じ確かさに見えてしまうため。
    </p>
  )
}

// ---------------------------------------------------------------------------
// タブ1. このアプリの数え方
// ---------------------------------------------------------------------------

/** 統計タブのスタイル分布の規則。画面に出ている短文（`Dashboard.tsx`）の長い版 */
function StyleCounting() {
  return (
    <Block id="counting-style">
      <ul className={`${BODY} list-disc pl-4`}>
        <li>
          対象は記録の「スペック」欄の文字列<b>だけ</b>。備考（メモ）は数えない。備考を混ぜると、味の話として書いた語が製法の集計に入る。
        </li>
        <li>
          判定は<b>部分一致</b>。11語について、スペック欄にその語が含まれるかを見るだけで、表記ゆれを吸収する処理（括弧の中身を落とす・異体字を畳む）は挟まない。生の文字列に当てる。
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
      <p className={NOTE}>
        11語がどこから来た語かは「名称」タブにある。この画面に出る数字はすべて、自分が記録に入れた値か、同梱した さけのわデータから引いた値のどちらかで、推定で埋めた値は無い。
      </p>
    </Block>
  )
}

/**
 * 紐付けの5値。**`LINK_STATUS_BADGES` と `LinkStatusBadge` から描く。**
 * ラベルも説明もバッジの見た目も、記録タブに出る実物とまったく同じものが出る
 * （凡例のためにここで書き写すと、対応表を直したときに凡例だけが古くなる）。
 */
function LinkStatusLegend() {
  return (
    <Block id="counting-link">
      <p className={BODY}>
        記録に書いた銘柄名を、さけのわの銘柄マスタに突き合わせた結果。記録1件ごとに次の5つのどれかが付く（記録の詳細にも同じバッジが出る）。
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
    </Block>
  )
}

/**
 * 記録がどこにあるか。**このアプリで最も実害の大きい知識**なので画面に置く
 * （SPEC の「決定に由来する制約」に書いてあるだけで、これまで画面のどこにも無かった）。
 *
 * 数値は実装から引く: DB 名は `DB_NAME`、督促のしきい値は `BACKUP_NOTICE_DAYS` /
 * `BACKUP_STRONG_DAYS`、サムネイルの上限は `MAX_THUMBNAIL_BYTES` と `EDGE_LADDER[0]`。
 * **ここに数字を書き写さない** — 書き写すと、しきい値を直したときに説明だけが古くなる。
 */
function StorageNotes() {
  return (
    <Block id="counting-storage">
      <p className={BODY}>
        {`記録・別名・写真のサムネイルは、この端末のブラウザの中（IndexedDB の「${DB_NAME}」）にだけ入る。サーバーへ送らないので、アカウントも同期も無い。`}
      </p>
      <ul className={`${BODY} list-disc pl-4`}>
        <li>
          <b>ブラウザのサイトデータを消すと記録も消える。</b>
          端末を変えても引き継がれない。
        </li>
        <li>
          守る手段は<b>JSON の書き出しと取り込みだけ</b>。記録・別名・サムネイルが1つのファイルに入る。端末を移すときも同じファイルを使う。
        </li>
        <li>
          {`最後に書き出してから ${String(BACKUP_NOTICE_DAYS)}日で注意、${String(BACKUP_STRONG_DAYS)}日で強い注意を記録タブに出す。一度も書き出していないときは経過日数が分からないので、段は上げずに事実だけを言う。`}
        </li>
        <li>
          {`写真は長辺 ${String(THUMBNAIL_EDGE)}px・${String(Math.round(MAX_THUMBNAIL_BYTES / 1024))}KB 以下のサムネイルだけを保存する。原本はアプリが持たない（端末のカメラロールに残る）。ラベルの OCR も端末内で動くので、写真は外に出ない。`}
        </li>
      </ul>
    </Block>
  )
}

// ---------------------------------------------------------------------------
// タブ2. 味の見方
// ---------------------------------------------------------------------------

/** 6軸。ラベルと並びの出所は `flavorAxes.ts`（図も同じ並びを引く） */
function FlavorAxisLegend() {
  return (
    <Block id="flavor-axes">
      <p className={BODY}>
        さけのわが銘柄ごとに持つ6つの値。味タブのレーダーはこの並びで描く。
      </p>
      <div className="mt-2 flex justify-center">
        <AxisMap />
      </div>
      <p className="text-center text-[11px] leading-relaxed text-ink-faint">
        中心が 0、外周が 100。値そのものは描いていない（この図は軸の位置の凡例）。
      </p>
      <ul className={`${BODY} list-disc pl-4`}>
        <li>
          値は<b>0〜100 の整数</b>。さけのわの原値は 0.0〜1.0 の小数で、100倍して整数にしている。
        </li>
        <li>
          <b>銘柄に紐づく値で、自分の評価ではない。</b>
          同じ銘柄を何度飲んでも6つの数字は同じ。味について自分が入れるのは5段階の評価と備考だけ。
        </li>
        <li>
          6軸の分母は<b>「フレーバー取得済み」の本数</b>で、「紐付け済み」の本数ではない。紐付いてもさけのわ側にチャートが無い銘柄がある。味タブはこの分母を数字で出す。
        </li>
      </ul>
    </Block>
  )
}

/**
 * 味タグ。**打ち切りの話を弁別力の話より前に出す。**
 * 「タグが無い＝その味がない」と読まれるのが一番害の大きい誤解で、
 * `unlinked` に推定値を埋めないのと同じ種類の問題（偽陰性を沈黙させない）。
 */
function FlavorTagNotes() {
  return (
    <Block id="flavor-tags">
      <p className={BODY}>
        {`さけのわが銘柄ごとに持つ短い語。語彙は${String(FLAVOR_TAG_VOCABULARY)}語で、記録タブの絞り込みに使う。以下の数字は同梱データ（${FLAVOR_TAG_COUNTED_ON} 取得）を数えたもので、データを取り直すと変わる。`}
      </p>

      <p className="mt-3 text-xs font-medium text-ink">タグが無いことは「その味がない」ことを意味しない</p>
      <p className={BODY}>
        {`上流が銘柄あたり${String(FLAVOR_TAG_CAP)}語で打ち切っている。${String(FLAVOR_TAG_CAP)}語ちょうどの銘柄が${FLAVOR_TAG_BRANDS.toLocaleString('ja-JP')}件中${String(FLAVOR_TAG_AT_CAP)}件ある一方、${String(FLAVOR_TAG_CAP - 1)}語の銘柄は${String(FLAVOR_TAG_BELOW_CAP)}件しかない。この段差は味の分布ではなく上限。だから「熱燗」でタグを絞ると、熱燗が合うのに${String(FLAVOR_TAG_CAP + 1)}番目に押し出された銘柄は黙って落ちる。`}
      </p>

      <p className="mt-3 text-xs font-medium text-ink">語によって絞り込みの効き方が大きく違う</p>
      <p className={BODY}>
        {`付いている銘柄が多い上位5語（${FLAVOR_TAG_BRANDS.toLocaleString('ja-JP')}銘柄に対する割合）。どれも半分以上に付くので、選んでもほとんど絞れない。`}
      </p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {FLAVOR_TAG_TOP_SHARES.map((share) => (
          <li key={share.tag} className="flex items-center gap-2">
            <span className="w-16 shrink-0 whitespace-nowrap text-[11px] text-ink">{share.tag}</span>
            {/* 棒は SVG。`w-[59%]` のような文字列連結のクラスは本番で消える */}
            <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="h-1.5 flex-1">
              <rect x="0" y="0" width="100" height="6" className="fill-surface-raised" />
              <rect x="0" y="0" width={share.percent} height="6" className="fill-plot-ink" />
            </svg>
            <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-ink-muted">
              {`${String(share.percent)}%`}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs font-medium text-ink">「味タグ」だが味ではない語も混ざる</p>
      <p className={BODY}>
        {`${String(FLAVOR_TAG_VOCABULARY)}語には次のような種類が同じ一覧に入っている（それぞれ一部を挙げたもので、網羅ではない）。`}
      </p>
      <dl className="mt-1.5 flex flex-col gap-1.5">
        {FLAVOR_TAG_GROUPS.map((group) => (
          <div key={group.kind} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <dt className="w-full shrink-0 text-[11px] text-ink-muted sm:w-40">{group.kind}</dt>
            <dd className="flex flex-wrap gap-1.5">
              {group.examples.map((tag) => (
                <span key={tag} className={CHIP}>
                  {tag}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>

      <p className={NOTE}>
        6軸のラベルのうち4つ（華やか・芳醇・穏やか・軽快）は、味タグにも同じ語がある。
        <b>別のデータ</b>なので混ぜて読めない。軸は 0〜100 の連続量、タグは付いているかいないかだけ。
      </p>
    </Block>
  )
}

// ---------------------------------------------------------------------------
// タブ3. 産地の見方
// ---------------------------------------------------------------------------

/** 県の出所。**「蔵元の所在地」であって酒米の産地でも飲んだ場所でもない**が要点 */
function AreaSource() {
  return (
    <Block id="area-source">
      <p className={BODY}>
        産地タブが数えるのは記録の「都道府県」欄。銘柄を選ぶと<b>その銘柄の蔵元の所在地</b>が初期値として入り、手で直せる。空のままにもできる。
      </p>
      <ul className={`${BODY} list-disc pl-4`}>
        <li>
          <b>蔵元の所在地であって、酒米の産地ではない。</b>
          県外の米を使った酒も蔵のある県に数える。
        </li>
        <li>
          <b>飲んだ場所でもない。</b>
          店や家は「場所」欄が持っていて、産地タブは見ない。
        </li>
        <li>
          初期値は紐付いた銘柄から <b>銘柄 → 蔵元 → 所在地</b> と辿った値で、推定ではない。辿れなければ空のままにする（近い県で埋めない）。
        </li>
      </ul>
    </Block>
  )
}

/** 塗り分けの段。**`FILL_STEPS` を走査して描く**（凡例と地図が同じ1箇所から色を引く） */
function AreaFillLegend() {
  return (
    <Block id="area-fill">
      <p className={BODY}>
        {`${String(PREFECTURE_TOTAL)}県を本数で塗り分ける。段は次の5つで、`}
        <b>多いほど濃い</b>。
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {FILL_STEPS.map((step) => (
          <li key={step.label} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`h-3 w-6 shrink-0 rounded-sm border border-line-strong ${step.swatch}`}
            />
            <span className="whitespace-nowrap text-xs text-ink-muted">{step.label}</span>
          </li>
        ))}
      </ul>
      <ul className={`${BODY} list-disc pl-4`}>
        <li>
          <b>未進出（0本）だけ色味を持たない。</b>
          階調の中で一番薄い色にすると、行っていない県が「少しだけ飲んだ県」と同じ仲間に見える。
        </li>
        <li>
          連続階調（本数に比例した濃さ）にしない。1本と2本の差は見分けられないのに、この画面で最も重要な差は<b>0本と1本</b>だから。
        </li>
        <li>
          0本の県にも輪郭を引く。塗りが消えると日本の形が崩れて「そこに県が無い」ように見える。
        </li>
      </ul>
    </Block>
  )
}

/** 地図に載らない記録。**丸めずに件数のまま残す**という規律の説明 */
function AreaUnmapped() {
  return (
    <Block id="area-unmapped">
      <p className={BODY}>
        県が1つに決まらない記録は、地図の外に<b>「地図に塗った N本 / 全 M本」</b>と<b>「地図に塗れなかった N本」</b>として出る。近い県に丸めたり、多いほうの県に寄せたりはしない。
      </p>
      <ul className={`${BODY} list-disc pl-4`}>
        <li>都道府県が未記入の記録。</li>
        <li>「◯◯または△△」のように県が1つに決まらない記録。</li>
        <li>
          県名として解決できない値。この場合も<b>地図の形は残す</b>。消すと地図から県が1つ消えて、本数の合計だけが合わなくなる（どの県が消えたのかは画面から分からない）。
        </li>
      </ul>
      <p className={NOTE}>
        塗った本数と塗れなかった本数を足すと全本数になる。差が出たら数え落としがあるということなので、画面に両方を並べてある。
      </p>
    </Block>
  )
}

// ---------------------------------------------------------------------------
// タブ4. 特定名称と語の出所
// ---------------------------------------------------------------------------

/**
 * 告示の逐語表。**390px でも読めることが要件**なので、表は親の
 * `overflow-x-auto` の中に置いて `min-w` で下限を切る。
 * 表を折り返して縦に潰すと5列の対応が読めなくなる一方、`body` を横に溢れさせるのは論外
 * （画面全体が横に揺れる）。**溢れるのはこの箱の中だけ**にする。
 */
function MeishoTable() {
  const [rowHead, ...dataColumns] = SEISHU_MEISHO_COLUMNS

  return (
    <Block id="meisho-table">
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
    </Block>
  )
}

/** 表のセルは短縮形なので、セルだけでは何を測っているのか分からない。定義と出典を併記する */
function MeishoDefinitions() {
  return (
    <Block id="meisho-terms">
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
    </Block>
  )
}

/**
 * 8種のどれにも当たらない清酒。**上の表から導ける事実だけを書く**（要件を満たさない酒がある）。
 *
 * 「普通酒」という呼び名は**このアプリが確認できていない**。告示にこの語があるかを原文で
 * 確かめていないので、**慣習の呼び名として紹介するだけにして「告示の語ではない」とも断定しない**
 * （`無濾過` などに対して取っているのと同じ態度。確かめていないことを確かめたように書かない）。
 */
function OtherSeishu() {
  return (
    <Block id="meisho-other">
      <p className={BODY}>
        上の8種は<b>名乗るための条件</b>で、清酒がこの8つに分かれるという意味ではない。原料・精米歩合・こうじ米使用割合のどれかが要件から外れる清酒は、8種のどの名称も表示できないだけで、清酒であることは変わらない。
      </p>
      <p className={BODY}>
        こうした酒は一般に「普通酒」と呼ばれる。ただしこの呼び名が告示にある語かどうかは原文で確かめていないので、ここでは<b>慣習の呼び名として紹介するにとどめる</b>。
      </p>
      <p className={NOTE}>
        統計タブの「11語のどれにも当たらない本数」は、こうした酒と、スペック欄が未記入の記録の両方を含む。分けて数えてはいない。
      </p>
    </Block>
  )
}

/**
 * 季節の呼び名。**このページで唯一「法令ではない語」を正面から載せる節**。
 *
 * 告示の逐語表と地続きに見えないよう、**語ごとに「慣習」のバッジを付ける**
 * （`STYLE_TERM_ORIGIN_LABELS` と同じ見た目の語彙を使い、出所の違いだけを載せ替える）。
 * 中身は `seasonalTerms.ts`。時期を断定しないこと・味の優劣を書かないことはあちらの頭注。
 */
function SeasonalTermList() {
  return (
    <div>
      <p className={BODY}>
        ラベルや店先で見る季節の語。<b>告示の用語ではなく、蔵や酒屋が使う慣習の呼び名</b>で、特定名称（名称タブ）のような要件は無い。時期は目安で、蔵や地域で前後する。
      </p>
      <dl className="mt-2 flex flex-col divide-y divide-line border-y border-line">
        {SEASONAL_TERMS.map((entry) => (
          <div key={entry.term} className="py-1.5">
            <dt className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="whitespace-nowrap text-xs font-medium text-ink">{entry.term}</span>
              <span className="whitespace-nowrap rounded border border-line-strong px-1.5 py-px text-[11px] leading-4 text-ink-muted">
                {SEASONAL_ORIGIN_LABEL}
              </span>
              <span className="whitespace-nowrap text-[11px] text-ink-faint">{entry.season}</span>
            </dt>
            <dd className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">{entry.meaning}</dd>
          </div>
        ))}
      </dl>
      <p className={NOTE}>
        このアプリはこれらの語で何も判定していない（季節で絞り込む機能は無い）。ただし
        しぼりたて と ひやおろし はスペック欄の11語に入っているので、スペック欄に書けば統計タブのスタイル分布に数えられる。
      </p>
    </div>
  )
}

/**
 * 11語 × 出所の3値。**表をやめて縦積みにしてある** — 3列の表は 390px で横スクロールが要り、
 * 上の8種の表と2つ並ぶと画面が横に揺れているように見えた。行ごとに「語 → 出所 → 定義」を
 * 積めば折り返しで収まる。
 *
 * **この節の要点は3つ目の状態**（このアプリが決めたルール）で、告示由来の表の隣に出所を
 * 書かずに並べると、アプリ独自の規則が法令由来に見える。
 * 語と出所の対応は `styleTermOrigin.ts` が持ち、ここは描画だけ。
 */
function StyleTermOrigins() {
  return (
    <Block id="meisho-style-terms">
      <p className={BODY}>
        統計タブのスタイル分布が数える11語。この11語は同じ出所から来ていない。告示に定義がある語、語そのものは告示に無く要件の組み合わせとして読める語、告示に定義を確認できていない語が混ざっている。
      </p>

      <dl className="mt-2 flex flex-col divide-y divide-line border-y border-line">
        {STYLE_TERMS.map((term) => {
          const origin = STYLE_TERM_ORIGINS[term]
          return (
            <div key={term} className="py-1.5">
              <dt className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="whitespace-nowrap text-xs font-medium text-ink">{term}</span>
                <span
                  className={`whitespace-nowrap rounded border px-1.5 py-px text-[11px] leading-4 ${STYLE_TERM_ORIGIN_CLASSES[origin.kind]}`}
                >
                  {STYLE_TERM_ORIGIN_LABELS[origin.kind]}
                </span>
              </dt>
              <dd className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
                {originDefinition(origin)}
              </dd>
            </div>
          )
        })}
      </dl>

      <p className={NOTE}>
        「確認できていない」の4語（無濾過・ひやおろし・しぼりたて・にごり）は、上の告示の本文に1度も出てこない。ここでは定義を書かない。かわりに「法令上の定義は無い」と断定もしない
        —
        他の法令・通達・業界の自主基準まで網羅して調べたわけではないので、無いと言えるだけの根拠がこちらに無い。
      </p>
      <p className={NOTE}>
        このうち ひやおろし と しぼりたて が何を指す語かは、下の「季節の呼び名」にある。<b>慣習としての説明</b>で、告示の定義ではない（だからこの表の「定義」欄には書いていない）。
      </p>

      {/* 3つ目の状態。**法令の表と地続きに見えないよう帯にする**(notice-* は注記の箱にだけ使う) */}
      <p className="mt-2 rounded border border-notice-line bg-notice-surface px-2.5 py-2 text-xs leading-relaxed text-notice-ink">
        この11語という語彙の選び方、部分一致で判定すること、1本を複数の語に重複計上すること、スペック欄だけを見ることは、<b>すべてこのアプリが決めたルール</b>で、どの法令にも書いていない。告示は「この名称を表示できる条件」を定めているだけで、記録の数え方は定めていない。
      </p>

      <p className={NOTE}>
        特定名称の正式な名前には「酒」が付き（純米酒・大吟醸酒）、11語のほうは付かない。部分一致なので、スペック欄に「純米酒」と書いてあれば「純米」に当たる。
      </p>
    </Block>
  )
}

/**
 * 出所ごとの「定義」。**`unconfirmed` には定義を書かない**（推測で埋めない）。
 * `switch` を網羅させているので、`StyleTermOrigin` に状態が増えると
 * 戻り値が `undefined` を含んで型エラーになる（分類し忘れが空欄として出ない）。
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
// タブ5. 出典とライセンス
//
// クレジットの置き場。**フッタから外した CC-BY の4項目がここと産地タブにある。**
// CC-BY-4.0 §3(a)(1) は作者・タイトル・ライセンスへのリンク・改変した旨の表示を求め、
// §3(a)(2) の「URI で必要情報の場所を示す」枝はこのアプリでは使えない
// （URL ルーティングを持たないので、この画面を指す URL が作れない）。
// だから**地図を描く産地タブに併記し、ここにも同じものを置く**。
//
// 4項目そのものは `MapCredit` が持ち、このファイルでは書き直さない
// （同じ義務の文面を2箇所に書くと、片方だけ直したときに義務違反に気付けない）。
// ---------------------------------------------------------------------------

function SakenowaSource() {
  return (
    <Block id="sources-sakenowa">
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
    </Block>
  )
}

/** 見出しで「県形状」を繰り返さない。`MapCredit` の文が「産地マップの県形状は…」で始まる */
function MapSource() {
  return (
    <Block id="sources-map">
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
    </Block>
  )
}

function OcrSource() {
  return (
    <Block id="sources-ocr">
      <p className={BODY}>
        ラベル写真から銘柄の候補を出す処理は、tesseract.js を使って端末内で動かしている。写真を端末の外に出さないため、実行に必要な wasm・worker・学習データは同一オリジンから配信している（クラウドの OCR や第三者の CDN は使わない）。tesseract.js
        本体・コア・学習データはいずれも Apache-2.0。
      </p>
      <p className={NOTE}>
        Apache-2.0 が求めるのは配布物への告知で、画面での表示義務は無い（さけのわデータや CC BY
        4.0 と違って、表示を条件にする条項が無い）。それでもここに書いておく。同梱している成果物・入手元・改変の一覧はリポジトリの docs/THIRD_PARTY.md にある。
      </p>
    </Block>
  )
}

function NtaSource() {
  return (
    <Block id="sources-nta">
      <p className={BODY}>
        特定名称の表と「原酒」の定義は、国税庁の告示と概要ページから逐語で写した（
        {NTA_FETCHED_ON} 取得。リンクは「名称」タブにある）。法令・告示は著作権法13条により著作権の目的とならないので利用の許諾は要らないが、原文に戻れるように出典と取得日を書いている。
      </p>
    </Block>
  )
}
