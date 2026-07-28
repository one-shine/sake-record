// 「知る」タブ。**日本酒の話と、この画面の数字の出し方をまとめた面**。
//
// ## 何を載せるか
//
// **平易さを優先する**（私用の記録アプリなので、法令上の厳密さは求めない — 利用者の判断）。
// 出所の3値バッジ・「確認できていない」の断り・慣習の印はすべて外してある。
// 読む人にとって中身より注釈のほうが多い状態だったため。
//
// **書かないもの**: 味の優劣・銘柄の評価・「◯◯すべき」という飲み方の指南。
//
// ## 6つの下位タブ（読む人の関心で割る）
//
// 1枚に積むと 390px で 5,000px を超え、読みたい1トピックに着くまでが全部スクロールだった。
// **割って1画面に1トピックだけ出す**。
//
//   種類 → ラベル → 季節 → 産地 → 味   … 日本酒そのものの話（この面の主）
//   アプリ                              … 保存・数え方・紐付け・出典（付随）
//
// **実装の都合で割らない。** もとは「このアプリの数え方」を先頭に置いていたが、
// 読む人には何の話か分からなかった（利用者の指摘）。画面ごとの数え方は、
// その話題のタブの中（味の分母・産地の地図の見方）か「アプリ」タブに置く。
//
// タブ帯は `sticky` で上端に貼り付くので、どこまで読んでも別のトピックへ移れる。
// 切り替えたら**スクロール位置を先頭へ戻す**（`AppShell` が上位タブでやっているのと同じ理由）。
//
// **義務のある表示が畳んだ側に落ちないこと。** さけのわのクレジットは全画面のフッタ（`Attribution`）
// にあり、地図の CC-BY 4項目は**使用箇所である産地タブ**に併記してある。この面の「アプリ」タブは
// その再掲なので、既定で開いていなくても義務は満たされる。フッタの「出典とライセンス」は
// **アプリタブを開き、出典の節まで送った状態で**「知る」に着く。
//
// ## 文字の羅列にしない
//
// 6軸は**軸の配置図**（`AxisMap`）、味タグは**種類ごとの語のチップと上位語の棒**、
// 産地は**蔵の数の棒**と**塗り分けの5段のスウォッチ**（`FILL_STEPS`）で見せる。
// 数値は実装か同梱データから引いた値で、説明のために作った数字は無い。
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
import {
  AREA_NOTES,
  BREWERY_FEW,
  BREWERY_TOP,
  BREWERY_TOTAL,
  SAKE_RICE,
} from './areaFacts.ts'
import { SEASONAL_TERMS } from './seasonalTerms.ts'
import {
  FLAVOR_TAG_AT_CAP,
  FLAVOR_TAG_BELOW_CAP,
  FLAVOR_TAG_BRANDS,
  FLAVOR_TAG_CAP,
  FLAVOR_TAG_GROUPS,
  FLAVOR_TAG_TOP_SHARES,
  FLAVOR_TAG_VOCABULARY,
} from './flavorTagGroups.ts'
import {
  LEARN_DEFAULT_PANEL,
  LEARN_PANELS,
  LEARN_SOURCES_PANEL,
  LEARN_SOURCES_SUB,
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
import { LABEL_TERMS, SAKE_NUMBERS, SPEC_TERM_NOTES } from './sakeTerms.ts'

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
   * 開いた直後に見せる下位タブ。フッタの「出典とライセンス」から「アプリ」タブで来る。
   * **記録には依存しない**（この面が props で受け取るのはどこを開くかだけ）。
   */
  initialPanel?: LearnPanelId
}

export function Learn({ initialPanel }: Props) {
  const [panel, setPanel] = useState<LearnPanelId>(initialPanel ?? LEARN_DEFAULT_PANEL)
  const rootRef = useRef<HTMLElement>(null)
  const firstRender = useRef(true)

  // フッタの「出典とライセンス」から来たときは、**出典の節まで送る**。
  // 出典は「アプリ」タブの後半にあるので、タブを開くだけだと押したラベルの行き先が画面に無い。
  // `scrollIntoView` はこの jsdom に定義が無いので optional call（`AppShell.test.tsx` の頭注）。
  useEffect(() => {
    if (initialPanel !== LEARN_SOURCES_PANEL) return
    document.getElementById(subDomId(LEARN_SOURCES_SUB))?.scrollIntoView?.({ block: 'start' })
  }, [initialPanel])

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
        {id === 'types' && (
          <>
            <WhatIsSake />
            <MeishoTable />
          </>
        )}
        {id === 'label' && (
          <>
            <SpecTermNotes />
            <SakeNumbers />
          </>
        )}
        {id === 'season' && <SeasonalTermList />}
        {id === 'area' && (
          <>
            <AreaRegions />
            <BreweryCounts />
            <SakeRiceList />
            <AreaMapNotes />
          </>
        )}
        {id === 'flavor' && (
          <>
            <FlavorAxisLegend />
            <FlavorTagNotes />
          </>
        )}
        {id === 'app' && (
          <>
            <StorageNotes />
            <StyleCounting />
            <LinkStatusLegend />
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
      日本酒の語と、この画面に出る数字をまとめたもの。個人用の記録アプリなので、細かい定義よりも読んで分かることを優先している。
    </p>
  )
}

// ---------------------------------------------------------------------------
// タブ1. このアプリの数え方
// ---------------------------------------------------------------------------

/** 統計タブのスタイル分布の規則。画面に出ている短文（`Dashboard.tsx`）の長い版 */
function StyleCounting() {
  return (
    <Block id="app-counting">
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
    <Block id="app-link">
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
    <Block id="app-storage">
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
        {`さけのわが銘柄ごとに持つ短い語。語彙は${String(FLAVOR_TAG_VOCABULARY)}語で、記録タブの絞り込みに使う。以下の数字は同梱データを数えたもので、データを取り直せば変わる。`}
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
// タブ4. 産地
// ---------------------------------------------------------------------------

/** 土地ごとの手がかり。**県名を味に直結させない**（いまは蔵ごとの差のほうが大きい） */
function AreaRegions() {
  return (
    <Block id="area-regions">
      <dl className={`${BODY} flex flex-col gap-2`}>
        {AREA_NOTES.map(({ title, note }) => (
          <div key={title}>
            <dt className="text-xs font-medium text-ink">{title}</dt>
            <dd className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">{note}</dd>
          </div>
        ))}
      </dl>
    </Block>
  )
}

/**
 * 蔵の数。**同梱データ（さけのわ）を数えた値**で、棒で多い少ないが見える形にする。
 * 数値は `areaFacts.ts` のリテラル（取り直すとずれるので取得時期を併記する）。
 */
function BreweryCounts() {
  const max = BREWERY_TOP[0]?.count ?? 1

  return (
    <Block id="area-breweries">
      <p className={BODY}>
        {`同梱データに載っている蔵は ${BREWERY_TOTAL.toLocaleString('ja-JP')}。${String(PREFECTURE_TOTAL)}都道府県すべてに蔵があるが、数は大きく偏る。`}
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {BREWERY_TOP.map(({ name, count }) => (
          <li key={name} className="flex items-center gap-2">
            <span className="w-16 shrink-0 whitespace-nowrap text-[11px] text-ink">{name}</span>
            {/* 棒は SVG。`w-[59%]` のような文字列連結のクラスは本番で消える */}
            <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="h-1.5 flex-1">
              <rect x="0" y="0" width="100" height="6" className="fill-surface-raised" />
              <rect
                x="0"
                y="0"
                width={Math.round((count / max) * 100)}
                height="6"
                className="fill-plot-ink"
              />
            </svg>
            <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-ink-muted">
              {count}
            </span>
          </li>
        ))}
      </ul>
      <p className={NOTE}>
        {`少ないほうは ${BREWERY_FEW.map((row) => `${row.name} ${String(row.count)}`).join(' / ')} など。蔵の数と飲む機会は比例しないので、産地タブが白いのは「その県の酒が少ない」ではなく「まだ飲んでいない」ということ。`}
      </p>
    </Block>
  )
}

/** 酒米。**産地と結びつけて覚えられる形**にする（銘柄選びの手がかりになる） */
function SakeRiceList() {
  return (
    <Block id="area-rice">
      <p className={BODY}>
        ラベルに書かれる米の名前。品種によって味の傾向が語られることが多い。
      </p>
      <dl className="mt-2 flex flex-col divide-y divide-line border-y border-line">
        {SAKE_RICE.map(({ title, note }) => (
          <div key={title} className="flex flex-wrap gap-x-2 py-1.5">
            <dt className="w-20 shrink-0 whitespace-nowrap text-xs font-medium text-ink">{title}</dt>
            <dd className="min-w-40 flex-1 text-[11px] leading-relaxed text-ink-muted">{note}</dd>
          </div>
        ))}
      </dl>
      <p className={NOTE}>
        水も土地ごとに違う。硬い水は発酵が進みやすく、やわらかい水はおだやかな酒になると言われる。
      </p>
    </Block>
  )
}

/**
 * 産地タブの地図の見方。**塗り分けの段は `FILL_STEPS` を走査**する
 * （凡例と地図が同じ1箇所から色を引く）。県の出所と地図に載らない記録の話もここにまとめる。
 */
function AreaMapNotes() {
  return (
    <Block id="area-map">
      <p className={BODY}>
        産地タブは記録の「都道府県」欄を数える。銘柄を選ぶと<b>その銘柄の蔵元の所在地</b>が初期値として入り、手で直せる。酒米の産地でも、飲んだ店の場所でもない。
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
          <b>多いほど濃い。</b>
          未進出（0本）だけ色味を持たないので、行っていない県が一目で分かる。
        </li>
        <li>
          県が1つに決まらない記録（未記入・「◯◯または△△」など）は<b>地図に塗れなかった N本</b>として地図の外に出る。近い県に丸めない。
        </li>
        <li>塗った本数と塗れなかった本数を足すと全本数になる。</li>
      </ul>
    </Block>
  )
}


// ---------------------------------------------------------------------------
// タブ4. 日本酒の基礎
// ---------------------------------------------------------------------------

/** どういう酒なのか。**この面で唯一「アプリの外の話」を正面から書く節** */
function WhatIsSake() {
  return (
    <Block id="types-what">
      <p className={BODY}>
        米・米こうじ・水を発酵させ、漉して造る酒。アルコール分は 22度未満で、15度前後のものが多い。同じ原料でも漉さずに造ればどぶろくになり、蒸留すれば米焼酎になる。
      </p>
      <p className={BODY}>
        「清酒」は酒税法の分類名で、「日本酒」は<b>国産米を使って日本国内で造ったもの</b>を指す呼び方。海外で造られた清酒は日本酒とは呼ばない。
      </p>
      <p className={BODY}>
        造りの流れはおおむね次のとおり。<b>米を磨く → 蒸す → こうじを造る → 酒母（酵母を育てる）→ もろみを仕込む → 搾る → 火入れして貯蔵</b>。仕込みは3回に分けて足していくのが一般的で、これを三段仕込みという。
      </p>
      <p className={NOTE}>
        仕込みは冬にやることが多く、造りの年度は 7月から翌年6月で数える。だから秋に出る酒と春に出る酒は同じ年度の酒でも状態が違う（「季節」タブ）。
      </p>
    </Block>
  )
}

/**
 * 特定名称の8種類。**表は 390px でも読めることが要件**なので、親の `overflow-x-auto` の中に
 * 置いて `min-w` で下限を切る。表を折り返して縦に潰すと5列の対応が読めなくなる一方、
 * `body` を横に溢れさせるのは論外（画面全体が横に揺れる）。**溢れるのはこの箱の中だけ**にする。
 *
 * 中身は国税庁の告示から写した値（`seishuMeisho.ts`）。**純米酒の精米歩合は要件が無い**ので
 * `−` を出す（かつての「70%以下」は改正で削除済み。`Learn.test.tsx` が固定している）。
 */
function MeishoTable() {
  const [rowHead, ...dataColumns] = SEISHU_MEISHO_COLUMNS

  return (
    <Block id="types-meisho">
      <p className={BODY}>
        原料と精米歩合が一定の条件を満たすと名乗れる8つの名前。ラベルの一番目立つところに書いてあることが多い。
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
        {`精米歩合の「${NO_REQUIREMENT}」は条件が無いという意味（純米酒に精米歩合の決まりは無い）。こうじ米使用割合15%以上は8種すべてに共通する。`}
      </p>

      <dl className={`${BODY} flex flex-col gap-1`}>
        {SEISHU_MEISHO_DEFINITIONS.map(({ term, definition }) => (
          <div key={term}>
            <dt className="inline font-medium text-ink">{term}</dt>
            <dd className="inline">{` — ${definition}`}</dd>
          </div>
        ))}
      </dl>

      <p className={NOTE}>
        この8つに当てはまらない清酒もある（一般に普通酒と呼ばれる）。条件を満たさない・名乗っていないというだけで、味が劣るという意味ではない。
      </p>
    </Block>
  )
}

/**
 * ラベルの語。**11語の説明は `SPEC_TERM_NOTES` から引く**（`STYLE_TERMS` を走査するので、
 * 統計が数える語と画面の説明が同じ集合になる）。11語の外の語は `LABEL_TERMS`。
 */
function SpecTermNotes() {
  return (
    <Block id="label-terms">
      <p className={BODY}>
        スペック欄に書くとスタイル分布に数えられる11語（上から順に）。
      </p>
      <dl className="mt-2 flex flex-col divide-y divide-line border-y border-line">
        {STYLE_TERMS.map((term) => (
          <div key={term} className="flex flex-wrap gap-x-2 py-1.5">
            <dt className="w-20 shrink-0 whitespace-nowrap text-xs font-medium text-ink">{term}</dt>
            <dd className="min-w-40 flex-1 text-[11px] leading-relaxed text-ink-muted">
              {SPEC_TERM_NOTES[term]}
            </dd>
          </div>
        ))}
      </dl>

      <p className={`${BODY} mt-4`}>11語には入っていないが、ラベルでよく見る語。</p>
      <dl className="mt-2 flex flex-col divide-y divide-line border-y border-line">
        {LABEL_TERMS.map(({ term, note }) => (
          <div key={term} className="flex flex-wrap gap-x-2 py-1.5">
            <dt className="w-20 shrink-0 whitespace-nowrap text-xs font-medium text-ink">{term}</dt>
            <dd className="min-w-40 flex-1 text-[11px] leading-relaxed text-ink-muted">{note}</dd>
          </div>
        ))}
      </dl>
    </Block>
  )
}

/** ラベルの数字。**目安であって規格ではない**ことを添える */
function SakeNumbers() {
  return (
    <Block id="label-numbers">
      <dl className={`${BODY} flex flex-col gap-1.5`}>
        {SAKE_NUMBERS.map(({ name, note }) => (
          <div key={name}>
            <dt className="inline font-medium text-ink">{name}</dt>
            <dd className="inline">{` — ${note}`}</dd>
          </div>
        ))}
      </dl>
      <p className={NOTE}>
        日本酒度と酸度は蔵が公開していないこともある。書いていないから品質が低いという話ではない。
      </p>
    </Block>
  )
}

// ---------------------------------------------------------------------------
// タブ5. 季節の呼び名
// ---------------------------------------------------------------------------

/** 中身は `seasonalTerms.ts`。時期は幅で書く（蔵や地域で前後する） */
function SeasonalTermList() {
  return (
    <div>
      <p className={BODY}>
        ラベルや店先で見る季節の語。同じ蔵の酒でも、出る時期によって呼び名と味が変わる。
      </p>
      <dl className="mt-2 flex flex-col divide-y divide-line border-y border-line">
        {SEASONAL_TERMS.map((entry) => (
          <div key={entry.term} className="py-1.5">
            <dt className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="whitespace-nowrap text-xs font-medium text-ink">{entry.term}</span>
              <span className="whitespace-nowrap text-[11px] text-ink-faint">{entry.season}</span>
            </dt>
            <dd className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">{entry.meaning}</dd>
          </div>
        ))}
      </dl>
      <p className={NOTE}>
        時期は目安で、蔵や地域で前後する。しぼりたて と ひやおろし はスペック欄の11語に入っているので、書けば統計タブのスタイル分布に数えられる。
      </p>
    </div>
  )
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
    <Block id="app-sakenowa">
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
    <Block id="app-map">
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
    <Block id="app-ocr">
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
    <Block id="app-nta">
      <p className={BODY}>
        「日本酒」タブの特定名称8種の表は、国税庁の告示と概要ページから写した（{NTA_FETCHED_ON}{' '}
        取得）:{' '}
        <a href={NTA_KOKUJI_URL} target="_blank" rel="noreferrer" className={LINK}>
          清酒の製法品質表示基準を定める件
        </a>
        {' / '}
        <a href={NTA_GAIYO_URL} target="_blank" rel="noreferrer" className={LINK}>
          「清酒の製法品質表示基準」の概要
        </a>
        。手で写したもので改正に追随する仕組みは無いので、取得日を出している。
      </p>
      <p className={NOTE}>
        表以外の説明（ラベルの語・数字・季節の呼び名）は一般的な言い方をまとめたもので、法令の条文ではない。個人用の記録アプリなので、細かい定義よりも読んで分かることを優先している。
      </p>
    </Block>
  )
}
