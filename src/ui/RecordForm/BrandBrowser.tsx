// 銘柄を**打たずに選ぶ**三段の絞り込み(県 → 蔵元 → 銘柄)。照合・並び・件数の判断は持たず、
// `createBrandBrowser` が返すものを描くだけ(domain/browseBrands.ts が唯一の実装)。
//
// ## なぜこの導線が要るか
//
// 検索は**銘柄名の字か読みを知っていること**が前提。かなは引けるようになった(B68。`きど` →
// `紀土`)が、漢字1字ごとの読みから組むので当たらない銘柄があり、ローマ字では引けない。
// OCR も実測で9枚中3枚は銘柄の字を1文字も読めない。
// **ラベルから確実に読めるのは蔵元名と都道府県**なので、そこから辿れる道を1本用意する。
//
// ## この部品が引き受けている決定
//
// 1. **既定は畳んでおく。** 3264件の入口を常時開くと、打って探す人の邪魔にしかならない
// 2. **一段ずつしか出さない。** 県48 → 蔵元(その県ぶん) → 銘柄(その蔵ぶん)。
//    3つ同時に出すと画面が縦に伸びるだけで、絞り込んでいる実感が消える
// 3. **どの段にも件数を出す。** 押す前に「どれだけ絞れるか」が分かる状態を保つ
// 4. **選んだら `onPick`(= `BrandSuggest` と同じ受け口)に流して畳む。** 紐付けの経路を増やさない
// 5. **編集中でも使える。** 1タップで確定しない(最短3タップ)ので、最近飲んだ銘柄のチップと違い
//    「直そうとして開いた紐付けを誤って別の銘柄にする」事故が起きない

import { useState } from 'react'
import type { BrandBrowser as Browser } from '../../domain/browseBrands.ts'
import type { PickedBrand } from '../common/pickedBrand.ts'

type Props = {
  browse: Browser
  onPick: (picked: PickedBrand) => void
  /**
   * 開閉は**親が持つ**。OCR が外れたときに `OcrAssist` の「一覧から銘柄を選ぶ」から
   * ここを開くので、この部品だけが状態を持っていると外から開けない。
   */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** いま銘柄欄に紐付いている銘柄ID。行に「入れた」印を出すためだけに使う */
  pickedBrandId?: number | null
  disabled?: boolean
}

/** いま見ている段。`breweryId` が非 null なら三段目 */
type At = { areaId: number | null; breweryId: number | null }

const CLOSED: At = { areaId: null, breweryId: null }

const CHIP =
  'whitespace-nowrap rounded-full border border-line-strong bg-canvas px-2.5 py-1 text-xs text-ink disabled:opacity-50'
const ROW =
  'block w-full rounded border border-line-strong bg-canvas px-3 py-2 text-left disabled:opacity-50'
const PILL = 'whitespace-nowrap rounded border border-line-strong px-1.5 py-px text-[11px] leading-4'

export function BrandBrowser({
  browse,
  onPick,
  open,
  onOpenChange,
  pickedBrandId = null,
  disabled = false,
}: Props) {
  const [at, setAt] = useState<At>(CLOSED)

  const areas = browse.areas()
  const area = at.areaId === null ? null : (areas.find((row) => row.areaId === at.areaId) ?? null)
  const breweries = area === null ? [] : browse.breweries(area.areaId)
  const brewery =
    at.breweryId === null
      ? null
      : (breweries.find((row) => row.brewery.id === at.breweryId) ?? null)

  function close() {
    onOpenChange(false)
    setAt(CLOSED)
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => {
          if (open) close()
          else onOpenChange(true)
        }}
        disabled={disabled}
        aria-expanded={open}
        className="whitespace-nowrap rounded border border-line-strong px-3 py-1.5 text-sm text-ink-muted disabled:opacity-50"
      >
        {open ? '一覧を閉じる' : '一覧から選ぶ'}
      </button>

      {!open && (
        <p className="mt-1 text-xs leading-relaxed text-ink-faint">
          銘柄名を打たずに、都道府県 → 蔵元 → 銘柄と辿って選ぶ。ラベルの蔵元名と住所から探すときに使う。
        </p>
      )}

      {open && (
        <div className="mt-2 rounded border border-line bg-surface px-2.5 py-2">
          {/* いまどこに居るかを常に1行で出す。押すと一段戻る */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <button
              type="button"
              onClick={() => setAt(CLOSED)}
              disabled={area === null}
              className="whitespace-nowrap text-xs text-ink-muted disabled:text-ink-faint"
            >
              都道府県
            </button>
            {area !== null && (
              <>
                <span aria-hidden className="text-xs text-ink-faint">
                  ›
                </span>
                <button
                  type="button"
                  onClick={() => setAt({ areaId: area.areaId, breweryId: null })}
                  disabled={brewery === null}
                  className="whitespace-nowrap text-xs text-ink-muted disabled:text-ink-faint"
                >
                  {area.name}
                </button>
              </>
            )}
            {brewery !== null && (
              <>
                <span aria-hidden className="text-xs text-ink-faint">
                  ›
                </span>
                <span className="whitespace-nowrap text-xs text-ink-faint">
                  {brewery.name ?? '蔵元名がデータに無い'}
                </span>
              </>
            )}
          </div>

          {area === null && (
            <>
              {/* 対で折り返しを直す: 行に flex-wrap + gap-y、原子ラベル(県名と件数)に nowrap */}
              <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1.5">
                {areas.map((row) => (
                  <button
                    key={row.areaId}
                    type="button"
                    onClick={() => setAt({ areaId: row.areaId, breweryId: null })}
                    disabled={disabled}
                    aria-label={`${row.name} の蔵元を出す（${String(row.breweryCount)}蔵）`}
                    className={CHIP}
                  >
                    {row.name}
                    <span className="ml-1 text-ink-faint">{row.breweryCount}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
                数字はその県の蔵元の数。銘柄を1件も持たない県と蔵元は並べていない。
              </p>
            </>
          )}

          {area !== null && brewery === null && (
            <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
              {breweries.map((row) => (
                <li key={row.brewery.id}>
                  <button
                    type="button"
                    onClick={() => setAt({ areaId: area.areaId, breweryId: row.brewery.id })}
                    disabled={disabled}
                    aria-label={`${row.name ?? '蔵元名がデータに無い'} の銘柄を出す（${String(row.brandCount)}件）`}
                    className={ROW}
                  >
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-sm text-ink">
                        {row.name ?? '蔵元名がデータに無い'}
                      </span>
                      <span className="whitespace-nowrap text-xs text-ink-muted">
                        {row.brandCount}銘柄
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {brewery !== null && (
            <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
              {browse.brands(brewery.brewery.id).map((row) => (
                <li key={row.brand.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(row)
                      close()
                    }}
                    disabled={disabled}
                    aria-label={`${row.brand.name} を銘柄にする`}
                    className={ROW}
                  >
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-sm font-medium text-ink">{row.brand.name}</span>
                      {row.brand.id === pickedBrandId && (
                        <span className={`${PILL} border-ok-line text-ok-ink`}>銘柄欄に入れた</span>
                      )}
                    </span>
                    <span className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-ink-muted">
                      <span className="whitespace-nowrap">
                        {row.prefecture ?? '都道府県がデータに無い'}
                      </span>
                      <span className="whitespace-nowrap">
                        {row.breweryName ?? '蔵元名がデータに無い'}
                      </span>
                      {/* 紐付け済み ≠ フレーバー取得済み。選ぶ前に分かるようにする */}
                      {!row.hasFlavorChart && <span className="whitespace-nowrap">フレーバーなし</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
