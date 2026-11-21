// 次に飲む候補(B124)。選ぶ規則は `domain/nextBrands.ts` の1箇所で、ここは並べて理由を添えるだけ。
//
// **推定であることを画面の側でも割る。** 候補は記録と同じ見た目にしない(評価・日付の欄を持たない)
// し、「おすすめ」「好きそう」とは言わない。言えるのは「どの記録の銘柄に、6軸がどれだけ近いか」まで。

import { useMemo, useState } from 'react'
import { NEXT_BRANDS_PER_ANCHOR, suggestNextBrands } from '../../domain/nextBrands.ts'
import { prefectureCode } from '../../domain/prefecture.ts'
import type { FlavorPoint } from '../../domain/flavor.ts'
import type {
  FlavorChart,
  SakeRecord,
  SakenowaBrand,
  SakenowaBrewery,
} from '../../domain/types.ts'

/** 候補を引くのに要る表。`DecodedTables` の部分集合(テストで数件のリテラルから組める) */
export type NextBrandCatalog = {
  flavorCharts: readonly FlavorChart[]
  brandById: ReadonlyMap<number, SakenowaBrand>
  breweryById: ReadonlyMap<number, SakenowaBrewery>
  prefectureOfBrand: (brandId: number) => string | null
}

export function NextBrands({
  records,
  points,
  catalog,
}: {
  records: readonly SakeRecord[]
  points: readonly FlavorPoint[]
  catalog: NextBrandCatalog
}) {
  const [unvisitedOnly, setUnvisitedOnly] = useState(false)

  const drunkBrandIds = useMemo(
    () =>
      new Set(
        records.flatMap((record) =>
          record.sakenowaBrandId === null ? [] : [record.sakenowaBrandId],
        ),
      ),
    [records],
  )
  // 産地タブと同じく記録の都道府県で数える。県に落ちない値(「その他」・複数県)は飲んだ県に入れない
  const visited = useMemo(
    () =>
      new Set(
        records.flatMap((record) => {
          const code = prefectureCode(record.prefecture)
          return code === null ? [] : [code]
        }),
      ),
    [records],
  )

  const result = useMemo(
    () =>
      suggestNextBrands({
        points,
        flavorCharts: catalog.flavorCharts,
        drunkBrandIds,
        accept: unvisitedOnly
          ? (brandId) => {
              // 県が分からない銘柄は「まだ飲んでいない県」と言えないので外す
              const code = prefectureCode(catalog.prefectureOfBrand(brandId))
              return code !== null && !visited.has(code)
            }
          : undefined,
      }),
    [points, catalog, drunkBrandIds, unvisitedOnly, visited],
  )

  return (
    <section className="mt-5 border-t border-line pt-4">
      <h3 className="text-xs font-semibold text-ink-muted">次に飲む候補</h3>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
        評価4〜5を付けた銘柄に、さけのわの6軸が近い順。まだ記録の無い銘柄だけを出す。
      </p>

      {result.anchors === 0 ? (
        <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
          起点にできる銘柄がまだ無い。フレーバーの取れた記録に評価4〜5を付けると、ここに候補が出る（評価1〜2の記録もある銘柄は起点にしない）。
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1.5">
            <button
              type="button"
              aria-pressed={unvisitedOnly}
              onClick={() => setUnvisitedOnly((value) => !value)}
              className={`whitespace-nowrap rounded border px-2.5 py-1.5 text-xs ${
                unvisitedOnly
                  ? 'border-ink bg-surface-raised text-ink'
                  : 'border-line-strong text-ink-muted'
              }`}
            >
              まだ飲んでいない県だけ
            </button>
          </div>

          {result.candidates.length === 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              条件に合う銘柄が無い。
            </p>
          ) : (
            <ol className="mt-2 space-y-1.5">
              {result.candidates.map((candidate) => {
                const brand = catalog.brandById.get(candidate.brandId)
                const brewery =
                  brand === undefined ? undefined : catalog.breweryById.get(brand.breweryId)
                const prefecture = catalog.prefectureOfBrand(candidate.brandId)
                return (
                  <li
                    key={candidate.brandId}
                    className="rounded border border-line bg-surface px-3 py-2 text-xs"
                  >
                    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-sm font-medium text-ink">
                        {brand?.name ?? `銘柄 ${String(candidate.brandId)}`}
                      </span>
                      <span className="text-ink-muted">
                        {[brewery?.name, prefecture].filter(Boolean).join('・')}
                      </span>
                    </p>
                    <p className="mt-0.5 leading-relaxed text-ink-faint">
                      「{candidate.anchorLabel}」に近い（各軸の差 平均 {candidate.distance.toFixed(1)}）
                    </p>
                  </li>
                )
              })}
            </ol>
          )}
          <p className="mt-2 text-xs leading-relaxed text-ink-faint">
            近さは6軸だけで見ている。スペック・季節・価格・手に入りやすさは見ていない。起点{result.anchors}
            銘柄それぞれから最大{NEXT_BRANDS_PER_ANCHOR}件まで採るので、記録の多い味の近所だけで埋まらない。
          </p>
        </>
      )}
    </section>
  )
}
