// 5タブは**1つの `<main>` を共有**しているので、スクロール位置はタブを切り替えても持ち越される。
// `AppShell` はタブが変わったときに先頭へ戻す(実測した壊れ方は `AppShell.tsx` のコメント)。
//
// ## なぜ「実装の仕掛け」を見るテストなのか
//
// jsdom はレイアウトを持たないので、`scrollTop` は**常に 0 を返し、代入は捨てられる**。
// つまり「切り替えたら先頭が見えている」を jsdom で観測する方法は無く、
// 実ブラウザでの計測が唯一の証拠になる(`docs/evidence/`)。
// それでも **仕掛けごと消える回帰**は捕まえられる: `useEffect` の削除、依存配列の間違い。
// 依存配列を空にすると「切り替えても戻らない」、依存を外すと「毎描画で先頭へ飛ぶ」
// (検索欄に打っている最中に画面が跳ねる)という別の壊れ方になるので、両方を1件ずつ固定する。
//
// `scrollTop` への代入を記録するために prototype を差し替える(**`Element.prototype` にある** —
// `HTMLElement.prototype` には無いので、そちらを差し替えても何も記録されない)。
// **テストごとに必ず戻す**(残すと以降のテストの `scrollTop` が本物でなくなる)。
//
// `scrollTo()` / `scrollIntoView()` はこの jsdom に**定義そのものが無い**(実測)。
// 代入をやめて `scrollTo` に変えると `useEffect` の中で TypeError になり、
// 下の1件目がその場で落ちる = 乗り換えはここで気付ける。

import { render } from '@testing-library/react'
import { AppShell } from './AppShell.tsx'
import type { TabId } from './tabs.ts'

type ScrollTopCall = { element: HTMLElement; value: number }

/** `scrollTop` への代入を記録する差し替え。戻す関数を返す */
function trackScrollTop(): { calls: ScrollTopCall[]; restore: () => void } {
  const calls: ScrollTopCall[] = []
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
  if (original === undefined) throw new Error('Element.prototype.scrollTop が無い')

  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get: () => 0,
    set(this: HTMLElement, value: number) {
      calls.push({ element: this, value })
    },
  })

  return {
    calls,
    restore: () => {
      Object.defineProperty(Element.prototype, 'scrollTop', original)
    },
  }
}

function mainElement(): HTMLElement {
  const main = document.querySelector('main')
  if (main === null) throw new Error('<main> が無い')
  return main
}

describe('AppShell のスクロール位置', () => {
  let tracked: { calls: ScrollTopCall[]; restore: () => void } | null = null

  afterEach(() => {
    tracked?.restore()
    tracked = null
  })

  /** `<main>` への代入だけを取り出す(React が別の要素で読み書きする分を混ぜない) */
  function mainScrollTops(calls: ScrollTopCall[]): number[] {
    const main = mainElement()
    return calls.filter((call) => call.element === main).map((call) => call.value)
  }

  function renderShell(tab: TabId) {
    return render(
      <AppShell tab={tab} onTabChange={() => undefined} onOpenSources={() => undefined}>
        <p>本文</p>
      </AppShell>,
    )
  }

  it('タブが変わったらスクロール容器を先頭へ戻す', () => {
    tracked = trackScrollTop()
    const { rerender } = renderShell('timeline')
    const before = mainScrollTops(tracked.calls).length

    rerender(
      <AppShell tab="stats" onTabChange={() => undefined} onOpenSources={() => undefined}>
        <p>本文</p>
      </AppShell>,
    )

    // 代入した値は 0(「前のタブの位置」でも「保存した位置」でもない)
    expect(mainScrollTops(tracked.calls).slice(before)).toEqual([0])
  })

  // 依存配列を外すと毎描画で発火し、スクロール中・入力中に画面が先頭へ跳ねる
  it('同じタブのまま再描画しても戻さない', () => {
    tracked = trackScrollTop()
    const { rerender } = renderShell('timeline')
    const before = mainScrollTops(tracked.calls).length

    rerender(
      <AppShell tab="timeline" onTabChange={() => undefined} onOpenSources={() => undefined}>
        <p>本文（差し替え）</p>
      </AppShell>,
    )

    expect(mainScrollTops(tracked.calls).slice(before)).toEqual([])
  })

})
