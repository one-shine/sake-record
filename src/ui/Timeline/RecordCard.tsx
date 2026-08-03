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
//    が、正方形にトリミングしたいので `h-16 w-16 object-cover` のクラスで上書きする。
//    **上書きが成り立つのは index.css 側が `@layer base` に入っているからで、詳細度ではない** —
//    レイヤー無しの `img { height: auto }` は utilities より強く、実ブラウザで実際に `h-16` が
//    負けて 64×48 / 64×85 で描かれていた(Phase 4 の実機確認で発見)。
// 3. **中身は phrasing content だけで組む。** 行全体をタップで詳細を開けるようにすると
//    ルート要素が `<button>` になるため、`<h3>` / `<p>`(flow content) を入れると不正な HTML に
//    なる。`<span className="block">` で組めば押せる行と押せない行で DOM が変わらない。
// 4. **表記の差を見せる。** `荷札酒` → `加茂錦` のように別名で紐付いた行は、さけのわの銘柄名を
//    主にしつつ**記録した生の表記も併記**する(どちらかを黙って捨てると、なぜその銘柄名なのかが
//    追えなくなる)。

import { normalizePrefecture } from '../../domain/prefecture.ts'
import type { SakeRecord } from '../../domain/types.ts'
import { canShowThumbnail, useThumbnailImageRef } from '../common/thumbnailUrl.ts'
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
  // `!== null` だけで見ると、バックアップ JSON 由来の `''` で**中身が空のバッジ**が出る
  // (幅だけあって読めるものが無い)。未記入の判定は domain の1箇所に寄せる
  const prefecture = normalizePrefecture(record.prefecture)
  const showRawLabel = record.brandName !== null && record.brandName !== record.brandLabel

  const body = (
    <>
      <Thumbnail bytes={record.thumbnail} label={record.brandLabel} />
      <span className="block min-w-0 flex-1">
        {/* 対の片側: flex-wrap + gap-y。バッジ側の whitespace-nowrap と合わせて初めて折り返しが直る */}
        <span className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
          <time dateTime={record.drankOn} className="text-xs text-ink-muted">
            {record.drankOn}
          </time>
          <LinkStatusBadge status={record.linkStatus} />
        </span>

        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-ink">{name}</span>
          {prefecture !== null && (
            <span className="whitespace-nowrap text-[11px] text-ink-muted">{prefecture}</span>
          )}
        </span>

        {showRawLabel && (
          <span className="mt-px block text-[11px] text-ink-faint">
            記録の表記: {record.brandLabel}
          </span>
        )}

        {record.spec !== '' && (
          <span className="mt-0.5 block text-xs leading-snug text-ink-muted">{record.spec}</span>
        )}

        {(record.rating !== null || record.place !== '') && (
          <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-ink-muted">
            {record.rating !== null && (
              <span className="whitespace-nowrap text-ink">評価 {record.rating}</span>
            )}
            {record.place !== '' && <span>{record.place}</span>}
          </span>
        )}

        {record.note !== '' && (
          <span className="mt-1 block text-xs leading-relaxed text-ink-muted">{record.note}</span>
        )}
      </span>
    </>
  )

  const shell = 'flex w-full gap-3 rounded border border-line bg-surface p-2.5 text-left'
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
 * object URL の生成と revoke は `../common/thumbnailUrl.ts` が対で持つ(理由はそちら)。
 * `URL.createObjectURL` が無い環境(jsdom 等)ではプレースホルダに落とす — 例外で行を落とさない。
 */
function Thumbnail({ bytes, label }: { bytes: ArrayBuffer | null; label: string }) {
  const imgRef = useThumbnailImageRef(bytes)

  if (bytes === null || !canShowThumbnail()) {
    return (
      <span
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-dashed border-line-strong text-[10px] text-ink-faint"
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
      className="h-16 w-16 shrink-0 rounded bg-surface-raised object-cover"
    />
  )
}
