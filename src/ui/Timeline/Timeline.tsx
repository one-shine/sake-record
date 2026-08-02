// 時系列リスト(A9)。203本を実データで見て意味がある密度にするのがこの画面の要件。
//
// ## この画面が引き受けている7つの決定
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
//    味タグは**表が届いていない/失敗した状態でも**この規則に従う: 選んだ語が残っている限り
//    結果は0件で、「該当なし」とチップが出る(黙って条件を落として全件へ広げない)。
// 4. **`<select>` を使わない**(ルール6)。年 / 都道府県 / 評価 / 写真 / 紐付け / スペック /
//    味タグ は自作のピルで、**データに実際に存在する値だけ**を件数付きで出す。
//    - **0件のピルを出さない**(行き止まりを作らない)
//    - **排他な軸は「空でないバケツが1つ」なら行ごと出さない**(`narrowingOnly`)。その1つは
//      常に全件なので、押しても表示が変わらないピルになる(実台帳203本は写真が1枚も無いので
//      素直に作ると「写真なし 203」だけが出る)。全記録が同じ年・同じ紐付け状態でも同じ。
//    - **`Dashboard` は逆に0件の行を残す**(あちらは分布を読む面で、棒が消えると「0本だった」と
//      「数えていない」が同じ見た目になる)。**この不一致は意図的**なので片方に揃えないこと。
// 5. **件数はこの画面では数えない軸がある。** スタイル語(スペック)と評価の件数は**統計タブにも
//    出る同じ数字**なので、2箇所で数えると必ずドリフトする(A10「本数を数える実装は
//    `stats.ts` の1箇所」)。App が `computeStats()` の戻り値から `counts` として渡す。
//    年 / 都道府県 / 写真 は**この画面だけのバケツ定義**なので `buildFacets` が数える
//    (年は `drankOn` の先頭4桁、都道府県は `normalizePrefecture` を通した表記、写真は `thumbnail !== null`。
//     統計タブの年別は日付として読めた行だけ・県別は JIS コードに解けた行だけ = 別の量)。
// 6. **検索の述語は `domain/searchRecord.ts`。** 正規化の分岐と「正規化後に空になる検索語」の
//    ガードは CI で走る単体テストが要る(`src/integration/` は seed が無い環境で skip される)。
// 7. **味タグは「本人が絞り込みパネルを開いたとき」に初めて取る**任意の資源で、
//    **記録の作成や詳細を止める条件にしない**(取得は `store/linking.ts` の `getFlavorTags`
//    が `getTables` と並列に持つ)。読み込み中・失敗中も**行ごと消さない** — 隠れた絞り込みを
//    作らないの裏返しで、「今この軸で絞れない理由」も隠さない。件数の数え方・帯分け・
//    複数選択をやらない判断は `flavorTagFacet.ts` に書いてある。
//
// ファセットの件数は**常に全件に対して**数える(他の絞り込みを掛けた後の件数にしない)。
// 掛け合わせで数えると、ピルを押すたびに他のピルの数字が動いて「203本の分布」を読めなくなる。
// 代わりに見出しで `該当 N本 / 全 M本` を出して、いま何が見えているかを取り違えないようにする。

import { useMemo, useState } from 'react'
import { isLinkStatus, isRating } from '../../domain/backupSchema.ts'
import {
  NO_PREFECTURE_LABEL,
  normalizePrefecture,
  prefectureCode,
} from '../../domain/prefecture.ts'
import { buildSearchText, matchesQuery, type SearchText } from '../../domain/searchRecord.ts'
import {
  isStyleTerm,
  matchesStyleTerm,
  type RatingCount,
  type Stats,
  type StyleCount,
  type StyleTerm,
} from '../../domain/stats.ts'
import type { LinkStatus, Rating, SakeRecord } from '../../domain/types.ts'
import { byNewestFirst } from '../../store/records.ts'
import { EmptyState } from './EmptyState.tsx'
import { RecordCard } from './RecordCard.tsx'
import {
  buildFlavorTagFacet,
  type FlavorTagFacet,
  type FlavorTagState,
  type FlavorTagSource,
} from './flavorTagFacet.ts'
import { LINK_STATUS_ORDER, isLinkedStatus, linkStatusBadge } from './linkStatus.ts'

/**
 * ピルの件数のうち**この画面が数えないもの**。`computeStats(records)` の戻り値がそのまま入る
 * (`Stats` の一部だけを型に出しているので、他の集計値をここで読むことはできない)。
 *
 * **渡す `records` と同じ集合から数えた値**でなければならない(別の集合の `Stats` を渡すと
 * ピルの件数と絞った行数が食い違う)。App は `records` と `counts` を同じ1箇所から渡す。
 */
export type TimelineCounts = Pick<Stats, 'styles' | 'ratings' | 'unratedCount'>

/**
 * 味タグの絞り込みに要る3点。**1つのオブジェクトで受ける** — 状態だけ渡せる形にすると、
 * 「読み込めなかった」を出しながら再試行の導線が無い配線が型で作れてしまう。
 */
// 型は `flavorTagFacet.ts` に移した(絞り込みと記録の詳細の両方が使うため)。
// 呼び側の import を割らないよう、ここからも出しておく
export type { FlavorTagSource } from './flavorTagFacet.ts'

type Props = {
  /** 表示する記録。順序は問わない(この画面が `byNewestFirst` で並べ直す) */
  records: readonly SakeRecord[]
  /** ピルの件数(この画面では数えない軸)。上の `TimelineCounts` の約束を読むこと */
  counts: TimelineCounts
  /** JSON 取り込みを開く。空状態の主要導線なので**任意にしない** */
  onImport: () => void
  /** 記録フォームを開く。同上 */
  onCreate: () => void
  /** 1件の詳細を開く。未配線なら渡さない — 押しても何も起きない行を作らない */
  onSelect?: (record: SakeRecord) => void
  /**
   * 手動紐付けを開く。**渡すと未紐付け(`unlinked` / `unknown`)の行にだけ導線が出る。**
   *
   * 行そのものは詳細を開くボタンなので、導線を行の**中**に置くと `<button>` が入れ子になる
   * (不正な HTML で、押した先も一意に決まらない)。`<li>` の中でカードの兄弟として並べる。
   */
  onLink?: (record: SakeRecord) => void
  /**
   * 味タグの絞り込み。**渡さないとタグの行が出ない**(配線していない呼び出し側で空の行を
   * 出さない。`onSelect` / `onLink` と同じ規則)。渡したら読み込み中・失敗中も行は残る。
   */
  flavorTags?: FlavorTagSource
  /**
   * 開いたときに当てておく都道府県の絞り込み。産地タブから「記録タブで見る」で飛ぶときに使う。
   *
   * **初期値としてしか見ない。** 以後は本人の操作が持ち主で、外から書き換えない
   * (押すたびに当て直したいなら呼び側が `key` を変えてこの画面を作り直す。`Learn` と同じ手)。
   */
  initialPrefecture?: string | null
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

/** 未評価の束を選ぶための内部キー。`'1'`..`'5'` と衝突しない(同上の理由でエスケープで書く) */
const UNRATED_KEY = '\u0000unrated'

/** 写真の有無。**ラベル(`写真あり`)をキーにしない** — 表示文字列を直すとキーが動くのを避ける */
const HAS_PHOTO_KEY = 'photo-has'
const NO_PHOTO_KEY = 'photo-none'

/** 都道府県の絞り込み。`null` は「絞り込みなし」、`{ value: null }` は「県が無い記録だけ」 */
type PrefectureFilter = { value: string | null } | null

/** 評価の絞り込み。`null` は「絞り込みなし」、`{ value: null }` は「未評価だけ」 */
type RatingFilter = { value: Rating | null } | null

/** 写真の絞り込み。`null` は「絞り込みなし」、`{ value: true }` は「写真がある記録だけ」 */
type PhotoFilter = { value: boolean } | null

type FacetItem = { key: string; label: string; count: number; help?: string }

export function Timeline({
  records,
  counts,
  onImport,
  onCreate,
  onSelect,
  onLink,
  flavorTags,
  initialPrefecture,
}: Props) {
  const [query, setQuery] = useState('')
  const [year, setYear] = useState<string | null>(null)
  const [prefecture, setPrefecture] = useState<PrefectureFilter>(
    initialPrefecture === undefined || initialPrefecture === null
      ? null
      : { value: initialPrefecture },
  )
  const [rating, setRating] = useState<RatingFilter>(null)
  const [photo, setPhoto] = useState<PhotoFilter>(null)
  const [status, setStatus] = useState<LinkStatus | null>(null)
  const [styleTerm, setStyleTerm] = useState<StyleTerm | null>(null)
  const [flavorTag, setFlavorTag] = useState<string | null>(null)
  const [broadTagsOpen, setBroadTagsOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const ordered = useMemo(() => [...records].sort(byNewestFirst), [records])
  // 依存は `counts` のプロパティで取る。呼び側が毎描画で新しいオブジェクトを組んでも、
  // 中身(`Stats` の配列)が同じなら数え直さない
  const facets = useMemo(
    () => buildFacets(records, counts.styles, counts.ratings, counts.unratedCount),
    [records, counts.styles, counts.ratings, counts.unratedCount],
  )

  /**
   * 記録の集合ごとに1回だけ組む検索テキスト。**打鍵ごとに 203本 × 5フィールドの NFKC を
   * 走らせない**ためにここで memo する(検索語は依存に入れない)。
   */
  const searchTexts = useMemo(() => {
    const texts = new Map<string, SearchText>()
    for (const record of records) texts.set(record.id, buildSearchText(record))
    return texts
  }, [records])

  /**
   * 味タグのファセット。**依存は `flavorTags.state`** で、呼び側が毎描画で
   * `{ state, onNeeded, onRetry }` を組み直しても、状態が変わらなければ数え直さない。
   */
  const tagState = flavorTags?.state
  const tagFacet = useMemo(
    () => (tagState?.status === 'ready' ? buildFlavorTagFacet(records, tagState.value) : null),
    [records, tagState],
  )

  const visible = useMemo(
    () =>
      ordered.filter((record) => {
        if (year !== null && !record.drankOn.startsWith(year)) return false
        // 未記入は3通りの形(`null` / `''` / 空白のみ)で来るので**畳んでから**比べる。
        // 生の値で比べると `{ value: null }` のピルが `''` の記録を取りこぼす
        if (prefecture !== null && normalizePrefecture(record.prefecture) !== prefecture.value) {
          return false
        }
        if (rating !== null && !matchesRating(record, rating.value)) return false
        if (photo !== null && (record.thumbnail !== null) !== photo.value) return false
        if (status !== null && record.linkStatus !== status) return false
        if (styleTerm !== null && !matchesStyleTerm(record, styleTerm)) return false
        if (flavorTag !== null && !matchesFlavorTag(tagFacet, record, flavorTag)) return false
        // キャッシュに無い記録は組み直す(取りこぼして全件に落ちるより、その1件を数える)
        const text = searchTexts.get(record.id) ?? buildSearchText(record)
        if (!matchesQuery(text, query)) return false
        return true
      }),
    [
      ordered,
      year,
      prefecture,
      rating,
      photo,
      status,
      styleTerm,
      flavorTag,
      tagFacet,
      query,
      searchTexts,
    ],
  )

  function clearAll() {
    setQuery('')
    setYear(null)
    setPrefecture(null)
    setRating(null)
    setPhoto(null)
    setStatus(null)
    setStyleTerm(null)
    setFlavorTag(null)
  }

  /**
   * 絞り込みパネルの開閉。**開くときにだけ**味タグの取得を促す(閉じるときは呼ばない)。
   * ここが「開かないセッションでは 22KB を parse しない」の実装点で、呼び側の `onNeeded` は
   * 2回目以降を無視する(何度開いても取得は1回)。
   */
  function toggleFilters() {
    if (!filtersOpen) flavorTags?.onNeeded()
    setFiltersOpen(!filtersOpen)
  }

  // 閉じていても効いている絞り込みが見えるようにする(隠れた条件を作らない)。
  // 検索語は入力欄そのものが見えているのでチップにしない。
  const chips: { key: string; label: string; clear: () => void }[] = []
  if (year !== null) chips.push({ key: 'year', label: `${year}年`, clear: () => setYear(null) })
  if (prefecture !== null) {
    chips.push({
      key: 'prefecture',
      // `prefecture.value` はピルのキー由来 = `normalizePrefecture` を通った値なので、
      // ここの `?? ` は空文字に化けない(生の `record.prefecture` を入れてはいけない)
      label: prefecture.value ?? NO_PREFECTURE_LABEL,
      clear: () => setPrefecture(null),
    })
  }
  if (rating !== null) {
    // **ピルは行タイトル「評価」の下なので数字だけ、チップは行の外に出るので「評価 4」と書く。**
    // (`RecordCard` の本文にも `評価 4` があるので、テストは `getByText` ではなく role で引く)
    chips.push({
      key: 'rating',
      label: rating.value === null ? '未評価' : `評価 ${String(rating.value)}`,
      clear: () => setRating(null),
    })
  }
  if (photo !== null) {
    chips.push({
      key: 'photo',
      label: photo.value ? '写真あり' : '写真なし',
      clear: () => setPhoto(null),
    })
  }
  if (status !== null) {
    chips.push({
      key: 'status',
      label: linkStatusBadge(status).label,
      clear: () => setStatus(null),
    })
  }
  if (styleTerm !== null) {
    chips.push({ key: 'style', label: styleTerm, clear: () => setStyleTerm(null) })
  }
  if (flavorTag !== null) {
    // **語だけでは何の軸か読めない**(`常温` `桜` はスペック語にも見える)。チップは行の外に
    // 出るので軸名を付ける — 評価のチップを `評価 4` と書くのと同じ理由
    chips.push({ key: 'flavorTag', label: `味タグ ${flavorTag}`, clear: () => setFlavorTag(null) })
  }
  const narrowed = chips.length > 0 || query.trim() !== ''

  if (records.length === 0) {
    return (
      <section aria-label="記録の時系列" className="mx-auto w-full max-w-3xl px-4 py-4">
        <EmptyState onImport={onImport} onCreate={onCreate} />
      </section>
    )
  }

  const attributeRows = [
    facets.years,
    facets.prefectures,
    facets.ratings,
    facets.photos,
    facets.statuses,
  ]
  const hasAttributeRow = attributeRows.some((items) => items.length > 0)
  /**
   * 味タグで絞れる見込みがあるか。**まだ読めていない状態も「見込みあり」に数える** —
   * 読み込み中に「絞り込める軸が無い」と書くと、直後にピルが出てきて嘘になる。
   */
  const hasFlavorTagAxis =
    flavorTags !== undefined && (tagFacet === null || tagFacet.taggedCount > 0)

  return (
    <section
      aria-label="記録の時系列"
      className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4"
    >
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="銘柄・スペック・場所・メモを検索"
        placeholder="銘柄・スペック・場所・メモを検索"
        className="w-full rounded border border-line-strong bg-field px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint"
      />

      {/* 対で折り返しを直す: 行に flex-wrap + gap-y、原子ラベル(件数・ボタン・チップ)に nowrap */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-muted">
        <p className="whitespace-nowrap">
          {narrowed ? `該当 ${visible.length}本 / 全 ${records.length}本` : `全 ${records.length}本`}
        </p>
        <button
          type="button"
          onClick={toggleFilters}
          aria-expanded={filtersOpen}
          aria-controls="timeline-facets"
          className="whitespace-nowrap rounded border border-line-strong px-2 py-0.5 text-ink-muted"
        >
          絞り込み
        </button>
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={chip.clear}
            aria-label={`${chip.label} の絞り込みを解除`}
            className="whitespace-nowrap rounded-full border border-line-strong bg-surface-raised px-2 py-0.5 text-ink"
          >
            {chip.label}
            <span aria-hidden="true" className="ml-1 text-ink-muted">
              ×
            </span>
          </button>
        ))}
        {narrowed && (
          <button
            type="button"
            onClick={clearAll}
            className="whitespace-nowrap text-link underline decoration-link-underline underline-offset-2"
          >
            条件を解除
          </button>
        )}
      </div>

      {filtersOpen && (
        <div
          id="timeline-facets"
          className="flex flex-col gap-2 rounded border border-line bg-surface p-2.5"
        >
          {/* 第1群: 記録の属性。**互いに排他**(1本はどの行でも1つのピルにしか入らない) */}
          {hasAttributeRow && (
            <p className="text-[11px] leading-relaxed text-ink-faint">
              記録の属性 — 互いに排他（1本はどの行でも1つのピルにしか入らない）。もう一度押すと解除。件数は全件に対する数で、他の絞り込みを掛けない。
            </p>
          )}
          <FacetRow
            title="年"
            items={facets.years}
            selected={year}
            onSelect={(key) => setYear(key)}
          />
          <FacetRow
            title="都道府県"
            items={facets.prefectures}
            selected={prefecture === null ? null : (prefecture.value ?? NO_PREFECTURE_KEY)}
            onSelect={(key) => {
              if (key === null) {
                setPrefecture(null)
                return
              }
              setPrefecture({ value: key === NO_PREFECTURE_KEY ? null : key })
            }}
          />
          <FacetRow
            title="評価"
            items={facets.ratings}
            selected={
              rating === null ? null : rating.value === null ? UNRATED_KEY : String(rating.value)
            }
            onSelect={(key) => {
              if (key === null) {
                setRating(null)
                return
              }
              if (key === UNRATED_KEY) {
                setRating({ value: null })
                return
              }
              // 定義域外のキーは**無視する**(全件に戻さない)。ピルは1..5の列挙から作る
              const value = Number(key)
              if (isRating(value)) setRating({ value })
            }}
          />
          <FacetRow
            title="写真"
            items={facets.photos}
            selected={photo === null ? null : photo.value ? HAS_PHOTO_KEY : NO_PHOTO_KEY}
            onSelect={(key) => {
              if (key === null) {
                setPhoto(null)
                return
              }
              if (key === HAS_PHOTO_KEY) setPhoto({ value: true })
              else if (key === NO_PHOTO_KEY) setPhoto({ value: false })
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

          {/* 第2群: 味の手がかり。**重複計上**なので合計が総本数を超える。
              説明は `Dashboard` のスタイル分布と同一文にする(同じ現象に2つの説明を作らない)。
              こちらは `narrowingOnly` を通さない — 重複計上の軸はバケツが1つでも部分集合なので、
              押せば絞り込みとして意味がある(排他な軸の1バケツ = 全件、とは別)。
              スペックは記録の欄、味タグはさけのわの銘柄データで**出所が違う**ので、
              群の中でも行ごとに説明を持たせる(1つの説明文にまとめると片方に嘘が混じる) */}
          {(facets.styles.length > 0 || flavorTags !== undefined) && (
            // 罫は**上に何かあるときだけ**。第1群が空のときに引くと、何も区切っていない
            // 飾り罫がパネルの先頭に残る
            <div
              className={`flex flex-col gap-2 ${
                hasAttributeRow ? 'border-t border-line pt-2' : ''
              }`}
            >
              {facets.styles.length > 0 && (
                <>
                  <p className="text-[11px] leading-relaxed text-ink-faint">
                    味の手がかり — スペック列だけを対象にした部分一致で、1本を複数の語に重複計上する（「純米大吟醸」の1本は「大吟醸」にも「純米」にも数える）。合計は総本数を超える。備考（メモ）は数えない。
                  </p>
                  <FacetRow
                    title="スペック"
                    items={facets.styles}
                    selected={styleTerm}
                    onSelect={(key) => {
                      if (key === null) {
                        setStyleTerm(null)
                        return
                      }
                      // 定義域外のキーは**無視する**(全件に戻さない)
                      if (isStyleTerm(key)) setStyleTerm(key)
                    }}
                  />
                </>
              )}
              {flavorTags !== undefined && (
                <FlavorTagFilter
                  state={flavorTags.state}
                  facet={tagFacet}
                  total={records.length}
                  selected={flavorTag}
                  broadOpen={broadTagsOpen}
                  onRetry={flavorTags.onRetry}
                  onToggleBroad={() => setBroadTagsOpen(!broadTagsOpen)}
                  onSelect={(key) => {
                    if (key === null) {
                      setFlavorTag(null)
                      return
                    }
                    // 定義域外のキーは**無視する**(全件に戻さない)。ピルは組んだ語から作るので
                    // 通常来ないが、表が入れ替わった後の古いキーで全件に落ちない形にしておく
                    if (isKnownFlavorTag(tagFacet, key)) setFlavorTag(key)
                  }}
                />
              )}
            </div>
          )}

          {!hasAttributeRow && facets.styles.length === 0 && !hasFlavorTagAxis && (
            <p className="text-[11px] leading-relaxed text-ink-faint">
              絞り込める軸が無い — この記録の集合ではどの軸も値が1種類しか無く、押しても表示が変わらないピルになる。検索語で絞る。
            </p>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded border border-line px-3 py-4">
          <p className="text-sm text-ink">該当なし</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            検索語と絞り込みの両方に一致する記録が無い。条件を緩めると出る（勝手に全件へは戻さない）。
          </p>
          <button
            type="button"
            onClick={clearAll}
            className="mt-2 whitespace-nowrap rounded border border-line-strong px-2 py-0.5 text-xs text-ink"
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
              {onLink !== undefined && !isLinkedStatus(record.linkStatus) && (
                <div className="mt-1 flex flex-wrap justify-end gap-x-2 gap-y-1">
                  <button
                    type="button"
                    onClick={() => onLink(record)}
                    className="whitespace-nowrap rounded border border-line-strong px-2 py-0.5 text-xs text-ink-muted"
                  >
                    手動で紐付ける
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * 評価の述語。**未評価(`value === null`)は「1..5 のどれでもない」**と定義する —
 * `stats.unratedCount` が壊れた値(手で編集したバックアップの 0 や 7)も未評価に数えているので、
 * ここで `record.rating === null` だけを見るとピルの件数より行数が少なくなる。
 */
function matchesRating(record: SakeRecord, value: Rating | null): boolean {
  return value === null ? !isRating(record.rating) : record.rating === value
}

/**
 * 味タグの述語。**表が無い(未取得・失敗)ときも、定義域外の語のときも `false`。**
 *
 * ここで `true` を返して全件に落とすと、味タグの取得が失敗した瞬間に「タグで絞ったはずの
 * 一覧」が静かに全件へ広がる。0件になれば「該当なし」とチップと解除ボタンが出るので、
 * 本人は何が起きたかを見て自分で外せる(定義域外のキーで全件に戻さない、の適用)。
 */
function matchesFlavorTag(
  facet: FlavorTagFacet | null,
  record: SakeRecord,
  tag: string,
): boolean {
  return facet?.tagsByRecordId.get(record.id)?.includes(tag) ?? false
}

/** いま出しているピルにその語があるか。両方の帯を見る(畳んだ側の語も選べる) */
function isKnownFlavorTag(facet: FlavorTagFacet | null, tag: string): boolean {
  if (facet === null) return false
  return (
    facet.narrowing.some((item) => item.tag === tag) ||
    facet.broad.some((item) => item.tag === tag)
  )
}

type Facets = {
  years: FacetItem[]
  prefectures: FacetItem[]
  ratings: FacetItem[]
  photos: FacetItem[]
  statuses: FacetItem[]
  styles: FacetItem[]
}

/**
 * 実際に存在する値だけを件数付きで返す。全件に対して数える(掛け合わせない)。
 *
 * **スタイル語と評価の件数は数えない**(引数で受け取る)。同じ数字が統計タブにも出るので、
 * 2箇所で数えると必ずドリフトする(A10)。年 / 都道府県 / 写真 はこの画面だけのバケツ定義。
 */
function buildFacets(
  records: readonly SakeRecord[],
  styleCounts: readonly StyleCount[],
  /** 1..5 の昇順(`computeStats` の約束)。並べ直さずそのまま出す */
  ratingCounts: readonly RatingCount[],
  unratedCount: number,
): Facets {
  const years = new Map<string, number>()
  const prefectures = new Map<string | null, number>()
  const statuses = new Map<string, number>()
  let withPhoto = 0
  for (const record of records) {
    bump(years, record.drankOn.slice(0, 4))
    // **畳んでから数える。** 生の値で数えると `null` と `''` が別のバケツになり、同じ
    // 「県が未記入」の記録が2つのピルに割れる(片方はラベルが空になる)
    bump(prefectures, normalizePrefecture(record.prefecture))
    bump(statuses, record.linkStatus)
    if (record.thumbnail !== null) withPhoto += 1
  }

  return {
    // 年は新しい順(リストの並びと同じ向き)
    years: narrowingOnly(
      [...years]
        .sort(([a], [b]) => (a < b ? 1 : -1))
        .map(([value, count]) => ({ key: value, label: `${value}年`, count })),
    ),
    // 都道府県は本数の多い順 → JIS コード順。未記入は最後(数の少ない残余)。
    // ラベルは産地タブ・統計タブと同じ語を使う(同じ束を画面ごとに言い換えない)
    prefectures: narrowingOnly(
      [...prefectures].sort(comparePrefectureFacet).map(([value, count]) => ({
        key: value ?? NO_PREFECTURE_KEY,
        label: value ?? NO_PREFECTURE_LABEL,
        count,
      })),
    ),
    // 評価は 1..5 の昇順 → 未評価(残余なので最後)。**ラベルは数字だけ** —
    // `評価 4` にすると `RecordCard` の本文と同じ文字列になり、テストの引き当てが曖昧になる。
    // 行タイトルが「評価」なので数字で読める(文脈は `title` で補う)
    ratings: narrowingOnly([
      ...ratingCounts.map((entry) => ({
        key: String(entry.rating),
        label: String(entry.rating),
        help: `評価 ${String(entry.rating)} / 5 の記録`,
        count: entry.count,
      })),
      {
        key: UNRATED_KEY,
        label: '未評価',
        help: '評価を入れていない記録(1..5 のどれでもない値もここに入る)',
        count: unratedCount,
      },
    ]),
    // 写真は2値。**実台帳203本は写真が1枚も無い**ので、素直に作ると「写真なし 203」の1個だけが
    // 出て押しても何も変わらない。`narrowingOnly` がその行を落とす
    photos: narrowingOnly([
      { key: HAS_PHOTO_KEY, label: '写真あり', count: withPhoto },
      { key: NO_PHOTO_KEY, label: '写真なし', count: records.length - withPhoto },
    ]),
    // 紐付けは確信の高い順(LINK_STATUS_ORDER)。**表に無い値は列挙に出さない**が、
    // 行のバッジ側は unknown に格下げして描くので記録が消えることはない
    statuses: narrowingOnly(
      LINK_STATUS_ORDER.filter((linkStatus) => statuses.has(linkStatus)).map((linkStatus) => {
        const badge = linkStatusBadge(linkStatus)
        return {
          key: linkStatus,
          label: badge.label,
          help: badge.help,
          count: statuses.get(linkStatus) ?? 0,
        }
      }),
    ),
    // スタイル語は `STYLE_TERMS` の宣言順(`computeStats` の戻り値の並びをそのまま使う)。
    // **`narrowingOnly` を通さない**(重複計上の軸なので1バケツでも部分集合 = 絞り込みになる)。
    // 0件の語は落とす — Timeline の規則は「行き止まりのピルを作らない」
    styles: styleCounts
      .filter((entry) => entry.count > 0)
      .map((entry) => ({ key: entry.term, label: entry.term, count: entry.count })),
  }
}

/**
 * **排他な軸**のピル。0件のピルを落としたうえで、**残りが1つ以下なら行ごと落とす**。
 *
 * 排他な軸で空でないバケツが1つだけなら、そのバケツは常に全件なので、押しても表示が変わらない
 * 行き止まりのピルになる(実台帳203本は写真が1枚も無いので「写真なし 203」だけが出る。
 * 全記録が同じ年・同じ紐付け状態のときにも同じことが起きる)。既存の「0件のピルを出さない」の
 * 自然な一般化。
 *
 * **重複計上の軸(スペック)には使わない。** あちらは空でないバケツが1つでも真部分集合になりうる
 * ので、押せば絞り込みとして意味がある。
 */
function narrowingOnly(items: readonly FacetItem[]): FacetItem[] {
  const nonEmpty = items.filter((item) => item.count > 0)
  return nonEmpty.length >= 2 ? nonEmpty : []
}

function bump<T>(counts: Map<T, number>, key: T): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

/** 本数降順 → JIS コード昇順 → 名前順。`null`(未記入)は必ず最後 */
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
 *
 * **ピルが1つも無い行は描かない。** 行タイトルだけが残ると「絞り込めるはずなのに押せない」
 * ように見える(どの軸を落とすかの判断は `buildFacets` 側が持つ)。
 *
 * `role="group"` + 行タイトルの `aria-label`: 行タイトルとピルの関係が**位置だけ**で示されて
 * いると、読み上げでは「4」「未評価」がどの軸のものか分からない(評価のピルはラベルが数字だけ)。
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
  if (items.length === 0) return null
  return (
    <div
      role="group"
      aria-label={title}
      className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1.5"
    >
      <span aria-hidden="true" className="w-14 shrink-0 whitespace-nowrap text-[11px] text-ink-faint">
        {title}
      </span>
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
                ? 'border-ink bg-ink text-ink-inverted'
                : 'border-line-strong text-ink-muted'
            }`}
          >
            {item.label}
            <span
              className={`ml-1 text-[10px] ${active ? 'text-ink-inverted-muted' : 'text-ink-faint'}`}
            >
              {item.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** 味タグの行の器。3つの状態(読み込み中 / 失敗 / 取得済み)で**同じ枠**にする */
const TAG_BLOCK = 'flex flex-col gap-1.5'
const TAG_NOTE = 'text-[11px] leading-relaxed text-ink-faint'
const TAG_QUIET_BUTTON =
  'self-start whitespace-nowrap rounded border border-line-strong px-2 py-0.5 text-[11px] text-ink-muted'

/**
 * 味タグの絞り込み。**この行が引き受けているのは「出せない理由も隠さない」こと。**
 *
 * - 未取得・失敗でも行は残す(黙って消すと、絞り込める軸が減ったことに気付けない)
 * - **分母を常設する**(`FlavorMap` と同じ作法)。紐付いていない記録とタグが無い銘柄は
 *   どのタグにも当たらないので、書かないと「絞ったら消えた」になる
 * - **偽陰性を先に書く**。上流が銘柄あたり N語で打ち切っているので、
 *   「タグが無い = その味がない」ではない。数字は同梱データから出す(リテラルを持たない)
 * - 半数より多くに付く語は畳むが、**残数付きのトグルで必ず出せる**(件数も畳んだ側に出す)
 */
function FlavorTagFilter({
  state,
  facet,
  total,
  selected,
  broadOpen,
  onRetry,
  onToggleBroad,
  onSelect,
}: {
  state: FlavorTagState
  facet: FlavorTagFacet | null
  /** 全記録数。行の分母 */
  total: number
  selected: string | null
  broadOpen: boolean
  onRetry: () => void
  onToggleBroad: () => void
  onSelect: (key: string | null) => void
}) {
  if (state.status === 'error') {
    return (
      <div className={TAG_BLOCK}>
        <p className="text-[11px] font-medium text-notice-ink">味タグを読み込めなかった</p>
        <p className="text-[11px] leading-relaxed text-notice-ink">{state.message}</p>
        <p className={TAG_NOTE}>
          味タグを使うのはこの行だけ。一覧と他の絞り込みは影響を受けない。
        </p>
        <button type="button" onClick={onRetry} className={TAG_QUIET_BUTTON}>
          再試行
        </button>
      </div>
    )
  }
  // `idle`(まだ要求していない)もここに入る。パネルを開いた操作がそのまま取得の開始なので、
  // 本人から見える状態は「読み込んでいる」で正しい
  if (state.status !== 'ready' || facet === null) {
    return (
      <div className={TAG_BLOCK}>
        <p role="status" className={TAG_NOTE}>
          味タグを読み込んでいる
        </p>
      </div>
    )
  }

  const { maxTagsPerBrand, atCapBrandCount, tagIdsByBrandId } = state.value
  return (
    <div className={TAG_BLOCK}>
      <p className={TAG_NOTE}>
        {`味タグ — さけのわが銘柄ごとに持つ語。タグを引けた ${String(facet.taggedCount)}本 / 全 ${String(total)}本（紐付いていない記録と、タグが無い銘柄の記録はどのタグにも当たらない）。1本が複数の語に入る。`}
      </p>
      <p className={TAG_NOTE}>
        {`上流は銘柄あたり最大${String(maxTagsPerBrand)}語で打ち切っている。${String(tagIdsByBrandId.size)}銘柄のうち${String(atCapBrandCount)}銘柄がその上限に達しているので、タグが無いことは「その味がない」ことを意味しない。`}
      </p>
      {facet.taggedCount === 0 ? (
        <p className={TAG_NOTE}>
          タグを引けた記録が0本なので、この軸では絞れない。記録を銘柄に紐付けると出る。
        </p>
      ) : (
        <>
          <FacetRow
            title="味タグ"
            items={facet.narrowing.map(toTagItem)}
            selected={selected}
            onSelect={onSelect}
          />
          {facet.broad.length > 0 && (
            <>
              <p className={TAG_NOTE}>
                {`タグを引けた記録の半数より多くに付く語（${String(facet.broad.length)}語）は、押しても大きくは絞れないので既定では畳んでいる。件数付きで出せる。`}
              </p>
              <button
                type="button"
                onClick={onToggleBroad}
                aria-expanded={broadOpen}
                className={TAG_QUIET_BUTTON}
              >
                {broadOpen
                  ? `残り ${String(facet.broad.length)}語を隠す`
                  : `残り ${String(facet.broad.length)}語を出す`}
              </button>
              {/* 畳んだ側の語を選んだまま閉じても、効いている条件はチップで見えている
                  (だから閉じるボタンを押せなくする必要はない) */}
              {broadOpen && (
                <FacetRow
                  title="半数超"
                  items={facet.broad.map(toTagItem)}
                  selected={selected}
                  onSelect={onSelect}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

/** ピルのキーは語そのもの(表示と選択で別の識別子を持たない) */
function toTagItem({ tag, count }: { tag: string; count: number }): FacetItem {
  return { key: tag, label: tag, count }
}
