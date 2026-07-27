// 6軸レーダー。**自作 SVG**(チャートライブラリを入れない)。
//
// ## 平均1枚で終わらせない
//
// 太い多角形が平均、細い多角形が記録1本ずつ。平均だけを描くと 185本がどれだけ散らばっているかが
// 消え、中心寄りの丸い形だけが残る(平均は必ず内側に寄る)。記録ごとの薄い線を重ねると
// 「なぞっている領域」が面として読める。**空白地帯は `ScatterPlot` 側の担当**で、
// レーダーは6軸を1枚に畳んだ側面しか見せない(SPEC「レーダー1枚で終わらせない」)。
//
// ## 白背景での2層の区別(濃さ + 太さの2つで切る)
//
// 平均 = `stroke-plot-ink` の実線 1.8px + `fill-plot-ink/10` の面。
// 記録1本ずつ = 同じ `plot-ink` の **20%** で 0.6px。**色相を変えずに不透明度と太さで割る**ので、
// 「同じ量の違う見せ方」であることが図から読める(別の色を足すと2種類のデータに見える)。
// 15% では白地に溶けて消える(暗い地に明るい線を薄く置いていたときの値がそれ)。20% は1本でも
// 線として見え、重なると 2本で 36% / 3本で 49% / 5本で 67% と急に濃くなるので密度が面になる。
// 白地での実効値: 1本 = #d4d4d4(対白 1.48)/ 2本 2.14 / 3本 2.96。平均の線は 14.89 で、
// 記録1本に対して 10.05 ある(平均が最も濃い、は太さだけでなく濃さでも成立している)。
//
// ## 目盛りと外周の濃さ(**外周だけはデータ層より濃い**。意図的)
//
// - 目盛り(`plot-grid` = 同心多角形と軸線)は対白 1.27 で、**記録層より薄い**(対 1.17)。
//   目盛りの上を記録の線が通っても記録が勝つ。
// - 外周(`plot-axis` = 値 100 の枠)は対白 2.56 で、**記録層より濃い**(対 1.73)。
//   白地では 1.00〜1.48 の間に目盛りと枠を2段入れると 1.1 刻みになって両方消えるので、
//   「全部をデータ層より薄く」は成立しない。外周はデータではなく図の範囲を示す構造なので
//   濃さで勝ってよく、データとの区別は**面を持つのは平均だけ**・**正六角形＝枠と目盛り /
//   不定形＝データ**で付ける。値の詳細は `src/index.css` のグラフ節が持つ。
//
// ## 持たないもの
//
// - **集計**。平均も分母も `domain/flavor.ts` の `computeFlavor` が出した値をそのまま描く。
//   ここで points から平均を取り直すと、分母の規則(status で外すのか brandId で外すのか)が
//   二重実装になる(BACKLOG B29 / B1(3))。
// - **軸ラベルの表**。`./flavorAxes.ts` の1箇所から引く。
// - **点の銘柄名**。重なった線に名前を付けても読めないうえ、スクリーンショットに台帳が
//   写る面を増やす(B24)。`FlavorPoint.label` は意図して使わない。
//
// ## 単位
//
// `f1..f6` は **0-100 の整数**(さけのわ原値の 0.0-1.0 ではない)。0.0-1.0 を渡すと例外は出ず、
// 全点が中心に潰れた図として現れる。半径への写像はこのファイルの `radiusOf` 1箇所だけが行う。

import { FLAVOR_AXIS_KEYS, type FlavorAxes, type FlavorPoint } from '../../domain/flavor.ts'
import { FLAVOR_AXIS_LABELS, FLAVOR_AXIS_UNITS } from './flavorAxes.ts'

export type RadarChartProps = {
  /** 6軸の平均。**丸めない実数**が来る(表示の桁数を決めるのはこの層) */
  axes: FlavorAxes
  /** 記録1本ずつ。薄い多角形で重ねる。空なら平均だけを描く */
  points?: readonly FlavorPoint[]
}

// viewBox の座標系。実寸は外側の `w-full` に任せる(`<svg>` に width/height 属性を付けない —
// 付けると index.css の `img { height: auto }` と違って効く規則が無く、比率が崩れる)
const VIEW_W = 260
const VIEW_H = 240
const CX = 130
const CY = 112
/** 値 100 の半径 */
const R = 76
/** ラベルを置く半径。R より外側に出す */
const LABEL_R = 96
/** 同心の六角形。100 は外周そのものなので目盛り線としては描かない */
const RINGS = [25, 50, 75] as const

/** 軸の向き。**`flavorAxes.ts` が持つ**(「知る」の軸配置図と同じ並びを引くため) */
const UNIT = FLAVOR_AXIS_UNITS

/**
 * 値 → 半径。**0-100 の外は端に寄せ、数でない値は 0 にする**(NaN を座標に流すと
 * その多角形だけが黙って消える)。数でない平均は数字の側で `—` として格下げ表示する。
 */
function radiusOf(value: number): number {
  if (!Number.isFinite(value)) return 0
  return (Math.min(100, Math.max(0, value)) / 100) * R
}

function vertex(index: number, radius: number): string {
  const unit = UNIT[index]
  return `${(CX + unit.x * radius).toFixed(2)},${(CY + unit.y * radius).toFixed(2)}`
}

/** 同心六角形(全軸同じ半径) */
function ringPoints(value: number): string {
  const radius = (value / 100) * R
  return UNIT.map((_, index) => vertex(index, radius)).join(' ')
}

function axesPoints(axes: FlavorAxes): string {
  return FLAVOR_AXIS_KEYS.map((key, index) => vertex(index, radiusOf(axes[key]))).join(' ')
}

/**
 * 平均の表示。**小数第1位まで出す** — 整数に丸めると分母が 185 → 190 に動いても
 * 数字が変わらないことがあり、「紐付けが分母に効いた」ことが画面から読めなくなる。
 * 数でない値は `—`(0 と書くと「軸の値が 0」という別の意味になる)。
 */
function formatAverage(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '—'
}

/** ラベルの寄せ。左右の軸は外向きに寄せないと図に文字が重なる */
function anchorOf(index: number): 'start' | 'middle' | 'end' {
  const { x } = UNIT[index]
  if (x > 0.1) return 'start'
  if (x < -0.1) return 'end'
  return 'middle'
}

export function RadarChart({ axes, points = [] }: RadarChartProps) {
  return (
    <svg
      viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
      className="h-auto w-full max-w-[19rem] text-ink"
    >
      <title>6軸の平均。太い線が平均、細い線が記録1本ずつ</title>

      {/* 目盛りと軸は控えめに(データの線より目立たせない) */}
      {RINGS.map((ring) => (
        <polygon
          key={ring}
          points={ringPoints(ring)}
          className="fill-none stroke-plot-grid"
          strokeWidth={0.8}
        />
      ))}
      {UNIT.map((_, index) => (
        <line
          key={FLAVOR_AXIS_KEYS[index]}
          x1={CX}
          y1={CY}
          x2={CX + UNIT[index].x * R}
          y2={CY + UNIT[index].y * R}
          className="stroke-plot-grid"
          strokeWidth={0.8}
        />
      ))}
      <polygon
        points={ringPoints(100)}
        className="fill-none stroke-plot-axis"
        strokeWidth={0.8}
      />

      {/* 記録1本ずつ。重なりの濃さがそのまま密度になる(点の名前は出さない) */}
      {points.map((point) => (
        <polygon
          key={point.recordId}
          points={axesPoints(point.axes)}
          className="fill-none stroke-plot-ink/20"
          strokeWidth={0.6}
        />
      ))}

      {/* 平均。最後に描いて細い線の上に出す */}
      <polygon
        points={axesPoints(axes)}
        className="fill-plot-ink/10 stroke-plot-ink"
        strokeWidth={1.8}
      />

      {FLAVOR_AXIS_KEYS.map((key, index) => {
        const unit = UNIT[index]
        const x = CX + unit.x * LABEL_R
        const y = CY + unit.y * LABEL_R
        const anchor = anchorOf(index)
        return (
          <g key={key}>
            <text x={x} y={y} textAnchor={anchor} className="fill-ink-muted text-[11px]">
              {FLAVOR_AXIS_LABELS[key]}
            </text>
            <text x={x} y={y + 13} textAnchor={anchor} className="fill-ink text-[10px]">
              {formatAverage(axes[key])}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
