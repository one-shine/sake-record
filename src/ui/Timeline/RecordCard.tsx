// 時系列リストの1行。**203本を実データで見て意味がある密度**にするのが要件なので、
// 飾り罫・カラーバー・中央寄せを置かず、1行に「日付 / 由来バッジ / 銘柄 / 県 / スペック / 評価 /
// 場所 / メモ」を詰める。
//
// ## この行が引き受けている決定
//
// 1. **サムネイルの不在を隠さない。** 既存203本は写真が1枚も無い(`thumbnail: null`)。空の枠を
//    黙って出すと「読み込み中なのか、無いのか」が区別できないので、破線枠に `写真なし` と書く。
//    枠の寸法は写真ありの `<img>` と同じにして、Phase 4 で写真が入っても行の高さが動かない。
// 2. **`<img>` には width/height 属性を付ける。** 付けないと読み込み中に行がずれる。
//    属性を付けたら CSS の `height:auto` が要る(src/index.css の `img` 規則がグローバルに当てている)
//    が、正方形にトリミングしたいので `h-16 w-16 object-cover` のクラスで上書きする
//    (クラスの詳細度が要素セレクタより強い)。
// 3. **中身は phrasing content だけで組む。** 行全体をタップで詳細を開けるようにすると
//    ルート要素が `<button>` になるため、`<h3>` / `<p>`(flow content) を入れると不正な HTML に
//    なる。`<span className="block">` で組めば押せる行と押せない行で DOM が変わらない。
// 4. **表記の差を見せる。** `荷札酒` → `加茂錦` のように別名で紐付いた行は、さけのわの銘柄名を
//    主にしつつ**記録した生の表記も併記**する(どちらかを黙って捨てると、なぜその銘柄名なのかが
//    追えなくなる)。

import { useEffect, useRef } from 'react'
import type { SakeRecord } from '../../domain/types.ts'
import { LinkStatusBadge } from './LinkStatusBadge.tsx'

type Props = {
  record: SakeRecord
  /** 渡すと行全体が詳細を開くボタンになる。**渡さなければ押せない行**(空振りするボタンを作らない) */
  onSelect?: (record: SakeRecord) => void
}

/** サムネイルの一辺(px)。`<img>` の width/height 属性とプレースホルダの寸法を1箇所から供給する */
const THUMB_SIZE = 64

export function RecordCard({ record, onSelect }: Props) {
  // 銘柄名はさけのわ由来を優先し、無ければ記録した生の表記(`寫楽` はさけのわに無いのでこちら)
  const name = record.brandName ?? record.brandLabel
  const showRawLabel = record.brandName !== null && record.brandName !== record.brandLabel

  const body = (
    <>
      <Thumbnail blob={record.thumbnail} label={record.brandLabel} />
      <span className="block min-w-0 flex-1">
        {/* 対の片側: flex-wrap + gap-y。バッジ側の whitespace-nowrap と合わせて初めて折り返しが直る */}
        <span className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
          <time dateTime={record.drankOn} className="text-xs text-stone-400">
            {record.drankOn}
          </time>
          <LinkStatusBadge status={record.linkStatus} />
        </span>

        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-stone-100">{name}</span>
          {record.prefecture !== null && (
            <span className="whitespace-nowrap text-[11px] text-stone-400">
              {record.prefecture}
            </span>
          )}
        </span>

        {showRawLabel && (
          <span className="mt-px block text-[11px] text-stone-500">記録の表記: {record.brandLabel}</span>
        )}

        {record.spec !== '' && (
          <span className="mt-0.5 block text-xs leading-snug text-stone-300">{record.spec}</span>
        )}

        {(record.rating !== null || record.place !== '') && (
          <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-stone-400">
            {record.rating !== null && (
              <span className="whitespace-nowrap text-stone-200">評価 {record.rating}</span>
            )}
            {record.place !== '' && <span>{record.place}</span>}
          </span>
        )}

        {record.note !== '' && (
          <span className="mt-1 block text-xs leading-relaxed text-stone-400">{record.note}</span>
        )}
      </span>
    </>
  )

  const shell = 'flex w-full gap-3 rounded border border-stone-800 bg-stone-900/40 p-2.5 text-left'
  if (!onSelect) return <div className={shell}>{body}</div>
  return (
    <button type="button" onClick={() => onSelect(record)} className={shell}>
      {body}
    </button>
  )
}

/**
 * 写真が無い記録の見せ方。**寸法は写真ありと同じ**にして行の高さを動かさない。
 *
 * ## `src` を state に持たず effect から DOM に直接書く理由
 *
 * `URL.createObjectURL` は Blob を表示するための唯一の手段だが、**revoke を忘れると
 * 203行ぶんの Blob URL がタブを閉じるまで解放されない**。したがって生成と解放は必ず対で
 * 書きたい = effect の後始末に置きたい。一方で
 * - effect の中で同期的に `setState` するのは React の指針に反する(`react-hooks` の
 *   `set-state-in-effect` が実際に error を出す)。
 * - render 中に `useMemo` で作るのは StrictMode の二重呼び出しで**1本ずつ leak する**
 *   (捨てられた1本目は revoke されない)。
 *
 * 「外部システム(ここでは DOM のプロパティ)を React の state と同期させる」のは effect の
 * 本来の用途なので、`img.src` を effect で直接書き、cleanup で revoke する。
 * `src` を React に描かせないので、再描画で React が上書きすることもない。
 *
 * `URL.createObjectURL` が無い環境(jsdom 等)ではプレースホルダに落とす — 例外で行を落とさない。
 */
function Thumbnail({ blob, label }: { blob: Blob | null; label: string }) {
  const imgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const img = imgRef.current
    if (img === null || blob === null) return
    const objectUrl = URL.createObjectURL(blob)
    img.src = objectUrl
    return () => {
      img.removeAttribute('src')
      URL.revokeObjectURL(objectUrl)
    }
  }, [blob])

  if (blob === null || typeof URL.createObjectURL !== 'function') {
    return (
      <span
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-dashed border-stone-700 text-[10px] text-stone-600"
        aria-hidden="true"
      >
        写真なし
      </span>
    )
  }
  // src は effect が入れる(空の img は壊れた画像アイコンにならず、ただの空枠として1フレーム出る)。
  // width/height 属性で行の高さを先に確定させ、正方形のトリミングはクラス側で上書きする。
  return (
    <img
      ref={imgRef}
      alt={`${label} のラベル写真`}
      width={THUMB_SIZE}
      height={THUMB_SIZE}
      className="h-16 w-16 shrink-0 rounded bg-stone-800 object-cover"
    />
  )
}
