// linkStatus のバッジ対応表。**ここが唯一の出所**(PHASE_3 の完了条件 / brain「単一の真実源から引く」)。
//
// 5値の実行時列挙は `src/domain/backupSchema.ts` の `LINK_STATUSES` が持っている。こちらは
// `Record<LinkStatus, _>` なので **型に6値目が増えるとコンパイルエラーになり**、
// 「実行時列挙とこの表が同じ5値を覆っている」ことは Timeline.test.tsx が固定する
// (表を1つ消すと落ちる)。バッジ・絞り込みピル・詳細画面はすべてこの表を引く。
//
// 定数をコンポーネントと同じファイルから export すると Fast Refresh が効かなくなるため
// (`ui/AppShell/tabs.ts` と同じ理由)、表はこのモジュールに置き
// `LinkStatusBadge.tsx` は描画だけを持つ。

import type { LinkStatus } from '../../domain/types.ts'

export type LinkStatusBadgeSpec = {
  /** バッジに出す短いラベル。**原子ラベルなので描画側で `whitespace-nowrap` を当てる** */
  label: string
  /** title。なぜその状態なのかと、フレーバーが取れるのかを1行で言う */
  help: string
  /** 見た目。**accent 色は manual だけ**(本人が判断した紐付けを機械の判断と混ぜない) */
  className: string
}

/**
 * 5値の対応表。`unlinked` / `unknown` の help に「フレーバーは取れない」を書くのは、
 * ここが不確実性を隠さないための面だから(SPEC「紐付いていない記録に推定値を埋めない」)。
 */
export const LINK_STATUS_BADGES: Record<LinkStatus, LinkStatusBadgeSpec> = {
  auto: {
    label: '自動',
    help: '銘柄名（と都道府県）の一致で機械が紐付けた',
    className: 'border-stone-700 text-stone-300',
  },
  alias: {
    label: '別名',
    help: '別名表で紐付けた（記録の表記とさけのわの銘柄名が違う）',
    className: 'border-sky-900 bg-sky-950/60 text-sky-300',
  },
  manual: {
    label: '手動',
    help: '本人が手動で紐付けた（機械の一致ではなく本人の判断）',
    className: 'border-emerald-800 bg-emerald-950/60 font-medium text-emerald-300',
  },
  unlinked: {
    label: '未紐付け',
    help: 'さけのわに該当が無い、または候補を絞れない。フレーバーは取れない',
    className: 'border-amber-900 bg-amber-950/60 text-amber-300',
  },
  unknown: {
    label: '銘柄不明',
    help: '記録した時点で銘柄が判読できていない。フレーバーは取れない',
    className: 'border-dashed border-stone-600 text-stone-400',
  },
}

/**
 * 表示順。**確信の高い順 → 低い順**で、絞り込みピルの並びもこれに従う。
 * `LINK_STATUSES` はキーの挿入順なので表示順として使わない(並べ方は表示層の関心)。
 */
export const LINK_STATUS_ORDER: readonly LinkStatus[] = [
  'auto',
  'alias',
  'manual',
  'unlinked',
  'unknown',
]

/**
 * 表を引く唯一の関数。**表に無い値は `unknown` に格下げする** —
 * 壊れた JSON から来た値を「自動で紐付いた」側に丸めると、確信度を上げる方向の嘘になる
 * (迷ったら格下げ)。
 */
export function linkStatusBadge(status: LinkStatus): LinkStatusBadgeSpec {
  return Object.hasOwn(LINK_STATUS_BADGES, status)
    ? LINK_STATUS_BADGES[status]
    : LINK_STATUS_BADGES.unknown
}
