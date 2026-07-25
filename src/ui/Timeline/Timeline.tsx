// 時系列リスト(A9)。203本を実データで見て意味がある密度にするのがこの画面の要件。
//
// ## この画面が引き受けている4つの決定
//
// 1. **React の `key` は `record.id`。** `drankOn + brandLabel` を key にすると、同日・同銘柄の
//    2件(表/裏ラベルとして2本に数えている組)が衝突して**1行が静かに消え、ストアは203件なのに
//    画面は202行になる**。件数表示はストアの件数なので画面を見ても気付けない。
//    Timeline.test.tsx の「同日・同銘柄の2件」テストがこれを固定する(key を変えると落ちる)。
// 2. **並び順の正典は `byNewestFirst` の1本。** 呼び側が渡す配列の順序に依存させない
//    (絞り込み後の部分配列でも同じ全順序で並ぶ)。ここで独自に比較関数を書くと二重実装になり、
//    片方だけ直したときに同日の並びが静かに入れ替わる。
// 3. **絞り込みは述語で、定義域外のキーで全件に戻さない**(brain の絶対ルール)。0件なら
//    「該当なし」を明示する。**沈黙して全件を出すのが最悪の挙動**なので、絞り込みパネルを
//    閉じていても効いている条件をチップで見せる(隠れた絞り込みを作らない)。
// 4. **`<select>` を使わない**(ルール6)。年 / 都道府県 / 紐付け は自作のピルで、
//    **データに実際に存在する値だけ**を件数付きで出す(0件のピルという行き止まりを作らない)。
//
// ファセットの件数は**常に全件に対して**数える(他の絞り込みを掛けた後の件数にしない)。
// 掛け合わせで数えると、ピルを押すたびに他のピルの数字が動いて「203本の分布」を読めなくなる。
// 代わりに見出しで `該当 N本 / 全 M本` を出して、いま何が見えているかを取り違えないようにする。

import { useMemo, useState } from 'react'
import { isLinkStatus } from '../../domain/backupSchema.ts'
import { prefectureCode } from '../../domain/prefecture.ts'
import type { LinkStatus, SakeRecord } from '../../domain/types.ts'
import { byNewestFirst } from '../../store/records.ts'
import { EmptyState } from './EmptyState.tsx'
import { RecordCard } from './RecordCard.tsx'
import { LINK_STATUS_ORDER, linkStatusBadge } from './linkStatus.ts'

type Props = {
  /** 表示する記録。順序は問わない(この画面が `byNewestFirst` で並べ直す) */
  records: readonly SakeRecord[]
  /** JSON 取り込みを開く。空状態の主要導線なので**任意にしない** */
  onImport: () => void
  /** 記録フォームを開く。同上 */
  onCreate: () => void
  /** 1件の詳細を開く。未配線(Phase 4 まで)なら渡さない — 押しても何も起きない行を作らない */
  onSelect?: (record: SakeRecord) => void
}

/**
 * 都道府県が `null`(手がかりが無い)の束を選ぶための内部キー。**都道府県名と衝突しない値**を使う
 * (先頭が U+0000 なので県名やさけのわのエリア名と一致しない)。ピルの識別子は文字列で揃えたいが、
 * 絞り込みの状態は `string | null` を値として持つ必要があるため、この境界で1回だけ変換する。
 *
 * **エスケープで書く(生の NUL バイトをソースに置かない)。** リテラルの U+0000 を1個でも含むと
 * git がファイルを binary と見なして差分が出なくなり、`grep` も「Binary file matches」しか
 * 返さない。実際にこのファイルは差分がレビューできない状態で、`npm run ledger:check` の
 * 走査対象からも静かに外れていた。
 */
const NO_PREFECTURE_KEY = '\u0000none'

/** 都道府県の絞り込み。`null` は「絞り込みなし」、`{ value: null }` は「県が無い記録だけ」 */
type PrefectureFilter = { value: string | null } | null

type FacetItem = { key: string; label: string; count: number; help?: string }

export function Timeline({ records, onImport, onCreate, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [year, setYear] = useState<string | null>(null)
  const [prefecture, setPrefecture] = useState<PrefectureFilter>(null)
  const [status, setStatus] = useState<LinkStatus | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const ordered = useMemo(() => [...records].sort(byNewestFirst), [records])
  const facets = useMemo(() => buildFacets(records), [records])

  const needle = query.trim().toLowerCase()
  const visible = useMemo(
    () =>
      ordered.filter((record) => {
        if (year !== null && !record.drankOn.startsWith(year)) return false
        if (prefecture !== null && record.prefecture !== prefecture.value) return false
        if (status !== null && record.linkStatus !== status) return false
        if (needle !== '' && !haystack(record).includes(needle)) return false
        return true
      }),
    [ordered, year, prefecture, status, needle],
  )

  function clearAll() {
    setQuery('')
    setYear(null)
    setPrefecture(null)
    setStatus(null)
  }

  // 閉じていても効いている絞り込みが見えるようにする(隠れた条件を作らない)。
  // 検索語は入力欄そのものが見えているのでチップにしない。
  const chips: { key: string; label: string; clear: () => void }[] = []
  if (year !== null) chips.push({ key: 'year', label: `${year}年`, clear: () => setYear(null) })
  if (prefecture !== null) {
    chips.push({
      key: 'prefecture',
      label: prefecture.value ?? '県なし',
      clear: () => setPrefecture(null),
    })
  }
  if (status !== null) {
    chips.push({
      key: 'status',
      label: linkStatusBadge(status).label,
      clear: () => setStatus(null),
    })
  }
  const narrowed = chips.length > 0 || needle !== ''

  if (records.length === 0) {
    return (
      <section aria-label="記録の時系列" className="mx-auto w-full max-w-3xl px-4 py-4">
        <EmptyState onImport={onImport} onCreate={onCreate} />
      </section>
    )
  }

  return (
    <section
      aria-label="記録の時系列"
      className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4"
    >
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="銘柄・場所・メモを検索"
        placeholder="銘柄・場所・メモを検索"
        className="w-full rounded border border-stone-700 bg-stone-900 px-2.5 py-1.5 text-sm text-stone-100 placeholder:text-stone-500"
      />

      {/* 対で折り返しを直す: 行に flex-wrap + gap-y、原子ラベル(件数・ボタン・チップ)に nowrap */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-stone-400">
        <p className="whitespace-nowrap">
          {narrowed ? `該当 ${visible.length}本 / 全 ${records.length}本` : `全 ${records.length}本`}
        </p>
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          aria-controls="timeline-facets"
          className="whitespace-nowrap rounded border border-stone-700 px-2 py-0.5 text-stone-300"
        >
          絞り込み
        </button>
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={chip.clear}
            aria-label={`${chip.label} の絞り込みを解除`}
            className="whitespace-nowrap rounded-full border border-stone-600 bg-stone-800 px-2 py-0.5 text-stone-200"
          >
            {chip.label}
            <span aria-hidden="true" className="ml-1 text-stone-400">
              ×
            </span>
          </button>
        ))}
        {narrowed && (
          <button
            type="button"
            onClick={clearAll}
            className="whitespace-nowrap text-stone-400 underline decoration-stone-600 underline-offset-2"
          >
            条件を解除
          </button>
        )}
      </div>

      {filtersOpen && (
        <div
          id="timeline-facets"
          className="flex flex-col gap-2 rounded border border-stone-800 bg-stone-900/40 p-2.5"
        >
          <FacetRow
            title="年"
            items={facets.years}
            selected={year}
            onSelect={(key) => setYear(key)}
          />
          <FacetRow
            title="都道府県"
            items={facets.prefectures}
            selected={
              prefecture === null ? null : (prefecture.value ?? NO_PREFECTURE_KEY)
            }
            onSelect={(key) => {
              if (key === null) {
                setPrefecture(null)
                return
              }
              setPrefecture({ value: key === NO_PREFECTURE_KEY ? null : key })
            }}
          />
          <FacetRow
            title="紐付け"
            items={facets.statuses}
            selected={status}
            onSelect={(key) => {
              if (key === null) {
                setStatus(null)
                return
              }
              // 定義域外のキーは**無視する**(全件に戻さない)。ピルは列挙から作るので通常来ない
              if (isLinkStatus(key)) setStatus(key)
            }}
          />
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded border border-stone-800 px-3 py-4">
          <p className="text-sm text-stone-200">該当なし</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-400">
            検索語と絞り込みの両方に一致する記録が無い。条件を緩めると出る（勝手に全件へは戻さない）。
          </p>
          <button
            type="button"
            onClick={clearAll}
            className="mt-2 whitespace-nowrap rounded border border-stone-700 px-2 py-0.5 text-xs text-stone-200"
          >
            条件を解除
          </button>
        </div>
      ) : (
        <ol className="flex flex-col gap-2">
          {/* key は必ず record.id。日付+銘柄では同日同銘柄の2件が1行に潰れる */}
          {visible.map((record) => (
            <li key={record.id}>
              <RecordCard record={record} onSelect={onSelect} />
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * 検索対象。**銘柄(記録の生の表記とさけのわの銘柄名の両方) / 場所 / メモ**の部分一致。
 *
 * `normalize()` は通さない: この検索は画面に見えている文字列に対する部分一致で、
 * 括弧内除去や異体字畳み込みが効くと「打った文字が入っているのに出ない/入っていないのに出る」が
 * 起きる。スペックを含めないのも同じ理由で、スペックは絞り込みの軸として別に扱う(将来)。
 */
function haystack(record: SakeRecord): string {
  return [record.brandName ?? '', record.brandLabel, record.place, record.note]
    .join('\n')
    .toLowerCase()
}

type Facets = {
  years: FacetItem[]
  prefectures: FacetItem[]
  statuses: FacetItem[]
}

/** 実際に存在する値だけを件数付きで返す。全件に対して数える(掛け合わせない) */
function buildFacets(records: readonly SakeRecord[]): Facets {
  const years = new Map<string, number>()
  const prefectures = new Map<string | null, number>()
  const statuses = new Map<string, number>()
  for (const record of records) {
    bump(years, record.drankOn.slice(0, 4))
    bump(prefectures, record.prefecture)
    bump(statuses, record.linkStatus)
  }

  return {
    // 年は新しい順(リストの並びと同じ向き)
    years: [...years]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([value, count]) => ({ key: value, label: `${value}年`, count })),
    // 都道府県は本数の多い順 → JIS コード順。`県なし` は最後(数の少ない残余)
    prefectures: [...prefectures]
      .sort(comparePrefectureFacet)
      .map(([value, count]) => ({
        key: value ?? NO_PREFECTURE_KEY,
        label: value ?? '県なし',
        count,
      })),
    // 紐付けは確信の高い順(LINK_STATUS_ORDER)。**表に無い値は列挙に出さない**が、
    // 行のバッジ側は unknown に格下げして描くので記録が消えることはない
    statuses: LINK_STATUS_ORDER.filter((linkStatus) => statuses.has(linkStatus)).map(
      (linkStatus) => {
        const badge = linkStatusBadge(linkStatus)
        return {
          key: linkStatus,
          label: badge.label,
          help: badge.help,
          count: statuses.get(linkStatus) ?? 0,
        }
      },
    ),
  }
}

function bump<T>(counts: Map<T, number>, key: T): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

/** 本数降順 → JIS コード昇順 → 名前順。`null`(県なし)は必ず最後 */
function comparePrefectureFacet(
  [aName, aCount]: [string | null, number],
  [bName, bCount]: [string | null, number],
): number {
  if (aName === null) return bName === null ? 0 : 1
  if (bName === null) return -1
  if (aCount !== bCount) return bCount - aCount
  // 未知の県名(さけのわの海外エリア等)はコードに落ちないので末尾側へ寄せる
  const aCode = prefectureCode(aName) ?? 48
  const bCode = prefectureCode(bName) ?? 48
  if (aCode !== bCode) return aCode - bCode
  return aName < bName ? -1 : 1
}

/**
 * ファセット1行。押されているピルをもう一度押すと解除(`onSelect(null)`)。
 * `<select>` を使わない(ルール6)ので、選択状態は `aria-pressed` で伝える。
 */
function FacetRow({
  title,
  items,
  selected,
  onSelect,
}: {
  title: string
  items: readonly FacetItem[]
  selected: string | null
  onSelect: (key: string | null) => void
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1.5">
      <span className="w-14 shrink-0 whitespace-nowrap text-[11px] text-stone-500">{title}</span>
      {items.map((item) => {
        const active = item.key === selected
        return (
          <button
            key={item.key}
            type="button"
            title={item.help}
            aria-pressed={active}
            onClick={() => onSelect(active ? null : item.key)}
            className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${
              active
                ? 'border-stone-200 bg-stone-200 text-stone-900'
                : 'border-stone-700 text-stone-300'
            }`}
          >
            {item.label}
            <span className={`ml-1 text-[10px] ${active ? 'text-stone-600' : 'text-stone-500'}`}>
              {item.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
