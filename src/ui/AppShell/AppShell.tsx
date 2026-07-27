import { useEffect, useRef, type ReactNode } from 'react'
import { Attribution } from '../Attribution/Attribution.tsx'
import { APP_NAME, APP_TAGLINE } from '../../config/app.ts'
import { TABS, type TabId } from './tabs.ts'

type Props = {
  tab: TabId
  onTabChange: (tab: TabId) => void
  /** フッタの「出典とライセンス」。**「知る」の出典タブを開いた状態で**移動する */
  onOpenSources: () => void
  children: ReactNode
}

// h-dvh(動的ビューポート): iOS の 100vh は URL バー込みの大きい高さで、下端のタブが画面外に
// 出てスクロールしないと届かない。dvh で実際の可視領域に合わせる(内部の overflow-auto はそのまま)。
// Chromium では dvh==vh で再現しないため、ブラウザ自動化では検出できない。定石として先に当てる。
export function AppShell({ tab, onTabChange, onOpenSources, children }: Props) {
  // 5タブは**1つの `<main>` を共有**しており、スクロール位置はその `<main>` が1つだけ持つ。
  // リセットしないと切り替えた先が「前のタブの位置」で開く(前のタブと文書の長さは無関係なので
  // 着地点に意味が無い)。実測: 記録タブを下端(2659px)まで送って統計へ移ると 1246px から始まり、
  // 記録タブを 300px 送ってフッタの「出典とライセンス」を押すと「知る」も 300px = 出典節
  // (3448px)は画面外。**押したラベルの行き先に着かない**ので先頭へ戻す。
  //
  // **`scrollTo()` ではなく `scrollTop` に代入する。** jsdom は `Element.scrollTo` を実装して
  // おらず "Not implemented" を投げるので、`scrollTo` にすると `AppShell` を描く既存テストが
  // 29件まとめて落ちる(実測)。`scrollTop` の代入は jsdom では無害な no-op で、
  // 実ブラウザでは効く — 位置合わせの副作用が要らないここでは代入で足りる。
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const main = mainRef.current
    if (main) main.scrollTop = 0
  }, [tab])

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-line px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h1 className="whitespace-nowrap text-base font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="whitespace-nowrap text-xs text-ink-muted">{APP_TAGLINE}</p>
      </header>

      {/* flex-col + Attribution の mt-auto: 中身が短くてもクレジットが宙に浮かず下端に付く。
          フッタの「出典とライセンス」は**タブ移動**で満たす(オーバーレイを増やさない) —
          クレジットの全文は「知る」の出典タブが持っており、二重に持たない。
          移動先の下位タブまで指定するのは App(`onOpenSources`)。ここは押されたことだけを伝える。 */}
      <main ref={mainRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
        <Attribution onOpenLearn={onOpenSources} />
      </main>

      {/* 下端は safe-area 分を足す。iPhone のホームインジケータに重なると最後のタブが押せない。
          **`grid-cols-5` は `TABS.length` から導出せずリテラルで書く。** 文字列連結で作ると
          Tailwind の静的抽出が候補を見つけられず、本番の CSS に .grid-cols-5 が生成されない
          (開発では出るので気付けないまま、本番だけタブが2段に折り返す)。 */}
      <nav className="grid shrink-0 grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
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
