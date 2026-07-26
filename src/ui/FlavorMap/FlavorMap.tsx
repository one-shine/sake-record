// フレーバー分布(A5 の表示側)。**この画面の主目的は「分母を常設すること」**。
//
// ## 分母を常設する(BACKLOG B29 / B1(3) の恒久策)
//
// 「203本中185本のデータで集計」と、取れなかった18本の**内訳3種**を常に画面に出す。
// 手動紐付けで185→190に変われば、この画面の数字がそのまま変わる(親が読み直した記録を渡すだけで
// よいように、この画面は記録をキャッシュしない)。
//
// **分母は `computeFlavor` の `denominator` から引く。** 画面側で `records.filter(...)` と
// 数え直すと、規則(status で外すのか brandId で外すのか)が二重実装になり、片方だけ直したときに
// 分母が食い違う。`summarize()`(取り込み内訳)が brandId だけで数えるのと違って、こちらは
// status を先に見る — 壊れた記録(unlinked なのに brandId がある)で両者はずれる。
//
// ## 3種を潰さない
//
// 未紐付け / 銘柄不明 / チャート無し は**別の状態**で、件数が 0 でも行を消さない
// (`紐付け済み186 ≠ フレーバー取得済み185` の差の1本は「チャート無し」にしか現れない)。
// 未紐付け・銘柄不明の**推定値は入れない**。件数だけを出す。
//
// ## レーダー1枚で終わらせない
//
// SPEC は「自分がなぞっている味の領域と**空白地帯**」を求めている。平均のレーダーは6軸を1枚に
// 畳んだ側面でしかなく、空白は写らない(平均は必ず内側に寄る)。そこで
// `computeFlavor` の `grids` / `gaps`(2軸射影15面 × 16セル)を散布図と度数表で見せる。
//
// ## 持たないもの
//
// - **集計**。平均・分母・度数・空白セルはすべて `domain/flavor.ts` の戻り値。
//   ビン分けもここでやり直さない(`FLAVOR_BINS` は範囲の表示にだけ使う)。
// - **`linkStatus` のラベル**。`../Timeline/linkStatus.ts` の対応表から引く(単一の真実源)。
// - **軸ラベルの表**。`./flavorAxes.ts` から引く。
// - **テーブルの取得状態**。`flavorChartByBrandId` は**読み終わった表**が渡される前提で、
//   取得失敗は親が先に出す。空の Map を渡すと紐付き全件が「チャート無し」になり、
//   「さけのわにチャートが無い」と嘘をつくことになる(`domain/flavor.ts` の前提)。

import { useMemo, useState } from 'react'
import {
  FLAVOR_BINS,
  computeFlavor,
  type FlavorGrid,
  type FlavorSummary,
} from '../../domain/flavor.ts'
import type { FlavorChart, SakeRecord } from '../../domain/types.ts'
import { linkStatusBadge } from '../Timeline/linkStatus.ts'
import { RadarChart } from './RadarChart.tsx'
import { ScatterPlot } from './ScatterPlot.tsx'
import { FLAVOR_AXIS_LABELS, flavorFaceKey, flavorFaceLabel } from './flavorAxes.ts'

export type FlavorMapProps = {
  /**
   * 集計する記録。**書き込みの後に読み直した一覧をそのまま渡す**(この画面は記録を持たない)。
   * 手動紐付けで `linkStatus` が変わると、次の描画で分母が動く。
   */
  records: readonly SakeRecord[]
  /**
   * `DecodedTables.flavorChartByBrandId` をそのまま渡す。**取得に失敗しているときは
   * この画面を出さない**(空の Map は「上流にチャートが無い」の意味になってしまう)。
   */
  flavorChartByBrandId: ReadonlyMap<number, FlavorChart>
}

/** Timeline / EmptyState と同じ器。1280px でも本文が左端に張り付かない(B16) */
const CONTAINER = 'mx-auto w-full max-w-3xl px-4'

/** 1面のセル数。分割数は `FLAVOR_BINS` の1箇所が持つ(4 を直に書かない) */
const CELLS_PER_FACE = FLAVOR_BINS.length * FLAVOR_BINS.length

export function FlavorMap({ records, flavorChartByBrandId }: FlavorMapProps) {
  const summary = useMemo(
    () => computeFlavor(records, flavorChartByBrandId),
    [records, flavorChartByBrandId],
  )
  const grids = summary.grids

  // 面の選択。`grids` は 6軸から2つ取る15面で**記録が0本でも同じ15面が返る**(domain の約束)ので、
  // 初期値の `grids[0]` は常に存在する。状態は表示ラベルではなく軸の対のキーで持つ
  const [faceKey, setFaceKey] = useState<string>(() => flavorFaceKey(grids[0].axes))
  const selected = grids.find((grid) => flavorFaceKey(grid.axes) === faceKey) ?? grids[0]

  // 面ごとの空白セル数。**`gaps` を面で束ねるだけ**で、ビン分けをやり直さない。
  // 出てこない面は空白0(定義域外のキーで別の面の値に落ちない)
  const emptyByFace = useMemo(() => {
    const map = new Map<string, number>()
    for (const gap of summary.gaps) {
      const key = flavorFaceKey(gap.axes)
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [summary.gaps])

  return (
    <section className={`${CONTAINER} py-4`}>
      <h2 className="text-sm font-semibold text-ink">フレーバー分布</h2>

      {summary.total === 0 ? (
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          記録が1本も無いので集計できない。記録タブから JSON を取り込むか記録を1本作ると、ここに6軸の分布が出る。
        </p>
      ) : (
        <>
          <Denominator summary={summary} />
          <AverageSection summary={summary} />
          <CoverageSection
            summary={summary}
            selected={selected}
            emptyByFace={emptyByFace}
            onSelectFace={setFaceKey}
          />
        </>
      )}
    </section>
  )
}

/**
 * 分母と内訳。**この画面で最初に読める位置に常設する**(紐付け直後に分母を見る導線が
 * どこにも無かったのが B29)。
 */
function Denominator({ summary }: { summary: FlavorSummary }) {
  const { total, denominator, missing } = summary
  const missingTotal = missing.unlinked + missing.unknown + missing.linkedWithoutChart
  // total が 0 のこの分岐は呼ばれないが、割り算の側で 0 を除いておく(NaN% を出さない)。
  // **切り上げない**(floor): 202/203 を四捨五入すると 100% になり、18本欠けているのに
  // 「全部集計できた」と読める。丸めるなら確信を下げる向きに丸める
  const share = total === 0 ? null : Math.floor((denominator / total) * 100)

  const unlinked = linkStatusBadge('unlinked')
  const unknown = linkStatusBadge('unknown')

  /** 3種は別の状態。**件数0でも行を消さない**(消すと 186 と 185 の差の出所が読めなくなる) */
  const rows = [
    { key: 'unlinked', label: unlinked.label, count: missing.unlinked, help: unlinked.help },
    { key: 'unknown', label: unknown.label, count: missing.unknown, help: unknown.help },
    {
      key: 'linkedWithoutChart',
      label: 'チャート無し',
      count: missing.linkedWithoutChart,
      help: '銘柄には紐付いているが、さけのわにフレーバーの行が無い（紐付け済み ≠ フレーバー取得済み）',
    },
  ]

  return (
    <div className="mt-2 rounded border border-line bg-surface px-3 py-2.5">
      <p className="text-sm leading-relaxed text-ink">
        {total}本中 {denominator}本のデータで集計
        {share === null ? '' : `（${String(share)}%）`}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        フレーバー未取得は {missingTotal}本。内訳は次の3種で、いずれも6軸の集計から外してある。
      </p>
      <ul className="mt-1.5 space-y-1">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
            <span className="whitespace-nowrap text-ink-muted">{row.label}</span>
            <span className="whitespace-nowrap text-ink">{row.count}本</span>
            <span className="min-w-0 leading-relaxed text-ink-faint">{row.help}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs leading-relaxed text-ink-faint">
        未紐付けと銘柄不明に推定値は入れない（0で埋めると平均が静かに下振れする）。記録タブで手動紐付けすると銘柄が決まり、この分母が増える。
      </p>
    </div>
  )
}

/** 6軸の平均。分母0のときは**数値を1つも出さない**(0 で埋めた平均を描かない) */
function AverageSection({ summary }: { summary: FlavorSummary }) {
  return (
    <section className="mt-5 border-t border-line pt-4">
      <h3 className="text-xs font-semibold text-ink-muted">6軸の平均</h3>
      {summary.axes === null ? (
        <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
          フレーバーを取得できた記録が0本なので平均を出せない。0で埋めた平均は出さない（穏やかで軽快な酒として描かれてしまう）。
        </p>
      ) : (
        <>
          <div className="mt-2">
            <RadarChart axes={summary.axes} points={summary.points} />
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
            太い線が平均（{summary.denominator}本）。細い線は記録1本ずつで、重なりの濃さが密度になる。各軸 0〜100
            で、同心の六角形は 25 / 50 / 75。さけのわの銘柄データの値で、本人の評価ではない。
          </p>
        </>
      )}
    </section>
  )
}

type CoverageSectionProps = {
  summary: FlavorSummary
  selected: FlavorGrid
  emptyByFace: ReadonlyMap<string, number>
  onSelectFace: (key: string) => void
}

/** なぞった領域と空白地帯。散布図・度数表・面ごとの空白の3つで同じ `grids` / `gaps` を読む */
function CoverageSection({ summary, selected, emptyByFace, onSelectFace }: CoverageSectionProps) {
  const faceCount = summary.grids.length
  const totalCells = faceCount * CELLS_PER_FACE
  const selectedEmpty = emptyByFace.get(flavorFaceKey(selected.axes)) ?? 0

  return (
    <section className="mt-5 border-t border-line pt-4">
      <h3 className="text-xs font-semibold text-ink-muted">なぞった領域と空白地帯</h3>

      {summary.denominator === 0 ? (
        <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
          フレーバーを取得できた記録が0本なので、なぞった領域も空白地帯も判定できない。分母が増えると、ここに2軸
          {faceCount}面の分布が出る。
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            2軸{faceCount}面 × {CELLS_PER_FACE}セル = {totalCells}セル中 {summary.gaps.length}
            セルに記録が1本も無い。
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-faint">
            6軸すべての組み合わせ（{FLAVOR_BINS.length}の6乗 ={' '}
            {FLAVOR_BINS.length ** 6}セル）では数えない。{summary.total}
            本では原理的に埋まらず、空白が「まだ飲んでいない」ではなく「次元が高い」ことの帰結になるため。
          </p>

          <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-ink">
            <span className="whitespace-nowrap font-medium">{flavorFaceLabel(selected.axes)}</span>
            <span className="whitespace-nowrap text-ink-muted">
              {CELLS_PER_FACE}セル中 {selectedEmpty}セルが空白
            </span>
          </p>

          <div className="mt-2">
            <ScatterPlot grid={selected} points={summary.points} />
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
            網掛けのセルは記録が1本も無い（まだ飲んでいない領域）。濃いセルは本数が多い。点は記録1本ずつ。
          </p>

          <CoverageTable grid={selected} />

          <p className="mt-4 text-xs text-ink-muted">面ごとの空白。押すと図と度数表が切り替わる。</p>
          <ul className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {summary.grids.map((grid) => {
              const key = flavorFaceKey(grid.axes)
              const active = key === flavorFaceKey(selected.axes)
              return (
                <li key={key}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectFace(key)}
                    className={`flex w-full flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 rounded border px-2 py-1 text-left text-xs ${
                      active
                        ? 'border-ink bg-surface-raised text-ink'
                        : 'border-line text-ink-muted'
                    }`}
                  >
                    <span className="whitespace-nowrap">{flavorFaceLabel(grid.axes)}</span>
                    <span className="whitespace-nowrap text-ink-muted">
                      空白 {emptyByFace.get(key) ?? 0}/{CELLS_PER_FACE}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}

/**
 * 選んだ面の度数表。図の網掛けと同じ情報を数字で持つ(色・模様だけに頼らない読み手のための面)。
 *
 * 行は上が高い側で散布図の向きに合わせる。範囲はビンの閉区間をそのまま出す
 * (`0〜24` / `25〜49` … の切れ目が読めないと、空白セルがどの味の領域かが分からない)。
 */
function CoverageTable({ grid }: { grid: FlavorGrid }) {
  const [xAxis, yAxis] = grid.axes
  const xLabel = FLAVOR_AXIS_LABELS[xAxis]
  const yLabel = FLAVOR_AXIS_LABELS[yAxis]
  // 行は y の高い側から
  const yBins = [...FLAVOR_BINS.keys()].reverse()

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-auto border-collapse text-xs">
        <caption className="caption-top pb-1 text-left text-xs leading-relaxed text-ink-faint">
          度数表。縦が{yLabel}、横が{xLabel}。0 のセルが空白地帯
        </caption>
        <thead>
          <tr>
            <th scope="col" className="border border-line px-1.5 py-1 font-normal text-ink-faint">
              <span className="whitespace-nowrap">
                {yLabel} ＼ {xLabel}
              </span>
            </th>
            {FLAVOR_BINS.map((bin, xBin) => (
              <th
                key={xBin}
                scope="col"
                className="border border-line px-1.5 py-1 font-normal text-ink-muted"
              >
                <span className="whitespace-nowrap">
                  {bin.min}〜{bin.max}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {yBins.map((yBin) => (
            <tr key={yBin}>
              <th
                scope="row"
                className="border border-line px-1.5 py-1 text-right font-normal text-ink-muted"
              >
                <span className="whitespace-nowrap">
                  {FLAVOR_BINS[yBin].min}〜{FLAVOR_BINS[yBin].max}
                </span>
              </th>
              {FLAVOR_BINS.map((_, xBin) => {
                // `counts[xBin][yBin]`(x が先)は domain の約束。取り違えると図と表がずれる
                const count = grid.counts[xBin][yBin]
                const empty = count === 0
                return (
                  <td
                    key={xBin}
                    title={empty ? '空白（記録が1本も無い）' : undefined}
                    className={`border px-1.5 py-1 text-right ${
                      empty
                        ? 'border-notice-line bg-notice-surface text-notice-ink'
                        : 'border-line text-ink'
                    }`}
                  >
                    {count}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
