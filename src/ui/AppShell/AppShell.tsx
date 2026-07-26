import type { ReactNode } from 'react'
import { Attribution } from '../Attribution/Attribution.tsx'
import { APP_NAME, APP_TAGLINE } from '../../config/app.ts'
import { TABS, type TabId } from './tabs.ts'

type Props = {
  tab: TabId
  onTabChange: (tab: TabId) => void
  children: ReactNode
}

// h-dvh(動的ビューポート): iOS の 100vh は URL バー込みの大きい高さで、下端のタブが画面外に
// 出てスクロールしないと届かない。dvh で実際の可視領域に合わせる(内部の overflow-auto はそのまま)。
// Chromium では dvh==vh で再現しないため、ブラウザ自動化では検出できない。定石として先に当てる。
export function AppShell({ tab, onTabChange, children }: Props) {
  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-line px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h1 className="whitespace-nowrap text-base font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="whitespace-nowrap text-xs text-ink-muted">{APP_TAGLINE}</p>
      </header>

      {/* flex-col + Attribution の mt-auto: 中身が短くてもクレジットが宙に浮かず下端に付く */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
        <Attribution />
      </main>

      {/* 下端は safe-area 分を足す。iPhone のホームインジケータに重なると最後のタブが押せない */}
      <nav className="grid shrink-0 grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ id, label, Icon }) => {
          const active = id === tab
          return (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center gap-1 py-2.5 text-xs ${
                active ? 'text-ink' : 'text-ink-faint'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="whitespace-nowrap">{label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
