// 年の振り返り(B126)。数えるのは `computeStats` の `yearReviews` で、この節は並べるだけ
// (Dashboard と同じく記録の配列はここに届かない)。

import { useState } from 'react'
import type { YearReview } from '../../domain/stats.ts'
import type { TimelineSeed } from '../Timeline/Timeline.tsx'
import { ColumnChart } from './charts.tsx'

const SECTION_HEADING = 'text-xs font-semibold text-ink-muted'
const NOTE = 'mt-2 text-xs leading-relaxed text-ink-faint'

/** 最高評価の記録を並べる上限。超えた分は本数だけ言う(1年に評価5が20本あっても節が伸びない) */
const TOP_RATED_SHOWN = 5

function formatMonthDay(drankOn: string): string {
  return `${String(Number(drankOn.slice(5, 7)))}月${String(Number(drankOn.slice(8, 10)))}日`
}

export function YearReviewSection({
  reviews,
  onOpen,
}: {
  reviews: readonly YearReview[]
  onOpen?: (seed: TimelineSeed) => void
}) {
  // 既定は直近の年(`yearReviews` は新しい年が先)。選んだ年が消えたら(全削除・取り込み)直近に戻る
  const [chosen, setChosen] = useState<string | null>(null)
  const review = reviews.find((entry) => entry.year === chosen) ?? reviews[0]
  if (review === undefined) return null

  const shown = review.topRated.slice(0, TOP_RATED_SHOWN)
  const hidden = review.topRated.length - shown.length

  return (
    <div>
      <h2 className={SECTION_HEADING}>年の振り返り</h2>
      {reviews.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-x-1.5 gap-y-1.5" role="group" aria-label="振り返る年">
          {reviews.map((entry) => {
            const active = entry.year === review.year
            return (
              <button
                key={entry.year}
                type="button"
                aria-pressed={active}
                onClick={() => setChosen(entry.year)}
                className={`whitespace-nowrap rounded border px-2.5 py-1.5 text-xs ${
                  active ? 'border-ink bg-surface-raised text-ink' : 'border-line-strong text-ink-muted'
                }`}
              >
                {entry.year}年
              </button>
            )
          })}
        </div>
      )}

      <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="whitespace-nowrap text-sm text-ink-muted">{review.year}年は</span>
        <span className="text-2xl font-semibold leading-none tracking-tight text-ink">
          {review.count}
        </span>
        <span className="whitespace-nowrap text-sm text-ink-muted">本</span>
      </p>

      <ColumnChart
        label={`${review.year}年の月別の本数`}
        rows={review.months.map((count, index) => ({
          key: String(index + 1),
          label: String(index + 1),
          count,
        }))}
      />
      <p className={NOTE}>月別（1〜12月）。</p>

      <dl className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-ink-muted">銘柄</dt>
        <dd className="text-ink">
          {review.brandCount}種
          <span className="text-ink-muted">（初めて {review.newBrandCount}種）</span>
          {review.unidentifiedCount > 0 && (
            <span className="block text-xs text-ink-faint">
              銘柄の分からない {review.unidentifiedCount}本は数えていない。
            </span>
          )}
        </dd>
        <dt className="text-ink-muted">都道府県</dt>
        <dd className="text-ink">
          {review.prefectureCount}県
          <span className="block text-xs text-ink-muted">
            {review.newPrefectures.length === 0
              ? '初めての県は無い。'
              : `初めて: ${review.newPrefectures.map((entry) => entry.name).join('・')}`}
          </span>
        </dd>
        <dt className="text-ink-muted">
          最高の評価
        </dt>
        <dd className="text-ink">
          {review.topRating === null ? (
            <span className="text-ink-faint">評価の付いた記録が無い</span>
          ) : (
            <>
              {review.topRating} / 5<span className="text-ink-muted">（{review.topRated.length}本）</span>
              <ul className="mt-1 space-y-0.5 text-xs">
                {shown.map((entry) => (
                  <li key={entry.recordId} className="flex flex-wrap gap-x-2">
                    <time dateTime={entry.drankOn} className="whitespace-nowrap text-ink-muted">
                      {formatMonthDay(entry.drankOn)}
                    </time>
                    <span className="min-w-0 text-ink">{entry.label}</span>
                  </li>
                ))}
              </ul>
              {hidden > 0 && <p className="text-xs text-ink-faint">ほか {hidden}本</p>}
            </>
          )}
        </dd>
      </dl>

      {review.firstYear && (
        <p className={NOTE}>記録のある最初の年なので、銘柄も県もすべて「初めて」に数えている。</p>
      )}
      {onOpen !== undefined && (
        <button
          type="button"
          onClick={() => onOpen({ year: review.year })}
          className="mt-3 whitespace-nowrap rounded border border-line-strong px-3 py-1.5 text-xs text-ink"
        >
          {review.year}年の記録を見る
        </button>
      )}
    </div>
  )
}
