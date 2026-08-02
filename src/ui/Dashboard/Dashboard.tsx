// 統計画面(A10)。**唯一の数値受け入れ基準を出す面**なので、この画面の役目は
// `domain/stats.ts` の戻り値を「取り違えようのない形で」並べることに尽きる。
//
// ## この画面が数えない
//
// **本数を数える実装は `computeStats` の1本だけ**(A10)。しかもその**呼び出し自体が App の
// 1箇所**で、この画面は戻り値を受け取るだけにしてある(産地マップが同じ `Stats` を共有する。
// 2箇所で呼ぶと入力の取り違えで統計と産地の本数が静かに食い違う)。
//
// そのため**記録の配列はこの画面に届かない** — `records.filter(...).length` を書こうにも
// 材料が無い。このファイルに出てくる算術は `stats` の**戻り値に対する引き算/足し算だけ**で、
// 記録の配列を走査しない(`sumCounts` も `stats` の行に対してだけ使う)。
//
// 紐付けの内訳(`auto`/`alias`/…)と**フレーバーの分母**もここでは数えない。
// 前者は取り込みパネルの `summarize()`、後者は `domain/flavor.ts` が持つ
// (**紐付け済み ≠ フレーバー取得済み**という区別はあちらの関心。ここに持ち込むと3つ目の定義になる)。
//
// ## 丸めない・混ぜない(この画面の要件はほぼこれ)
//
// 集計の外に落ちる記録を「その他」に押し込んで見えなくしない。別枠は4つあり、いずれも
// **件数を数字で出す**:
//   - 日付が `YYYY-MM-DD` として読めない記録 → 年別の外
//   - 県名として1つに決まらない表記(`静岡県または京都府`) → 独自の区分。近い県に丸めない
//   - 都道府県が未記入 → 県別の合計に含めない
//   - 未評価 → 評価分布に含めない(0点として数えない)
// スタイル分布は**重複計上**(1本が複数の語に入る)なので、合計が総本数を超える理由を
// 画面に書く。書かないと数え間違いに見える。
//
// ## 年の 0 埋めは表示の関心
//
// `stats.years` は**観測された年だけ**を返す(誤入力の年1件で空の年が数十行生えるのを
// 避けるため。`stats.ts` が明示的に表示側へ委譲している)。時間軸として読めるように
// ここで間の年を0本で埋めるが、**範囲が広すぎるときは埋めない**(委譲された理由がそこにある)。

import { NO_PREFECTURE_LABEL } from '../../domain/prefecture.ts'
import type { Stats, UnresolvedPrefectureCount, YearCount } from '../../domain/stats.ts'
import { BarList, ColumnChart, type BarRow } from './charts.tsx'
import type { TimelineSeed } from '../Timeline/Timeline.tsx'
import { isStyleTerm } from '../../domain/stats.ts'
import { isRating } from '../../domain/backupSchema.ts'

type Props = {
  /**
   * `computeStats(records)` の戻り値。**この画面では数えない**(上の「この画面が数えない」)。
   * 記録が読めていないあいだは**渡さない**のが呼び側の責任 — 空配列から作った `Stats` を
   * 渡すと `total === 0` の空状態が出て「記録が0本」と嘘をつく(読めなかっただけなのに)。
   */
  stats: Stats
  /**
   * 棒を押したときに記録タブへ渡す絞り込み。**渡さなければ棒を押せない見た目のまま**にする
   * (押しても何も起きない行を並べない)。
   */
  onOpenRecords?: (seed: TimelineSeed) => void
}

/** Timeline / EmptyState と同じ器。1280px でも本文が左端に張り付かない(B16) */
const CONTAINER = 'mx-auto w-full max-w-3xl px-4'

const SECTION_HEADING = 'text-xs font-semibold text-ink-muted'
const CAPTION = 'mt-1 text-xs leading-relaxed text-ink-faint'
const NOTE = 'mt-2 text-xs leading-relaxed text-ink-faint'

/**
 * 年を0本で埋める上限(この年数までなら連続軸にする)。
 *
 * 実台帳は2020-2026の7年なので通常は連続軸。`drankOn` に `1900-01-01` のような誤入力が
 * 1件入ると範囲が126年になり、連続軸のままでは1列あたり数pxで年ラベルも読めない
 * (=分布が読めない)。そのときは観測された年だけを並べ、**軸が連続でないことを画面に書く**。
 */
const MAX_CONTINUOUS_SPAN = 12

/** 各節が共有する面。導線は**渡されたときだけ**押せる形にする */
type SectionProps = { stats: Stats; onOpen?: (seed: TimelineSeed) => void }

export function Dashboard({ stats, onOpenRecords }: Props) {
  if (stats.total === 0) return <EmptyStats />

  return (
    <section aria-label="統計" className={`${CONTAINER} flex flex-col gap-6 py-4`}>
      <TotalSection stats={stats} />
      <YearSection stats={stats} onOpen={onOpenRecords} />
      <PrefectureSection stats={stats} onOpen={onOpenRecords} />
      <StyleSection stats={stats} onOpen={onOpenRecords} />
      <RatingSection stats={stats} onOpen={onOpenRecords} />

      <p className="border-t border-line pt-3 text-xs leading-relaxed text-ink-faint">
        棒の長さは各節の最大値を基準にした相対値で、本数は必ず数字で併記している。紐付けの内訳とフレーバーの分母はこの画面では数えない（「味」タブが持つ。紐付け済みとフレーバー取得済みは同じ数ではない）。
      </p>
    </section>
  )
}

function TotalSection({ stats }: { stats: Stats }) {
  return (
    <div>
      <h2 className={SECTION_HEADING}>総本数</h2>
      {/* 数字(大)と単位(小)を同じ行に置くので、行に flex-wrap + gap-y、単位に nowrap */}
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-3xl font-semibold leading-none tracking-tight text-ink">
          {stats.total}
        </span>
        <span className="whitespace-nowrap text-sm text-ink-muted">本の記録</span>
      </p>
      <p className={CAPTION}>
        {`この端末に保存されている記録を数えた値。以下の年別・都道府県別・スタイル・評価はすべて同じ ${String(stats.total)}本 から数えている。`}
      </p>
    </div>
  )
}

function YearSection({ stats, onOpen }: SectionProps) {
  const { rows, continuous } = yearColumns(stats.years)
  return (
    <div>
      <h2 className={SECTION_HEADING}>年別</h2>
      {rows.length === 0 ? (
        <p className={CAPTION}>年として読める日付を持つ記録が1本も無い。</p>
      ) : (
        <>
          <ColumnChart
            label="年別の本数"
            rows={rows}
            // 行の key は年そのもの(`yearColumns` が作る)
            onSelect={onOpen && ((row) => onOpen({ year: row.key }))}
          />
          <p className={NOTE}>
            {continuous
              ? '記録が無い年も0本の柱として置き、年の間隔をそのまま横幅にしている。'
              : '記録が無い年の柱は置いていない。年の幅が広すぎて、空の柱で埋めると柱が細くなり分布が読めなくなるため（隣り合う柱の年が飛ぶ）。'}
          </p>
        </>
      )}
      {stats.undatedCount > 0 && (
        <p className={NOTE}>
          {`日付が YYYY-MM-DD として読めない記録 ${String(stats.undatedCount)}本。どの年にも振り分けず、この分布の外に置いている（先頭4桁を年として使うと、でっち上げの年ができる）。`}
        </p>
      )}
    </div>
  )
}

function PrefectureSection({ stats, onOpen }: SectionProps) {
  const resolvedRows: BarRow[] = stats.prefectures.map((entry) => ({
    key: String(entry.code),
    label: entry.name,
    count: entry.count,
  }))
  // 区分 = 解決できた県 + 「県名として決まらない表記」ごとの独自区分(実台帳では 33 + 1 = 34)
  const buckets = stats.prefectures.length + stats.unresolvedPrefectures.length
  // 空(未記入)以外の記録は必ずどれかの区分に入る(`computeStats` の分岐がそうなっている)。
  // ここで各行を足し直すのではなく引き算で出す — 足し算と実装が食い違ったら合計が嘘になる
  const inBuckets = stats.total - stats.noPrefectureCount
  const unresolvedTotal = sumCounts(stats.unresolvedPrefectures)
  const unmappable = unresolvedTotal + stats.noPrefectureCount

  return (
    <div>
      <h2 className={SECTION_HEADING}>都道府県別</h2>
      <p className={CAPTION}>
        {[
          `${String(buckets)}区分に${String(inBuckets)}本。`,
          stats.unresolvedPrefectures.length > 0
            ? `うち ${String(stats.unresolvedPrefectures.length)}区分（${String(unresolvedTotal)}本）は県名として1つに決まらない表記で、下に別枠で出す。`
            : '',
          stats.noPrefectureCount > 0
            ? `${NO_PREFECTURE_LABEL}の ${String(stats.noPrefectureCount)}本 はこの ${String(inBuckets)}本 に含めない。`
            : '',
        ].join('')}
      </p>
      {resolvedRows.length === 0 ? (
        <p className={NOTE}>都道府県として読める記録が1本も無い。</p>
      ) : (
        <BarList
        label="都道府県別の本数"
        rows={resolvedRows}
        // 行の key は都道府県コード。記録側は県名で絞るのでラベルを渡す
        onSelect={onOpen && ((row) => onOpen({ prefecture: { value: row.label } }))}
      />
      )}
      {unmappable > 0 && (
        <div className="mt-3 rounded border border-line px-3 py-2.5">
          <h3 className={SECTION_HEADING}>その他 / 不明</h3>
          <p className={CAPTION}>
            上の棒に混ぜていない記録。近い県や多数派の県に丸めない — 丸めると、県が分からない記録の分だけどこかの県が静かに太る。
          </p>
          <ul aria-label="都道府県が読めなかった記録" className="mt-2 flex flex-col gap-1.5">
            {stats.unresolvedPrefectures.map((entry) => (
              <li
                key={entry.label}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
              >
                <span className="min-w-0 break-words text-xs text-ink">{entry.label}</span>
                <span className="whitespace-nowrap text-xs text-ink">{entry.count}</span>
              </li>
            ))}
            {stats.noPrefectureCount > 0 && (
              <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 whitespace-nowrap text-xs text-ink">
                  {NO_PREFECTURE_LABEL}
                </span>
                <span className="whitespace-nowrap text-xs text-ink">
                  {stats.noPrefectureCount}
                </span>
              </li>
            )}
          </ul>
          <p className={NOTE}>
            {`合計 ${String(unmappable)}本 は都道府県が特定できていないので、上の棒にも産地マップの塗りにも出さない。`}
          </p>
        </div>
      )}
    </div>
  )
}

function StyleSection({ stats, onOpen }: SectionProps) {
  const rows: BarRow[] = stats.styles.map((entry) => ({
    key: entry.term,
    label: entry.term,
    count: entry.count,
  }))
  const unmatched = stats.total - stats.styleMatchedCount

  return (
    <div>
      <h2 className={SECTION_HEADING}>スタイル分布</h2>
      {/* 「重複計上」は必ず出す。合計が総本数を超えるのは定義どおりで、
          説明が無いと数え間違いに見える(PHASE_6 の完了条件) */}
      <p className={CAPTION}>
        {`スペック列だけを対象にした部分一致で、1本を複数の語に重複計上する（「純米大吟醸」の1本は「大吟醸」にも「純米」にも数える）。延べ ${String(stats.styleTotal)}件 が総本数 ${String(stats.total)}本 を超えるのは正しい。備考（メモ）は数えない。`}
      </p>
      <BarList
        label="スタイル別の本数"
        rows={rows}
        // 行の key はスタイルの語そのもの。**定義域外は無視する**(番人を通す)
        onSelect={onOpen && ((row) => {
          // **定義域外のキーで全件に戻さない**(番人を通してから渡す)
          if (isStyleTerm(row.key)) onOpen({ styleTerm: row.key })
        })}
      />
      <p className={NOTE}>
        {`1語以上に当たった記録 ${String(stats.styleMatchedCount)}本 / どの語にも当たらない記録 ${String(unmatched)}本（スペック未記入か、この語彙の外）。0件の語も行として残す — 行を消すと「0本だった」と「数えていない」が同じ見た目になる。`}
      </p>
    </div>
  )
}

function RatingSection({ stats, onOpen }: SectionProps) {
  const rows: BarRow[] = stats.ratings.map((entry) => ({
    key: String(entry.rating),
    // 「3」だけでは本数の列と見分けが付かない。詳細画面と同じ `N / 5` の表記に揃える
    label: `${String(entry.rating)} / 5`,
    count: entry.count,
  }))
  const rated = stats.total - stats.unratedCount

  return (
    <div>
      <h2 className={SECTION_HEADING}>評価</h2>
      <p className={CAPTION}>
        5段階の自己評価。未評価は分布に入れない（0点として数えると、評価の低い酒として並ぶ）。
      </p>
      <BarList
        label="評価別の本数"
        rows={rows}
        onSelect={onOpen && ((row) => {
          const value = Number(row.key)
          if (isRating(value)) onOpen({ rating: { value } })
        })}
      />
      <p className={NOTE}>
        {`評価済み ${String(rated)}本 / 未評価 ${String(stats.unratedCount)}本。${
          rated === 0
            ? 'まだ1本も評価を付けていないので 1〜5 はすべて0本。段そのものは消さずに残す（消すと分布の形が読めない）。'
            : ''
        }`}
      </p>
    </div>
  )
}

/**
 * 0本のときの画面。**「0」を並べた表を出さない** — 数えた結果の0と、数える元が1本も無い
 * 状態は別物で、同じ見た目にすると「集計が壊れている」と読める。
 *
 * 導線のボタンは置かない。取り込みと記録の入口は「記録」タブが持っていて、ここに置くと
 * ハンドラを親から通す必要があり(未配線だと押しても何も起きないボタンになる)、
 * タブバーで1タップの操作を二重に持つことになる。文言でタブを名指しする。
 */
function EmptyStats() {
  return (
    <section aria-label="統計" className={`${CONTAINER} py-6`}>
      <h2 className="text-sm font-semibold text-ink">まだ集計できる記録が無い</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
        記録が1本入ると、この画面に総本数・年別・都道府県別・スタイル分布（重複計上）・評価分布が同じ記録から出る。
      </p>
      <p className="mt-3 text-xs leading-relaxed text-ink-faint">
        「記録」タブから JSON を取り込むか、1本記録する。都道府県は銘柄の紐付けから埋まるので、統計のために県を手で入れる必要は無い。
      </p>
    </section>
  )
}

/**
 * 年の列。`stats.years` は昇順で**観測された年だけ**を持つ。
 *
 * 範囲が `MAX_CONTINUOUS_SPAN` 以内なら間の年を**0本の柱**で埋めて連続軸にする
 * (`?? 0` で読むのは「その年の記録が無い」という真の値。定義域外のキーに全件や既定値を
 * 返しているのではない)。範囲が広すぎるときは観測年だけを並べ、呼び側が
 * 「軸が連続でない」と書けるように `continuous: false` を返す。
 */
function yearColumns(years: readonly YearCount[]): { rows: BarRow[]; continuous: boolean } {
  const observed: BarRow[] = years.map((entry) => ({
    key: entry.year,
    label: entry.year,
    count: entry.count,
  }))
  if (years.length === 0) return { rows: observed, continuous: true }

  const first = Number(years[0].year)
  const last = Number(years[years.length - 1].year)
  // 'YYYY' は `computeStats` が正規表現で通した4桁だが、壊れた値が来たら埋めずに素で並べる
  if (!Number.isInteger(first) || !Number.isInteger(last)) return { rows: observed, continuous: false }
  if (last - first + 1 > MAX_CONTINUOUS_SPAN) return { rows: observed, continuous: false }

  const counts = new Map(years.map((entry) => [entry.year, entry.count]))
  const rows: BarRow[] = []
  for (let year = first; year <= last; year += 1) {
    const key = String(year)
    rows.push({ key, label: key, count: counts.get(key) ?? 0 })
  }
  return { rows, continuous: true }
}

/**
 * `stats` が返した行の件数を足す。**記録の配列は走査しない**(それは `computeStats` の仕事)。
 * 別枠の合計を出すためだけに使う。
 */
function sumCounts(entries: readonly UnresolvedPrefectureCount[]): number {
  let total = 0
  for (const entry of entries) total += entry.count
  return total
}
