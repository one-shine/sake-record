// 5段階評価 + **未評価**。SPEC は「5段階整数 + 未評価(null)」で、既存203本は全て未評価で入る。
//
// ## この部品が引き受けている決定
//
// 1. **未評価に戻せる。** 一度押したら外せない UI は不可(値を消す手段が無いと、誤タップが
//    そのまま台帳に残る)。押した数字をもう一度押すと `null` に戻り、`未評価に戻す` も出す
//    — トグルだけでは「戻せる」と気付けないので、明示のボタンを併置する。
// 2. **星ではなく数字。** 記録は 1〜5 の整数で、星は「4.5 が入るのでは」と読める。等幅数字
//    (index.css の font-variant-numeric)で桁も揃う。絵文字はアイコンに使わない(ルール8)。
// 3. **`null` と 0 を混ぜない。** 「未評価」は 0 点ではない。集計の分母から外す値なので、
//    ここでも 0 のボタンを作らない(0 を押せると「最低評価」と区別できなくなる)。

import type { Rating } from '../../domain/types.ts'

type Props = {
  value: Rating | null
  /** 同じ値を押し直したときは `null`(未評価)が来る */
  onChange: (value: Rating | null) => void
}

/** 5段階。`Rating` は 1..5 の union なのでここに 0 や 6 は書けない(型が防ぐ) */
const RATINGS: readonly Rating[] = [1, 2, 3, 4, 5]

export function RatingInput({ value, onChange }: Props) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-xs text-ink-muted">評価</legend>
      {/* 原子(数字ボタン・状態表示)は語中で折らせず、折り返しは行側で受ける(ルール4) */}
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        {RATINGS.map((rating) => {
          const active = value === rating
          return (
            <button
              key={rating}
              type="button"
              aria-label={`評価 ${String(rating)}`}
              aria-pressed={active}
              onClick={() => onChange(active ? null : rating)}
              className={`w-8 whitespace-nowrap rounded border py-1 text-sm ${
                active
                  ? 'border-ink bg-ink font-medium text-ink-inverted'
                  : 'border-line-strong text-ink-muted'
              }`}
            >
              {rating}
            </button>
          )
        })}
        <span className="whitespace-nowrap text-xs text-ink-muted">
          {value === null ? '未評価' : `${String(value)} / 5`}
        </span>
        {value !== null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="whitespace-nowrap rounded border border-line-strong px-2 py-1 text-xs text-ink-muted"
          >
            未評価に戻す
          </button>
        )}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-faint">
        評価は任意。未評価のまま保存できる（押した数字をもう一度押しても未評価に戻る）。
      </p>
    </fieldset>
  )
}
