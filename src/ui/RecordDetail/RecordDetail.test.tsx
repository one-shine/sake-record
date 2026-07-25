import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecordDetail, type RecordDetailTables } from './RecordDetail.tsx'
import type { FlavorChart, SakeRecord, SakenowaBrand, SakenowaBrewery } from '../../domain/types.ts'

// **合成データだけを使う。** 実際の飲酒記録(日付と銘柄の対・店名・備考)はテストに転記しない
// (`data/seed/` は gitignore 済み。fixture に写すと public リポジトリに台帳が漏れる)。
// 日付は架空の1種、銘柄・蔵元・県名も架空の文字列にしてある。

const BRAND_ID = 900001
const BREWERY_ID = 800001

const BRAND: SakenowaBrand = { id: BRAND_ID, name: 'カクウ', breweryId: BREWERY_ID }
const BREWERY: SakenowaBrewery = { id: BREWERY_ID, name: '架空酒造', areaId: 7 }

/** 6軸の値は互いに異なり、他の項目(評価・日付)と重ならない2桁にしてある */
const CHART: FlavorChart = { brandId: BRAND_ID, f1: 72, f2: 64, f3: 31, f4: 58, f5: 43, f6: 66 }
const CHART_VALUES = ['72', '64', '31', '58', '43', '66']
const AXIS_LABELS = ['華やか', '芳醇', '重厚', '穏やか', 'ドライ', '軽快']

function makeRecord(over: Partial<SakeRecord> = {}): SakeRecord {
  return {
    id: 'record-1',
    drankOn: '2020-01-01',
    brandLabel: 'かくう',
    sakenowaBrandId: BRAND_ID,
    brandName: 'カクウ',
    linkStatus: 'auto',
    prefecture: '架空県',
    spec: '純米大吟醸',
    rating: null,
    place: '架空の店',
    note: '合成のメモ',
    thumbnail: null,
    sourceNo: null,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    ...over,
  }
}

/** チャートを渡さなければ「銘柄はあるがチャートが無い」テーブルになる(ビキニ娘 id2020 のケース) */
function makeTables(chart?: FlavorChart): RecordDetailTables {
  return {
    brandById: new Map([[BRAND.id, BRAND]]),
    breweryById: new Map([[BREWERY.id, BREWERY]]),
    flavorChartByBrandId: chart === undefined ? new Map() : new Map([[chart.brandId, chart]]),
  }
}

function renderDetail(
  record: SakeRecord,
  tables: RecordDetailTables,
  handlers: { onEdit?: () => void; onDelete?: () => void; onClose?: () => void } = {},
) {
  render(
    <RecordDetail
      record={record}
      tables={tables}
      onClose={handlers.onClose ?? (() => undefined)}
      onEdit={handlers.onEdit ?? (() => undefined)}
      onDelete={handlers.onDelete ?? (() => undefined)}
    />,
  )
}

/** 「フレーバー」見出しを含む節。未取得のときここに数字が1つも無いことを見張る */
function flavorSection(): HTMLElement {
  const section = screen.getByRole('heading', { name: 'フレーバー' }).closest('section')
  if (section === null) throw new Error('フレーバー節が見つからない')
  return section
}

describe('RecordDetail', () => {
  it('紐付け済みでチャートがあるとフレーバー6軸の値を出す', () => {
    renderDetail(makeRecord(), makeTables(CHART))

    for (const label of AXIS_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    for (const value of CHART_VALUES) {
      expect(screen.getByText(value)).toBeInTheDocument()
    }
    // 銘柄 → 蔵 の逆引きも1件だけ引く(定義域外で全件に落ちない)
    expect(screen.getByText('架空酒造')).toBeInTheDocument()
    expect(screen.queryByText('フレーバー未取得')).not.toBeInTheDocument()
  })

  it('unlinked では「フレーバー未取得」を出し、数値を1つも出さない', () => {
    // テーブルにはチャートを入れておく。**紐付いていない記録が名前や既定値でチャートを
    // 拾ってしまう実装**(全件フォールバック)ならここで数値が出て赤くなる。
    renderDetail(
      makeRecord({ sakenowaBrandId: null, brandName: null, linkStatus: 'unlinked' }),
      makeTables(CHART),
    )

    expect(screen.getByText('フレーバー未取得')).toBeInTheDocument()
    expect(screen.getByText(/さけのわの銘柄に紐付いていない/)).toBeInTheDocument()
    for (const label of AXIS_LABELS) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
    for (const value of CHART_VALUES) {
      expect(screen.queryByText(value)).not.toBeInTheDocument()
    }
    // 説明文の中の数字も許さない(「6軸」「1本」も軸の値と読めてしまう)
    expect(flavorSection().textContent ?? '').not.toMatch(/\d/)
    // 蔵元も推定しない(銘柄が決まっていないので引けない)
    expect(screen.queryByText('架空酒造')).not.toBeInTheDocument()
  })

  it('紐付け済みでもチャートが無ければ「フレーバー未取得」になり、理由は未紐付けと別文になる', () => {
    // ビキニ娘(id2020)のケース: brandId は引けるが flavorCharts に行が無い。
    // 紐付け済み(186) ≠ フレーバー取得済み(185) の区別を画面でも保つ。
    renderDetail(makeRecord({ linkStatus: 'auto' }), makeTables())

    expect(screen.getByText('フレーバー未取得')).toBeInTheDocument()
    expect(screen.getByText(/フレーバーデータが無い/)).toBeInTheDocument()
    expect(screen.queryByText(/紐付いていない/)).not.toBeInTheDocument()
    for (const value of CHART_VALUES) {
      expect(screen.queryByText(value)).not.toBeInTheDocument()
    }
    expect(flavorSection().textContent ?? '').not.toMatch(/\d/)
    // 紐付いてはいるので蔵元は出る(未取得なのはフレーバーだけ)
    expect(screen.getByText('架空酒造')).toBeInTheDocument()
  })

  it('unknown は「銘柄が判読できていない」を理由に出す(未登録とは別の状態)', () => {
    renderDetail(
      makeRecord({ sakenowaBrandId: null, brandName: null, linkStatus: 'unknown' }),
      makeTables(CHART),
    )

    expect(screen.getByText('フレーバー未取得')).toBeInTheDocument()
    expect(screen.getByText(/銘柄が判読できていない/)).toBeInTheDocument()
  })

  it('brandName が null なら brandLabel を見出しに使う', () => {
    renderDetail(
      makeRecord({
        brandName: null,
        brandLabel: '架空酒',
        sakenowaBrandId: null,
        linkStatus: 'unlinked',
      }),
      makeTables(),
    )

    expect(screen.getByRole('heading', { name: '架空酒' })).toBeInTheDocument()
    // 見出しが原本そのものなので「記録の表記」の重複行は出さない
    expect(screen.queryByText(/記録の表記/)).not.toBeInTheDocument()
  })

  it('brandName が本人の表記と違うときは原本も併記する', () => {
    renderDetail(makeRecord({ brandName: 'カクウ', brandLabel: 'かくう' }), makeTables(CHART))

    expect(screen.getByRole('heading', { name: 'カクウ' })).toBeInTheDocument()
    expect(screen.getByText('記録の表記: かくう')).toBeInTheDocument()
  })

  it('linkStatus のバッジは Timeline と同じ対応表(単一の真実源)から引く', () => {
    renderDetail(makeRecord({ linkStatus: 'alias' }), makeTables(CHART))
    expect(screen.getByText('別名')).toBeInTheDocument()

    // 未紐付けは格下げ側のラベル。Timeline の行と詳細で同じ語が出る
    renderDetail(
      makeRecord({ id: 'record-2', sakenowaBrandId: null, linkStatus: 'unlinked' }),
      makeTables(CHART),
    )
    expect(screen.getByText('未紐付け')).toBeInTheDocument()
  })

  it('未評価・未記入は空欄でなく「記録なし」「未評価」と出す', () => {
    renderDetail(makeRecord({ rating: null, spec: '', place: '', note: '' }), makeTables(CHART))

    expect(screen.getByText('未評価')).toBeInTheDocument()
    expect(screen.getAllByText('記録なし')).toHaveLength(3)
  })

  it('評価があれば5段階の分母つきで出す', () => {
    renderDetail(makeRecord({ rating: 4 }), makeTables(CHART))
    expect(screen.getByText('4 / 5')).toBeInTheDocument()
  })

  it('削除は確認ダイアログを経てから onDelete を呼ぶ(OS の confirm は使わない)', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    const record = makeRecord()
    renderDetail(record, makeTables(CHART), { onDelete })

    await user.click(screen.getByRole('button', { name: '削除' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByText(/取り消せない/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '削除する' }))
    expect(onDelete).toHaveBeenCalledWith(record)
  })

  it('確認をやめると削除ダイアログが閉じる', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderDetail(makeRecord(), makeTables(CHART), { onDelete })

    await user.click(screen.getByRole('button', { name: '削除' }))
    await user.click(screen.getByRole('button', { name: 'やめる' }))

    expect(screen.queryByText(/取り消せない/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '削除' })).toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('編集と閉じるは親に渡すだけ(この画面はフォームも開閉機構も持たない)', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    const onClose = vi.fn()
    const record = makeRecord()
    renderDetail(record, makeTables(CHART), { onEdit, onClose })

    await user.click(screen.getByRole('button', { name: '編集' }))
    expect(onEdit).toHaveBeenCalledWith(record)

    await user.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('日付は和文で出し、machine 可読な datetime を保つ', () => {
    renderDetail(makeRecord({ drankOn: '2020-01-01' }), makeTables(CHART))

    expect(screen.getByText('2020年1月1日')).toHaveAttribute('datetime', '2020-01-01')
  })
})
