// 自作ラインアイコン。絵文字をアイコン代わりに使わず、線幅・角丸・グリッドを統一する。
// 24x24 グリッド / stroke 1.5 / currentColor。size は Tailwind の w-*/h-* で外から与える。

import type { ReactNode } from 'react'

type IconProps = { className?: string }

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  )
}

/** 時系列: 日付軸に並ぶ記録 */
export function TimelineIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 4v16" />
      <circle cx="5" cy="8" r="1.6" />
      <circle cx="5" cy="15.5" r="1.6" />
      <path d="M9.5 8h9.5M9.5 11h6M9.5 15.5h9.5M9.5 18.5h6" />
    </Svg>
  )
}

/** 統計: 本数の分布 */
export function StatsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20h16" />
      <path d="M7 20v-6M12 20V6M17 20v-9" />
    </Svg>
  )
}

/** フレーバー: 6軸レーダー */
export function FlavorIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9L12 3z" />
      <path d="M12 7.2l4 2.3v4.6l-4 2.3-4-2.3V9.5l4-2.3z" />
    </Svg>
  )
}

/** 産地: 都道府県マップ */
export function AreaIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9.2 4.4 4.5 6.2v13l4.7-1.8 5.6 2 4.7-1.8v-13l-4.7 1.8-5.6-2z" />
      <path d="M9.2 4.4v13.2M14.8 6.4v13.2" />
    </Svg>
  )
}

/**
 * 知る: 開いた本(語と数え方の説明)。
 *
 * 弧は `A` ではなく3次ベジェ(`C`/`c`)で描く。`A` は sweep フラグで曲がる向きが決まるので、
 * 綴りを1つ間違えるとページが逆に反った本になり**コードを読んでも気付けない**。
 * 制御点は x=12 の背表紙に対して左右対称(12±1.4 / 12±3.6)。
 */
export function LearnIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 7.4C10.6 6.1 8.4 5.5 5 5.6v11.2c3.4-.1 5.6.5 7 1.8 1.4-1.3 3.6-1.9 7-1.8V5.6c-3.4-.1-5.6.5-7 1.8z" />
      <path d="M12 7.4v11.2" />
    </Svg>
  )
}

/** 新規記録 */
export function PlusIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  )
}
