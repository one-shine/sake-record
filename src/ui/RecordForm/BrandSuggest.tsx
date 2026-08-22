// 銘柄のインクリメンタル検索(A7)。`createSuggester` が返す検索関数を受けて combobox を描くだけで、
// 照合・並び・上限の判断は持たない(domain/suggest.ts が唯一の実装)。
//
// ## この部品が引き受けている4つの決定
//
// 1. **IME 対応は必須。** 日本語入力は かな→漢字 の変換中にも `input` が飛ぶ。`きど` を打っている
//    間は当然0件なので、素朴に書くと**変換確定まで「該当なし」が出続けて見出し機能が壊れて見える**。
//    `compositionstart` / `compositionend` を見て、**変換中は「該当なし」を出さない**
//    (候補が在るなら出す — 変換候補を選んだ瞬間に銘柄が現れるのは助けになるので、
//     抑えるのは否定のメッセージだけ)。変換中の `Enter` はフォーム送信に化けさせない。
// 2. **一致0件は0件。** 「該当なし」を出し、候補リストは描かない。**全件(3264件)に落ちる枝は
//    作らない**(ルール2)。0件のときの次の手(かなでも引けるが当たらない銘柄がある / ローマ字では
//    引けない / 未登録でもそのまま保存できる)を添える — ここで黙ると本人は「アプリが壊れた」と読む。
//    **「かなでは引けない」と書かない**(B85) — B68 でかな検索を入れたのにこの文だけ古いままで、
//    同じ部品が読み一致の行に「読み」バッジを描く横で機能の存在を否定していた。
// 3. **行に「銘柄名 + 都道府県 + 蔵元」を出す。** 同名の銘柄が複数あり(`高砂` は静岡/三重/佐賀/島根)、
//    名前だけでは選び分けられない。県や蔵元が引けない銘柄は `県なし` / `蔵元なし` と書く
//    — さけのわの蔵元マスタには名前が空の行が48件あり262銘柄がそこに属すので、
//    空白で描くと「取得できている」ように見える(不確実性を隠さない)。
// 4. **候補を選んでも入力欄の文字を書き換えない。** `brandLabel` は本人が記録した生の表記が原本で、
//    さけのわの銘柄名はそれに当てた解釈にすぎない(`荷札酒` → `加茂錦`)。書き換えると原本が消える。
//
// キーボードは ↑↓ で移動 / Enter で確定 / Escape で閉じる。Escape は**リストが開いている間だけ
// stopPropagation する** — このフォームは Overlay の中に出るので、素通しすると
// 「候補を閉じるつもりでフォームごと閉じる」ことになる。

import { useId, useMemo, useState, type ChangeEvent, type CompositionEvent, type KeyboardEvent } from 'react'
import { DEFAULT_SUGGEST_LIMIT, type SuggestHit, type Suggester } from '../../domain/suggest.ts'

type Props = {
  /** 入力欄の値 = 記録の生の表記。**候補を選んでも書き換えない** */
  value: string
  onChange: (value: string) => void
  /** 候補を選んだ。紐付けの状態は親が持つ(この部品は選択を記憶しない) */
  onPick: (hit: SuggestHit) => void
  /** `createSuggester(tables)` の戻り。**親が useMemo で1回だけ作る**(キーストロークごとに作らない) */
  suggest: Suggester
  /** 1回に出す上限。既定は domain 側の既定値に合わせる */
  limit?: number
  /** 入力欄の見出し。候補リストの aria-label もここから作る */
  label?: string
}

const OPTION = 'flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2.5 py-1.5 text-sm'

export function BrandSuggest({
  value,
  onChange,
  onPick,
  suggest,
  limit = DEFAULT_SUGGEST_LIMIT,
  label = '銘柄',
}: Props) {
  const inputId = useId()
  const listboxId = useId()
  const optionPrefix = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  // 変換中フラグ。**「該当なし」を出さない**ためだけに使う(候補の表示は止めない)
  const [composing, setComposing] = useState(false)

  // 照合は正規化済み索引への indexOf だけ(domain/suggest.ts)。1キーストロークごとに走ってよい
  const hits = useMemo(() => suggest(value, limit), [suggest, value, limit])

  const listOpen = open && hits.length > 0
  // 候補が減って active が範囲外になったら「選択なし」に畳む(古い添字で確定しない)
  const activeIndex = listOpen && active >= 0 && active < hits.length ? active : -1
  const showEmpty = open && !composing && value.trim() !== '' && hits.length === 0

  function pick(hit: SuggestHit) {
    setOpen(false)
    setActive(-1)
    onPick(hit)
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange(event.target.value)
    setOpen(true)
    // 文字が変わったら選択位置は捨てる(1つ下にずれた別の銘柄を確定させない)
    setActive(-1)
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLInputElement>) {
    setComposing(false)
    // ブラウザによって `compositionend` と `input` の順序が違う。確定した文字列を
    // ここでも取り込んでおかないと、`input` が先に来る実装で1文字分古い検索結果が残る
    const composed = event.currentTarget.value
    if (composed !== value) onChange(composed)
    setOpen(true)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // 変換中のキーは IME のもの(↓ は変換候補の移動)。**Enter だけは押さえる** —
    // 変換確定の Enter が form の暗黙送信になると、打ちかけの記録が保存される
    if (composing || event.nativeEvent.isComposing) {
      if (event.key === 'Enter') event.preventDefault()
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (hits.length === 0) return
      event.preventDefault()
      setOpen(true)
      const delta = event.key === 'ArrowDown' ? 1 : -1
      // 端で止めずに回す(`-1`(選択なし)からは端の候補に入る)
      const from = activeIndex < 0 ? (delta === 1 ? -1 : 0) : activeIndex
      setActive((from + delta + hits.length) % hits.length)
      return
    }

    if (event.key === 'Enter') {
      if (!listOpen) return
      // リストが開いている間の Enter は候補の確定に使う。**候補を選んでいないときは
      // 保存に化けさせない**(先頭を勝手に採ると、見てもいない銘柄に紐付く)
      event.preventDefault()
      if (activeIndex >= 0) pick(hits[activeIndex])
      else setOpen(false)
      return
    }

    if (event.key === 'Escape') {
      if (!listOpen && !showEmpty) return
      // 外側の Overlay まで届かせない(候補を閉じるつもりでフォームが閉じる)
      event.stopPropagation()
      setOpen(false)
      setActive(-1)
      return
    }

    if (event.key === 'Tab') setOpen(false)
  }

  return (
    <div className="min-w-0">
      <label htmlFor={inputId} className="text-xs text-ink-muted">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${optionPrefix}-${String(activeIndex)}` : undefined}
        autoComplete="off"
        value={value}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        // 候補は mousedown(preventDefault 済み)で選ぶので、blur で閉じても選択は取りこぼさない
        onBlur={() => {
          setOpen(false)
          setActive(-1)
        }}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        placeholder="銘柄名で検索"
        className="mt-1 w-full rounded border border-line-strong bg-field px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint"
      />

      {listOpen && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`${label}の候補`}
          className="mt-1 max-h-64 divide-y divide-line overflow-y-auto rounded border border-line-strong bg-field"
        >
          {hits.map((hit, index) => (
            <li
              // key は銘柄 ID。同名が並ぶので名前を key にすると行が1つに潰れる
              key={hit.brand.id}
              id={`${optionPrefix}-${String(index)}`}
              role="option"
              aria-selected={index === activeIndex}
              // click ではなく mousedown で拾い、既定動作(フォーカス移動)を止める。
              // click まで待つと先に blur が走ってリストが閉じ、選択が落ちる
              onMouseDown={(event) => {
                event.preventDefault()
                pick(hit)
              }}
              className={`${OPTION} ${index === activeIndex ? 'bg-surface-raised' : ''}`}
            >
              <span className="font-medium text-ink">{hit.brand.name}</span>
              {/* **読みで当たった行は名前に打った文字が無い**(`きど` → `紀土`)。理由を出さないと
                  無関係な行が混ざったように見えるので、名前一致と見分けが付く印を置く */}
              {hit.matchedBy === 'reading' && (
                <span className="whitespace-nowrap text-xs text-ink-faint">読み</span>
              )}
              {/* 県・蔵元は同名を選び分ける唯一の手がかり。引けないときは空白にせず言い切る */}
              <span className="whitespace-nowrap text-xs text-ink-muted">
                {hit.prefecture ?? '県なし'}
              </span>
              <span className="text-xs text-ink-muted">{hit.breweryName ?? '蔵元なし'}</span>
              {!hit.hasFlavorChart && (
                <span className="whitespace-nowrap text-xs text-ink-faint">フレーバーなし</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {listOpen && hits.length >= limit && (
        <p className="mt-1 text-xs text-ink-faint">
          上位{limit}件まで出している。続きは文字を足して絞り込む。
        </p>
      )}

      {showEmpty && (
        <div role="status" className="mt-1 rounded border border-line px-2.5 py-2">
          <p className="text-sm text-ink">該当なし</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            さけのわの銘柄マスタに一致する銘柄が無い。かな（読み）でも引けるが、当たらない銘柄もあるので漢字・アルファベットでも打ってみる（ローマ字では引けない）。見つからなくても、この表記のまま未紐付けで保存できる。
          </p>
        </div>
      )}
    </div>
  )
}
