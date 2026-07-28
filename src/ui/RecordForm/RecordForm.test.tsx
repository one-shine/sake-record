// 記録フォームの約束を固定する: **銘柄を選ぶと県・蔵元・6軸が埋まる / 分からない記録も保存できる /
// 推定で埋めない / 由来(auto・alias)を編集で偽らない / 評価は未評価に戻せる / 日付は自作 /
// `key` を渡さないと state が持ち越される(既知事故を可視化する) / 写真の生成中は保存を止める。**
//
// リサイズ本体は `resizePhoto` で差し替える(canvas も createImageBitmap も jsdom に無い)。
// サジェストの照合は `createSuggester` の本物を通す(合成テーブル数件で組める)。
//
// データは全て合成。**実際の飲酒記録(日付と銘柄/県の対)はテストに書かない** —
// `data/seed/` は gitignore で、fixture に写すと public リポジトリに台帳が漏れる(`ledger:check`)。

import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  HEIC_ADVICE,
  ThumbnailError,
  type ThumbnailResult,
} from '../../lib/image/resize.ts'
import type {
  FlavorChart,
  SakeRecord,
  SakenowaArea,
  SakenowaBrand,
  SakenowaBrewery,
} from '../../domain/types.ts'
import type { OcrResult } from '../../lib/ocr/recognize.ts'
import { RecordForm, type RecordDraft, type RecordFormTables } from './RecordForm.tsx'
import type { LabelRecognizer } from '../OcrAssist/OcrAssist.tsx'
import type { PhotoResizer } from '../PhotoPicker/PhotoPicker.tsx'

// ---------------------------------------------------------------------------
// 合成データ
// ---------------------------------------------------------------------------

const TODAY = '2020-02-03'

const AREAS: readonly SakenowaArea[] = [
  { id: 0, name: 'その他' },
  { id: 41, name: '甲県' },
  { id: 42, name: '乙県' },
]

const BREWERIES: readonly SakenowaBrewery[] = [
  { id: 800001, name: '架空酒造', areaId: 41 },
  { id: 800002, name: '二号酒造', areaId: 42 },
]

/** 同名2件。県と蔵元でしか選び分けられない(実データの同名4件と同じ形) */
const BRAND_A: SakenowaBrand = { id: 900001, name: 'カクウ', breweryId: 800001 }
const BRAND_B: SakenowaBrand = { id: 900002, name: 'カクウ', breweryId: 800002 }
/** チャートを持たない銘柄(紐付け済み ≠ フレーバー取得済み) */
const BRAND_C: SakenowaBrand = { id: 900003, name: 'ホシ', breweryId: 800001 }

/** 6軸の値は互いに異なり、日付・評価と重ならない2桁にしてある */
const CHART: FlavorChart = { brandId: BRAND_A.id, f1: 72, f2: 64, f3: 31, f4: 58, f5: 43, f6: 66 }
const CHART_VALUES = ['72', '64', '31', '58', '43', '66']
const AXIS_LABELS = ['華やか', '芳醇', '重厚', '穏やか', 'ドライ', '軽快']

const TABLES: RecordFormTables = {
  brands: [BRAND_A, BRAND_B, BRAND_C],
  breweries: BREWERIES,
  areas: AREAS,
  flavorCharts: [CHART, { brandId: BRAND_B.id, f1: 10, f2: 20, f3: 30, f4: 40, f5: 50, f6: 60 }],
}

function makeRecord(over: Partial<SakeRecord> = {}): SakeRecord {
  return {
    id: 'record-1',
    drankOn: '2020-01-05',
    brandLabel: 'かくう',
    sakenowaBrandId: BRAND_A.id,
    brandName: 'カクウ',
    linkStatus: 'auto',
    prefecture: '甲県',
    spec: '純米',
    rating: null,
    place: '甲店',
    note: '',
    thumbnail: null,
    sourceNo: null,
    createdAt: '2020-01-05T00:00:00.000Z',
    updatedAt: '2020-01-05T00:00:00.000Z',
    ...over,
  }
}

/** 新規で「日付だけ」を保存したときの下書き。各テストは差分だけを書く */
function draft(over: Partial<RecordDraft> = {}): RecordDraft {
  return {
    drankOn: TODAY,
    brandLabel: '',
    sakenowaBrandId: null,
    brandName: null,
    linkStatus: 'unknown',
    prefecture: null,
    spec: '',
    rating: null,
    place: '',
    note: '',
    thumbnail: null,
    ...over,
  }
}

function jpeg(bytes: number): Blob {
  return new Blob(['x'.repeat(bytes)], { type: 'image/jpeg' })
}

function thumbnail(over: Partial<ThumbnailResult> = {}): ThumbnailResult {
  const bytes = over.bytes ?? 38912
  return { blob: jpeg(bytes), width: 400, height: 533, bytes, quality: 0.82, ...over }
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

type FormOptions = {
  record?: SakeRecord | null
  recentBrands?: readonly { brandId: number; brandName: string | null; lastDrankOn: string }[]
  onSubmit?: (input: RecordDraft) => void | Promise<void>
  onCancel?: () => void
  resizePhoto?: PhotoResizer
  recognizePhoto?: LabelRecognizer
  today?: string
}

function renderForm({
  record = null,
  recentBrands = [],
  onSubmit,
  onCancel,
  resizePhoto,
  recognizePhoto,
  today,
}: FormOptions = {}) {
  return render(
    <RecordForm
      record={record}
      tables={TABLES}
      recentBrands={recentBrands}
      today={today ?? TODAY}
      onSubmit={onSubmit ?? (() => undefined)}
      onCancel={onCancel ?? (() => undefined)}
      resizePhoto={resizePhoto}
      recognizePhoto={recognizePhoto}
    />,
  )
}

function brandField(): HTMLElement {
  return screen.getByRole('combobox')
}

function save(): HTMLElement {
  return screen.getByRole('button', { name: '保存' })
}

function firstArg(mock: ReturnType<typeof vi.fn>): RecordDraft {
  return mock.mock.calls[0][0] as RecordDraft
}

/** 銘柄を打って候補から選ぶ(見出し機能の最短経路) */
async function pickBrand(user: ReturnType<typeof userEvent.setup>, query: string, index = 0) {
  await user.type(brandField(), query)
  await user.click(screen.getAllByRole('option')[index])
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------

describe('銘柄の紐付け', () => {
  it('候補から選ぶと県・蔵元・フレーバー6軸が埋まり、manual で保存される', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    await pickBrand(user, 'カクウ')

    // A7 / e2e手順13: 選んだだけで県・蔵元・6軸が入る
    expect(screen.getByText('甲県')).toBeInTheDocument()
    expect(screen.getByText('架空酒造')).toBeInTheDocument()
    for (const label of AXIS_LABELS) expect(screen.getByText(label)).toBeInTheDocument()
    for (const value of CHART_VALUES) expect(screen.getByText(value)).toBeInTheDocument()
    // 本人が選んだ紐付けは「手動」(バッジ表は linkStatus.ts の1箇所から引く)
    expect(screen.getByText('手動')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '評価 4' }))
    await user.type(screen.getByLabelText('場所・店名'), '自宅')
    await user.click(save())

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
      draft({
        brandLabel: 'カクウ',
        sakenowaBrandId: BRAND_A.id,
        brandName: 'カクウ',
        linkStatus: 'manual',
        prefecture: '甲県',
        rating: 4,
        place: '自宅',
      }),
    )
  })

  it('同名の候補は県で選び分けられる（2件目を選ぶと乙県が入る）', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    await pickBrand(user, 'カクウ', 1)
    await user.click(save())

    const submitted = firstArg(onSubmit)
    expect(submitted.sakenowaBrandId).toBe(BRAND_B.id)
    expect(submitted.prefecture).toBe('乙県')
  })

  it('銘柄が分からない記録は日付だけで保存できる（unknown のまま）', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    await user.click(save())

    // 必須は日付だけ。銘柄なしでも「静かに保存されない」ことがない
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(draft())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('銘柄名を打っただけ（候補未選択）なら unlinked で、県も6軸も埋めない', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    await user.type(brandField(), 'カクウ')
    // 候補リストを閉じてから見る(リストの行にも県名が出るので混ざらないようにする)
    await user.keyboard('{Escape}')

    expect(screen.getByText('未紐付け')).toBeInTheDocument()
    // **推定で埋めない**: 名前が一致していてもフレーバーも蔵元も出さない
    for (const value of CHART_VALUES) expect(screen.queryByText(value)).toBeNull()
    expect(screen.queryByText('架空酒造')).toBeNull()

    await user.click(save())

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
      draft({ brandLabel: 'カクウ', linkStatus: 'unlinked' }),
    )
  })

  it('チャートが無い銘柄は「フレーバー未取得」と言う（紐付け済み ≠ 取得済み）', async () => {
    const user = userEvent.setup()
    renderForm()

    await pickBrand(user, 'ホシ')

    expect(screen.getByText(/フレーバー未取得/)).toBeInTheDocument()
    for (const value of CHART_VALUES) expect(screen.queryByText(value)).toBeNull()
  })

  it('auto の記録を編集して場所だけ直しても、由来は auto のまま', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ record: makeRecord({ linkStatus: 'auto' }), onSubmit })

    // 機械が当てた紐付けは編集画面でもそのまま見える
    expect(screen.getByText('自動')).toBeInTheDocument()
    expect(screen.getByText('甲県')).toBeInTheDocument()

    await user.type(screen.getByLabelText('場所・店名'), '（二次会）')
    await user.click(save())

    const submitted = firstArg(onSubmit)
    // ここが 'manual' になると「機械が当てた」という由来の記録が壊れる
    expect(submitted.linkStatus).toBe('auto')
    expect(submitted.sakenowaBrandId).toBe(BRAND_A.id)
    expect(submitted.prefecture).toBe('甲県')
    expect(submitted.place).toBe('甲店（二次会）')
  })

  it('alias の記録も同じく由来を保つ', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ record: makeRecord({ linkStatus: 'alias' }), onSubmit })

    expect(screen.getByText('別名')).toBeInTheDocument()
    await user.click(save())

    expect(firstArg(onSubmit).linkStatus).toBe('alias')
  })

  it('保存済みの表記に余分な空白があっても、開いただけで「手動」に化けない', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    // 空白付きの表記は実際に入り得る: ログのパーサは全セルを trim するが、
    // バックアップ JSON の取り込みは型しか見ない(`domain/backupSchema.ts`)
    renderForm({ record: makeRecord({ brandLabel: 'かくう ', linkStatus: 'auto' }), onSubmit })

    // 銘柄欄に触っていないので由来は `auto` のまま。ここが「手動」になると、
    // 本人が下していない判断を本人の判断として記録することになる(決定2の違反)
    expect(screen.getByText('自動')).toBeInTheDocument()
    expect(screen.queryByText('手動')).toBeNull()

    await user.type(screen.getByLabelText('場所・店名'), '（二次会）')
    await user.click(save())

    const submitted = firstArg(onSubmit)
    expect(submitted.linkStatus).toBe('auto')
    expect(submitted.brandLabel).toBe('かくう')
  })

  it('表記に余分な空白がある未紐付けの記録は、開いて保存しても県を落とさない', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({
      record: makeRecord({
        brandLabel: 'かくう ',
        sakenowaBrandId: null,
        brandName: null,
        linkStatus: 'unlinked',
        prefecture: '甲県',
      }),
      onSubmit,
    })

    await user.click(save())

    const submitted = firstArg(onSubmit)
    // 触っていない = 何も判断していないので、ログ由来の `unlinked` と県をそのまま残す
    expect(submitted.linkStatus).toBe('unlinked')
    expect(submitted.prefecture).toBe('甲県')
  })

  it('表記を変えたら紐付けを外し、外したことを画面に出す', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ record: makeRecord(), onSubmit })

    await user.clear(brandField())
    await user.type(brandField(), 'ホシ')
    await user.keyboard('{Escape}')

    // 無音で変えない(銘柄名と紐付け先が食い違った行を黙って作らない)
    expect(screen.getByText(/表記を変えたので紐付けを外した/)).toBeInTheDocument()
    expect(screen.getByText('未紐付け')).toBeInTheDocument()

    await user.click(save())

    const submitted = firstArg(onSubmit)
    expect(submitted.sakenowaBrandId).toBeNull()
    expect(submitted.brandName).toBeNull()
    expect(submitted.linkStatus).toBe('unlinked')
    // 前の銘柄の県を残さない
    expect(submitted.prefecture).toBeNull()
  })

  it('「紐付けを外す」で unlinked のまま残せる（アプリが代替紐付けを決めない）', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ record: makeRecord(), onSubmit })

    await user.click(screen.getByRole('button', { name: '紐付けを外す' }))

    expect(screen.getByText('未紐付け')).toBeInTheDocument()
    expect(screen.queryByText('架空酒造')).toBeNull()

    await user.click(save())

    const submitted = firstArg(onSubmit)
    expect(submitted.sakenowaBrandId).toBeNull()
    expect(submitted.linkStatus).toBe('unlinked')
    // 本人の表記は原本なので消さない
    expect(submitted.brandLabel).toBe('かくう')
  })

  it('記録に県が無い紐付け済みは、銘柄から辿った県を出して保存する', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({
      record: makeRecord({ sakenowaBrandId: BRAND_B.id, prefecture: null }),
      onSubmit,
    })

    // 紐付け先が確定している銘柄の県。候補から選び直したときに入る値と同じ経路(推定ではない)
    expect(screen.getByText('乙県')).toBeInTheDocument()
    await user.click(save())

    expect(firstArg(onSubmit).prefecture).toBe('乙県')
  })

  it('マスタから消えた銘柄IDでも表示を落とさず、それが分かるように書く', async () => {
    renderForm({ record: makeRecord({ sakenowaBrandId: 999999, brandName: null }) })

    expect(screen.getByText(/さけのわのマスタに無い銘柄ID 999999/)).toBeInTheDocument()
  })
})

describe('評価', () => {
  it('付けた評価を未評価に戻せる（押し直しと専用ボタンの両方）', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    expect(screen.getByText('未評価')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '評価 4' }))
    expect(screen.getByText('4 / 5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '評価 4' })).toHaveAttribute('aria-pressed', 'true')

    // 同じ数字を押し直すと未評価に戻る
    await user.click(screen.getByRole('button', { name: '評価 4' }))
    expect(screen.getByText('未評価')).toBeInTheDocument()

    // 専用ボタンでも戻せる(トグルだけでは戻せると気付けない)
    await user.click(screen.getByRole('button', { name: '評価 3' }))
    await user.click(screen.getByRole('button', { name: '未評価に戻す' }))
    expect(screen.getByText('未評価')).toBeInTheDocument()

    await user.click(save())
    expect(firstArg(onSubmit).rating).toBeNull()
  })

  it('0 のボタンは無い（未評価は 0 点ではない）', () => {
    renderForm()
    expect(screen.queryByRole('button', { name: '評価 0' })).toBeNull()
  })
})

describe('日付', () => {
  it('既定は今日で、そのまま保存できる', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    expect(screen.getByLabelText('年')).toHaveValue('2020')
    expect(screen.getByLabelText('月')).toHaveValue('2')
    expect(screen.getByLabelText('日')).toHaveValue('3')

    await user.click(save())
    expect(firstArg(onSubmit).drankOn).toBe(TODAY)
  })

  it('OS 既定の日付入力・セレクトを使わない', () => {
    renderForm()
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(0)
    expect(document.querySelectorAll('select')).toHaveLength(0)
  })

  it('成立していない日付では保存せず、日付欄の隣で理由を言う', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    await user.clear(screen.getByLabelText('月'))
    // 打ちかけの状態でも「まだ日付でない」ことは先に出る
    expect(screen.getByText(/日付になっていない/)).toBeInTheDocument()

    await user.click(save())

    expect(onSubmit).not.toHaveBeenCalled()
    // **近い日付に補正しない**(本人が意図しない日付が黙って保存されるのが最悪)
    expect(screen.getByText(/日付が成立していないので保存できない/)).toBeInTheDocument()

    await user.type(screen.getByLabelText('月'), '2')
    expect(screen.queryByText(/日付が成立していないので保存できない/)).toBeNull()
    await user.click(save())
    expect(firstArg(onSubmit).drankOn).toBe(TODAY)
  })

  it('実在しない日付は保存しない（2月30日を3月2日に繰り上げない）', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    await user.clear(screen.getByLabelText('日'))
    await user.type(screen.getByLabelText('日'), '30')
    await user.click(save())

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('未来日付は注意だけ出して保存できる（時計ずれで正しい記録を止めない）', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    await user.click(screen.getByRole('button', { name: '翌日' }))

    expect(screen.getByText(/今日より後の日付/)).toBeInTheDocument()
    await user.click(save())
    expect(firstArg(onSubmit).drankOn).toBe('2020-02-04')
  })

  it('前日・今日のボタンで動かせる', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    await user.click(screen.getByRole('button', { name: '前日' }))
    expect(screen.getByLabelText('日')).toHaveValue('2')
    await user.click(screen.getByRole('button', { name: '前日' }))
    expect(screen.getByLabelText('月')).toHaveValue('2')
    expect(screen.getByLabelText('日')).toHaveValue('1')

    await user.click(screen.getByRole('button', { name: '今日' }))
    await user.click(save())
    expect(firstArg(onSubmit).drankOn).toBe(TODAY)
  })

  it('IME の全角数字を受ける（打てているのに入らない、を作らない）', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({ onSubmit })

    await user.clear(screen.getByLabelText('年'))
    await user.type(screen.getByLabelText('年'), '２０２１')

    expect(screen.getByLabelText('年')).toHaveValue('2021')
    await user.click(save())
    expect(firstArg(onSubmit).drankOn).toBe('2021-02-03')
  })
})

describe('写真', () => {
  it('作れたサムネイルが下書きに入る', async () => {
    const user = userEvent.setup()
    const made = thumbnail()
    const onSubmit = vi.fn()
    renderForm({ onSubmit, resizePhoto: vi.fn<PhotoResizer>().mockResolvedValue(made) })

    await user.upload(screen.getByLabelText('写真'), new File(['bytes'], 'p.jpg', { type: 'image/jpeg' }))
    // A8 の証拠(文言の出所は PhotoPicker 側)
    expect(await screen.findByText('サムネイル 38KB / 400×533')).toBeInTheDocument()

    await user.click(save())
    expect(firstArg(onSubmit).thumbnail).toBe(made.blob)
  })

  it('生成中は保存を止める（写真なしで保存が通ると無音の取りこぼしになる）', async () => {
    const user = userEvent.setup()
    const pending = deferred<ThumbnailResult>()
    const onSubmit = vi.fn()
    renderForm({ onSubmit, resizePhoto: vi.fn<PhotoResizer>().mockReturnValue(pending.promise) })

    await user.upload(screen.getByLabelText('写真'), new File(['bytes'], 'big.jpg', { type: 'image/jpeg' }))
    await user.click(save())

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/写真をサムネイルにしている途中/)).toBeInTheDocument()

    const made = thumbnail()
    pending.resolve(made)
    expect(await screen.findByText('サムネイル 38KB / 400×533')).toBeInTheDocument()

    await user.click(save())
    expect(firstArg(onSubmit).thumbnail).toBe(made.blob)
  })

  it('失敗しても付いている写真を落とさず、文言は resize.ts のものをそのまま出す', async () => {
    const user = userEvent.setup()
    const existing = jpeg(20480)
    const onSubmit = vi.fn()
    renderForm({
      record: makeRecord({ thumbnail: existing }),
      onSubmit,
      resizePhoto: vi.fn<PhotoResizer>().mockRejectedValue(new ThumbnailError('heic', HEIC_ADVICE)),
    })

    await user.upload(
      screen.getByLabelText('写真'),
      new File(['bytes'], 'IMG_0001.HEIC', { type: 'image/heic' }),
    )

    // 文言の出所は resize.ts の1箇所。フォームは写しを持たない
    expect(await screen.findByText(HEIC_ADVICE)).toBeInTheDocument()

    await user.click(save())
    // 1回の失敗で既存の写真を失わせない
    expect(firstArg(onSubmit).thumbnail).toBe(existing)
  })
})

// ---------------------------------------------------------------------------
// OCR 補助(A?): **候補を出すだけで銘柄は決めない。**
// 認識そのものの検証は src/ui/OcrAssist/OcrAssist.test.tsx。ここで見るのは
// 「フォームの既存の経路(県・蔵元・6軸・スペック欄)に正しく合流しているか」だけ。
// ---------------------------------------------------------------------------

/** 実測と同じ形の誤読(`カ` → `力`)。`クウ` だけで `カクウ` に絞れる */
const MISREAD = '力クウ'

function ocrReads(text: string) {
  const results: OcrResult[] = [{ text, confidence: 38, source: 'horizontal' }]
  return vi.fn<LabelRecognizer>().mockResolvedValue(results)
}

/** 写真を1枚付ける(OCR の導線は原本があるときだけ出る) */
async function attachPhoto(user: ReturnType<typeof userEvent.setup>, name = 'label.jpg') {
  await user.upload(screen.getByLabelText('写真'), new File(['bytes'], name, { type: 'image/jpeg' }))
  await screen.findByText('サムネイル 38KB / 400×533')
}

function ocrButton(): HTMLElement {
  return screen.getByRole('button', { name: '写真から銘柄を探す' })
}

describe('写真から銘柄を探す（OCR 補助）', () => {
  it('写真が無いうちは導線を出さない', () => {
    renderForm()
    expect(screen.queryByRole('button', { name: '写真から銘柄を探す' })).toBeNull()
  })

  it('写真を選んでも押すまで走らせない', async () => {
    const user = userEvent.setup()
    const recognizePhoto = ocrReads(MISREAD)
    renderForm({
      resizePhoto: vi.fn<PhotoResizer>().mockResolvedValue(thumbnail()),
      recognizePhoto,
    })

    await attachPhoto(user)

    // 数秒かかる処理を、写真を選んだだけで勝手に始めない
    expect(recognizePhoto).not.toHaveBeenCalled()
    expect(ocrButton()).toBeInTheDocument()
  })

  it('候補を選ぶと県・蔵元・6軸が埋まり、手動の紐付けとして保存される', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({
      onSubmit,
      resizePhoto: vi.fn<PhotoResizer>().mockResolvedValue(thumbnail()),
      recognizePhoto: ocrReads(MISREAD),
    })

    await attachPhoto(user)
    await user.click(ocrButton())

    // 同名2件はどちらも候補に出る(県と蔵元で選び分ける)。得点が同じなら銘柄ID昇順
    const rows = await screen.findAllByRole('button', { name: 'カクウ を銘柄にする' })
    expect(rows).toHaveLength(2)

    await user.click(rows[0])

    // **既存の経路に合流している**: 手で選んだときと同じく6軸まで入る
    for (const value of CHART_VALUES) expect(screen.getByText(value)).toBeInTheDocument()
    expect(screen.getByText('手動')).toBeInTheDocument()
    // 何を入れたのかが写真の欄でも分かる(銘柄欄は画面の上にある)
    expect(screen.getByText('銘柄欄に入れた')).toBeInTheDocument()

    await user.click(save())

    const submitted = firstArg(onSubmit)
    expect(submitted.sakenowaBrandId).toBe(BRAND_A.id)
    expect(submitted.brandName).toBe('カクウ')
    // 銘柄欄が空のまま選んだときは銘柄名が入る(手で選んだときと同じ規則)
    expect(submitted.brandLabel).toBe('カクウ')
    expect(submitted.linkStatus).toBe('manual')
    expect(submitted.prefecture).toBe('甲県')
  })

  it('絞れなかったら候補を0件にして、手で選ぶ経路をそのまま使わせる', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({
      onSubmit,
      resizePhoto: vi.fn<PhotoResizer>().mockResolvedValue(thumbnail()),
      // どの銘柄とも1文字も共有しない読み取り
      recognizePhoto: ocrReads('モヤ'),
    })

    await attachPhoto(user)
    await user.click(ocrButton())

    expect(await screen.findByText(/銘柄を読み取れなかった。手で選ぶ。/)).toBeInTheDocument()
    // **もっともらしい別銘柄を出さない**
    expect(screen.queryAllByRole('button', { name: /を銘柄にする$/ })).toHaveLength(0)
    // 紐付けは何も起きていない(推定で埋めない)
    expect(screen.getByText('銘柄不明')).toBeInTheDocument()

    // 手で選ぶ経路は生きている(OCR が外れたときのコストがゼロ)
    await pickBrand(user, 'ホシ')
    await user.click(save())

    const submitted = firstArg(onSubmit)
    expect(submitted.sakenowaBrandId).toBe(BRAND_C.id)
    expect(submitted.linkStatus).toBe('manual')
  })

  it('スペックとして読んだ語は、押すまでスペック欄に書き込まない', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({
      onSubmit,
      resizePhoto: vi.fn<PhotoResizer>().mockResolvedValue(thumbnail()),
      recognizePhoto: ocrReads('カクウ純米大吟醸'),
    })

    await attachPhoto(user)
    await user.click(ocrButton())
    await screen.findByText(/スペックとして読んだ語 純米大吟醸/)

    // 読んだだけでは1文字も入らない
    expect(screen.getByLabelText('スペック')).toHaveValue('')

    // 既に打ってある内容を消さない
    await user.type(screen.getByLabelText('スペック'), '無濾過')
    await user.click(screen.getByRole('button', { name: 'スペック欄に入れる' }))

    expect(screen.getByLabelText('スペック')).toHaveValue('無濾過 純米大吟醸')

    // 2度押しても重ならない
    await user.click(screen.getByRole('button', { name: 'スペック欄に入れる' }))
    expect(screen.getByLabelText('スペック')).toHaveValue('無濾過 純米大吟醸')

    await user.click(save())
    expect(firstArg(onSubmit).spec).toBe('無濾過 純米大吟醸')
  })

  it('写真を選び直すと前の写真の候補は消える', async () => {
    const user = userEvent.setup()
    renderForm({
      resizePhoto: vi
        .fn<PhotoResizer>()
        .mockResolvedValueOnce(thumbnail())
        .mockResolvedValueOnce(thumbnail({ bytes: 20_480, width: 300, height: 400 })),
      recognizePhoto: ocrReads(MISREAD),
    })

    await attachPhoto(user)
    await user.click(ocrButton())
    expect(await screen.findAllByRole('button', { name: 'カクウ を銘柄にする' })).toHaveLength(2)

    await user.upload(
      screen.getByLabelText('写真'),
      new File(['bytes'], 'another.jpg', { type: 'image/jpeg' }),
    )
    await screen.findByText('サムネイル 20KB / 300×400')

    // 別の写真に対して前の写真の候補を出さない
    expect(screen.queryAllByRole('button', { name: /を銘柄にする$/ })).toHaveLength(0)
    expect(ocrButton()).toBeInTheDocument()
  })

  it('保存済みの写真しか無い記録では、使えない理由を書く', () => {
    renderForm({ record: makeRecord({ thumbnail: jpeg(20480) }) })

    // 長辺400pxのサムネイルに OCR をかけても読めない(仕様は変えない)
    expect(screen.getByText(/保存済みの写真は縮小済みなので文字を読み取れない/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '写真から銘柄を探す' })).toBeNull()
  })

  it('OCR を使わない経路は何も変わらない（回帰）', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const recognizePhoto = ocrReads(MISREAD)
    renderForm({
      onSubmit,
      resizePhoto: vi.fn<PhotoResizer>().mockResolvedValue(thumbnail()),
      recognizePhoto,
    })

    // 写真を付けても、手で打って候補から選ぶ経路はそのまま
    await attachPhoto(user)
    await pickBrand(user, 'カクウ')
    await user.click(save())

    expect(recognizePhoto).not.toHaveBeenCalled()
    const submitted = firstArg(onSubmit)
    expect(submitted.sakenowaBrandId).toBe(BRAND_A.id)
    expect(submitted.linkStatus).toBe('manual')
    expect(submitted.prefecture).toBe('甲県')
  })
})

describe('保存と取消', () => {
  it('保存が拒否されたら理由を出す（保存できたのか黙らせない）', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('容量が足りない'))
    renderForm({ onSubmit })

    await user.click(save())

    expect(await screen.findByText(/保存できなかった/)).toHaveTextContent('容量が足りない')
  })

  it('入力があるまま閉じると自作の確認ダイアログを出す（OS の confirm は使わない）', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm')
    const onCancel = vi.fn()
    renderForm({ onCancel })

    await user.type(screen.getByLabelText('メモ'), '打ちかけ')
    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(onCancel).not.toHaveBeenCalled()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByText(/この画面で入れた内容は保存されない/)).toBeInTheDocument()

    // 入力に戻れる(誤って破棄させない)
    await user.click(screen.getByRole('button', { name: '入力に戻る' }))
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByLabelText('メモ')).toHaveValue('打ちかけ')

    await user.click(screen.getByRole('button', { name: '取消' }))
    await user.click(screen.getByRole('button', { name: '破棄して閉じる' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('何も入れていなければ確認せずに閉じる', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    renderForm({ onCancel })

    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/この画面で入れた内容は保存されない/)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// key の既知事故(brain: 同型コンポーネントを三項で入れ替えると Fiber が再利用される)
// ---------------------------------------------------------------------------

/** 呼び側。`withKey` で `key={record.id}` を付けるかどうかだけを変える */
function EditHarness({ withKey, records }: { withKey: boolean; records: readonly SakeRecord[] }) {
  const [index, setIndex] = useState(0)
  const record = records[index]
  return (
    <>
      <button type="button" onClick={() => setIndex(1)}>
        次の記録へ
      </button>
      <RecordForm
        key={withKey ? record.id : undefined}
        record={record}
        tables={TABLES}
        today={TODAY}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    </>
  )
}

describe('編集フォームの同一性', () => {
  const RECORDS = [
    makeRecord({ id: 'record-1', place: '甲店' }),
    makeRecord({ id: 'record-2', place: '乙店' }),
  ]

  it('key を渡せば別の記録に切り替えたとき前の入力が残らない', async () => {
    const user = userEvent.setup()
    render(<EditHarness withKey records={RECORDS} />)

    await user.type(screen.getByLabelText('場所・店名'), 'に追記')
    expect(screen.getByLabelText('場所・店名')).toHaveValue('甲店に追記')

    await user.click(screen.getByRole('button', { name: '次の記録へ' }))

    expect(screen.getByLabelText('場所・店名')).toHaveValue('乙店')
  })

  it('key を渡さないと前の入力が持ち越される（既知事故。dev で警告する）', async () => {
    const user = userEvent.setup()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<EditHarness withKey={false} records={RECORDS} />)

    await user.type(screen.getByLabelText('場所・店名'), 'に追記')
    await user.click(screen.getByRole('button', { name: '次の記録へ' }))

    // **これが事故**: 別の記録を開いたのに前の記録の入力が残り、そのまま上書き保存される
    expect(screen.getByLabelText('場所・店名')).toHaveValue('甲店に追記')
    // 黙って壊れないこと(dev では言う)。これが唯一の気付き口
    expect(error).toHaveBeenCalled()
    expect(error.mock.calls.map((call) => String(call[0])).join('\n')).toMatch(/RecordForm/)
  })

  it('新規と編集で見出しが違う', () => {
    renderForm()
    expect(screen.getByRole('heading', { name: '記録を追加' })).toBeInTheDocument()

    renderForm({ record: makeRecord() })
    expect(screen.getByRole('heading', { name: '記録を編集' })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 最近飲んだ銘柄（入力を短くするための1タップ）
// ---------------------------------------------------------------------------

describe('最近飲んだ銘柄', () => {
  const RECENT = [{ brandId: BRAND_A.id, brandName: 'カクウ', lastDrankOn: '2020-01-05' }]

  it('押すと打たずに紐付き、県・蔵元・6軸が入る（サジェストと同じ受け口）', async () => {
    const user = userEvent.setup()
    renderForm({ recentBrands: RECENT })

    await user.click(screen.getByRole('button', { name: 'カクウ' }))

    expect(screen.getByText('甲県')).toBeInTheDocument()
    expect(screen.getByText('架空酒造')).toBeInTheDocument()
    for (const value of CHART_VALUES) {
      expect(screen.getByText(value)).toBeInTheDocument()
    }
  })

  // ★ 編集中に出すと、直そうとして開いた紐付けを1タップで別の銘柄にしてしまう
  it('編集のときは出さない', () => {
    renderForm({ record: makeRecord({ sakenowaBrandId: null, linkStatus: 'unlinked' }), recentBrands: RECENT })

    expect(screen.queryByText('最近飲んだ銘柄')).toBeNull()
  })

  // 選んだあとも並んでいると、押し間違いで紐付けが差し替わる
  it('銘柄を選んだら引っ込む', async () => {
    const user = userEvent.setup()
    renderForm({ recentBrands: RECENT })

    expect(screen.getByText('最近飲んだ銘柄')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'カクウ' }))

    expect(screen.queryByText('最近飲んだ銘柄')).toBeNull()
  })

  // 上流から消えた銘柄を押せる形で出すと、押しても県も蔵元も入らない紐付けができる
  it('銘柄マスタに無いものは出さない', () => {
    renderForm({ recentBrands: [{ brandId: 999999, brandName: '消えた銘柄', lastDrankOn: '2020-01-05' }] })

    expect(screen.queryByText('最近飲んだ銘柄')).toBeNull()
    expect(screen.queryByRole('button', { name: '消えた銘柄' })).toBeNull()
  })

  it('無ければ何も出さない（0件のときに見出しだけ残さない）', () => {
    renderForm({})

    expect(screen.queryByText('最近飲んだ銘柄')).toBeNull()
  })
})
