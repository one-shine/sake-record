// Overlay が負っているのは「戻るボタンでモーダルが閉じる(アプリが終わらない)」と
// 「キーボードでモーダルの外に出られない」の2つ。どちらも実機でしか気づけない類の不具合なので
// ここで固定する。
//
// `history.back()` は必ずスタブする。jsdom の履歴移動は非同期で、前のテストが積んだ戻りが
// 次のテストの popstate として届くと落ち方が非決定になる(本番では起きない)。
// 履歴の state も各テストの前に空へ戻して深さの起点を 0 に揃える。

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
import { Overlay } from './Overlay.tsx'

function popstate(state: unknown): void {
  fireEvent(window, new PopStateEvent('popstate', { state }))
}

/** cleanup が予約した `history.back()` はマイクロタスクで走る。予約が片付くまで待つ */
function flushMicrotasks(): Promise<void> {
  return Promise.resolve()
}

describe('Overlay', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', window.location.href)
    vi.spyOn(window.history, 'back').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('開くときに履歴を1エントリ積む。URL は変えない', () => {
    const pushState = vi.spyOn(window.history, 'pushState')
    const before = window.location.href

    render(
      <Overlay title="題" onClose={vi.fn()}>
        本文
      </Overlay>,
    )

    expect(pushState).toHaveBeenCalledTimes(1)
    // 第3引数が現在の URL そのものであること = 相対 base の解決を壊さない(PLAN の設計方針)
    expect(pushState.mock.calls[0][2]).toBe(before)
    expect(window.location.href).toBe(before)
  })

  it('popstate(戻る)で閉じる', () => {
    const onClose = vi.fn()
    render(
      <Overlay title="題" onClose={onClose}>
        本文
      </Overlay>,
    )

    popstate(null)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('自分より深い階層への popstate では閉じない(入れ子の内側を閉じても外側が残る)', () => {
    const onClose = vi.fn()
    render(
      <Overlay title="題" onClose={onClose}>
        本文
      </Overlay>,
    )

    // 内側(深さ2)を閉じたときの popstate。外側(深さ1)はここで閉じてはいけない
    popstate({ overlayDepth: 1 })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('UI から閉じたときは積んだエントリを戻す。popstate で閉じたときは戻さない', async () => {
    const back = vi.spyOn(window.history, 'back')

    const ui = render(
      <Overlay title="題" onClose={vi.fn()}>
        本文
      </Overlay>,
    )
    ui.unmount()
    // back() は**マイクロタスクに予約される**(同期に呼ぶと StrictMode の作り直しで取り消せない)
    expect(back).not.toHaveBeenCalled()
    await flushMicrotasks()
    expect(back).toHaveBeenCalledTimes(1)

    back.mockClear()
    const byPopstate = render(
      <Overlay title="題" onClose={vi.fn()}>
        本文
      </Overlay>,
    )
    popstate(null)
    byPopstate.unmount()
    await flushMicrotasks()
    // 戻ってきた分をもう一度戻すと1つ余分に履歴を消費する
    expect(back).not.toHaveBeenCalled()
  })

  // 実測した事故(dev + StrictMode の Chrome): 1回目の mount が pushState、擬似 unmount が
  // back() を予約、2回目の mount が**まだ戻っていない history.state** を読んで深さ2で積み直し、
  // 遅れて届いた popstate(深さ0) を「戻られた」と誤認して**開いた瞬間に閉じていた**。
  // 取り込み画面も記録の詳細も一切開けない状態で、テストは全部緑だった
  // (Testing Library の render は StrictMode を挟まず、back() もスタブしていたため)。
  it('StrictMode の作り直しでも履歴を積み直さず、開いた直後に閉じない', async () => {
    const pushState = vi.spyOn(window.history, 'pushState')
    const back = vi.spyOn(window.history, 'back')
    const onClose = vi.fn()

    render(
      <Overlay title="題" onClose={onClose}>
        本文
      </Overlay>,
      { wrapper: StrictMode },
    )
    await flushMicrotasks()

    // 積むのは1回だけ。2回積むと2回目の深さが1つ深くなり、予約されていた back() が
    // 「自分より浅い popstate」として届く
    expect(pushState).toHaveBeenCalledTimes(1)
    expect(pushState.mock.calls[0][0]).toEqual({ overlayDepth: 1 })
    // 作り直しの cleanup が入れた予約は次の mount が引き継ぐので、back() は起きない
    expect(back).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '題' })).toBeInTheDocument()
  })

  it('StrictMode で作り直しても、外から戻られたら閉じる(深さを取り違えていない)', async () => {
    const onClose = vi.fn()
    render(
      <Overlay title="題" onClose={onClose}>
        本文
      </Overlay>,
      { wrapper: StrictMode },
    )
    await flushMicrotasks()

    // 土台(overlay を積む前)に戻られた = 本物の戻る
    popstate(null)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape で閉じる', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Overlay title="題" onClose={onClose}>
        本文
      </Overlay>,
    )

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('閉じるボタンで閉じる', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Overlay title="題" onClose={onClose}>
        本文
      </Overlay>,
    )

    await user.click(screen.getByRole('button', { name: '閉じる' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('role=dialog / aria-modal / 見出しとの結び付けを持つ', () => {
    render(
      <Overlay title="題" onClose={vi.fn()}>
        本文
      </Overlay>,
    )

    const dialog = screen.getByRole('dialog', { name: '題' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('body 直下(portal)に出る。AppShell の overflow 内に閉じ込めない', () => {
    const { container } = render(
      <Overlay title="題" onClose={vi.fn()}>
        本文
      </Overlay>,
    )

    const dialog = screen.getByRole('dialog')
    expect(container.contains(dialog)).toBe(false)
    expect(dialog.parentElement?.parentElement).toBe(document.body)
  })

  it('Tab が末尾から先頭に戻る(フォーカスがモーダルの外に出ない)', async () => {
    const user = userEvent.setup()
    render(
      <Overlay title="題" onClose={vi.fn()}>
        <button type="button">一つ目</button>
        <button type="button">二つ目</button>
      </Overlay>,
    )
    const close = screen.getByRole('button', { name: '閉じる' })
    const last = screen.getByRole('button', { name: '二つ目' })

    last.focus()
    await user.tab()
    expect(close).toHaveFocus()

    await user.tab({ shift: true })
    expect(last).toHaveFocus()
  })

  it('開いたらモーダル内にフォーカスを移し、閉じたら元の要素に返す', async () => {
    const user = userEvent.setup()

    function Host() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setOpen(true)
            }}
          >
            開く
          </button>
          {open && (
            <Overlay
              title="題"
              onClose={() => {
                setOpen(false)
              }}
            >
              本文
            </Overlay>
          )}
        </>
      )
    }
    render(<Host />)
    const trigger = screen.getByRole('button', { name: '開く' })

    await user.click(trigger)
    expect(screen.getByRole('button', { name: '閉じる' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  // **呼び側が「閉じない」ことがある**(B81)。dirty な RecordForm は戻るで閉じる代わりに
  // 破棄確認を出すので、popstate が消費したエントリの持ち主が残ったままになる。
  //
  // これを積み直さないと確認ダイアログが無限に再表示される。実際の履歴で追うと:
  //
  //   [土台][フォーム深さ1]                  ← フォームを開いた状態
  //   戻る → 土台へ。popstate(深さ0) → requestClose → dirty なので閉じず確認を出す
  //   [土台][確認深さ1]                      ← 確認が **同じ深さ1** を積んでしまう
  //   「入力に戻る」→ 確認の cleanup が back() → popstate(深さ0)
  //     → フォームのリスナが 0 < 1 で再び requestClose → 確認が出る … 以下ループ
  //
  // 積み直せば確認は深さ2に乗り、その back() は深さ1の popstate になるのでフォームは
  // `1 >= 1` で無視する。ここで固定するのは**積み直すこと**そのもの。
  describe('呼び側が閉じなかったとき(B81)', () => {
    /**
     * jsdom の履歴は back() が動かないので、スタックを自前で持って popstate まで起こす。
     * 実機の「戻る」と同じ順序(先にエントリが消え、あとから popstate が届く)にする。
     */
    // `history.state` は History.prototype のゲッタなので、上書きした own プロパティは
    // `vi.restoreAllMocks()` では消えない。消さないと次のテストが深さ1から始まる
    afterEach(() => {
      Reflect.deleteProperty(window.history, 'state')
    })

    function fakeHistory() {
      const stack: unknown[] = [null]
      vi.spyOn(window.history, 'pushState').mockImplementation((state) => {
        stack.push(state)
        Object.defineProperty(window.history, 'state', { value: state, configurable: true })
      })
      vi.spyOn(window.history, 'back').mockImplementation(() => {
        if (stack.length > 1) stack.pop()
        const top = stack[stack.length - 1]
        Object.defineProperty(window.history, 'state', { value: top, configurable: true })
        popstate(top)
      })
      Object.defineProperty(window.history, 'state', { value: null, configurable: true })
      return { depth: () => stack.length - 1, top: () => stack[stack.length - 1] }
    }

    /** dirty なフォーム + 破棄確認。`requestClose` の形だけを写した最小の宿主 */
    function DirtyHost() {
      const [open, setOpen] = useState(true)
      const [asking, setAsking] = useState(false)
      if (!open) return <p>閉じた</p>
      return (
        <Overlay
          title="記録を追加"
          onClose={() => {
            setAsking(true)
            return false // **閉じていない**
          }}
        >
          <p>本文</p>
          {asking && (
            <Overlay title="入力を破棄する" onClose={() => setAsking(false)}>
              <button type="button" onClick={() => setOpen(false)}>
                破棄して閉じる
              </button>
              <button type="button" onClick={() => setAsking(false)}>
                入力に戻る
              </button>
            </Overlay>
          )}
        </Overlay>
      )
    }

    it('popstate で閉じなかったら、消費されたエントリを積み直す', () => {
      const history = fakeHistory()
      render(
        <Overlay title="題" onClose={() => false}>
          本文
        </Overlay>,
      )
      expect(history.depth()).toBe(1)

      window.history.back()

      // 閉じていないのだから、この Overlay は履歴エントリを1つ持ったままでなければならない
      expect(history.depth()).toBe(1)
      expect(history.top()).toEqual({ overlayDepth: 1 })
      expect(screen.getByRole('dialog', { name: '題' })).toBeInTheDocument()
    })

    it('閉じたときは積み直さない(戻ってきた分をもう一度積むと戻るが効かなくなる)', () => {
      const history = fakeHistory()
      render(
        <Overlay title="題" onClose={vi.fn()}>
          本文
        </Overlay>,
      )

      window.history.back()

      expect(history.depth()).toBe(0)
    })

    it('戻る → 破棄確認 → 「入力に戻る」で、確認が再表示されない', async () => {
      const user = userEvent.setup()
      fakeHistory()
      render(<DirtyHost />)

      window.history.back()
      expect(screen.getByRole('dialog', { name: '入力を破棄する' })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: '入力に戻る' }))
      await flushMicrotasks()

      // ここが本題。積み直していないと確認が即座に出直す
      expect(screen.queryByRole('dialog', { name: '入力を破棄する' })).toBeNull()
      expect(screen.getByRole('dialog', { name: '記録を追加' })).toBeInTheDocument()
    })
  })

  it('開いている間だけ背後のスクロールを止める', () => {
    const ui = render(
      <Overlay title="題" onClose={vi.fn()}>
        本文
      </Overlay>,
    )
    expect(document.body.style.overflow).toBe('hidden')

    ui.unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
