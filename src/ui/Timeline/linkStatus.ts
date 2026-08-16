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
  /**
   * 見た目。**色を持つのは manual と unlinked だけ**(本人が判断した紐付けを機械の判断と混ぜない)。
   * 機械の一致(`auto` / `alias`)は無彩色で、`auto` は枠だけ・`alias` は面ありで区別する。
   */
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
    className: 'border-line-strong text-ink-muted',
  },
  alias: {
    label: '別名',
    help: '別名表で紐付けた（記録の表記とさけのわの銘柄名が違う）',
    // 強調色は amber 1色に絞るので sky は使わず中性に畳む。`auto` との差は
    // 「枠だけ + 補助文字」対「面あり + 本文の濃さ」で付ける(ラベルは変えない)
    className: 'border-line-strong bg-surface-raised text-ink',
  },
  manual: {
    label: '手動',
    help: '本人が手動で紐付けた（機械の一致ではなく本人の判断）',
    className: 'border-ok-line bg-ok-surface font-medium text-ok-ink',
  },
  unlinked: {
    label: '未紐付け',
    help: 'さけのわに該当が無い、または候補を絞れない。フレーバーは取れない',
    className: 'border-notice-line bg-notice-surface text-notice-ink',
  },
  unknown: {
    label: '銘柄不明',
    help: '記録した時点で銘柄が判読できていない。フレーバーは取れない',
    className: 'border-dashed border-line-strong text-ink-muted',
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
 * 紐付いているか。**列挙外の値は「紐付いている」側に寄せる**(上書きしないほうが安全なので、
 * 5値目が増えても手動紐付けの導線が他人の判断を勝手に潰さない)。
 *
 * 対応表と同じモジュールに置くのは、これを使う3箇所(時系列の行 / 記録の詳細 / 手動紐付けの計算)が
 * すべて「`linkStatus` をどう解釈するか」の話で、実装が分かれるとドリフトするため。
 * このモジュールは `domain/types.ts` しか import しないので、store を引かずに使える
 * (`ui/LinkBrand/applyManualLink.ts` は `isLinked` の名前でこれを再輸出している)。
 */
export function isLinkedStatus(status: LinkStatus): boolean {
  return status !== 'unlinked' && status !== 'unknown'
}

/**
 * 解除しても**元データの取り込み直しで戻る**紐付けか(B30)。
 *
 * `auto` は銘柄名の一致で、`alias` はエイリアス表で機械的に決まるので、記録を作り直せば
 * 同じ判断がまた当たる(取り込みは記録を全置換するが**エイリアスは残す**ので、`alias` も戻る)。
 * `manual` は解除で保存した別名も消えるため戻らない。
 *
 * **否定の別名(「この表記はこの銘柄ではない」)を持たない**という設計をそのまま言い換えたもの。
 * 持たせない判断の理由は `ui/LinkBrand/LinkBrandPanel.tsx` の解除の節に書いてある。
 * ここに置くのは、`linkStatus` の解釈を1モジュールに集めるという既存の約束に従うため。
 */
export function revertsOnReimport(status: LinkStatus): boolean {
  return status === 'auto' || status === 'alias'
}

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
