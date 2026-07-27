// 6軸の配置図。**味タブのレーダーの「どの角が何の軸か」を読むための凡例**で、データではない。
//
// ## 値を描かない
//
// 架空の値で多角形を描くと、**このページが「推定で埋めた値は無い」と書いている面**なのに
// 実データに見える図が1つ混ざる。ここに描くのは枠（値100の六角形）と軸線とラベルだけで、
// 中身は空にしてある。「読み方」は位置の対応さえ分かれば足りる。
//
// ## 並びは `FLAVOR_AXIS_UNITS` から引く
//
// f1 が真上・時計回りに60°、という向きを**このファイルにも書くとレーダーとずれる**
// （凡例だけが古い並びのまま正しく見える、という壊れ方をする）。角度の出所は1つ。

import { FLAVOR_AXIS_KEYS } from '../../domain/flavor.ts'
import { FLAVOR_AXIS_LABELS, FLAVOR_AXIS_UNITS } from '../FlavorMap/flavorAxes.ts'

const VIEW_W = 260
const VIEW_H = 200
const CX = 130
const CY = 96
/** 値 100 の半径（レーダーと同じ意味の枠） */
const R = 62
/** ラベルを置く半径。枠より外に出す */
const LABEL_R = 82

function point(index: number, radius: number): { x: number; y: number } {
  const unit = FLAVOR_AXIS_UNITS[index]
  if (unit === undefined) throw new Error(`軸 ${String(index)} の向きが無い`)
  return { x: CX + unit.x * radius, y: CY + unit.y * radius }
}

/** ラベルの寄せ。左右の軸は外向きに寄せないと図に文字が重なる（レーダーと同じ規則） */
function anchorOf(index: number): 'start' | 'middle' | 'end' {
  const unit = FLAVOR_AXIS_UNITS[index]
  if (unit === undefined) return 'middle'
  if (unit.x > 0.1) return 'start'
  if (unit.x < -0.1) return 'end'
  return 'middle'
}

export function AxisMap() {
  const frame = FLAVOR_AXIS_KEYS.map((_, index) => {
    const { x, y } = point(index, R)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')

  return (
    <svg
      viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
      className="h-auto w-full max-w-[17rem] text-ink"
    >
      <title>6軸の並び。真上が華やかで、時計回りに芳醇・重厚・穏やか・ドライ・軽快</title>

      <polygon points={frame} className="fill-none stroke-plot-axis" strokeWidth={1} />

      {FLAVOR_AXIS_KEYS.map((key, index) => {
        const end = point(index, R)
        const label = point(index, LABEL_R)
        return (
          <g key={key}>
            <line
              x1={CX}
              y1={CY}
              x2={end.x}
              y2={end.y}
              className="stroke-plot-grid"
              strokeWidth={0.8}
            />
            <text
              x={label.x}
              y={label.y}
              textAnchor={anchorOf(index)}
              dominantBaseline="middle"
              className="fill-current text-[11px]"
            >
              {FLAVOR_AXIS_LABELS[key]}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
