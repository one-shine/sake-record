// 47都道府県の一覧。**地図の相棒**で、地図の欠点を引き受けるのがこの表の役割。
//
// 実形状の地図を選んだ副作用が2つある:
//   1. 香川・大阪のような小県はタップ標的が数px しかなく、塗りも面積が無いので色が読めない
//   2. 塗りは段(5段)なので、県の正確な本数は地図から読めない
// この表は**47県すべてを行として持ち**、県名と本数を文字で出し、押せる標的を44px 近くまで
// 広げて上の2つを埋める。**0本の県も行として出す**(未進出が読めることが存在理由)。
//
// ## 並びは押して切り替える。`<select>` は使わない(ルール4)
//
// 既定は本数の多い順 — この画面の問いは「どこの酒を飲んでいるか」なので、答えが上に来る並びを
// 既定にする。「北から順」(JIS コード順)は自分の県や旅程を探すときの並びで、こちらは
// 名前の位置が固定なので目で追える。**どちらの並びでも 47行すべて出す**(絞り込みではない)。
//
// ## 棒は行の背景に敷く
//
// 棒を別の列にすると、県名・本数・棒で3列になって 390px では県名が2文字で折り返す。
// 行の背景に敷けば列が増えず、長さの比較もできる。**棒の色は地図と同じ段の色**を使う
// (`FILL_STEPS[step].swatch`)ので、表の行と地図の県が同じ色で対応する。

import { useMemo, useState } from 'react'
import { FILL_STEPS } from './fillSteps.ts'
import { buildPrefectureRows, type PrefectureOrder } from './areaRows.ts'

type Props = {
  /** `computeStats()` の `byPrefectureCode`。**未出現の県はキーが無い**ので行側が `?? 0` で読む */
  byPrefectureCode: ReadonlyMap<number, number>
  /** 地図で強調している県。`null` は未選択 */
  selectedCode: number | null
  /** 行を押したとき。同じ行をもう一度押すと `null`(選択解除)を渡す */
  onSelect: (code: number | null) => void
}

const ORDERS: readonly { id: PrefectureOrder; label: string }[] = [
  { id: 'count', label: '本数順' },
  { id: 'jis', label: '北から順' },
]

export function PrefectureList({ byPrefectureCode, selectedCode, onSelect }: Props) {
  const [order, setOrder] = useState<PrefectureOrder>('count')
  const rows = useMemo(() => buildPrefectureRows(byPrefectureCode, order), [byPrefectureCode, order])

  // 棒の基準。**最大本数を基準にする**(合計にすると 22/203 で棒が全部潰れて比較できない)。
  // 0本しか無いときは 0 除算を避けて棒を出さない
  const max = rows.reduce((largest, row) => Math.max(largest, row.count), 0)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      {/* 対で折り返しを直す: 行に flex-wrap + gap-y、原子ラベルに whitespace-nowrap */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="whitespace-nowrap text-xs font-semibold text-stone-200">都道府県</h3>
        <span className="whitespace-nowrap text-[11px] text-stone-500">{rows.length}県</span>
        <div className="ml-auto flex flex-wrap gap-1">
          {ORDERS.map((option) => {
            const active = option.id === order
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => setOrder(option.id)}
                className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] ${
                  active
                    ? 'border-stone-200 bg-stone-200 text-stone-900'
                    : 'border-stone-700 text-stone-300'
                }`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      <ol aria-label="都道府県の一覧" className="grid grid-cols-1 gap-y-0.5 sm:grid-cols-2 sm:gap-x-3">
        {rows.map((row) => {
          const active = row.code === selectedCode
          const empty = row.count === 0
          return (
            <li key={row.code}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(active ? null : row.code)}
                className={`relative flex w-full items-baseline gap-x-2 overflow-hidden rounded border px-2 py-1.5 text-left ${
                  active ? 'border-stone-300 bg-stone-800/60' : 'border-transparent'
                }`}
              >
                {/* 棒は背景。opacity を下げて上の文字が読める濃さに保つ */}
                {max > 0 && row.count > 0 && (
                  <span
                    aria-hidden="true"
                    className={`absolute inset-y-0 left-0 ${FILL_STEPS[row.step].swatch} opacity-30`}
                    style={{ width: `${String(Math.round((row.count / max) * 100))}%` }}
                  />
                )}
                <span
                  className={`relative min-w-0 flex-1 truncate text-xs ${
                    empty ? 'text-stone-500' : 'text-stone-100'
                  }`}
                >
                  {row.name}
                </span>
                {/* 「未進出」と書く。0本 と書くと「集計から漏れた県」と見分けが付かない */}
                <span
                  className={`relative w-11 shrink-0 whitespace-nowrap text-right text-xs ${
                    empty ? 'text-stone-500' : 'text-stone-200'
                  }`}
                >
                  {empty ? '未進出' : `${String(row.count)}本`}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
