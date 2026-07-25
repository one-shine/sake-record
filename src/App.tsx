import { useState } from 'react'
import { AppShell } from './ui/AppShell/AppShell.tsx'
import type { TabId } from './ui/AppShell/tabs.ts'

// Phase 1 の空枠。各タブの中身は Phase 3(記録) / Phase 6(統計・味・産地) で入る。
const PLACEHOLDERS: Record<TabId, { title: string; body: string }> = {
  timeline: {
    title: '記録',
    body: '写真と銘柄から1本を記録する。既存の記録は JSON から取り込む。',
  },
  stats: { title: '統計', body: '本数・年別・都道府県別・スペックの分布。' },
  flavor: {
    title: 'フレーバー分布',
    body: '6軸レーダーと散布図。なぞっている味の領域と空白地帯を見る。',
  },
  area: { title: '産地マップ', body: '都道府県を本数で塗り分け、未進出県を可視化する。' },
}

export default function App() {
  const [tab, setTab] = useState<TabId>('timeline')
  const { title, body } = PLACEHOLDERS[tab]

  return (
    <AppShell tab={tab} onTabChange={setTab}>
      <section className="px-4 py-6">
        <h2 className="text-sm font-semibold text-stone-200">{title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-stone-400">{body}</p>
        <p className="mt-4 text-xs text-stone-500">この画面はまだ実装されていない（Phase 1: 足場）。</p>
      </section>
    </AppShell>
  )
}
