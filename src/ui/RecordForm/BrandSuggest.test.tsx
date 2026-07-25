// 銘柄サジェストの約束を固定する: **同名を県と蔵元で選び分けられる / 0件は0件 /
// IME の変換中に「該当なし」を出さない / 変換中の Enter を送信に化けさせない /
// 候補を選んでも本人の表記を書き換えない。**
//
// 照合そのものは `createSuggester` の担当なので**スタブを挟まず本物を通す**(合成テーブル数件で
// 組める形になっている)。スタブにすると「並び順が壊れているのに UI のテストは緑」になる。
//
// データは全て合成。実際の飲酒記録(`data/seed/` は gitignore)や実在の銘柄名は書かない。

import { useMemo, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createSuggester, type SuggestHit } from '../../domain/suggest.ts'
import type {
  FlavorChart,
  SakenowaArea,
  SakenowaBrand,
  SakenowaBrewery,
  SakenowaTables,
} from '../../domain/types.ts'
import { BrandSuggest } from './BrandSuggest.tsx'

// ---------------------------------------------------------------------------
// 合成テーブル
// ---------------------------------------------------------------------------
//
// `カクウ` を**同名4件**にして、県と蔵元だけが違う状態を作る(実データの同名4件と同じ形)。
// 加えて 前方一致1件 / 含む一致1件 / 蔵元名が空の行 / areaId 0(県として扱わない) /
// フレーバーチャートを持たない銘柄 を1つずつ置く。

const AREAS: readonly SakenowaArea[] = [
  // id 0 は「その他」。**県ではない**(県名として引けてはいけない)
  { id: 0, name: 'その他' },
  { id: 41, name: '甲県' },
  { id: 42, name: '乙県' },
  { id: 43, name: '丙県' },
  { id: 44, name: '丁県' },
]

const BREWERIES: readonly SakenowaBrewery[] = [
  { id: 800001, name: '一号酒造', areaId: 41 },
  { id: 800002, name: '二号酒造', areaId: 42 },
  { id: 800003, name: '三号酒造', areaId: 43 },
  { id: 800004, name: '四号酒造', areaId: 44 },
  // 名前が空の受け皿(実データに48件ある)。UI は空白で描かず「蔵元なし」と言う
  { id: 800005, name: '', areaId: 41 },
  // areaId 0 の蔵。県は引けない
  { id: 800006, name: '海外蔵', areaId: 0 },
]

const SAME_NAME = 'カクウ'

const BRANDS: readonly SakenowaBrand[] = [
  { id: 900001, name: SAME_NAME, breweryId: 800001 },
  { id: 900002, name: SAME_NAME, breweryId: 800002 },
  { id: 900003, name: SAME_NAME, breweryId: 800003 },
  { id: 900004, name: SAME_NAME, breweryId: 800004 },
  // 前方一致(完全一致より後ろに来る)。蔵元名が空の行に属す
  { id: 900005, name: 'カクウ錦', breweryId: 800005 },
  // 含む一致(前方一致の後ろ)。areaId 0 なので県が無い
  { id: 900006, name: 'ソラマメカクウ', breweryId: 800006 },
  // 別のクエリで引く1件。**チャートを持たない**
  { id: 900007, name: 'ホシ', breweryId: 800001 },
]

function chart(brandId: number): FlavorChart {
  return { brandId, f1: 11, f2: 22, f3: 33, f4: 44, f5: 55, f6: 66 }
}

const TABLES: SakenowaTables = {
  brands: BRANDS,
  breweries: BREWERIES,
  areas: AREAS,
  // 900007 だけ意図的に外す
  flavorCharts: [900001, 900002, 900003, 900004, 900005, 900006].map(chart),
}

/** `カクウ` に一致する銘柄の数。「全件(7件)に落ちていない」ことを件数で見張るために持つ */
const HITS_FOR_SAME_NAME = 6

// ---------------------------------------------------------------------------
// ハーネス
// ---------------------------------------------------------------------------

type HarnessProps = {
  initial?: string
  onPick?: (hit: SuggestHit) => void
  onChange?: (value: string) => void
  limit?: number
  /** 外側(Overlay 相当)の keydown。Escape を素通ししていないかを見る */
  onOuterKeyDown?: () => void
}

/**
 * `value` は親(RecordForm)が持つ設計なので、テストでも親を1つ立てる。非制御で回すと
 * 「打っているのに value が変わらない」という本番に無い状態を検証してしまう。
 */
function Harness({ initial = '', onPick, onChange, limit, onOuterKeyDown }: HarnessProps) {
  const [value, setValue] = useState(initial)
  // 本番と同じく「テーブル1つにつき1回だけ」組む
  const suggest = useMemo(() => createSuggester(TABLES), [])
  return (
    <div onKeyDown={onOuterKeyDown}>
      <BrandSuggest
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange?.(next)
        }}
        onPick={onPick ?? (() => undefined)}
        suggest={suggest}
        limit={limit}
      />
    </div>
  )
}

function input(): HTMLInputElement {
  return screen.getByRole('combobox')
}

function options(): HTMLElement[] {
  return screen.queryAllByRole('option')
}

function texts(): string[] {
  return options().map((option) => option.textContent ?? '')
}

describe('BrandSuggest', () => {
  it('候補の行に「銘柄名 + 都道府県 + 蔵元」を出し、同名4件を選び分けられる', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(input(), SAME_NAME)

    expect(options()).toHaveLength(HITS_FOR_SAME_NAME)
    const rows = texts()
    // 完全一致の4件が先頭に並び、**県と蔵元で1件ずつ区別できる**
    expect(rows[0]).toContain('甲県')
    expect(rows[0]).toContain('一号酒造')
    expect(rows[1]).toContain('乙県')
    expect(rows[1]).toContain('二号酒造')
    expect(rows[2]).toContain('丙県')
    expect(rows[2]).toContain('三号酒造')
    expect(rows[3]).toContain('丁県')
    expect(rows[3]).toContain('四号酒造')
    // 4行とも同じ銘柄名(名前だけでは選び分けられないことの裏返し)
    for (const row of rows.slice(0, 4)) expect(row).toContain(SAME_NAME)
    expect(input()).toHaveAttribute('aria-expanded', 'true')
  })

  it('県や蔵元が引けない候補は空白にせず「県なし」「蔵元なし」と言う', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(input(), SAME_NAME)
    const rows = texts()

    // 蔵元名が空の行(実データに48件ある受け皿)は「取得できている」ように見せない
    expect(rows[4]).toContain('カクウ錦')
    expect(rows[4]).toContain('蔵元なし')
    // areaId 0 は県として扱わない
    expect(rows[5]).toContain('ソラマメカクウ')
    expect(rows[5]).toContain('県なし')
    // その他(id 0)を県名として出してはいけない
    expect(screen.queryByText('その他')).not.toBeInTheDocument()
  })

  it('チャートが無い銘柄は「フレーバーなし」と出す（選んでも6軸は埋まらない）', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(input(), 'ホシ')

    expect(options()).toHaveLength(1)
    expect(texts()[0]).toContain('フレーバーなし')
  })

  it('一致0件では「該当なし」を出し、候補を1件も描かない（全件に落ちない）', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(input(), 'ゼンゼンチガウ')

    expect(screen.getByText('該当なし')).toBeInTheDocument()
    // **件数で見張る。** 全件フォールバックがあればここが 7 になる
    expect(options()).toHaveLength(0)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input()).toHaveAttribute('aria-expanded', 'false')
    // 未登録でも保存できることを言う(0件で黙ると「壊れた」と読まれる)
    expect(screen.getByText(/未紐付けで保存できる/)).toBeInTheDocument()
  })

  it('IME の変換中は「該当なし」を出さない（変換確定後に候補が出る）', async () => {
    render(<Harness />)
    const field = input()

    fireEvent.focus(field)
    fireEvent.compositionStart(field)
    // かな入力の途中。マスタに読みが無いので一致は0件だが、**ここで否定を出してはいけない**
    fireEvent.change(field, { target: { value: 'かく' } })

    expect(screen.queryByText('該当なし')).not.toBeInTheDocument()
    expect(options()).toHaveLength(0)

    // 変換確定。`compositionend` と `input` の順序は実装依存なので確定値をここでも取り込む
    fireEvent.compositionEnd(field, { target: { value: SAME_NAME } })

    expect(options()).toHaveLength(HITS_FOR_SAME_NAME)
    expect(screen.queryByText('該当なし')).not.toBeInTheDocument()
  })

  it('変換を確定した結果が0件なら「該当なし」を出す（黙り続けない）', async () => {
    render(<Harness />)
    const field = input()

    fireEvent.focus(field)
    fireEvent.compositionStart(field)
    fireEvent.change(field, { target: { value: 'ぜろけん' } })
    expect(screen.queryByText('該当なし')).not.toBeInTheDocument()

    fireEvent.compositionEnd(field, { target: { value: 'ぜろけん' } })

    expect(screen.getByText('該当なし')).toBeInTheDocument()
    expect(options()).toHaveLength(0)
  })

  it('変換中の Enter は押さえる（打ちかけの記録が保存に化けない）', () => {
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)
    const field = input()

    fireEvent.focus(field)
    fireEvent.compositionStart(field)
    // **かな入力の途中 = 一致0件**の状態で押さえられていることを見る。ここを `SAME_NAME`
    // (一致6件)にすると listOpen 側の preventDefault でも通ってしまい、
    // `onCompositionStart` / `onCompositionEnd` を削っても緑のままの恒真テストになる。
    // 危険なのはまさにこの0件の状態: リストが閉じているので、変換中を見ていなければ
    // 変換確定の Enter が form の暗黙送信になり、打ちかけの記録が保存される
    fireEvent.change(field, { target: { value: 'かく' } })
    expect(options()).toHaveLength(0)

    const composing = createEvent.keyDown(field, { key: 'Enter' })
    fireEvent(field, composing)
    expect(composing.defaultPrevented).toBe(true)

    // `compositionstart` を取りこぼした環境でも native の isComposing で同じ判定になる。
    // 変換は終わっている(0件なので「該当なし」が出ている = リストは閉じている)ので、
    // ここで押さえているのは isComposing の判定だけ
    fireEvent.compositionEnd(field, { target: { value: 'かく' } })
    expect(screen.getByText('該当なし')).toBeInTheDocument()
    const native = createEvent.keyDown(field, { key: 'Enter', isComposing: true })
    fireEvent(field, native)
    expect(native.defaultPrevented).toBe(true)

    // 変換が終わったあとの素の Enter は素通しする(通常のフォーム送信 = 保存)。
    // 押さえているのが「変換中」だけであることの裏取り
    const settled = createEvent.keyDown(field, { key: 'Enter' })
    fireEvent(field, settled)
    expect(settled.defaultPrevented).toBe(false)

    expect(onPick).not.toHaveBeenCalled()
  })

  it('↑↓ で候補を移動し、Enter で選んだ候補を確定する', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)

    await user.type(input(), SAME_NAME)
    await user.keyboard('{ArrowDown}{ArrowDown}')

    // aria-activedescendant が2件目を指す(読み上げと見た目が同じ行を指す)
    const active = input().getAttribute('aria-activedescendant')
    expect(active).not.toBeNull()
    expect(options()[1]).toHaveAttribute('id', active)
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')
    expect(options()[0]).toHaveAttribute('aria-selected', 'false')

    await user.keyboard('{Enter}')

    expect(onPick).toHaveBeenCalledTimes(1)
    // 2件目 = 乙県の同名銘柄。**名前ではなく ID で確定している**
    expect(onPick.mock.calls[0][0].brand.id).toBe(900002)
    expect(onPick.mock.calls[0][0].prefecture).toBe('乙県')
    // 確定したらリストは閉じる
    expect(options()).toHaveLength(0)
  })

  it('↑ は末尾から入る（端で止めずに回す）', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)

    await user.type(input(), SAME_NAME)
    await user.keyboard('{ArrowUp}{Enter}')

    expect(onPick.mock.calls[0][0].brand.id).toBe(900006)
  })

  it('候補を選んでいない Enter は確定しない（先頭を勝手に採らない）', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)

    await user.type(input(), SAME_NAME)
    await user.keyboard('{Enter}')

    expect(onPick).not.toHaveBeenCalled()
    expect(options()).toHaveLength(0)
  })

  it('文字を足したら選択位置を捨てる（1つ下の別の銘柄を確定させない）', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)

    await user.type(input(), SAME_NAME)
    await user.keyboard('{ArrowDown}')
    expect(input()).toHaveAttribute('aria-activedescendant')

    await user.type(input(), '錦')

    expect(input()).not.toHaveAttribute('aria-activedescendant')
    await user.keyboard('{Enter}')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('Escape は候補を閉じるだけで外側（Overlay）に伝えない', async () => {
    const user = userEvent.setup()
    const onOuterKeyDown = vi.fn()
    render(<Harness onOuterKeyDown={onOuterKeyDown} />)

    await user.type(input(), SAME_NAME)
    // 文字の keydown は外側にも届く(止めるのは Escape だけ)。ここから数え直す
    onOuterKeyDown.mockClear()

    await user.keyboard('{Escape}')

    expect(options()).toHaveLength(0)
    expect(onOuterKeyDown).not.toHaveBeenCalled()

    // リストが閉じている Escape は素通しする(フォームを閉じるのは外側の仕事)
    await user.keyboard('{Escape}')
    expect(onOuterKeyDown).toHaveBeenCalledTimes(1)
  })

  it('候補を選んでも入力欄の表記を書き換えない（本人の表記が原本）', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    const onChange = vi.fn()
    render(<Harness onPick={onPick} onChange={onChange} />)

    await user.type(input(), SAME_NAME)
    onChange.mockClear()
    // 名前が違う候補(カクウ錦)を選ぶ。**入力欄は `カクウ` のまま**
    await user.click(options()[4])

    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0][0].brand.id).toBe(900005)
    expect(input()).toHaveValue(SAME_NAME)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('上限に達したら続きがあることを言う（黙って打ち切らない）', async () => {
    const user = userEvent.setup()
    render(<Harness limit={2} />)

    await user.type(input(), SAME_NAME)

    expect(options()).toHaveLength(2)
    expect(screen.getByText(/上位2件/)).toBeInTheDocument()
  })

  it('空欄では候補も「該当なし」も出さない（まだ何も絞り込んでいない）', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(input())

    expect(options()).toHaveLength(0)
    expect(screen.queryByText('該当なし')).not.toBeInTheDocument()
  })

  it('OS 既定の入力部品を使わない', () => {
    render(<Harness />)
    expect(document.querySelectorAll('select')).toHaveLength(0)
    expect(document.querySelectorAll('input[list]')).toHaveLength(0)
  })
})
