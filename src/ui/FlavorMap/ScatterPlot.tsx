// 2軸射影1面の散布図。**自作 SVG**(チャートライブラリを入れない)。
//
// ## この図の主役は空白地帯
//
// 点(飲んだ記録)より先に、`domain/flavor.ts` が数えた 4×4 のセルを描く:
// 記録があるセルは本数に応じて濃く(白地なので「多い＝濃い」。`currentColor` = `plot-ink` を
// `fillOpacity` 0.08〜0.42 で薄めて塗る)、**1本も無いセルは網掛け + 破線**にする。
// 「なぞった領域」と「空白地帯」を同じ面の上に並べないと、どちらも相対的に読めない。
//
// 色だけで空白を区別しない(網掛けという模様と、`FlavorMap` 側の度数表の数字が二重の手掛かり)。
// 網掛けは CVD・印刷・forced-colors でも残る。
//
// ## 白地では「網掛け」と「無地」の差が最小のセルとの差になる
//
// 1本しか無いセルは `plot-ink` 8% ≒ ごく薄い灰色で、白との差は小さい。だから空白セルの側は
// **中性の灰色から外す**: ハッチも破線の枠も `accent`(暖色1色)にして、
// 「色味がある = 空白」「灰色 = 記録がある」で切る。濃さの差ではなく色味と模様の差なので、
// 最も薄い記録セル(8%)と隣り合っても混ざらない。枠は記録のあるセルが `plot-cell-line` の実線、
// 空白が `accent/50` の破線で、線種でも別になる。
//
// 記録セルの枠が**レーダーの目盛り(`plot-grid`)と別のトークン**なのはこのため:
// セルは自身が塗られているので、目盛りの薄さ(対白 1.27)だと最も薄いセル(対白 1.16)の上で
// 対比 1.03 になり隣のセルとの切れ目が消える。`plot-cell-line` は最も薄いセルで 1.27 /
// 最も濃いセル(42%)で 1.68 を持つ。
//
// ## 持たないもの
//
// - **ビン分け**。`counts[xBin][yBin]` は `computeFlavor` の `grids` をそのまま描く。
//   ここで `flavorBinIndex` を呼び直すと分割規則が二重実装になる。
// - **点の銘柄名**。重なった点の tooltip は当たり判定が不確実で、スクリーンショットに台帳が
//   写る面を増やすだけになる(B24)。`FlavorPoint.label` は意図して使わない。
// - **面の選択**。どの面を描くかは親が決める(この図は渡された1面だけを描く)。

import { FLAVOR_BINS, type FlavorGrid, type FlavorPoint } from '../../domain/flavor.ts'
import { FLAVOR_AXIS_LABELS, flavorFaceKey, flavorFaceLabel } from './flavorAxes.ts'

export type ScatterPlotProps = {
  /** 描く1面。`counts[xBin][yBin]` の向き(x が先)は domain の約束 */
  grid: FlavorGrid
  /** 記録1本ずつ。**面ごとに絞らない**(どの点も6軸すべて持っているので、この面に射影する) */
  points: readonly FlavorPoint[]
}

const VIEW_W = 280
const VIEW_H = 240
const PAD_L = 40
const PAD_R = 12
const PAD_T = 12
const PAD_B = 44
const PLOT_W = VIEW_W - PAD_L - PAD_R
const PLOT_H = VIEW_H - PAD_T - PAD_B
/** 値 0 の y(下端)。値が増えると上に行く */
const BASE_Y = VIEW_H - PAD_B

const BIN_COUNT = FLAVOR_BINS.length
/** 目盛り。ビンの境界と一致させる(境界が読めないと空白セルの範囲も読めない) */
const TICKS = Array.from({ length: BIN_COUNT + 1 }, (_, index) => (index / BIN_COUNT) * 100)

function clampValue(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function toX(value: number): number {
  return PAD_L + (clampValue(value) / 100) * PLOT_W
}

function toY(value: number): number {
  return BASE_Y - (clampValue(value) / 100) * PLOT_H
}

/** ビン番号 → 値域の下端・上端(4等分の境界。`FLAVOR_BINS` の整数の閉区間と同じ切れ目) */
function binEdges(index: number): { from: number; to: number } {
  return { from: (index / BIN_COUNT) * 100, to: ((index + 1) / BIN_COUNT) * 100 }
}

export function ScatterPlot({ grid, points }: ScatterPlotProps) {
  const [xAxis, yAxis] = grid.axes
  // 面ごとに一意な id。同じ図が2つ並んでも <defs> が衝突しない
  const hatchId = `flavor-gap-hatch-${flavorFaceKey(grid.axes)}`
  const maxCount = Math.max(0, ...grid.counts.flatMap((row) => [...row]))

  return (
    <svg
      viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
      className="h-auto w-full max-w-[22rem] text-plot-ink"
    >
      <title>{`${flavorFaceLabel(grid.axes)} の散布図。網掛けのセルは記録が1本も無い`}</title>

      <defs>
        <pattern
          id={hatchId}
          width={5}
          height={5}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={5}
            className="stroke-accent/60"
            strokeWidth={0.8}
          />
        </pattern>
      </defs>

      {/* セル。**点より先に描く**(背景として読ませる) */}
      {grid.counts.map((row, xBin) =>
        row.map((count, yBin) => {
          const x = binEdges(xBin)
          const y = binEdges(yBin)
          const empty = count === 0
          return (
            <rect
              key={`${String(xBin)}-${String(yBin)}`}
              x={toX(x.from)}
              y={toY(y.to)}
              width={toX(x.to) - toX(x.from)}
              height={toY(y.from) - toY(y.to)}
              fill={empty ? `url(#${hatchId})` : 'currentColor'}
              // maxCount が 0 のときは全セルが空白なのでこの枝に来ない(0除算しない)
              fillOpacity={empty ? 1 : 0.08 + 0.34 * (count / maxCount)}
              className={empty ? 'stroke-accent/50' : 'stroke-plot-cell-line'}
              strokeWidth={0.6}
              strokeDasharray={empty ? '2 2' : undefined}
            />
          )
        }),
      )}

      {/* 点。重なりが密度になる。縁取りは重なった点が1つの塊に溶けないようにするため */}
      {points.map((point) => (
        <circle
          key={point.recordId}
          cx={toX(point.axes[xAxis])}
          cy={toY(point.axes[yAxis])}
          r={2.4}
          className="fill-plot-ink/70 stroke-canvas"
          strokeWidth={0.6}
        />
      ))}

      {/* 目盛り。0〜100 を明示する(単位が 0.0-1.0 でないことがここで読める) */}
      {TICKS.map((tick) => (
        <text
          key={`x${String(tick)}`}
          x={toX(tick)}
          y={BASE_Y + 12}
          textAnchor="middle"
          className="fill-ink-muted text-[9px]"
        >
          {tick}
        </text>
      ))}
      {TICKS.map((tick) => (
        <text
          key={`y${String(tick)}`}
          x={PAD_L - 5}
          y={toY(tick) + 3}
          textAnchor="end"
          className="fill-ink-muted text-[9px]"
        >
          {tick}
        </text>
      ))}

      <text
        x={PAD_L + PLOT_W / 2}
        y={VIEW_H - 8}
        textAnchor="middle"
        className="fill-ink-muted text-[11px]"
      >
        {FLAVOR_AXIS_LABELS[xAxis]}
      </text>
      <text
        x={12}
        y={PAD_T + PLOT_H / 2}
        textAnchor="middle"
        transform={`rotate(-90 12 ${String(PAD_T + PLOT_H / 2)})`}
        className="fill-ink-muted text-[11px]"
      >
        {FLAVOR_AXIS_LABELS[yAxis]}
      </text>
    </svg>
  )
}
