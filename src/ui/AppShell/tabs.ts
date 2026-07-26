import { TimelineIcon, StatsIcon, FlavorIcon, AreaIcon, LearnIcon } from '../icons/icons.tsx'

// コンポーネントと同じファイルから定数を export すると Fast Refresh が効かなくなるため別ファイルに置く。
//
// **件数を増やしたら `AppShell` の `grid-cols-*` も直す。** あちらは Tailwind の静的抽出が
// 効くようリテラルで書いてあり、この配列から導出していない(導出するとクラス名が生成されず
// 本番だけタブが2段になる)。
//
// 「知る」は参照用の面なので最後。日々押すタブ(記録 → 統計 → 味 → 産地)を左に寄せる。
export const TABS = [
  { id: 'timeline', label: '記録', Icon: TimelineIcon },
  { id: 'stats', label: '統計', Icon: StatsIcon },
  { id: 'flavor', label: '味', Icon: FlavorIcon },
  { id: 'area', label: '産地', Icon: AreaIcon },
  { id: 'learn', label: '知る', Icon: LearnIcon },
] as const

export type TabId = (typeof TABS)[number]['id']
