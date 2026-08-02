import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecordDetail, type NoteSource, type RecordDetailTables } from './RecordDetail.tsx'
import type { FlavorChart, SakeRecord, SakenowaBrand, SakenowaBrewery } from '../../domain/types.ts'
import { decodeFlavorTags } from '../../data/tables.ts'
import type { FlavorTagSource } from '../Timeline/flavorTagFacet.ts'

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
  handlers: {
    onEdit?: () => void
    onDelete?: () => void
    onClose?: () => void
    flavorTags?: FlavorTagSource
    notes?: NoteSource
  } = {},
) {
  render(
    <RecordDetail
      record={record}
      tables={tables}
      flavorTags={handlers.flavorTags}
      notes={handlers.notes}
      onClose={handlers.onClose ?? (() => undefined)}
      onEdit={handlers.onEdit ?? (() => undefined)}
      onDelete={handlers.onDelete ?? (() => undefined)}
    />,
  )
}

/** メモの入手経路と書き込み口。既定は「1件も無い」状態 */
function noteSource(over: Partial<NoteSource> = {}, saved: Record<string, string> = {}): NoteSource {
  return {
    textOf: (target, targetId) => saved[`${target}:${String(targetId)}`],
    onSave: vi.fn(() => Promise.resolve()),
    onDelete: vi.fn(() => Promise.resolve()),
    ...over,
  }
}

/** 味タグの入手経路。既定は「読めている」状態 */
function tagSource(over: Partial<FlavorTagSource> = {}): FlavorTagSource {
  return {
    state: {
      status: 'ready',
      value: decodeFlavorTags({
        flavorTags: { copyright: 'synthetic', rows: [[1, '華やか'], [2, 'ふくよか']] },
        brandFlavorTags: { copyright: 'synthetic', rows: [[BRAND_ID, 1, 2]] },
      }),
    },
    onNeeded: vi.fn(),
    onRetry: vi.fn(),
    ...over,
  }
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

  // `prefecture` は `?? ` だけで見ていたので、バックアップ JSON 由来の `''` では
  // 都道府県の欄が**空欄のまま**になる(他の欄は「記録なし」と書くのに1つだけ黙る)。
  // 未記入の判定は3通り(`null` / `''` / 空白のみ)を同じに扱う。
  it('県が空文字なら都道府県の欄を空欄にせず「記録なし」と出す', () => {
    renderDetail(
      makeRecord({ prefecture: '', rating: null, spec: '', place: '', note: '' }),
      makeTables(CHART),
    )
    // spec / place / note の3件 + 都道府県 = 4件(空文字を素通しすると3件のまま)
    expect(screen.getAllByText('記録なし')).toHaveLength(4)
  })

  it('県が空白のみでも同じ(spec / place / メモは埋まっているので1件だけ)', () => {
    renderDetail(makeRecord({ prefecture: '   ' }), makeTables(CHART))
    expect(screen.getAllByText('記録なし')).toHaveLength(1)
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

// 端末に入れた写真が後から読めなくなることがある(iOS の Safari では IndexedDB の Blob の
// 実体が失われる)。**壊れた画像の印だけでは「消えた」としか見えない**ので、何が起きたかを書く
describe('保存された写真を読めないとき', () => {
  it('壊れた画像の印ではなく、理由と打てる手を出す', async () => {
    const record = makeRecord({ thumbnail: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }) })
    renderDetail(record, makeTables())

    const img = await screen.findByRole('img', { hidden: true })
    fireEvent.error(img)

    expect(screen.getByText(/この端末に保存された写真を読めなかった/)).toBeInTheDocument()
    expect(screen.getByText(/次の同期で同期先から取り直す/)).toBeInTheDocument()
  })
})

// 絞り込みに「味」があるのに、絞られた記録を開いても何も書いていない状態だった(実機で指摘)。
// **絞る根拠は、絞られた側に見えていること**
describe('味タグ', () => {
  it('銘柄に付いた語を出し、絞り込みと同じものだと書く', async () => {
    renderDetail(makeRecord(), makeTables(), { flavorTags: tagSource() })

    expect(await screen.findByRole('heading', { name: '味タグ' })).toBeInTheDocument()
    expect(screen.getByText('華やか')).toBeInTheDocument()
    expect(screen.getByText('ふくよか')).toBeInTheDocument()
    expect(screen.getByText(/絞り込みの「味」はこの語で絞る/)).toBeInTheDocument()
  })

  // **並べ替えないと、どの銘柄を開いても先頭が 酸味・辛口・旨味 になる**(実データで
  // 半数以上の銘柄に付いている語なので、生の並びの先頭は銘柄を区別しない = B76)
  it('その語が付く銘柄の少ない順に並べ、件数を添える', async () => {
    // 語1は3銘柄・語2は1銘柄・語3は2銘柄に付く。この銘柄が持つのは 1,2,3 の3語
    const source = tagSource({
      state: {
        status: 'ready',
        value: decodeFlavorTags({
          flavorTags: {
            copyright: 'synthetic',
            rows: [
              [1, 'ありふれた語'],
              [2, '珍しい語'],
              [3, '中くらいの語'],
            ],
          },
          brandFlavorTags: {
            copyright: 'synthetic',
            rows: [
              [BRAND_ID, 1, 2, 3],
              [901, 1, 3],
              [902, 1],
            ],
          },
        }),
      },
    })
    renderDetail(makeRecord(), makeTables(), { flavorTags: source })

    const list = (await screen.findByRole('heading', { name: '味タグ' }))
      .closest('section')
      ?.querySelector('ul')
    if (list == null) throw new Error('味タグの一覧が無い')
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      '珍しい語1',
      '中くらいの語2',
      'ありふれた語3',
    ])
    // 添えた数の意味と分母を画面から読める(並びの理由が説明できない状態にしない)
    expect(screen.getByText(/その語が付く銘柄数/)).toBeInTheDocument()
    expect(screen.getByText(/全3銘柄中/)).toBeInTheDocument()
  })

  // 開いたときが取得の起点。起動時には取らない資源なので、ここで言わないと永久に読み込まれない
  it('開いたときに「要る」と伝える', () => {
    const onNeeded = vi.fn()
    renderDetail(makeRecord(), makeTables(), {
      flavorTags: tagSource({ state: { status: 'idle' }, onNeeded }),
    })
    expect(onNeeded).toHaveBeenCalled()
  })

  // **0件と「読めていない」を同じ見た目にしない**(推定で埋めないのと同じ規律)
  it('上流に語が無いときは、無いと言う', () => {
    renderDetail(makeRecord(), makeTables(), {
      flavorTags: tagSource({
        state: {
          status: 'ready',
          value: decodeFlavorTags({
            flavorTags: { copyright: 'synthetic', rows: [[1, '華やか']] },
            brandFlavorTags: { copyright: 'synthetic', rows: [] },
          }),
        },
      }),
    })
    expect(screen.getByText(/さけのわにこの銘柄の味タグが無い/)).toBeInTheDocument()
  })

  it('紐付いていない記録では、紐付ければ出ると言う', () => {
    renderDetail(makeRecord({ sakenowaBrandId: null, linkStatus: 'unlinked' }), makeTables(), {
      flavorTags: tagSource(),
    })
    expect(screen.getByText(/銘柄が決まっていないので味タグは引けない/)).toBeInTheDocument()
  })

  it('読み込めなかったら理由と再試行を出す', async () => {
    const onRetry = vi.fn()
    renderDetail(makeRecord(), makeTables(), {
      flavorTags: tagSource({ state: { status: 'error', message: '取れなかった' }, onRetry }),
    })
    expect(screen.getByText(/味タグを読み込めなかった/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '再試行' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('渡さなければ節ごと出さない(この画面が味タグを要求しない配線もある)', () => {
    renderDetail(makeRecord(), makeTables())
    expect(screen.queryByRole('heading', { name: '味タグ' })).not.toBeInTheDocument()
  })
})

// スペックを見ていないことを画面に書く。書かないと「純米大吟醸と本醸造で同じ値が出る」理由が
// 本人に分からない(実機で指摘された)
describe('6軸の但し書き', () => {
  it('銘柄に紐づく値で、スペックを見ていないと書く', () => {
    renderDetail(makeRecord(), makeTables(CHART))
    expect(screen.getByText(/スペック（純米大吟醸・本醸造など）は見ていない/)).toBeInTheDocument()
  })
})

// 銘柄・蔵元のメモ(B76)。**記録1件のメモとは別物**で、同じ銘柄の記録すべてに出る
describe('銘柄・蔵元のメモ', () => {
  it('銘柄と蔵元それぞれに書く欄を出す', () => {
    renderDetail(makeRecord(), makeTables(CHART), { notes: noteSource() })

    expect(screen.getByRole('heading', { name: '銘柄・蔵元のメモ' })).toBeInTheDocument()
    expect(screen.getByLabelText('カクウ（銘柄）のメモ')).toBeInTheDocument()
    expect(screen.getByLabelText('架空酒造（蔵元）のメモ')).toBeInTheDocument()
    // 記録1件のメモと混ざらないことを画面から読める
    expect(screen.getByText(/1本ごとのメモは上の「メモ」に書く/)).toBeInTheDocument()
  })

  it('保存されているメモが欄に入っている', () => {
    renderDetail(makeRecord(), makeTables(CHART), {
      notes: noteSource({}, { [`brand:${String(BRAND_ID)}`]: '保存済みの文' }),
    })
    expect(screen.getByLabelText('カクウ（銘柄）のメモ')).toHaveValue('保存済みの文')
  })

  it('書いて押すと、前後の空白を落とした本文で保存を頼む', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => Promise.resolve())
    renderDetail(makeRecord(), makeTables(CHART), { notes: noteSource({ onSave }) })

    await user.type(screen.getByLabelText('カクウ（銘柄）のメモ'), '  書いた  ')
    await user.click(screen.getAllByRole('button', { name: '保存する' })[0]!)

    expect(onSave).toHaveBeenCalledWith({ target: 'brand', targetId: BRAND_ID, text: '書いた' })
  })

  // **押していない変更を黙って捨てない。** 閉じてから気付くより先に画面で言う
  it('打っただけで押していないときは、保存していないと画面に出る', async () => {
    const user = userEvent.setup()
    renderDetail(makeRecord(), makeTables(CHART), { notes: noteSource() })

    expect(screen.queryByText('保存していない変更がある')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('カクウ（銘柄）のメモ'), 'あ')
    expect(screen.getByText('保存していない変更がある')).toBeInTheDocument()
  })

  // **空にする操作は削除に落とす。** 空文字のまま生きている行を作らない(store 側と対)
  it('空にしただけでは保存を押せず、消し方を画面で言う', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => Promise.resolve())
    renderDetail(makeRecord(), makeTables(CHART), {
      notes: noteSource({ onSave }, { [`brand:${String(BRAND_ID)}`]: '書いてある' }),
    })

    await user.clear(screen.getByLabelText('カクウ（銘柄）のメモ'))
    expect(screen.getByText(/空にするだけでは消えない/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '保存する' })[0]).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('「消す」は保存されているときだけ出る', () => {
    renderDetail(makeRecord(), makeTables(CHART), { notes: noteSource() })
    expect(screen.queryByRole('button', { name: '消す' })).not.toBeInTheDocument()

    renderDetail(makeRecord({ id: 'r2' }), makeTables(CHART), {
      notes: noteSource({}, { [`brand:${String(BRAND_ID)}`]: 'ある' }),
    })
    expect(screen.getAllByRole('button', { name: '消す' }).length).toBeGreaterThan(0)
  })

  // **保存に失敗したうえに書いた文まで失う、をしない**
  it('保存に失敗したら理由を出し、打った文字を消さない', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(() => Promise.reject(new Error('容量が足りない')))
    renderDetail(makeRecord(), makeTables(CHART), { notes: noteSource({ onSave }) })

    const field = screen.getByLabelText('カクウ（銘柄）のメモ')
    await user.type(field, '消えたら困る')
    await user.click(screen.getAllByRole('button', { name: '保存する' })[0]!)

    expect(await screen.findByRole('alert')).toHaveTextContent('容量が足りない')
    expect(field).toHaveValue('消えたら困る')
  })

  // 宛先の銘柄が決まらないと書いても行き場が無い(`unlinked` に推定値を埋めないのと同じ規律)
  it('紐付いていない記録では書けず、紐付ければ書けると言う', () => {
    renderDetail(
      makeRecord({ sakenowaBrandId: null, brandName: null, linkStatus: 'unlinked' }),
      makeTables(CHART),
      { notes: noteSource() },
    )

    expect(screen.getByText(/銘柄が決まっていないのでメモの置き場が無い/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /のメモ/ })).not.toBeInTheDocument()
  })

  it('渡さなければ節ごと出さない', () => {
    renderDetail(makeRecord(), makeTables(CHART))
    expect(screen.queryByRole('heading', { name: '銘柄・蔵元のメモ' })).not.toBeInTheDocument()
  })
})
