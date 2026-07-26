// 候補の一覧。**候補(表記一致)と全件検索の両方が同じ行の形で出る**(選ぶ前に見える材料を
// 入口ごとに変えない)。行の材料の組み方は `./candidateRows.ts`、この .tsx は描画だけを持つ。
//
// ## この一覧が引き受けている約束
//
// 1. **0件を0件として出す。** 一致しなければ「該当なし」を出し、全件(3264件)に広げない
//    (brain: 定義域外のキーでルックアップが全件にフォールバックしてはならない)。
// 2. **推定しない。** 都道府県に辿れない銘柄・蔵元名がデータに無い銘柄・フレーバーチャートが
//    無い銘柄を、それぞれ「無い」と書く。空欄にすると取得できているように見える。
// 3. **押せる的を1行=1ボタンにする。** 行全体がボタンで、読み上げ名は `aria-label` で
//    「<銘柄> を選ぶ」に固定する(行の付随情報が全部名前に連結されると押す物を選べない)。

import type { ReactNode } from 'react'
import type { SakenowaBrand } from '../../domain/types.ts'
import type { CandidateRow } from './candidateRows.ts'

type Props = {
  rows: readonly CandidateRow[]
  onChoose: (brand: SakenowaBrand) => void
  disabled?: boolean
  /** 0件のときに出す文言。**打てる次の手を書く**(ここで全件に広げない) */
  emptyNote: ReactNode
  /** 上限で切ったときに出す文言 */
  truncatedNote?: ReactNode
}

/** 短い原子ラベルは語中で折らせない。折り返しは容器側の flex-wrap + gap-y が受ける */
const PILL = 'whitespace-nowrap rounded border border-line-strong px-1.5 py-px text-[11px] leading-4'

export function CandidateList({ rows, onChoose, disabled = false, emptyNote, truncatedNote }: Props) {
  if (rows.length === 0) {
    return <p className="mt-2 text-xs leading-relaxed text-ink-muted">{emptyNote}</p>
  }

  return (
    <>
      <ul className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <li key={row.brand.id}>
            <button
              type="button"
              onClick={() => {
                onChoose(row.brand)
              }}
              disabled={disabled}
              aria-label={`${row.brand.name} を選ぶ`}
              className="block w-full rounded border border-line-strong bg-canvas px-3 py-2 text-left disabled:opacity-50"
            >
              {/* 銘柄名(長い)と印(短い原子)を同じ行に並べるので、行側で折り返しを受ける */}
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-ink">{row.brand.name}</span>
                {row.samePrefecture && (
                  <span className={`${PILL} border-ok-line text-ok-ink`}>
                    記録と同じ都道府県
                  </span>
                )}
              </span>
              <span className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-ink-muted">
                <span className="whitespace-nowrap">
                  {row.prefecture ?? '都道府県がデータに無い'}
                </span>
                <span className="whitespace-nowrap">{row.breweryName ?? '蔵元名がデータに無い'}</span>
                <span className="whitespace-nowrap">
                  {row.hasFlavorChart ? 'フレーバーあり' : 'フレーバー無し'}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {truncatedNote !== undefined && (
        <p className="mt-2 text-xs leading-relaxed text-ink-faint">{truncatedNote}</p>
      )}
    </>
  )
}
