// 産地マップ(A9 の4画面目)。47都道府県を本数で塗り分け、**未進出県が空白で分かる**ことが
// SPEC の要求。地図の右(狭い画面では下)に 47県の一覧を必ず併置する。
//
// ## この画面が引き受けている決定
//
// 1. **本数を数え直さない。** 入力は `computeStats()` の戻り値だけ。ここで `records` を
//    受けて数えると、統計画面と産地画面で同じ数を2箇所で数えることになり必ずドリフトする
//    (数える実装は `src/domain/stats.ts` の1箇所 = 受け入れ基準 A10)。
// 2. **地図に塗れないものを黙って落とさない。** 県が確定していない記録(空欄 / `〜または〜` の
//    ような表記)は**地図の外に件数で別立てする**。近い県に丸めたり「その他」に混ぜたりしない
//    (不確実性を隠さない)。塗った本数と全本数を見出しに並べて、差が目で追えるようにする。
// 3. **`codeFromRomaji` で解決できない形は色を付けずに残し、id を名指しで出す**
//    (`areaRows.ts` を参照)。飛ばすと地図から県が1つ消えるだけで痕跡が残らない。
// 4. **地図の `<path>` は押せない。** 実形状では香川・大阪の標的が数px しかなく、47個の
//    フォーカス可能要素を作ると一覧と二重のタブ順ができる。選択は一覧側の役目で、
//    地図は「どこか」を示す側に徹する(押した県を地図が輪郭で強調する)。
// 5. **CC-BY のクレジット(`MapCredit`)はこの画面に置く。** ライセンス対象は県形状の `<path>` で、
//    それを描くのはこの画面だけなので使用箇所に併記するのが素直(CC-BY-4.0 §3(a)(2) の
//    「必要情報のある場所を URI で示す」枝には乗れない — このアプリは URL ルーティングを
//    持たないので示す URL が無い)。**文言の出所は `ui/Attribution/Attribution.tsx` の1箇所**で、
//    ここが決めるのは置き場所だけ。全画面のフッタからは外した(注釈が5行あるのが邪魔だという要望)。
//
// ## 日本語県名の出所
//
// `prefectureName()` = `public/data/sakenowa/areas.json`(さけのわ)の値。`DecodedTables` の
// `areaNameById` と**同じファイルから来る**ので出所は1つ。テーブルの fetch を待たずに描けるよう
// `prefecture.ts` 経由で引く(この画面が要るのは記録の集計値だけで、銘柄マスタは要らない)。

import { useMemo, useState } from 'react'
import { MapCredit } from '../Attribution/Attribution.tsx'
import { NO_PREFECTURE_LABEL, prefectureName } from '../../domain/prefecture.ts'
import type { Stats } from '../../domain/stats.ts'
import type { SakeRecord } from '../../domain/types.ts'
import { brandsInPrefecture, type PrefectureBrand } from './brandsInPrefecture.ts'
import { LinkStatusBadge } from '../Timeline/LinkStatusBadge.tsx'
import {
  JAPAN_LOCATIONS,
  JAPAN_VIEW_BOX,
  PREFECTURE_TOTAL,
  buildMapShapes,
  countPrefecturesByStep,
} from './areaRows.ts'
import { FILL_STEPS, SHAPE_STROKE, UNRESOLVED_FILL } from './fillSteps.ts'
import { PrefectureList } from './PrefectureList.tsx'

type Props = {
  /** `computeStats(records)` の戻り値。**この画面では数えない**(1 を参照) */
  stats: Stats
  /**
   * 県を選んだときの銘柄一覧に使う。**数えるのは `brandsInPrefecture` の1箇所**で、
   * 合計が地図の本数と一致することはテストで固定してある。
   *
   * 渡さなければ一覧を出さない(記録が読めていない間はこの画面を数字だけで出す)。
   */
  records?: readonly SakeRecord[]
  /** 「記録タブで見る」を押したとき。渡さなければボタンを出さない */
  onOpenRecords?: (prefectureName: string) => void
}

/** Timeline / 他タブと同じ器。1280px でも本文が左端に張り付かない(B16) */
const CONTAINER = 'mx-auto w-full max-w-3xl px-4'

export function AreaMap({ stats, records, onOpenRecords }: Props) {
  const [selectedCode, setSelectedCode] = useState<number | null>(null)

  const { shapes, unresolvedIds } = useMemo(
    () => buildMapShapes(JAPAN_LOCATIONS, stats.byPrefectureCode),
    [stats.byPrefectureCode],
  )
  const stepCounts = useMemo(() => countPrefecturesByStep(stats.prefectures), [stats.prefectures])

  // 塗れた本数と塗れなかった本数。**合計は `stats.total` に一致する**
  // (33バケツ + 未解決バケツ + 空欄 で分割されているため)。一致を見出しで見せる
  const mappedTotal = stats.prefectures.reduce((sum, prefecture) => sum + prefecture.count, 0)
  const unresolvedTotal = stats.unresolvedPrefectures.reduce((sum, row) => sum + row.count, 0)
  const unknownTotal = unresolvedTotal + stats.noPrefectureCount

  const selectedShape = shapes.find((shape) => shape.code === selectedCode) ?? null
  const selectedName = selectedCode === null ? null : prefectureName(selectedCode)
  const selectedCount = selectedCode === null ? 0 : (stats.byPrefectureCode.get(selectedCode) ?? 0)
  // 選んだ県が変わったときだけ数え直す(203本 × 47県を描画のたびに走らせない)
  const brands = useMemo(
    () => (records === undefined || selectedCode === null ? [] : brandsInPrefecture(records, selectedCode)),
    [records, selectedCode],
  )

  return (
    <section aria-label="産地マップ" className={`${CONTAINER} flex flex-col gap-3 py-4`}>
      <header>
        <h2 className="text-sm font-semibold text-ink">産地</h2>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink-muted">
          <span className="whitespace-nowrap">
            訪問 {stats.prefectures.length}県 / {PREFECTURE_TOTAL}県
          </span>
          <span className="whitespace-nowrap">地図に塗った {mappedTotal}本</span>
          <span className="whitespace-nowrap">全 {stats.total}本</span>
        </p>
      </header>

      {stats.total === 0 && (
        <p className="text-xs leading-relaxed text-ink-faint">
          記録が1本も無いので、{PREFECTURE_TOTAL}県すべてが未進出。記録タブから取り込むとここが塗られる。
        </p>
      )}

      {/* 地図の形と県コードが対応しなかったとき。**件数だけでなく id を出す**
          (どの形が落ちたか分からないと直せない) */}
      {unresolvedIds.length > 0 && (
        <div className="rounded border border-danger-line bg-danger-surface px-3 py-2">
          <p role="alert" className="text-xs font-medium text-danger-ink">
            地図の {unresolvedIds.length}件を都道府県に対応付けられなかった
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-danger-ink">
            対応付けられなかった id: {unresolvedIds.join(' / ')}
            。この形は色を付けずに残してある（黙って飛ばすと地図から県が消え、本数の合計だけが合わなくなる）。
          </p>
        </div>
      )}

      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="flex w-full flex-col gap-2 md:w-72 md:shrink-0">
          {/* SVG なので width/height 属性は不要(あの規則は <img> の話)。
              viewBox はパッケージの値をそのまま使い、幅に合わせて縦横比を保つ */}
          <svg
            viewBox={JAPAN_VIEW_BOX}
            role="img"
            aria-label="都道府県別の本数を塗り分けた日本地図。濃いほど本数が多い。県ごとの本数は隣の一覧で読める"
            className="h-auto w-full"
          >
            {shapes.map((shape) => (
              <path
                key={shape.id}
                d={shape.path}
                data-romaji={shape.id}
                data-code={shape.code ?? undefined}
                data-count={shape.count ?? undefined}
                data-step={shape.step === null ? 'unresolved' : String(shape.step)}
                strokeWidth={0.6}
                className={
                  shape.step === null ? UNRESOLVED_FILL : `${FILL_STEPS[shape.step].fill} ${SHAPE_STROKE}`
                }
              />
            ))}
            {/* 選択の強調は**最後に重ねる**。塗りの上に輪郭だけを引くので、
                段の色を書き換えずに位置を示せる(隣県に隠れることもない)。
                `data-romaji` は付けない — 47件の形を数える側と混ざる */}
            {selectedShape !== null && (
              <path
                d={selectedShape.path}
                data-selected="true"
                className="fill-none stroke-ink"
                strokeWidth={2}
              />
            )}
          </svg>

          {/* 選択の結果はここだけに出す(地図の中に数字を描かない)。
              `role="status"`(= aria-live polite)で、押した県の本数が読み上げられる */}
          <p role="status" className="min-h-4 text-xs text-ink-muted">
            {selectedName === null ? (
              <span className="text-ink-faint">一覧の県を押すと地図でその位置を示す</span>
            ) : (
              <>
                <span className="font-medium text-ink">{selectedName}</span>{' '}
                <span>{selectedCount === 0 ? '未進出（0本）' : `${String(selectedCount)}本`}</span>
              </>
            )}
          </p>

          {selectedName !== null && records !== undefined && (
            <PrefectureBrands
              prefectureName={selectedName}
              brands={brands}
              onOpenRecords={onOpenRecords}
            />
          )}

          <ul
            aria-label="塗りの段"
            className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted"
          >
            {FILL_STEPS.map((step, index) => (
              <li key={step.label} className="flex items-center gap-1 whitespace-nowrap">
                {/* 枠は `line-strong`。**未進出の段は白地に近い**ので、枠が無いと 2.5px 角の
                    スウォッチが凡例から消えて「0本の色」が読めなくなる(地図側は県境が同じ役目) */}
                <span
                  aria-hidden="true"
                  className={`inline-block h-2.5 w-2.5 rounded-sm border border-line-strong ${step.swatch}`}
                />
                {step.label}
                <span className="text-ink-faint">{stepCounts[index]}県</span>
              </li>
            ))}
          </ul>

          {/* ライセンス対象は上の svg の県形状。地図と凡例の直下に置いて、
              何に対するクレジットなのかを位置で示す(文言は Attribution.tsx が持つ) */}
          <MapCredit />

          {/* 地図の外の別立て。**丸めない / 混ぜない / 黙って落とさない** */}
          {unknownTotal > 0 && (
            <div className="rounded border border-line bg-surface px-3 py-2">
              <h3 className="text-xs font-semibold text-ink">
                地図に塗れなかった {unknownTotal}本
              </h3>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                県が1つに決まらない記録。近い県に丸めず、地図の外で件数のまま残す。
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {stats.unresolvedPrefectures.map((row) => (
                  <li
                    key={row.label}
                    className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[11px]"
                  >
                    <span className="min-w-0 text-ink-muted">{row.label}</span>
                    <span className="whitespace-nowrap text-ink-muted">{row.count}本</span>
                  </li>
                ))}
                {stats.noPrefectureCount > 0 && (
                  <li className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[11px]">
                    <span className="min-w-0 text-ink-muted">{NO_PREFECTURE_LABEL}</span>
                    <span className="whitespace-nowrap text-ink-muted">
                      {stats.noPrefectureCount}本
                    </span>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        <PrefectureList
          byPrefectureCode={stats.byPrefectureCode}
          selectedCode={selectedCode}
          onSelect={setSelectedCode}
        />
      </div>
    </section>
  )
}

/**
 * 選んだ県で飲んだ銘柄。**重複は畳んである**(同じ銘柄IDなら表記が違っても1行)。
 *
 * 合計は地図に出ている本数と必ず一致する(`brandsInPrefecture` のテストで固定)。
 * 一致しないと、どちらが正しいのか画面からは判定できない。
 */
function PrefectureBrands({
  prefectureName,
  brands,
  onOpenRecords,
}: {
  prefectureName: string
  brands: readonly PrefectureBrand[]
  onOpenRecords?: (prefectureName: string) => void
}) {
  const total = brands.reduce((sum, brand) => sum + brand.count, 0)

  return (
    <section className="rounded border border-line bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <h3 className="text-xs font-semibold text-ink">
          {prefectureName}で飲んだ銘柄
          {brands.length > 0 && (
            <span className="ml-1.5 font-normal text-ink-muted">
              {brands.length}銘柄 / {total}本
            </span>
          )}
        </h3>
        {onOpenRecords !== undefined && brands.length > 0 && (
          <button
            type="button"
            onClick={() => onOpenRecords(prefectureName)}
            className="whitespace-nowrap rounded border border-line-strong px-2.5 py-1 text-xs text-ink"
          >
            記録タブで見る
          </button>
        )}
      </div>

      {brands.length === 0 ? (
        <p className="mt-1.5 text-xs text-ink-faint">この県の記録はまだ無い。</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {brands.map((brand) => (
            <li key={brand.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="min-w-0 text-xs text-ink">{brand.name}</span>
              {/* 本人の表記が銘柄名と違うときだけ添える(`冩楽` に対する `寫楽`) */}
              {brand.label !== null && (
                <span className="whitespace-nowrap text-[11px] text-ink-faint">
                  記録の表記: {brand.label}
                </span>
              )}
              <LinkStatusBadge status={brand.linkStatus} />
              <span className="ml-auto whitespace-nowrap text-xs text-ink-muted">
                {brand.count}本
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
