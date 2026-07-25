// 紐付けの由来バッジ。対応表は `./linkStatus.ts` の1箇所だけが持ち、ここは描画専用。
//
// **`whitespace-nowrap` はこのバッジ側の責務**。日本語ラベル(`未紐付け` `銘柄不明`)は
// 語中で折れるので、包む行の `flex-wrap` + `gap-y-*` と**対で**直さないと
// 「未紐付」「け」のように割れる(片方だけでは直らない)。対の片側がここ、もう片側は RecordCard。

import type { LinkStatus } from '../../domain/types.ts'
import { linkStatusBadge } from './linkStatus.ts'

type Props = { status: LinkStatus }

export function LinkStatusBadge({ status }: Props) {
  const { label, help, className } = linkStatusBadge(status)
  return (
    <span
      title={help}
      className={`whitespace-nowrap rounded border px-1.5 py-px text-[11px] leading-4 ${className}`}
    >
      {label}
    </span>
  )
}
