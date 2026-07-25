// モーダルの土台。RecordDetail / ImportExportPanel / ConfirmDialog が共有する1点。
//
// ## 戻るボタン対応(PLAN の設計方針)
//
// このアプリは URL ルーティングを持たない(`base: './'` の相対解決を壊さないため)。その唯一の実損が
// 戻るボタンで、Android や PWA でモーダルを開いたまま戻るとモーダルではなく**アプリが終わる**。
// そこで**開くときだけ** `history.pushState(null, '', location.href)` して1エントリ積み、
// `popstate` で閉じる。**URL は変えない** — 文書 URL が `/repo/foo` になると `./sw.js` が
// `/repo/foo/sw.js` に解決されて Service Worker が壊れる。
//
// 積んだエントリには `overlayDepth` を入れる。入れないと**入れ子のとき内側を閉じた瞬間に
// 外側も閉じる**: 内側は自分のエントリを片付けるため `history.back()` を呼ぶが、その popstate は
// 外側のリスナにも届くので、外側が「戻られた」と誤認する。`popstate` の state の深さが自分の
// 深さより浅いときだけ閉じる、とすれば内側だけが反応する(まとめて何段戻られても、
// 各段が自分より浅い state を見て正しく全部閉じる)。
//
// ## portal に出す理由
//
// 入れ子のときフォーカストラップが破れないようにするため。React の portal は**イベントは
// React ツリーを伝播する**が DOM は body 直下の別サブツリーになるので、内側の ConfirmDialog の
// 要素は外側パネルの container に含まれない = 外側のトラップが内側の要素を掴まない。
// (イベントの方は伝播するので、扱ったキーは stopPropagation する。)
// AppShell の `overflow-y-auto` な main の内側で `fixed` を使う不安定さも同時に消える。
//
// `100vh` は使わない(`fixed inset-0` は実可視領域に一致する)。

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  /** 見出し。`aria-labelledby` で dialog に結び付ける */
  title: string
  /** 閉じる要求(戻る / Escape / 背景クリック / 閉じるボタン)。呼び側が open 状態を落とす */
  onClose: () => void
  children: ReactNode
  /** 本文を `aria-describedby` に結ぶときの id(ConfirmDialog が使う) */
  describedBy?: string
  /** 見出し行の「閉じる」ボタンを出すか。ConfirmDialog は自前の操作を持つので false */
  showClose?: boolean
  /** パネルの寸法だけを外から与える(色や枠線はここで固定する) */
  panelClassName?: string
}

/** 順序はDOM順。jsdom では offsetParent が常に null なので**可視判定に寸法を使わない** */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
  )
}

/** 積んである overlay の段数。`history.state` は素の値や null もあり得るので触る前に形を見る */
function depthOf(state: unknown): number {
  if (typeof state !== 'object' || state === null) return 0
  const depth = (state as { overlayDepth?: unknown }).overlayDepth
  return typeof depth === 'number' && Number.isFinite(depth) ? depth : 0
}

// ---------------------------------------------------------------------------
// 「まだ戻していないエントリ」の台帳
// ---------------------------------------------------------------------------
//
// **cleanup の `history.back()` を同期で呼ぶと、開いた直後にモーダルが閉じる。** 実測した経路
// (dev + StrictMode。Chrome で確認):
//
//   pushState {overlayDepth:1}   ← 1回目の mount
//   back()                       ← StrictMode の擬似 unmount(cleanup)
//   pushState {overlayDepth:2}   ← 2回目の mount。history.state はまだ戻っていないので深さが1つ深く見える
//   popstate null                ← 予約されていた back() が届く。深さ 0 < 2 なので「戻られた」と誤認して閉じる
//
// `back()` は非同期で、しかも**移動先は呼んだ時点の位置から決まる**ので、間に pushState を
// 挟むと最初のエントリを飛び越して土台まで戻る。段数を history.state から数えるのをやめても
// (モジュール変数で数えても)この popstate は本物の「戻る」と区別できない。
//
// なので**同じタスク内で作り直されるなら back() 自体を取り消す**: cleanup は back() を
// マイクロタスクに予約するだけにし、次の mount が予約を1つ消費して**積み直さずに前の
// エントリを引き継ぐ**。StrictMode の mount → cleanup → mount は同じタスクなので、
// 履歴には1エントリしか残らず popstate も起きない。Fast Refresh の作り直しも同じ経路で救われる。
//
// 本当に閉じたとき(予約を消費する mount が来ないとき)は、マイクロタスクがそのまま back() を
// 呼ぶので履歴は溜まらない。**この遅延は同一タスク内なのでユーザ操作の文脈を失わない。**

/** 予約済み(まだ back() していない)エントリの数 */
let pendingUnwind = 0

/** cleanup 側: 1つ戻す予約を入れる。同じタスク内で mount が来たら取り消される */
function scheduleUnwind(): void {
  pendingUnwind += 1
  queueMicrotask(() => {
    if (pendingUnwind === 0) return // 作り直しに引き継がれた
    pendingUnwind -= 1
    window.history.back()
  })
}

/**
 * mount 側: 予約を引き継げるなら引き継いで、引き継いだエントリの深さを返す。
 * 引き継げない(= 新しく積む必要がある)ときは 0。
 */
function inheritPendingUnwind(): number {
  if (pendingUnwind === 0) return 0
  const depth = depthOf(window.history.state)
  // 現在のエントリが overlay の積んだものでないなら引き継げない(予約はそのまま残す)
  if (depth === 0) return 0
  pendingUnwind -= 1
  return depth
}

const SHEET =
  'h-full w-full border-t sm:h-auto sm:max-h-[calc(100%-3rem)] sm:max-w-lg sm:rounded-xl sm:border'

export function Overlay({
  title,
  onClose,
  children,
  describedBy,
  showClose = true,
  panelClassName = SHEET,
}: Props) {
  const headingId = useId()
  const containerRef = useRef<HTMLDivElement | null>(null)
  // onClose を ref 経由で読む: 呼び側が毎レンダーで新しい関数を渡しても
  // pushState の効果が張り直されない(張り直すとエントリが増え続ける)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  // 戻るボタン: 開くときだけ1エントリ積み、popstate で閉じる。URL は変えない
  useEffect(() => {
    // 直前の cleanup が戻す予約を入れていたら、そのエントリを引き継ぐ(積み直さない)
    const inherited = inheritPendingUnwind()
    let myDepth = inherited
    let pushed = true
    if (inherited === 0) {
      myDepth = depthOf(window.history.state) + 1
      try {
        window.history.pushState({ overlayDepth: myDepth }, '', window.location.href)
      } catch {
        // pushState が使えない環境(頻度制限など)。履歴連携だけ諦め、Escape と閉じるは動く
        pushed = false
      }
    }
    if (!pushed) return

    let closedByPopstate = false
    const onPopState = (event: PopStateEvent) => {
      // 自分より浅い state に戻られたときだけ閉じる(入れ子の外側を巻き込まない)
      if (depthOf(event.state) >= myDepth) return
      closedByPopstate = true
      closeRef.current()
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      // UI から閉じたときは積んだ分を戻して履歴を溜めない。**同期では呼ばない**
      // (同じタスク内で作り直される = StrictMode / Fast Refresh のときに取り消せなくなる)。
      // リスナは外してあるので、この back() で自分が二重に閉じることはない
      if (!closedByPopstate) scheduleUnwind()
    }
  }, [])

  // 背後をスクロールさせない。入れ子は「開く前の値」を各段が覚えて戻す(内側は 'hidden' に戻る)
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  // 初期フォーカスをモーダル内へ移し、閉じたら元の要素へ返す
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const container = containerRef.current
    const preferred = container?.querySelector<HTMLElement>('[data-overlay-autofocus]')
    ;(preferred ?? focusables(container)[0] ?? container)?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      // portal でも React ツリーは伝播するので、外側の Overlay まで届かせない
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    event.stopPropagation()
    const items = focusables(containerRef.current)
    if (items.length === 0) {
      event.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === containerRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center">
      {/* 背景。クリックは「閉じる」と同じ扱い(確認ダイアログでは取りやめ = 安全側) */}
      <div className="absolute inset-0 bg-stone-950/80" aria-hidden="true" onClick={onClose} />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`relative flex max-h-full flex-col overflow-hidden border-stone-800 bg-stone-900 text-stone-100 shadow-2xl outline-none ${panelClassName}`}
      >
        {/* 見出しと操作は同じ行に並べる。日本語の見出しは語中で折れるので折り返しは行側で受ける */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-stone-800 px-4 pb-2.5 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <h2 id={headingId} className="text-sm font-semibold tracking-tight">
            {title}
          </h2>
          {showClose && (
            <button
              type="button"
              onClick={onClose}
              className="whitespace-nowrap rounded border border-stone-700 px-2.5 py-1 text-xs text-stone-300"
            >
              閉じる
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
