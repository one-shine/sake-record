// 取り消せない操作の確認。**OS 既定の `confirm()` は使わない**:
// スマホでは URL が出て素性の分からない警告に見え、文言も「OK / キャンセル」しか作れず、
// スタイルも当たらない。ここが唯一の確認 UI になる。
//
// 既定のフォーカスは**取りやめ側**に置く(Enter の連打で破壊的な操作が通らないように)。
// 実行側のボタンは色ではなく文言で何が起きるかを言う(`confirmLabel` に「消す」等を渡す)。

import { useId, type ReactNode } from 'react'
import { Overlay } from './Overlay.tsx'

type Props = {
  title: string
  /** 何が起きるかの説明。取り消せないなら**そう書く**(呼び側の文言責任) */
  message: ReactNode
  /** 実行ボタンの文言。「OK」ではなく動詞にする */
  confirmLabel: string
  cancelLabel?: string
  /** 実行中は両方のボタンを止める(二重実行を防ぐ) */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'やめる',
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const messageId = useId()

  return (
    <Overlay
      title={title}
      onClose={onCancel}
      describedBy={messageId}
      showClose={false}
      panelClassName="w-full max-w-sm rounded-t-xl border-t sm:rounded-xl sm:border"
    >
      <div className="px-4 py-4">
        <p id={messageId} className="text-sm leading-relaxed text-stone-200">
          {message}
        </p>
        {/* 短いボタン文言は語中で折らせない。行側は flex-wrap + gap-y で受ける */}
        <div className="mt-5 flex flex-wrap justify-end gap-x-2 gap-y-2">
          <button
            type="button"
            data-overlay-autofocus
            onClick={onCancel}
            disabled={busy}
            className="whitespace-nowrap rounded border border-stone-700 px-3 py-1.5 text-sm text-stone-300 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
            className="whitespace-nowrap rounded border border-red-900 bg-red-950 px-3 py-1.5 text-sm font-medium text-red-100 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Overlay>
  )
}
