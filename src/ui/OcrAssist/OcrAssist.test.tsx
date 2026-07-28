// OCR 補助の約束を固定する: **押すまで走らない / 候補は候補として出す(自動確定しない) /
// 絞れなければ候補を0件にして手動へ返す / 資産が取れないときは他の機能と無関係だと言う /
// 写真を選び直したら古い結果を捨てる / スペック語は押すまで書き込まない /
// 信頼度の低いパスの文字は照合に流さない(が、読めたことは画面に出す)。**
//
// 認識(`recognizeLabel`)は `recognize` prop で差し替える。jsdom には WebAssembly の SIMD も
// Worker も無いので本物を呼ぶと全ケースが `unsupported` に落ち、画面の分岐を1つも検証できない
// (認識の中身は src/lib/ocr/recognize.test.ts の担当)。
//
// **照合は本物を通す**(`createBrandMatcher` を合成テーブル2件で組む)。候補の並びと `tooWeak` は
// domain の判断そのものなので、ここでモックすると「候補を捏造しない」という肝心の約束を
// 検証したことにならない。
//
// 文言は `lib/ocr/recognize.ts` の `OCR_MESSAGES` / `OCR_PHASE_LABELS` / `OCR_CANDIDATE_NOTE` を
// import して照合する(テストに写すと出所が2箇所になる)。データはすべて合成。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BrandMatcherTables } from '../../domain/brandFromText.ts'
import { createSuggester } from '../../domain/suggest.ts'
import type { SakenowaArea, SakenowaBrand, SakenowaBrewery } from '../../domain/types.ts'
import {
  OCR_CANDIDATE_NOTE,
  OCR_MESSAGES,
  OCR_PHASE_LABELS,
  OcrError,
  type OcrResult,
} from '../../lib/ocr/recognize.ts'
import { OcrAssist, type LabelRecognizer, type OcrAssistProps } from './OcrAssist.tsx'

// ---------------------------------------------------------------------------
// 合成データ
// ---------------------------------------------------------------------------

const AREAS: readonly SakenowaArea[] = [
  { id: 0, name: 'その他' },
  { id: 41, name: '甲県' },
]

const BREWERIES: readonly SakenowaBrewery[] = [{ id: 800001, name: '架空酒造', areaId: 41 }]

const BRAND_A: SakenowaBrand = { id: 900001, name: 'カクウ', breweryId: 800001 }
const BRAND_B: SakenowaBrand = { id: 900002, name: 'ホシ', breweryId: 800001 }

const TABLES: BrandMatcherTables = {
  brands: [BRAND_A, BRAND_B],
  breweries: BREWERIES,
  areas: AREAS,
}

/**
 * 「読めた字で絞る」が引く検索。**本物の `createSuggester`** を通す — ここをモックすると
 * 「絞り込みは手で打つ経路と同じ一覧を出す」という約束を検証したことにならない。
 * フレーバーは1件だけ持たせて「フレーバーなし」の印が出ることも見る。
 */
const SUGGEST = createSuggester({
  ...TABLES,
  flavorCharts: [{ brandId: BRAND_B.id, f1: 50, f2: 50, f3: 50, f4: 50, f5: 50, f6: 50 }],
})

/**
 * 実測と同じ形の入力: **1文字が別の字に化けた短い文字列**にラベル常出語が混ざる
 * (`カ` → `力`(ちから) は実際に起きる誤読)。`酒造` は照合から除かれ、残る `クウ` で絞る。
 */
const MISREAD = '力クウ酒造'

function photo(name = 'photo.jpg'): File {
  return new File(['original-bytes'], name, { type: 'image/jpeg' })
}

function read(text: string, over: Partial<OcrResult> = {}): OcrResult[] {
  return [{ text, confidence: 38, source: 'horizontal', ...over }]
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type Options = Partial<OcrAssistProps>

function renderAssist({ file = photo(), recognize, ...rest }: Options = {}) {
  const props: OcrAssistProps = {
    file,
    tables: TABLES,
    onPick: rest.onPick ?? (() => undefined),
    onApplySpec: rest.onApplySpec ?? (() => undefined),
    suggest: rest.suggest ?? SUGGEST,
    pickedBrandId: rest.pickedBrandId ?? null,
    savedPhotoOnly: rest.savedPhotoOnly ?? false,
    disabled: rest.disabled ?? false,
    recognize: recognize ?? vi.fn<LabelRecognizer>().mockResolvedValue(read(MISREAD)),
    crop: rest.crop,
    detect: rest.detect ?? vi.fn().mockResolvedValue(null),
  }
  const view = render(<OcrAssist {...props} />)
  return {
    ...view,
    /** 写真を差し替える(参照が変われば別の写真) */
    swap: (next: File | null) => {
      view.rerender(<OcrAssist {...props} file={next} />)
    },
  }
}

function startButton(): HTMLElement {
  return screen.getByRole('button', { name: '写真から銘柄を探す' })
}

/** 候補行だけを拾う(`aria-label` が「<銘柄> を銘柄にする」に固定されている) */
function candidateButtons(): HTMLElement[] {
  return screen.queryAllByRole('button', { name: /を銘柄にする$/ })
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------

describe('起動', () => {
  it('ボタンを押すまで走らない（数秒かかる処理を勝手に始めない）', async () => {
    const user = userEvent.setup()
    const recognize = vi.fn<LabelRecognizer>().mockResolvedValue(read(MISREAD))
    renderAssist({ recognize })

    // 写真を渡しただけでは1回も呼ばない
    expect(recognize).not.toHaveBeenCalled()
    expect(startButton()).toBeInTheDocument()

    await user.click(startButton())

    expect(recognize).toHaveBeenCalledTimes(1)
    // 渡すのは原寸の元ファイル(サムネイルではない)
    expect(recognize.mock.calls[0][0]).toBeInstanceOf(File)
  })

  it('写真が無ければ導線を出さない', () => {
    const { container } = renderAssist({ file: null })
    expect(container).toBeEmptyDOMElement()
  })

  it('保存済みの写真しか無いときは、使えない理由を書く（黙って消さない）', () => {
    renderAssist({ file: null, savedPhotoOnly: true })

    expect(screen.getByText(/保存済みの写真は縮小済みなので文字を読み取れない/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '写真から銘柄を探す' })).toBeNull()
  })

  it('読み取り中は段階と進捗を出し、中断できる', async () => {
    const user = userEvent.setup()
    const pending = deferred<OcrResult[]>()
    let signal: AbortSignal | null = null
    const recognize = vi.fn<LabelRecognizer>().mockImplementation((_file, options) => {
      signal = options.signal ?? null
      options.onProgress?.({ source: 'horizontal', phase: 'recognizing', ratio: 0.5 })
      return pending.promise
    })
    renderAssist({ recognize })

    await user.click(startButton())

    // 段階の文言の出所は lib/ocr/recognize.ts(ここに写しを持たない)
    expect(screen.getByRole('status')).toHaveTextContent(
      `${OCR_PHASE_LABELS.recognizing} 50%`,
    )

    await user.click(screen.getByRole('button', { name: '読み取りを中止' }))

    // 中断は本人の操作なので何も言わずに元に戻る。**走っている認識も止める**
    expect((signal as AbortSignal | null)?.aborted).toBe(true)
    expect(startButton()).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('候補', () => {
  it('銘柄・都道府県・蔵元・当たった文字を並べ、選ぶと候補をそのまま返す', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    renderAssist({ onPick })

    await user.click(startButton())

    // 候補は候補だと毎回言う(文言の出所は recognize.ts)
    expect(await screen.findByText(OCR_CANDIDATE_NOTE)).toBeInTheDocument()

    const rows = candidateButtons()
    expect(rows).toHaveLength(1)
    // **なぜこの候補なのかが読める**: 当たった文字を出す(誤読した `力` は照合に使われていない)。
    // 何字中何字かも添える — 全字読めた候補と1字だけの候補が同じ見た目だと、
    // 当たっている候補と外れている候補を人が見分ける手がかりが1つも無くなる
    expect(rows[0].textContent).toContain('当たった文字 ウ・ク（銘柄名3字のうち2字）')
    expect(rows[0].textContent).toContain('甲県')
    expect(rows[0].textContent).toContain('架空酒造')
    // 読み取った文字そのものも見せる(当てずっぽうに見せない)
    expect(screen.getByText(MISREAD)).toBeInTheDocument()
    // 銘柄の照合に使っていない語は分けて出す(スペック欄には入れない語)
    expect(screen.getByText(/ラベルの語として読んだ 酒造/)).toBeInTheDocument()

    // **押すまで何も起きない**(押して初めて親に渡る)
    expect(onPick).not.toHaveBeenCalled()
    await user.click(rows[0])

    expect(onPick).toHaveBeenCalledTimes(1)
    const picked = onPick.mock.calls[0][0] as { brand: SakenowaBrand; prefecture: string | null }
    expect(picked.brand).toBe(BRAND_A)
    expect(picked.prefecture).toBe('甲県')
  })

  it('銘柄欄に入った候補には印を付ける（何が入ったのかを画面で確かめられる）', async () => {
    const user = userEvent.setup()
    renderAssist({ pickedBrandId: BRAND_A.id })

    await user.click(startButton())

    expect(await screen.findByText('銘柄欄に入れた')).toBeInTheDocument()
  })

  it('絞れなければ候補を0件にして手で選ばせる（もっともらしい別銘柄を出さない）', async () => {
    const user = userEvent.setup()
    // どの銘柄とも1文字も共有しない読み取り(= 実測の "新十" と同じ状況)
    const recognize = vi.fn<LabelRecognizer>().mockResolvedValue(read('モヤ'))
    renderAssist({ recognize })

    await user.click(startButton())

    expect(await screen.findByText(/銘柄を読み取れなかった。手で選ぶ。/)).toBeInTheDocument()
    // **これが肝心**: 近そうな銘柄を1件も出さない
    expect(candidateButtons()).toHaveLength(0)
    expect(screen.queryByText(OCR_CANDIDATE_NOTE)).toBeNull()
    expect(screen.getByText(/銘柄欄に打って候補から選ぶ/)).toBeInTheDocument()
    // 何が読めたのかは隠さない(手で選ぶときの手がかり)
    expect(screen.getByText('モヤ')).toBeInTheDocument()
  })

  it('信頼度が低いパスの文字は照合に流さない（が、読めたことは画面に出す）', async () => {
    const user = userEvent.setup()
    // 実測(v2.png)と同じ形: 本命の縦書き conf 41 と、ゴミの横書き conf 15。
    // ゴミ側にだけ `ホシ` の字が入っている = 混ぜると `ホシ` が候補に出る
    const recognize = vi.fn<LabelRecognizer>().mockResolvedValue([
      { text: 'ホシ', confidence: 15, source: 'horizontal' },
      { text: '力クウ', confidence: 41, source: 'vertical' },
    ])
    renderAssist({ recognize })

    await user.click(startButton())
    await screen.findByText(OCR_CANDIDATE_NOTE)

    // **これが肝心**: conf 15 のパスから `ホシ` を作らない
    expect(candidateButtons().map((row) => row.getAttribute('aria-label'))).toEqual([
      'カクウ を銘柄にする',
    ])
    // 読めたことは隠さない。どちらを照合に使ったのかも書く
    expect(screen.getByText('力クウ')).toBeInTheDocument()
    expect(screen.getByText('ホシ')).toBeInTheDocument()
    expect(screen.getByText('読み取れたが銘柄の照合に使わなかった文字')).toBeInTheDocument()
  })

  it('信頼度が近いパスは両方とも照合に流す（片方を捨てる仕掛けではない）', async () => {
    const user = userEvent.setup()
    // 実測(oyama.png)と同じ形: 83 と 72。どちらが当たるかは事前に分からないので両方使う
    const recognize = vi.fn<LabelRecognizer>().mockResolvedValue([
      { text: 'カクウ', confidence: 83, source: 'horizontal' },
      { text: 'ホシ', confidence: 72, source: 'vertical' },
    ])
    renderAssist({ recognize })

    await user.click(startButton())
    await screen.findByText(OCR_CANDIDATE_NOTE)

    expect(candidateButtons().map((row) => row.getAttribute('aria-label'))).toEqual([
      'カクウ を銘柄にする',
      'ホシ を銘柄にする',
    ])
    expect(screen.queryByText('読み取れたが銘柄の照合に使わなかった文字')).toBeNull()
  })

  it('信頼度が全パス 0 なら候補を作らず、読めた文字だけ見せる', async () => {
    const user = userEvent.setup()
    // 実測で conf 0 の読みは3枚すべてゴミだった(メ、.六獲 / 品洛 / 滞)
    const recognize = vi.fn<LabelRecognizer>().mockResolvedValue([
      { text: 'カクウ', confidence: 0, source: 'horizontal' },
    ])
    renderAssist({ recognize })

    await user.click(startButton())

    expect(await screen.findByText(/銘柄を読み取れなかった。手で選ぶ。/)).toBeInTheDocument()
    expect(candidateButtons()).toHaveLength(0)
    expect(screen.getByText('カクウ')).toBeInTheDocument()
    expect(screen.getByText('（なし）')).toBeInTheDocument()
  })

  it('候補が出たあとも読み直せる', async () => {
    const user = userEvent.setup()
    const recognize = vi.fn<LabelRecognizer>().mockResolvedValue(read(MISREAD))
    renderAssist({ recognize })

    await user.click(startButton())
    await user.click(await screen.findByRole('button', { name: 'もう一度読み取る' }))

    expect(recognize).toHaveBeenCalledTimes(2)
  })
})

describe('失敗', () => {
  it('資産が取れないときは専用の案内を出す（他の機能は無関係だと分かる）', async () => {
    const user = userEvent.setup()
    const recognize = vi.fn<LabelRecognizer>().mockRejectedValue(new OcrError('assets'))
    renderAssist({ recognize })

    await user.click(startButton())

    const alert = await screen.findByRole('alert')
    // 文言の出所は OCR_MESSAGES(ここで言い換えない)
    expect(alert).toHaveTextContent(OCR_MESSAGES.assets)
    expect(alert).toHaveTextContent(/オンラインで一度読み込めば、以降はオフラインでも使える/)
    expect(alert).toHaveTextContent(/記録の保存・検索・バックアップはこの失敗の影響を受けない/)
    // 失敗しても手動の経路は残る
    expect(screen.getByRole('button', { name: 'もう一度読み取る' })).toBeInTheDocument()
  })

  it('読めない写真は資産の案内と出し分ける（同じ文言で済ませない）', async () => {
    const user = userEvent.setup()
    const recognize = vi.fn<LabelRecognizer>().mockRejectedValue(new OcrError('decode'))
    renderAssist({ recognize })

    await user.click(startButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(OCR_MESSAGES.decode)
    expect(alert).not.toHaveTextContent(/オンラインで一度読み込めば/)
  })

  it('1文字も読めなかったときも候補を出さない', async () => {
    const user = userEvent.setup()
    const recognize = vi.fn<LabelRecognizer>().mockRejectedValue(new OcrError('empty'))
    renderAssist({ recognize })

    await user.click(startButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(OCR_MESSAGES.empty)
    expect(candidateButtons()).toHaveLength(0)
  })

  it('想定外の例外でも黙らない（理由を出して手動へ返す）', async () => {
    const user = userEvent.setup()
    const recognize = vi.fn<LabelRecognizer>().mockRejectedValue(new Error('謎の失敗'))
    renderAssist({ recognize })

    await user.click(startButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/謎の失敗/)
    expect(alert).toHaveTextContent(/銘柄は手で選ぶ/)
  })
})

describe('写真の選び直し', () => {
  it('古い写真の結果は後から届いても出さない', async () => {
    const user = userEvent.setup()
    const pending = deferred<OcrResult[]>()
    let signal: AbortSignal | null = null
    const recognize = vi.fn<LabelRecognizer>().mockImplementation((_file, options) => {
      signal = options.signal ?? null
      return pending.promise
    })
    const { swap } = renderAssist({ recognize })

    await user.click(startButton())
    swap(photo('another.jpg'))

    // 走っている認識は捨てる(WASM のループは自分では止まらないので中断を伝える)
    expect((signal as AbortSignal | null)?.aborted).toBe(true)

    // 追い越された結果が後から届く。**state 更新まで流し切ってから**見る
    // (流さずに見ると「まだ描かれていないだけ」で緑になり、回帰テストにならない)
    await act(async () => {
      pending.resolve(read(MISREAD))
      await pending.promise
    })

    // **新しい写真の候補として古い結果が出てはいけない**
    expect(candidateButtons()).toHaveLength(0)
    expect(startButton()).toBeInTheDocument()
  })

  it('中断してから読み直したとき、中断した回の結果が割り込まない', async () => {
    const user = userEvent.setup()
    const first = deferred<OcrResult[]>()
    const second = deferred<OcrResult[]>()
    const recognize = vi
      .fn<LabelRecognizer>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    renderAssist({ recognize })

    await user.click(startButton())
    await user.click(screen.getByRole('button', { name: '読み取りを中止' }))
    await user.click(startButton())

    // 中断した回が「間に合ってしまった」場合(認識が終わった直後に中断した競合)
    await act(async () => {
      first.resolve(read(MISREAD))
      await first.promise
    })

    // 同じ写真なので持ち主では見分けが付かない。**世代**で捨てる
    expect(candidateButtons()).toHaveLength(0)
    expect(screen.getByRole('status')).toBeInTheDocument()

    await act(async () => {
      second.resolve(read('モヤ'))
      await second.promise
    })

    // いま走っている回の結果はちゃんと出る
    expect(screen.getByText(/銘柄を読み取れなかった/)).toBeInTheDocument()
  })

  it('出ている候補は写真を選び直した時点で消える', async () => {
    const user = userEvent.setup()
    const { swap } = renderAssist()

    await user.click(startButton())
    expect(await screen.findByText(OCR_CANDIDATE_NOTE)).toBeInTheDocument()

    swap(photo('another.jpg'))

    expect(screen.queryByText(OCR_CANDIDATE_NOTE)).toBeNull()
    expect(candidateButtons()).toHaveLength(0)
    expect(startButton()).toBeInTheDocument()
  })
})

describe('スペック語', () => {
  it('押すまで書き込まず、押したら読んだ語をそのまま渡す', async () => {
    const user = userEvent.setup()
    const onApplySpec = vi.fn()
    // ラベルにはスペックが必ず写る。**銘柄の照合には流さない**(実測: 117件のノイズになる)
    const recognize = vi.fn<LabelRecognizer>().mockResolvedValue(read('カクウ純米大吟醸'))
    renderAssist({ recognize, onApplySpec })

    await user.click(startButton())

    expect(await screen.findByText(/スペックとして読んだ語 純米大吟醸/)).toBeInTheDocument()
    // スペック語は銘柄候補を汚していない(候補は `カクウ` 1件のまま)
    expect(candidateButtons()).toHaveLength(1)
    expect(onApplySpec).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'スペック欄に入れる' }))

    expect(onApplySpec).toHaveBeenCalledExactlyOnceWith('純米大吟醸')
  })

  it('スペック語が読めなければボタンを出さない', async () => {
    const user = userEvent.setup()
    renderAssist()

    await user.click(startButton())
    await screen.findByText(OCR_CANDIDATE_NOTE)

    expect(screen.queryByRole('button', { name: 'スペック欄に入れる' })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 読めた字で絞る
// ---------------------------------------------------------------------------
//
// **候補の門を緩める代わりの受け皿。** 候補が出せなかったときに「読めた1字」を鍵にして
// 手動サジェストと同じ一覧を出す。押すのは人なので、ここは候補を作らない。
//
// 鍵に使うのは `ウ`。`カクウ` は3字なので1字では被覆率 1/3 < 1/2 で**候補にはならない**
// (実測の `穂` → `刈穂` と同じ形)。候補が出ないのに絞り込みには効く、がこの節の主題。

/** 絞り込みの字のチップ(`aria-label` が「<字> を含む銘柄を出す（N件）」に固定) */
function narrowChips(): HTMLElement[] {
  return screen.queryAllByRole('button', { name: /を含む銘柄を出す/ })
}

describe('読めた字で絞る', () => {
  it('読めた字を「含む銘柄の少ない順」に件数付きで出す', async () => {
    const user = userEvent.setup()
    // `ウ` は `カクウ` の1件 / `ホ` は `ホシ` の1件 / `酒造` はラベル常出語で鍵にしない
    renderAssist({ recognize: vi.fn<LabelRecognizer>().mockResolvedValue(read('ウホ酒造')) })

    await user.click(startButton())
    await screen.findByText('読めた字で絞る')

    expect(narrowChips().map((chip) => chip.getAttribute('aria-label'))).toEqual([
      'ウ を含む銘柄を出す（1件）',
      'ホ を含む銘柄を出す（1件）',
    ])
  })

  it('マスタに1件も無い字は鍵にしない(押しても0件になる字を押せる形で並べない)', async () => {
    const user = userEvent.setup()
    // `力`(ちから) は誤読で出るが合成マスタのどの銘柄にも無い
    renderAssist({ recognize: vi.fn<LabelRecognizer>().mockResolvedValue(read('力ウ')) })

    await user.click(startButton())
    await screen.findByText('読めた字で絞る')

    expect(narrowChips().map((chip) => chip.getAttribute('aria-label'))).toEqual([
      'ウ を含む銘柄を出す（1件）',
    ])
  })

  it('押すと手動サジェストと同じ一覧が出て、選ぶと同じ受け口に流れる', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    renderAssist({ recognize: vi.fn<LabelRecognizer>().mockResolvedValue(read('ウ')), onPick })

    await user.click(startButton())
    // 3字の銘柄に1字は被覆率が足りない = **候補は作らない**
    expect(await screen.findByText(/銘柄を読み取れなかった/)).toBeInTheDocument()
    // 押すまでは一覧も出さない(候補欄のように見せない)
    expect(candidateButtons()).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'ウ を含む銘柄を出す（1件）' }))

    const row = screen.getByRole('button', { name: 'カクウ を銘柄にする' })
    // 行は BrandSuggest と同じ情報を出す。フレーバーが無いことも選ぶ前に言う
    expect(row).toHaveTextContent('甲県')
    expect(row).toHaveTextContent('架空酒造')
    expect(row).toHaveTextContent('フレーバーなし')

    await user.click(row)

    // 県も蔵元も付いた形で渡る(候補行と同じ `PickedBrand`)
    expect(onPick).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ brand: BRAND_A, prefecture: '甲県', breweryName: '架空酒造' }),
    )
  })

  it('押し直すと畳む', async () => {
    const user = userEvent.setup()
    renderAssist({ recognize: vi.fn<LabelRecognizer>().mockResolvedValue(read('ウ')) })

    await user.click(startButton())
    const chip = await screen.findByRole('button', { name: 'ウ を含む銘柄を出す（1件）' })

    await user.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(candidateButtons()).toHaveLength(1)

    await user.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(candidateButtons()).toHaveLength(0)
  })

  // **この節がこの機能の要**。信頼度で照合から外した字は候補を作れないが、
  // 人が押す鍵としては効く(実測の `七賢` の `賢` / `黒龍` の `龍` はどちらも conf 0 のパス由来)。
  it('照合に流さなかった低信頼のパスの字も鍵にする', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    const recognize = vi.fn<LabelRecognizer>().mockResolvedValue([
      { text: '力', confidence: 38, source: 'horizontal' },
      { text: 'ウ', confidence: 0, source: 'vertical' },
    ])
    renderAssist({ recognize, onPick })

    await user.click(startButton())

    // 照合は `力` だけ = 銘柄を絞れない。**候補は捏造しない**
    expect(await screen.findByText(/銘柄を読み取れなかった/)).toBeInTheDocument()
    // 落とした側は画面には出ている(従来の約束)うえに、絞り込みの鍵にもなる
    expect(screen.getByText(/読み取れたが銘柄の照合に使わなかった文字/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'ウ を含む銘柄を出す（1件）' }))
    await user.click(screen.getByRole('button', { name: 'カクウ を銘柄にする' }))

    expect(onPick).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ brand: BRAND_A }))
  })

  it('絞れなかったときは受け皿の在りかを文言で言う', async () => {
    const user = userEvent.setup()
    renderAssist({ recognize: vi.fn<LabelRecognizer>().mockResolvedValue(read('ウ')) })

    await user.click(startButton())

    expect(await screen.findByText(/「読めた字で絞る」から字を押すか/)).toBeInTheDocument()
  })

  it('鍵になる字が1つも無ければ節ごと出さず、文言も手入力だけを言う', async () => {
    const user = userEvent.setup()
    renderAssist({ recognize: vi.fn<LabelRecognizer>().mockResolvedValue(read('力')) })

    await user.click(startButton())

    expect(await screen.findByText(/銘柄を読み取れなかった/)).toBeInTheDocument()
    expect(screen.queryByText('読めた字で絞る')).toBeNull()
    expect(narrowChips()).toHaveLength(0)
    expect(screen.getByText(/銘柄欄に打って候補から選ぶ。$/)).toBeInTheDocument()
  })

  it('読み取り直すと開いていた一覧は畳む(前の写真の絞り込みが残らない)', async () => {
    const user = userEvent.setup()
    const first = deferred<OcrResult[]>()
    const second = deferred<OcrResult[]>()
    const recognize = vi
      .fn<LabelRecognizer>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    renderAssist({ recognize })

    await user.click(startButton())
    await act(async () => {
      first.resolve(read('ウ'))
      await first.promise
    })
    await user.click(screen.getByRole('button', { name: 'ウ を含む銘柄を出す（1件）' }))
    expect(candidateButtons()).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'もう一度読み取る' }))
    await act(async () => {
      second.resolve(read('ウ'))
      await second.promise
    })

    // 同じ字が鍵として出ているが、**開いた状態は引き継がない**
    expect(screen.getByRole('button', { name: 'ウ を含む銘柄を出す（1件）' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(candidateButtons()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// ラベルを囲んで読み取る(切り出し)
// ---------------------------------------------------------------------------
//
// tesseract は瓶の全体が写る写真からラベルの文字を見つけられない(実機報告「全く読み取って
// いない」)。**場所の特定は機械に推測させず、人が枠で囲む。** 切り出した Blob は全体と
// 同じ `recognize` 経路に流す。切り出し(canvas)は jsdom で動かないので `crop` を注入する。
//
// 幾何(dragToFraction)は cropImage.test.ts の担当。ここで見るのは配線:
// 枠 → crop に渡る比率 → recognize に渡る Blob、と、写真を替えたときの捨て方。

/** 200×260 の枠。jsdom の getBoundingClientRect は全0を返すので必ず差し替える */
function mockCropArea(): HTMLElement {
  const area = screen.getByLabelText('読み取る範囲')
  vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 200,
    height: 260,
    right: 200,
    bottom: 260,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  return area
}

/**
 * MouseEvent を pointer 型で dispatch する。jsdom の PointerEvent には座標が乗らない
 * (`clientX` が undefined になり枠が引けない)ので、座標を運べる MouseEvent を使う。
 */
function point(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
}

function drag(area: HTMLElement, from: [number, number], to: [number, number]) {
  fireEvent(area, point('pointerdown', from[0], from[1]))
  fireEvent(area, point('pointermove', to[0], to[1]))
  fireEvent(area, point('pointerup', to[0], to[1]))
}

describe('ラベルを囲んで読み取る', () => {
  it('枠を引くまで「囲んだ範囲を読み取る」は押せない', async () => {
    const user = userEvent.setup()
    renderAssist()

    await user.click(screen.getByRole('button', { name: 'ラベルを囲んで読み取る' }))

    expect(screen.getByRole('button', { name: '囲んだ範囲を読み取る' })).toBeDisabled()
  })

  it('囲んだ比率が crop に渡り、切り出された Blob が認識に渡る', async () => {
    const user = userEvent.setup()
    const cropped = new Blob(['cropped-bytes'], { type: 'image/jpeg' })
    const crop = vi.fn().mockResolvedValue(cropped)
    const recognize = vi.fn<LabelRecognizer>().mockResolvedValue(read('カクウ'))
    const file = photo()
    renderAssist({ file, recognize, crop })

    await user.click(screen.getByRole('button', { name: 'ラベルを囲んで読み取る' }))
    drag(mockCropArea(), [50, 65], [150, 195])

    await user.click(screen.getByRole('button', { name: '囲んだ範囲を読み取る' }))

    // 比率(0..1)で渡る。px で渡すと表示と実寸の座標系が食い違う
    expect(crop).toHaveBeenCalledExactlyOnceWith(file, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
    // **切り出した Blob が認識に渡る**(元の全体ではなく)
    expect(await screen.findByText(OCR_CANDIDATE_NOTE)).toBeInTheDocument()
    expect(recognize.mock.calls[0][0]).toBe(cropped)
  })

  it('タップ(16px未満)は枠にならない', async () => {
    const user = userEvent.setup()
    renderAssist()

    await user.click(screen.getByRole('button', { name: 'ラベルを囲んで読み取る' }))
    drag(mockCropArea(), [50, 65], [55, 70])

    expect(screen.getByRole('button', { name: '囲んだ範囲を読み取る' })).toBeDisabled()
  })

  it('切り出しに失敗したら全体に落とさず、読める形式でないと言う', async () => {
    const user = userEvent.setup()
    const crop = vi.fn().mockResolvedValue(null)
    const recognize = vi.fn<LabelRecognizer>().mockResolvedValue(read('カクウ'))
    renderAssist({ recognize, crop })

    await user.click(screen.getByRole('button', { name: 'ラベルを囲んで読み取る' }))
    drag(mockCropArea(), [50, 65], [150, 195])
    await user.click(screen.getByRole('button', { name: '囲んだ範囲を読み取る' }))

    // **黙って全体を読まない**(枠が効いていないように見え、枠を直す手がかりが消える)
    expect(await screen.findByRole('alert')).toHaveTextContent(OCR_MESSAGES.decode)
    expect(recognize).not.toHaveBeenCalled()
  })

  it('写真を選び直すと枠も開閉も消える', async () => {
    const user = userEvent.setup()
    const { swap } = renderAssist()

    await user.click(screen.getByRole('button', { name: 'ラベルを囲んで読み取る' }))
    drag(mockCropArea(), [50, 65], [150, 195])
    expect(screen.getByRole('button', { name: '囲んだ範囲を読み取る' })).toBeEnabled()

    swap(photo('another.jpg'))

    // 前の写真の枠を新しい写真に引き継がない(囲んだ場所は写真ごとに違う)
    expect(screen.queryByRole('button', { name: '囲んだ範囲を読み取る' })).toBeNull()
    expect(screen.getByRole('button', { name: 'ラベルを囲んで読み取る' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('絞れなかったときの文言が切り出しへ誘導する', async () => {
    const user = userEvent.setup()
    renderAssist({ recognize: vi.fn<LabelRecognizer>().mockResolvedValue(read('力')) })

    await user.click(startButton())

    expect(await screen.findByText(/銘柄を読み取れなかった/)).toBeInTheDocument()
    expect(screen.getByText(/「ラベルを囲んで読み取る」で銘柄の文字だけを囲む/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// ラベル位置の自動検出(提案 → 切り出し → 外れたら全体に戻す)
// ---------------------------------------------------------------------------
//
// 検出そのもの(勾配密度)は findLabel.test.ts の担当。ここで見るのは配線と退路:
// 提案が出れば切り出して読む / 出なければ全体 / 提案の読みが空振りしたら全体に自動で戻す。
// **どの経路でも候補の門と選ぶ人は同じ**なので、「銘柄を推測しない」規律とは衝突しない。

describe('ラベル位置の自動検出', () => {
  const REGION = { x: 0.3, y: 0.4, w: 0.3, h: 0.2 }

  it('検出した範囲を切り出して読み、そのことを画面で言う', async () => {
    const user = userEvent.setup()
    const cropped = new Blob(['auto-cropped'], { type: 'image/jpeg' })
    const detect = vi.fn().mockResolvedValue(REGION)
    const crop = vi.fn().mockResolvedValue(cropped)
    const recognize = vi.fn<LabelRecognizer>().mockResolvedValue(read('カクウ'))
    const file = photo()
    renderAssist({ file, detect, crop, recognize })

    await user.click(startButton())

    expect(await screen.findByText(OCR_CANDIDATE_NOTE)).toBeInTheDocument()
    expect(detect).toHaveBeenCalledExactlyOnceWith(file)
    expect(crop).toHaveBeenCalledExactlyOnceWith(file, REGION)
    // **切り出した Blob を読む**(全体ではなく)
    expect(recognize).toHaveBeenCalledOnce()
    expect(recognize.mock.calls[0][0]).toBe(cropped)
    // 読んだ範囲を隠さない
    expect(screen.getByText(/ラベルらしい範囲を自動で絞って読み取った/)).toBeInTheDocument()
  })

  it('検出できなければ全体を読む(自動は提案であって前提ではない)', async () => {
    const user = userEvent.setup()
    const crop = vi.fn()
    const recognize = vi.fn<LabelRecognizer>().mockResolvedValue(read('カクウ'))
    const file = photo()
    renderAssist({ file, detect: vi.fn().mockResolvedValue(null), crop, recognize })

    await user.click(startButton())

    expect(await screen.findByText(OCR_CANDIDATE_NOTE)).toBeInTheDocument()
    expect(crop).not.toHaveBeenCalled()
    expect(recognize.mock.calls[0][0]).toBe(file)
    expect(screen.getByText('写真全体を読み取った。')).toBeInTheDocument()
  })

  it('検出が落ちても読み取りは止めない(全体に戻す)', async () => {
    const user = userEvent.setup()
    const recognize = vi.fn<LabelRecognizer>().mockResolvedValue(read('カクウ'))
    const file = photo()
    renderAssist({ file, detect: vi.fn().mockRejectedValue(new Error('boom')), recognize })

    await user.click(startButton())

    expect(await screen.findByText(OCR_CANDIDATE_NOTE)).toBeInTheDocument()
    expect(recognize.mock.calls[0][0]).toBe(file)
  })

  it('提案の読みが候補を出せなければ、全体も読んで合算する', async () => {
    const user = userEvent.setup()
    const cropped = new Blob(['auto-cropped'], { type: 'image/jpeg' })
    const detect = vi.fn().mockResolvedValue(REGION)
    const crop = vi.fn().mockResolvedValue(cropped)
    const recognize = vi
      .fn<LabelRecognizer>()
      // 1回目(切り出し): 候補は出ない(`ウ` は3字の1字)が鍵にはなる
      .mockResolvedValueOnce(read('ウ'))
      // 2回目(全体): 別の字が読める
      .mockResolvedValueOnce(read('ホ'))
    const file = photo()
    renderAssist({ file, detect, crop, recognize })

    await user.click(startButton())

    expect(await screen.findByText(/銘柄を読み取れなかった/)).toBeInTheDocument()
    expect(recognize).toHaveBeenCalledTimes(2)
    expect(recognize.mock.calls[0][0]).toBe(cropped)
    expect(recognize.mock.calls[1][0]).toBe(file)
    // **合算**: 切り出しで得た `ウ` も全体で得た `ホ` も両方が鍵に残る
    expect(screen.getByRole('button', { name: 'ウ を含む銘柄を出す（1件）' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ホ を含む銘柄を出す（1件）' })).toBeInTheDocument()
    // 読んだ範囲も両方だと言う
    expect(screen.getByText(/ラベルらしい範囲と写真全体の両方を読み取った/)).toBeInTheDocument()
  })

  it('提案の読みで候補が出ていれば全体は読まない(1.2秒を追加で払う理由が無い)', async () => {
    const user = userEvent.setup()
    const detect = vi.fn().mockResolvedValue(REGION)
    const crop = vi.fn().mockResolvedValue(new Blob(['auto-cropped']))
    const recognize = vi.fn<LabelRecognizer>().mockResolvedValue(read('カクウ'))
    renderAssist({ detect, crop, recognize })

    await user.click(startButton())

    expect(await screen.findByText(OCR_CANDIDATE_NOTE)).toBeInTheDocument()
    expect(recognize).toHaveBeenCalledOnce()
    expect(screen.getByText(/ラベルらしい範囲を自動で絞って読み取った/)).toBeInTheDocument()
  })

  it('自動で絞った範囲が1文字も読めなくても、全体で読み直す', async () => {
    const user = userEvent.setup()
    const detect = vi.fn().mockResolvedValue(REGION)
    const crop = vi.fn().mockResolvedValue(new Blob(['auto-cropped']))
    const recognize = vi
      .fn<LabelRecognizer>()
      .mockRejectedValueOnce(new OcrError('empty'))
      .mockResolvedValueOnce(read('カクウ'))
    renderAssist({ detect, crop, recognize })

    await user.click(startButton())

    expect(await screen.findByText(OCR_CANDIDATE_NOTE)).toBeInTheDocument()
    expect(recognize).toHaveBeenCalledTimes(2)
  })

  it('読んだ範囲が手動の枠の初期値になる(囲み直しが1操作で始まる)', async () => {
    const user = userEvent.setup()
    const detect = vi.fn().mockResolvedValue(REGION)
    const crop = vi.fn().mockResolvedValue(new Blob(['auto-cropped']))
    renderAssist({ detect, crop, recognize: vi.fn<LabelRecognizer>().mockResolvedValue(read('ウ')) })

    await user.click(startButton())
    await screen.findByText(/銘柄を読み取れなかった/)

    await user.click(screen.getByRole('button', { name: 'ラベルを囲んで読み取る' }))

    // 枠が既に引かれている(自動で絞った範囲)ので、読み取りボタンは押せる
    expect(screen.getByRole('button', { name: '囲んだ範囲を読み取る' })).toBeEnabled()
  })

  it('手動で囲んだ読みには検出も全体への戻しも走らない(人の枠を上書きしない)', async () => {
    const user = userEvent.setup()
    const detect = vi.fn().mockResolvedValue(REGION)
    const crop = vi.fn().mockResolvedValue(new Blob(['manual-cropped']))
    // マスタに無い字だけ → 自動経路なら全体に戻る条件。手動なのでそのまま報告する
    const recognize = vi.fn<LabelRecognizer>().mockResolvedValue(read('力'))
    renderAssist({ detect, crop, recognize })

    await user.click(screen.getByRole('button', { name: 'ラベルを囲んで読み取る' }))
    drag(mockCropArea(), [50, 65], [150, 195])
    await user.click(screen.getByRole('button', { name: '囲んだ範囲を読み取る' }))

    expect(await screen.findByText(/銘柄を読み取れなかった/)).toBeInTheDocument()
    expect(detect).not.toHaveBeenCalled()
    expect(recognize).toHaveBeenCalledOnce()
    expect(screen.getByText('囲んだ範囲を読み取った。')).toBeInTheDocument()
  })
})
