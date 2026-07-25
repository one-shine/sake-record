import { TimelineIcon, StatsIcon, FlavorIcon, AreaIcon } from '../icons/icons.tsx'

// コンポーネントと同じファイルから定数を export すると Fast Refresh が効かなくなるため別ファイルに置く。
export const TABS = [
  { id: 'timeline', label: '記録', Icon: TimelineIcon },
  { id: 'stats', label: '統計', Icon: StatsIcon },
  { id: 'flavor', label: '味', Icon: FlavorIcon },
  { id: 'area', label: '産地', Icon: AreaIcon },
] as const

export type TabId = (typeof TABS)[number]['id']
