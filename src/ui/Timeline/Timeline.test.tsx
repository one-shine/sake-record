// 時系列リストのテスト。**投入データは全部合成**(架空の銘柄・架空の店・架空の日付)。
// 実際の飲酒記録(日付と銘柄の対・店名・備考)はテストコードに転記しない。日付の種類も
// 意図的に3種だけに抑え、**実台帳の範囲外の年**にしている — 合成の日付が偶然実台帳の日付と
// 一致すると、同じ行にある県名と組んで「日付 × 県」の結合キーに見えてしまう
// (実際に 2024/2022 の合成日付が台帳の日付と衝突していた。`npm run ledger:check` が見張る)。
//
// このファイルが固定している事故は5つ:
//  1. **DOM 行数 = 表示対象の件数**。とくに同日・同銘柄の2件が2行として描かれ、
//     **絞り込みで落ちるときに片方が DOM に取り残されない**こと
//     (`key` を `drankOn + brandLabel` にすると「ストアの件数と画面の行数が食い違う」。
//      実際に key を差し替えて行数の assert が赤くなることを確認した)
//  2. `linkStatus` 5種のバッジが別々のラベルで出て、**表に無い値は unknown に格下げされる**
//  3. 検索・絞り込みで件数が変わり、**0件のときに全件へ戻らず「該当なし」を出す**
//  4. 空状態が導線2つ(取り込み / 1本目の記録)を出す
//  5. 日本語ラベルの折り返しを**対で**直してある(バッジに nowrap / 包む行に flex-wrap)
//
// 期待値は実装から import せずリテラルで書く(定数を書き換えても緑のままになる恒真テストを
// 作らない。BACKLOG B15 で実際に踏んだ)。

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LINK_STATUSES } from '../../domain/backupSchema.ts'
import type { LinkStatus, SakeRecord } from '../../domain/types.ts'
import { LINK_STATUS_BADGES, LINK_STATUS_ORDER } from './linkStatus.ts'
import { RecordCard } from './RecordCard.tsx'
import { Timeline } from './Timeline.tsx'

/** バッジのラベルはライセンス表記と同じで「実装の設定値」ではなく仕様なのでリテラルで持つ */
const EXPECTED_BADGE_LABELS: Record<LinkStatus, string> = {
  auto: '自動',
  alias: '別名',
  manual: '手動',
  unlinked: '未紐付け',
  unknown: '銘柄不明',
}

function rec(over: Partial<SakeRecord> & { id: string }): SakeRecord {
  return {
    drankOn: '2019-05-01',
    brandLabel: 'テスト酒',
    sakenowaBrandId: null,
    brandName: null,
    linkStatus: 'unlinked',
    prefecture: null,
    spec: '',
    rating: null,
    place: '',
    note: '',
    thumbnail: null,
    sourceNo: null,
    createdAt: '2019-05-01T00:00:00.000Z',
    updatedAt: '2019-05-01T00:00:00.000Z',
    ...over,
  }
}

const noop = () => {}

function renderTimeline(records: readonly SakeRecord[], onSelect?: (r: SakeRecord) => void) {
  return render(
    <Timeline records={records} onImport={noop} onCreate={noop} onSelect={onSelect} />,
  )
}

/** 行は `<li>`。0件でも例外を投げないように queryAll を使う */
function rows(): HTMLElement[] {
  return screen.queryAllByRole('listitem')
}

/** 絞り込みピルはパネルを開くまで描かれない(閉じている間はバッジのラベルと衝突しない) */
async function openFacets(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '絞り込み' }))
}

describe('Timeline の行数', () => {
  it('投入した件数だけ行を描く', () => {
    renderTimeline([
      rec({ id: 'r1' }),
      rec({ id: 'r2', drankOn: '2018-08-09' }),
      rec({ id: 'r3', drankOn: '2017-03-04' }),
    ])
    expect(rows()).toHaveLength(3)
    expect(screen.getByText('全 3本')).toBeInTheDocument()
  })

  // 実データで踏む事故: 同日・同銘柄の2件(表/裏ラベルとして2本に数えている組)は
  // 内容では区別できない。key を `drankOn + brandLabel` にすると key が衝突し、
  // ストアの件数表示は正しいまま画面の行数だけずれる。
  //
  // **初回描画だけでは捕まらない**: React は key が重複していても初回は両方描き、
  // console.error に「同じ key の子が2つ」を出すだけ。
  //
  // **行数で捕まえるには「衝突した2件が絞り込みで落ちる」操作でなければならない。**
  // 重複 key の行が表示対象から外れると、React は片方しか見つけられず**もう片方を
  // DOM に取り残す**(実測: 3件のうち双子2件が落ちる絞り込みで、1行のはずが2行・
  // 解除後は3行のはずが4行)。逆に双子が残る絞り込みや全件に一致する検索語では
  // 行数がずれないので、そこで数えても検出は console.error の文面依存になる
  // (dev ビルド限定の警告が変わった瞬間に無検査になる)。
  //
  // したがってこのテストは**双子を除外する検索語**で 3 → 1 → 3 を数える。
  // 警告の監視も残すが、それは補助(mutation で確認済み: key を日付+銘柄にすると
  // 行数の2つの assert が両方落ちる)。
  it('同日・同銘柄で内容も同じ2件を、2行として描く（key が record.id である回帰）', async () => {
    const user = userEvent.setup()
    const twin = (id: string, sourceNo: number): SakeRecord =>
      rec({
        id,
        sourceNo,
        drankOn: '2019-05-01',
        brandLabel: 'テスト酒',
        brandName: 'テスト酒',
        linkStatus: 'alias',
        prefecture: '福島県',
        createdAt: `2019-05-01T00:00:0${String(sourceNo)}.000Z`,
      })
    // 絞り込みで**残る**1件。双子と部分一致しない銘柄にする(でないと双子が落ちない)
    const other = rec({ id: 'other', brandLabel: 'サンプル酒', brandName: 'サンプル酒' })

    const logged: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => String(arg)).join(' '))
    })
    try {
      renderTimeline([twin('twin-1', 1), twin('twin-2', 2), other])
      expect(rows()).toHaveLength(3)
      expect(screen.getByText('全 3本')).toBeInTheDocument()

      // 双子だけが落ちる検索語 = 衝突した key の行が表示対象から外れる再描画
      const box = screen.getByRole('searchbox')
      await user.type(box, 'サンプル酒')
      expect(rows()).toHaveLength(1)
      expect(screen.getByText('該当 1本 / 全 3本')).toBeInTheDocument()

      // 解除して戻す(取り残された行があればここで4行になる)
      await user.clear(box)
      expect(rows()).toHaveLength(3)
      expect(screen.getByText('全 3本')).toBeInTheDocument()

      expect(logged.join('\n')).toBe('')
    } finally {
      spy.mockRestore()
    }
  })

  it('呼び側の配列順に依存せず新しい順に並べる', () => {
    renderTimeline([
      rec({ id: 'mid', drankOn: '2018-08-09', createdAt: '2018-08-09T00:00:00.000Z' }),
      rec({ id: 'old', drankOn: '2017-03-04', createdAt: '2017-03-04T00:00:00.000Z' }),
      rec({ id: 'new', drankOn: '2019-05-01', createdAt: '2019-05-01T00:00:00.000Z' }),
    ])
    const dates = rows().map((row) => within(row).getByText(/^\d{4}-\d{2}-\d{2}$/).textContent)
    expect(dates).toEqual(['2019-05-01', '2018-08-09', '2017-03-04'])
  })
})

describe('linkStatus のバッジ', () => {
  it('5種が別々のラベルで出る', () => {
    renderTimeline(
      LINK_STATUS_ORDER.map((linkStatus, index) =>
        rec({ id: `s${String(index)}`, linkStatus, brandLabel: `テスト酒${String(index)}` }),
      ),
    )
    expect(rows()).toHaveLength(5)
    for (const linkStatus of LINK_STATUS_ORDER) {
      expect(screen.getByText(EXPECTED_BADGE_LABELS[linkStatus])).toBeInTheDocument()
    }
  })

  it('対応表は linkStatus の実行時列挙5値を漏れなく覆い、ラベルが重複しない', () => {
    // 「表示順の表」と「domain 側の実行時列挙」は別の出所なので、この比較は恒真にならない
    expect([...LINK_STATUS_ORDER].sort()).toEqual([...LINK_STATUSES].sort())
    const labels = LINK_STATUS_ORDER.map((linkStatus) => LINK_STATUS_BADGES[linkStatus].label)
    expect(labels).toEqual(LINK_STATUS_ORDER.map((s) => EXPECTED_BADGE_LABELS[s]))
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('manual は本人の判断であることが分かる（説明に「本人」が入る）', () => {
    render(<RecordCard record={rec({ id: 'm', linkStatus: 'manual' })} />)
    expect(screen.getByText('手動').getAttribute('title')).toContain('本人')
  })

  it('表に無い値は unknown へ格下げする（確信度を上げる方向に丸めない）', () => {
    render(<RecordCard record={rec({ id: 'bad', linkStatus: 'bogus' as LinkStatus })} />)
    expect(screen.getByText('銘柄不明')).toBeInTheDocument()
  })

  it('折り返しは対で直してある: バッジに nowrap、包む行に flex-wrap', () => {
    render(<RecordCard record={rec({ id: 'w', linkStatus: 'unlinked' })} />)
    const badge = screen.getByText('未紐付け')
    expect(badge.className).toContain('whitespace-nowrap')
    expect(badge.parentElement?.className).toContain('flex-wrap')
  })
})

describe('RecordCard の1件表示', () => {
  it('銘柄名はさけのわ由来を優先し、記録した生の表記も併記する', () => {
    render(
      <RecordCard
        record={rec({ id: 'a', brandLabel: 'テスト別名', brandName: 'テスト正名', linkStatus: 'alias' })}
      />,
    )
    expect(screen.getByText('テスト正名')).toBeInTheDocument()
    expect(screen.getByText(/記録の表記: テスト別名/)).toBeInTheDocument()
  })

  it('紐付いていない記録は記録した表記をそのまま出す（併記はしない）', () => {
    render(<RecordCard record={rec({ id: 'b', brandLabel: 'テスト酒', brandName: null })} />)
    expect(screen.getByText('テスト酒')).toBeInTheDocument()
    expect(screen.queryByText(/記録の表記/)).not.toBeInTheDocument()
  })

  it('写真が無い記録はプレースホルダを出す（203本は写真が1枚も無い）', () => {
    render(<RecordCard record={rec({ id: 'c' })} />)
    expect(screen.getByText('写真なし')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('写真がある記録は width/height 属性付きの img を出す', () => {
    // jsdom は URL.createObjectURL を実装していないので差し替える(実装側もこれが無い環境では
    // 例外を投げずプレースホルダに落ちる)
    Object.assign(URL, {
      createObjectURL: () => 'blob:test-thumbnail',
      revokeObjectURL: () => {},
    })
    render(<RecordCard record={rec({ id: 'd', thumbnail: new Blob(['x'], { type: 'image/jpeg' }) })} />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('width', '64')
    expect(img).toHaveAttribute('height', '64')
    expect(img).toHaveAttribute('src', 'blob:test-thumbnail')
    // width/height 属性を付けたら高さは CSS 側で決める(付けっぱなしだと縦に伸びる)
    expect(img.className).toContain('h-16')
  })

  it('評価と場所は入っているときだけ出す', () => {
    render(<RecordCard record={rec({ id: 'e', rating: 4, place: '架空バー' })} />)
    expect(screen.getByText('評価 4')).toBeInTheDocument()
    expect(screen.getByText('架空バー')).toBeInTheDocument()
  })

  it('onSelect を渡さない行は押せる要素を持たない', () => {
    renderTimeline([rec({ id: 'f' })])
    expect(within(rows()[0]).queryAllByRole('button')).toHaveLength(0)
  })

  it('onSelect を渡すと行を押してその1件が渡る', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const record = rec({ id: 'g', brandLabel: 'テスト酒' })
    renderTimeline([record], onSelect)
    await user.click(within(rows()[0]).getByRole('button'))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(record)
  })
})

describe('検索', () => {
  const records = [
    rec({ id: 'q1', brandLabel: 'テスト甲', place: '架空バー', note: 'メモ甲' }),
    rec({
      id: 'q2',
      drankOn: '2018-08-09',
      brandLabel: 'テスト乙',
      brandName: 'テスト正名',
      place: '自宅',
      note: 'メモ乙',
    }),
    rec({ id: 'q3', drankOn: '2017-03-04', brandLabel: 'テスト丙', place: '自宅', note: '' }),
  ]

  it('銘柄の部分一致で絞る（さけのわの銘柄名でも記録した表記でも当たる）', async () => {
    const user = userEvent.setup()
    renderTimeline(records)
    const box = screen.getByRole('searchbox', { name: '銘柄・場所・メモを検索' })

    await user.type(box, 'テスト乙')
    expect(rows()).toHaveLength(1)
    expect(screen.getByText('該当 1本 / 全 3本')).toBeInTheDocument()

    await user.clear(box)
    await user.type(box, 'テスト正名')
    expect(rows()).toHaveLength(1)
  })

  it('場所とメモの部分一致で絞る', async () => {
    const user = userEvent.setup()
    renderTimeline(records)
    const box = screen.getByRole('searchbox')

    await user.type(box, '架空バー')
    expect(rows()).toHaveLength(1)

    await user.clear(box)
    await user.type(box, 'メモ')
    expect(rows()).toHaveLength(2)
  })

  it('1件も当たらないときは「該当なし」を出し、全件へ戻さない', async () => {
    const user = userEvent.setup()
    renderTimeline(records)
    await user.type(screen.getByRole('searchbox'), '当たらない語')
    expect(rows()).toHaveLength(0)
    expect(screen.getByText('該当なし')).toBeInTheDocument()
    expect(screen.getByText('該当 0本 / 全 3本')).toBeInTheDocument()
  })
})

describe('絞り込み', () => {
  const records = [
    rec({ id: 'f1', drankOn: '2019-05-01', prefecture: '福島県', linkStatus: 'auto' }),
    rec({ id: 'f2', drankOn: '2019-05-01', prefecture: '福島県', linkStatus: 'alias' }),
    rec({ id: 'f3', drankOn: '2017-03-04', prefecture: '山形県', linkStatus: 'auto' }),
    rec({ id: 'f4', drankOn: '2017-03-04', prefecture: null, linkStatus: 'unknown' }),
  ]

  it('年のピルで件数が変わり、押し直すと解除される', async () => {
    const user = userEvent.setup()
    renderTimeline(records)
    await openFacets(user)

    await user.click(screen.getByRole('button', { name: /^2019年 2$/ }))
    expect(rows()).toHaveLength(2)
    expect(screen.getByText('該当 2本 / 全 4本')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^2019年 2$/ }))
    expect(rows()).toHaveLength(4)
    expect(screen.getByText('全 4本')).toBeInTheDocument()
  })

  it('都道府県のピルで絞れる。県が無い記録は「県なし」で選べる', async () => {
    const user = userEvent.setup()
    renderTimeline(records)
    await openFacets(user)

    await user.click(screen.getByRole('button', { name: /^福島県 2$/ }))
    expect(rows()).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: /^福島県 2$/ }))
    await user.click(screen.getByRole('button', { name: /^県なし 1$/ }))
    expect(rows()).toHaveLength(1)
  })

  it('紐付けのピルで絞れる', async () => {
    const user = userEvent.setup()
    renderTimeline(records)
    await openFacets(user)

    await user.click(screen.getByRole('button', { name: /^自動 2$/ }))
    expect(rows()).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: /^自動 2$/ }))
    await user.click(screen.getByRole('button', { name: /^銘柄不明 1$/ }))
    expect(rows()).toHaveLength(1)
  })

  it('組み合わせが0件なら「該当なし」を出し、条件を解除すると全件に戻る', async () => {
    const user = userEvent.setup()
    renderTimeline(records)
    await openFacets(user)

    await user.click(screen.getByRole('button', { name: /^2019年 2$/ }))
    await user.click(screen.getByRole('button', { name: /^山形県 1$/ }))
    expect(rows()).toHaveLength(0)
    expect(screen.getByText('該当なし')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: '条件を解除' })[0])
    expect(rows()).toHaveLength(4)
    expect(screen.getByText('全 4本')).toBeInTheDocument()
  })

  it('パネルを閉じても効いている絞り込みがチップで見える（隠れた条件を作らない）', async () => {
    const user = userEvent.setup()
    renderTimeline(records)
    await openFacets(user)
    await user.click(screen.getByRole('button', { name: /^2019年 2$/ }))
    await user.click(screen.getByRole('button', { name: '絞り込み' })) // 閉じる

    expect(screen.queryByRole('button', { name: /^2019年 2$/ })).not.toBeInTheDocument()
    const chip = screen.getByRole('button', { name: '2019年 の絞り込みを解除' })
    expect(rows()).toHaveLength(2)

    await user.click(chip)
    expect(rows()).toHaveLength(4)
  })
})

describe('空状態', () => {
  it('取り込みと1本目の記録の導線2つを出す', async () => {
    const user = userEvent.setup()
    const onImport = vi.fn()
    const onCreate = vi.fn()
    render(<Timeline records={[]} onImport={onImport} onCreate={onCreate} />)

    expect(screen.getByText('まだ1本も記録が無い')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'JSON を取り込む' }))
    await user.click(screen.getByRole('button', { name: '1本目を記録する' }))
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('0本のときは検索欄も絞り込みも出さない（押しても意味が無いので）', () => {
    render(<Timeline records={[]} onImport={noop} onCreate={noop} />)
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '絞り込み' })).not.toBeInTheDocument()
  })
})
