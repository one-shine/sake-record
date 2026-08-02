// 銘柄・蔵元のメモを書く欄(B76)。
//
// ## この欄が引き受けている約束
//
// - **保存されているかを画面から読める。** 打った瞬間に保存されるのでも、押さないと保存されない
//   のでもなく、「保存する」を押して初めて保存される。押していない変更が残っているときは
//   そう書く(黙って捨てない / 黙って保存しない)。
// - **空にする操作は削除に落とす。** 空文字のまま生きている行を作らない(store 側の `putNote` が
//   断るのと対。詳しくは `src/domain/types.ts` の `BrandNote`)。
// - **失敗を飲み込まない。** 保存も削除も失敗したら理由を出し、打った文字は消さない。
//
// ## 持たないもの
//
// - **どこに保存するか**。`onSave` / `onDelete` を受け取るだけで IndexedDB を知らない。
// - **記録1件のメモ**。あれは `SakeRecord.note` で、フォームが持つ(別物)。

import { useId, useState } from 'react'

export type NoteEditorProps = {
  /** 見出しに出す宛先の名前(銘柄名 / 蔵元名) */
  targetLabel: string
  /** 「銘柄」「蔵元」。文言に混ぜるので語だけ受ける */
  kindLabel: string
  /** 保存されている本文。無ければ `null` */
  value: string | null
  /** 押されたら保存する。**空でないことは呼ぶ前に保証する** */
  onSave: (text: string) => Promise<void>
  /** 押されたら消す */
  onDelete: () => Promise<void>
}

// **宛先が変わったら親が `key` で作り直す。** effect で書きかけを消す形にすると、
// 描画のたびに state を触ることになり(react-hooks/set-state-in-effect)、
// しかも「別の宛先に切り替わった瞬間だけ前の文が入っている」1フレームが作れてしまう。

const FIELD =
  'mt-1 w-full rounded border border-line-strong bg-field px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint'
const QUIET_BUTTON =
  'whitespace-nowrap rounded border border-line-strong px-2.5 py-1 text-xs text-ink disabled:opacity-50'

export function NoteEditor({ targetLabel, kindLabel, value, onSave, onDelete }: NoteEditorProps) {
  const fieldId = useId()
  const [draft, setDraft] = useState(value ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = draft.trim()
  const saved = value ?? ''
  const dirty = trimmed !== saved.trim()

  async function run(action: () => Promise<void>, what: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (cause) {
      // **打った文字は消さない。** 消すと、保存に失敗したうえに書いた内容まで失う
      setError(`${what}できなかった — ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  // 消した後は書きかけも捨てる。残すと「保存していない変更がある」と出て、
  // 消したはずの文がまだ生きているように見える
  async function remove() {
    await run(onDelete, '削除')
    setDraft('')
  }

  return (
    <div className="mt-3">
      <label htmlFor={fieldId} className="text-xs text-ink-muted">
        {targetLabel}（{kindLabel}）のメモ
      </label>
      <textarea
        id={fieldId}
        rows={3}
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={`この${kindLabel}について覚えておきたいこと`}
        className={`${FIELD} resize-y`}
      />
      {/* 短いボタン文言は語中で折らせない。行側は flex-wrap + gap-y で受ける */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <button
          type="button"
          disabled={busy || !dirty || trimmed === ''}
          onClick={() => void run(() => onSave(trimmed), '保存')}
          className={QUIET_BUTTON}
        >
          保存する
        </button>
        {value === null ? null : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className={QUIET_BUTTON}
          >
            消す
          </button>
        )}
        {/* **保存されていないことを画面から読める。** 押し忘れを黙って捨てない */}
        {dirty && trimmed !== '' ? (
          <span className="text-xs text-ink-faint">保存していない変更がある</span>
        ) : null}
        {/* 空にしただけでは消えない、と先に言う(押してから気付くより早い) */}
        {trimmed === '' && saved !== '' ? (
          <span className="text-xs text-ink-faint">空にするだけでは消えない。「消す」を押す</span>
        ) : null}
      </div>
      {error === null ? null : (
        <p role="alert" className="mt-1.5 text-xs leading-relaxed text-ink">
          {error}
        </p>
      )}
    </div>
  )
}
