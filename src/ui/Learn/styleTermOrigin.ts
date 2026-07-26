// `domain/stats.ts` の `STYLE_TERMS`（統計タブのスタイル分布が数える11語）が、それぞれ
// **どこで定義された語なのか**の対応表。
//
// ## なぜ2値ではなく3値なのか
//
// 11語を「法令の語」と「そうでない語」に割るだけでは足りない。3つ目の状態がある:
//
//   1. **告示に定義がある** … 特定名称5語（第1項・第2項）と `原酒`（第5項の任意記載事項）
//   2. **定義を確認できていない** … `無濾過` `ひやおろし` `しぼりたて` `にごり`。
//      告示の本文（5,394字）に1度も出てこないことは実測したが、
//      **「法令上の定義が無い」と断定はしない** — 他の法令・通達・業界の自主基準を
//      網羅して調べていないので、「無い」と言えるだけの根拠がこちらに無い。
//      不確かさを「定義が無い」と言い切って消すのは、`unlinked` に推定値を埋めるのと同じ間違い。
//   3. **このアプリが決めたルール** … 11語という語彙の選び方、部分一致、重複計上、
//      スペック欄だけを見ること。**どの法令にも書いていない。**
//
// 3つ目を表に出さないと、法令由来の表の隣に並んだアプリ独自の規則が法令由来に見える。
// 画面では 1 と 2 を表の `出所` 列で、3 を表の外の帯（`notice-*`）で示す。
//
// ## 型で強制していること
//
// `Record<StyleTerm, StyleTermOrigin>` なので、`STYLE_TERMS` に12語目が入ると
// **コンパイルエラーになる**（出所不明の語が黙って「法令の語」の表に混ざらない）。
// 逆に語を消したときもキーが余ってエラーになる。

import type { StyleTerm } from '../../domain/stats.ts'
import { GENSHU_DEFINITION, KIZAKE_DEFINITION } from './seishuMeisho.ts'

export type StyleTermOrigin =
  /** 告示の特定名称。定義は8種の表にある（`meishoName` はその表の行の名前） */
  | { readonly kind: 'meisho'; readonly meishoName: string }
  /** 告示 第5項の任意記載事項。定義を逐語で持つ */
  | { readonly kind: 'kokuji'; readonly definition: string }
  /**
   * 語そのものは告示に無いが、告示の要件2つの組み合わせとして読める語。
   * **「告示の用語」と書かない**ための独立した状態
   */
  | { readonly kind: 'composite'; readonly note: string }
  /** 告示の本文に定義を確認できていない語。**定義を書かない** */
  | { readonly kind: 'unconfirmed' }

/** 出所の短いラベル（表の `出所` 列）。**原子ラベルなので描画側で `whitespace-nowrap`** */
export const STYLE_TERM_ORIGIN_LABELS: Record<StyleTermOrigin['kind'], string> = {
  meisho: '告示（特定名称）',
  kokuji: '告示（任意記載事項）',
  composite: '告示の要件の組み合わせ',
  unconfirmed: '確認できていない',
}

/**
 * 出所ごとの見た目。**linkStatus のバッジと同じ語彙を使う**（このアプリでは
 * 破線の枠が「不明」を意味する。`LINK_STATUS_BADGES.unknown` がそれ）。
 * 色は付けない — 出所は状態の良し悪しではないので、注意色に寄せると意味が変わる。
 */
export const STYLE_TERM_ORIGIN_CLASSES: Record<StyleTermOrigin['kind'], string> = {
  meisho: 'border-line-strong text-ink-muted',
  kokuji: 'border-line-strong text-ink-muted',
  composite: 'border-line-strong text-ink-muted',
  unconfirmed: 'border-dashed border-line-strong text-ink-muted',
}

/**
 * 11語 → 出所。**キーの並びは `STYLE_TERMS` に揃えてある**が、描画の順序は
 * `STYLE_TERMS` 側を走査して決める（この表の挿入順を表示順に使わない。
 * `linkStatus.ts` が `LINK_STATUSES` を表示順に使わないのと同じ理由）。
 */
export const STYLE_TERM_ORIGINS: Record<StyleTerm, StyleTermOrigin> = {
  純米大吟醸: { kind: 'meisho', meishoName: '純米大吟醸酒' },
  大吟醸: { kind: 'meisho', meishoName: '大吟醸酒' },
  純米吟醸: { kind: 'meisho', meishoName: '純米吟醸酒' },
  純米: { kind: 'meisho', meishoName: '純米酒' },
  本醸造: { kind: 'meisho', meishoName: '本醸造酒' },
  生原酒: {
    kind: 'composite',
    // 「生原酒」で1つの用語として定義されているわけではない。2つの要件の重なりだと書く
    note: `「生原酒」という語そのものは告示に無い。「生酒」（${KIZAKE_DEFINITION}）と「原酒」（${GENSHU_DEFINITION}）の要件を両方満たすものを指す語として使われている。`,
  },
  無濾過: { kind: 'unconfirmed' },
  原酒: { kind: 'kokuji', definition: GENSHU_DEFINITION },
  ひやおろし: { kind: 'unconfirmed' },
  しぼりたて: { kind: 'unconfirmed' },
  にごり: { kind: 'unconfirmed' },
}
