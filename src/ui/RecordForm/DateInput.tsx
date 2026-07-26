// 飲んだ日の入力。**OS 既定の `<input type="date">` は使わない**(CLAUDE.md ルール5)。
//
// 使わない理由は3つ: (a) 端末とロケールで表記も操作も変わり、暗い店内で読めるコントラストに
// できない (b) iOS のホイールピッカーは「今日から2日前」を出すのに数回のスクロールが要る
// (c) キーボードから4桁を打つほうが速い。飲みながら1本を最短で記録するのが SPEC の中核なので、
// **既定値=今日 + 前日/今日/翌日 + 数字3欄**で組む。
//
// ## この部品が引き受けている決定
//
// 1. **成立していない日付を親に渡さない。** 桁が足りない・`2月30日` のような値は `''` を渡し、
//    保存は親が止める。「近い日付に補正する」ことはしない — 本人が意図しない日付が黙って
//    保存されるのが最悪で、記録の第1キーがずれると台帳としての価値が消える。
// 2. **未来日付は保存を止めない(注意だけ出す)。** 日付をまたぐ時間帯に記録することがあり、
//    端末の時計やタイムゾーンで「今日」は1日ずれる。**正しい記録をブロックする害のほうが大きい**
//    ので、今日より後なら注意文を出して保存は通す。「飲んだ日」は本人しか知らない。
// 3. **表示の正典はこの内部 state。** 親は成立した ISO 文字列だけを持つ(部分入力を逆流させない)。
//    フォーム全体を作り直すときは `key` で remount する(RecordForm と同じ根拠。ルール3)。
// 4. **全角数字を受ける。** 日本語 IME は `２０２６` を出す。NFKC で畳んでから数字だけ取る
//    (ここで弾くと「打てているのに入らない」になる)。
// 5. `today` は props で受ける。端末時計を直接読むと「今日」の定義がこの部品と親で2つに分かれる。

import { useState, type ChangeEvent } from 'react'

type Props = {
  /** `'YYYY-MM-DD'`。日付として成立していないときは `''` */
  value: string
  /** 成立した日付、または `''`(未成立) */
  onChange: (value: string) => void
  /** 「今日」の基準日 `'YYYY-MM-DD'`。**この部品は端末時計を読まない** */
  today: string
  /** 親の検証結果(保存を押したが日付が無い等)。自前の「実在しない日付」とは別に出す */
  errorMessage?: string | null
}

type Parts = { year: string; month: string; day: string }

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const EMPTY: Parts = { year: '', month: '', day: '' }

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

function isoOf(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`
}

/** `'YYYY-MM-DD'` を3欄に割る。形が違えば空欄(勝手に補完しない) */
function splitIso(iso: string): Parts {
  const parts = ISO_RE.exec(iso)
  if (parts === null) return EMPTY
  // 月日は先頭0を落として出す(手で打つときに `07` を消してから打ち直す手間を無くす)
  return {
    year: parts[1],
    month: String(Number(parts[2])),
    day: String(Number(parts[3])),
  }
}

/** IME の全角数字を畳んで数字だけを取る。`max` 桁で切る(年4 / 月日2) */
function digitsOnly(raw: string, max: number): string {
  return raw.normalize('NFKC').replace(/[^0-9]/g, '').slice(0, max)
}

/**
 * 3欄から ISO 文字列を作る。**実在しない日付は `''`。**
 * `Date.UTC` で組んで往復させるのが唯一の実在判定(`2019-02-30` は 3月2日に繰り上がる)。
 * ローカル時刻の `new Date(y, m, d)` を使わないのは DST のある地域で日付が1つずれるため。
 */
function toIso(parts: Parts): string {
  if (parts.year.length !== 4 || parts.month === '' || parts.day === '') return ''
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  if (month < 1 || month > 12 || day < 1 || day > 31) return ''
  const at = new Date(Date.UTC(year, month - 1, day))
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) {
    return ''
  }
  return isoOf(year, month, day)
}

/** 日数を足した ISO 文字列。形が違う値はそのまま返す(呼び側が成立を確かめてから渡す) */
function shiftIso(iso: string, days: number): string {
  const parts = ISO_RE.exec(iso)
  if (parts === null) return iso
  const at = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])))
  at.setUTCDate(at.getUTCDate() + days)
  return isoOf(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate())
}

const FIELD =
  'rounded border border-line-strong bg-field px-1.5 py-1 text-center text-sm text-ink'
const STEP = 'whitespace-nowrap rounded border border-line-strong px-2 py-1 text-xs text-ink'

export function DateInput({ value, onChange, today, errorMessage = null }: Props) {
  const [parts, setParts] = useState<Parts>(() => splitIso(value))

  const iso = toIso(parts)
  const blank = parts.year === '' && parts.month === '' && parts.day === ''
  // 打ちかけ(桁が足りない)と実在しない日付を1つの文言に寄せる。どちらも「まだ日付でない」
  const incomplete = !blank && iso === ''
  const future = iso !== '' && iso > today

  function update(next: Parts) {
    setParts(next)
    onChange(toIso(next))
  }

  function jump(days: number) {
    // 成立していないときは今日を起点にする(壊れた値から相対移動しても意味が無い)
    const next = shiftIso(iso === '' ? today : iso, days)
    update(splitIso(next))
  }

  /** 3欄の onChange。`{...parts, [key]: v}` を使わないのは computed key で型が緩むのを避けるため */
  function handleYear(event: ChangeEvent<HTMLInputElement>) {
    update({ ...parts, year: digitsOnly(event.target.value, 4) })
  }
  function handleMonth(event: ChangeEvent<HTMLInputElement>) {
    update({ ...parts, month: digitsOnly(event.target.value, 2) })
  }
  function handleDay(event: ChangeEvent<HTMLInputElement>) {
    update({ ...parts, day: digitsOnly(event.target.value, 2) })
  }

  return (
    <fieldset className="min-w-0">
      <legend className="text-xs text-ink-muted">日付</legend>
      {/* 日本語ラベルと原子(数字欄・ボタン)の折り返しは対で直す: 行に flex-wrap + gap-y、
          原子側に whitespace-nowrap(ルール4)。単位の「年月日」は入力欄の名前と重複するので
          aria-hidden にし、読み上げは aria-label 側1つに寄せる。 */}
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label="年"
          maxLength={4}
          value={parts.year}
          onChange={handleYear}
          className={`${FIELD} w-16`}
        />
        <span aria-hidden="true" className="text-xs text-ink-faint">
          年
        </span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label="月"
          maxLength={2}
          value={parts.month}
          onChange={handleMonth}
          className={`${FIELD} w-10`}
        />
        <span aria-hidden="true" className="text-xs text-ink-faint">
          月
        </span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label="日"
          maxLength={2}
          value={parts.day}
          onChange={handleDay}
          className={`${FIELD} w-10`}
        />
        <span aria-hidden="true" className="text-xs text-ink-faint">
          日
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
          <button type="button" onClick={() => jump(-1)} className={STEP}>
            前日
          </button>
          <button type="button" onClick={() => update(splitIso(today))} className={STEP}>
            今日
          </button>
          <button type="button" onClick={() => jump(1)} className={STEP}>
            翌日
          </button>
        </span>
      </div>

      {incomplete && (
        <p role="status" className="mt-1 text-xs leading-relaxed text-notice-ink">
          日付になっていない（年は4桁、月日は実在する値を入れる）。このままでは保存できない。
        </p>
      )}
      {future && (
        <p role="status" className="mt-1 text-xs leading-relaxed text-ink-muted">
          今日より後の日付。端末の時計やタイムゾーンで1日ずれることがあるので、そのまま保存できる。
        </p>
      )}
      {errorMessage !== null && (
        <p className="mt-1 text-xs leading-relaxed text-notice-ink">{errorMessage}</p>
      )}
    </fieldset>
  )
}
