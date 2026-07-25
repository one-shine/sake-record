// 取り消せない操作の確認が「OS 既定の confirm() ではない自作ダイアログ」として成立しているか。
// 既定フォーカスが取りやめ側にあること(Enter 連打で破壊的操作が通らない)まで含めて固定する。

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from './ConfirmDialog.tsx'

describe('ConfirmDialog', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', window.location.href)
    vi.spyOn(window.history, 'back').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('見出しと本文を dialog として読める形で出す', () => {
    render(
      <ConfirmDialog
        title="すべて消す"
        message="この操作は取り消せない。"
        confirmLabel="消す"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'すべて消す' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // 本文が aria-describedby で dialog に結び付いている
    const describedBy = dialog.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy ?? '')).toHaveTextContent('この操作は取り消せない。')
  })

  it('既定のフォーカスは取りやめ側に置く', () => {
    render(
      <ConfirmDialog
        title="すべて消す"
        message="この操作は取り消せない。"
        confirmLabel="消す"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'やめる' })).toHaveFocus()
  })

  it('実行ボタンで onConfirm、取りやめで onCancel を呼ぶ', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="すべて消す"
        message="この操作は取り消せない。"
        confirmLabel="消す"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    await user.click(screen.getByRole('button', { name: '消す' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'やめる' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Escape は取りやめとして扱う', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="すべて消す"
        message="この操作は取り消せない。"
        confirmLabel="消す"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('実行中は両方のボタンを止める(二重実行しない)', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        title="すべて消す"
        message="この操作は取り消せない。"
        confirmLabel="消す"
        busy
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    const confirm = screen.getByRole('button', { name: '消す' })
    expect(confirm).toBeDisabled()
    expect(screen.getByRole('button', { name: 'やめる' })).toBeDisabled()

    await user.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
