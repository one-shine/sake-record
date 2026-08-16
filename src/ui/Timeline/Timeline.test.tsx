// 時系列リストのテスト。**投入データは全部合成**(架空の銘柄・架空の店・架空の日付)。
// 実際の飲酒記録(日付と銘柄の対・店名・備考)はテストコードに転記しない。日付の種類も
// 意図的に3種だけに抑え、**実台帳の範囲外の年**にしている — 合成の日付が偶然実台帳の日付と
// 一致すると、同じ行にある県名と組んで「日付 × 県」の結合キーに見えてしまう
// (実際に 2024/2022 の合成日付が台帳の日付と衝突していた。`npm run ledger:check` が見張る)。
//
// このファイルが固定している事故は7つ:
//  1. **DOM 行数 = 表示対象の件数**。とくに同日・同銘柄の2件が2行として描かれ、
//     **絞り込みで落ちるときに片方が DOM に取り残されない**こと
//     (`key` を `drankOn + brandLabel` にすると「ストアの件数と画面の行数が食い違う」。
//      実際に key を差し替えて行数の assert が赤くなることを確認した)
//  2. `linkStatus` 5種のバッジが別々のラベルで出て、**表に無い値は unknown に格下げされる**
//  3. 検索・絞り込みで件数が変わり、**0件のときに全件へ戻らず「該当なし」を出す**
//  4. 空状態が導線2つ(取り込み / 1本目の記録)を出す
//  5. 日本語ラベルの折り返しを**対で**直してある(バッジに nowrap / 包む行に flex-wrap)
//  6. **ピルの件数を Timeline が数えない**(`counts` prop で渡した数がそのまま出る)。
//     スタイル語と評価の件数は統計タブにも出る同じ数字なので、2箇所で数えるとドリフトする(A10)
//  7. **絞り込みにならない軸を出さない**(空でないバケツが1つの排他軸は行ごと消える)。
//     重複計上の軸(スペック)はバケツ1つでも残る — 押せば真部分集合になるので行き止まりでない
//
// 期待値は実装から import せずリテラルで書く(定数を書き換えても緑のままになる恒真テストを
// 作らない。BACKLOG B15 で実際に踏んだ)。**`counts` もリテラルで組む** —
// `computeStats(records)` から作ると「画面が出す件数 = 実装が数えた件数」の恒真比較になる。

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { decodeFlavorTags, type DecodedFlavorTags } from '../../data/tables.ts'
import { LINK_STATUSES } from '../../domain/backupSchema.ts'
import type { RatingCount, StyleCount } from '../../domain/stats.ts'
import type { LinkStatus, Rating, SakeRecord } from '../../domain/types.ts'
import type { FlavorTagState } from './flavorTagFacet.ts'
import { LINK_STATUS_BADGES, LINK_STATUS_ORDER } from './linkStatus.ts'
import { RecordCard } from './RecordCard.tsx'
import { Timeline, type FlavorTagSource, type TimelineCounts } from './Timeline.tsx'

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

/** 評価の5段。**0件でも5行返る**(`computeStats` の約束)。ピル側は0件の段を落とす */
function noRatings(): RatingCount[] {
  return [
    { rating: 1, count: 0 },
    { rating: 2, count: 0 },
    { rating: 3, count: 0 },
    { rating: 4, count: 0 },
    { rating: 5, count: 0 },
  ]
}

/**
 * 件数 prop。**既定は全0**(スタイル語も評価もピルが出ない = 件数を要らないテストは今までどおり)。
 * 件数を要るテストだけがリテラルで渡す。**`computeStats` から作らない** — 画面が出す件数を
 * 実装が数えた件数と比べても恒真になる(B15)。
 */
function counts(over: Partial<TimelineCounts> = {}): TimelineCounts {
  return { styles: [], ratings: noRatings(), unratedCount: 0, ...over }
}

function renderTimeline(
  records: readonly SakeRecord[],
  onSelect?: (r: SakeRecord) => void,
  over: Partial<TimelineCounts> = {},
  flavorTags?: FlavorTagSource,
) {
  return render(
    <Timeline
      records={records}
      counts={counts(over)}
      onImport={noop}
      onCreate={noop}
      onSelect={onSelect}
      flavorTags={flavorTags}
    />,
  )
}

/** スタイル語の件数をリテラルで組む(型が `StyleTerm` を要求するので綴り違いはコンパイルで落ちる) */
function styleCounts(...entries: StyleCount[]): StyleCount[] {
  return entries
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

  // **一覧でも名前が空になっていた(B37)。** バッジは「銘柄不明」と言うのに名前の欄は空白で、
  // 同じ状態が画面ごとに別の見え方をしていた
  it('銘柄の無い記録でも名前の欄が空にならない', () => {
    render(<RecordCard record={rec({ id: 'u', brandLabel: '', brandName: null, linkStatus: 'unknown' })} />)

    expect(screen.getByText('銘柄不明の記録')).toBeInTheDocument()
    // 併記の行は出さない(「記録の表記: 」という中身の無い行を作らない)
    expect(screen.queryByText(/記録の表記/)).not.toBeInTheDocument()
  })

  // バックアップ JSON 由来の `''`。型は `string | null` なので空文字は正当に入ってくる
  it('brandName が空文字なら表記に落ちる(`??` では拾えない経路)', () => {
    render(<RecordCard record={rec({ id: 'v', brandLabel: 'テスト酒', brandName: '' })} />)

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
    render(<RecordCard record={rec({ id: 'd', thumbnail: new ArrayBuffer(1) })} />)
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

  // 県のバッジは `record.prefecture !== null` で出していたので、バックアップ JSON 由来の
  // `''` では**中身が空のバッジ**が銘柄名の隣に出る(幅だけあって読めるものが無い要素)。
  // 未記入の3通り(`null` / `''` / 空白のみ)は同じ判定に揃える(`normalizePrefecture`)。
  //
  // 要素数を `null` の描画と比べる。「空の span が無い」で見ると、他の空要素が増えたときに
  // 理由の違う失敗になる(比較なら県のバッジ1個だけの差を見られる)。
  it('県が空文字・空白のみの記録は県のバッジを出さない(null と同じ形になる)', () => {
    const spans = (record: SakeRecord): number =>
      render(<RecordCard record={record} />).container.querySelectorAll('span').length

    const baseline = spans(rec({ id: 'g0', prefecture: null }))
    expect(spans(rec({ id: 'g1', prefecture: '' }))).toBe(baseline)
    expect(spans(rec({ id: 'g2', prefecture: '   ' }))).toBe(baseline)
    // 県が入っていればバッジは増える(上の一致が「常に同じ」ではないことの正例)
    expect(spans(rec({ id: 'g3', prefecture: '新潟県' }))).toBe(baseline + 1)
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
    const box = screen.getByRole('searchbox', { name: '銘柄・スペック・場所・メモを検索' })

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

  // 述語の細部(生一致 OR 正規化一致 / フィールド跨ぎ / 空 needle)は searchRecord.test.ts が持つ。
  // ここは**画面の入力欄からその述語に届いている**ことだけを見る(3点)
  it('スペックでも絞れる（画面に出ている列が打てる）', async () => {
    const user = userEvent.setup()
    renderTimeline([
      rec({ id: 's1', brandLabel: 'テスト甲', spec: '純米大吟醸 無濾過生原酒' }),
      rec({ id: 's2', brandLabel: 'テスト乙', spec: '本醸造', drankOn: '2018-08-09' }),
    ])
    await user.type(screen.getByRole('searchbox'), '無濾過')
    expect(rows()).toHaveLength(1)
    expect(screen.getByText('該当 1本 / 全 2本')).toBeInTheDocument()
  })

  it('表記ゆれを吸収する（`写楽` で `寫楽` の記録が出る）', async () => {
    const user = userEvent.setup()
    renderTimeline([
      rec({ id: 'v1', brandLabel: '寫楽' }),
      rec({ id: 'v2', brandLabel: 'テスト乙', drankOn: '2018-08-09' }),
    ])
    await user.type(screen.getByRole('searchbox'), '写楽')
    expect(rows()).toHaveLength(1)
  })

  it('正規化すると空になる検索語（括弧だけ）で全件に戻らない', async () => {
    const user = userEvent.setup()
    renderTimeline(records)
    await user.type(screen.getByRole('searchbox'), '()')
    expect(rows()).toHaveLength(0)
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

  it('都道府県のピルで絞れる。県が無い記録は「都道府県が未記入」で選べる', async () => {
    const user = userEvent.setup()
    renderTimeline(records)
    await openFacets(user)

    await user.click(screen.getByRole('button', { name: /^福島県 2$/ }))
    expect(rows()).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: /^福島県 2$/ }))
    await user.click(screen.getByRole('button', { name: /^都道府県が未記入 1$/ }))
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

// 記録の `prefecture` は「未記入」を3通りの形で取る。取り込み(`importRows`)は `''` を `null` に
// 畳むが、**バックアップ JSON は `''` をそのまま持つ**(`backupSchema` は nullable string を通す)。
// `?? ` だけで書くと `''` では発火せず、**ラベルが空のピル**(件数だけの幅28px)が出て、
// チップの `aria-label` も「 の絞り込みを解除」になる(実測)。
// 産地タブ・統計タブは `computeStats` 経由で3通りを同じ束に畳んでいるので、ここが揃わないと
// **同じ記録の集合が画面ごとに別の数・別の名前になる**。
describe('絞り込み: 都道府県が未記入の記録', () => {
  const mixed = [
    rec({ id: 'p1', prefecture: '新潟県' }),
    // 前後に空白のある県名。取り込み側は trim するが JSON は素通しなので画面に来うる
    rec({ id: 'p2', prefecture: ' 新潟県 ' }),
    rec({ id: 'p3', prefecture: null }),
    rec({ id: 'p4', prefecture: '' }),
    rec({ id: 'p5', prefecture: '   ' }),
  ]

  /** 都道府県の行のピル。行は `role="group"` + 行タイトルの aria-label で引ける */
  function prefecturePills(): string[] {
    return within(screen.getByRole('group', { name: '都道府県' }))
      .getAllByRole('button')
      .map((pill) => pill.textContent ?? '')
  }

  it('null / 空文字 / 空白のみを1つのピルにまとめ、ラベルが空のピルを作らない', async () => {
    const user = userEvent.setup()
    renderTimeline(mixed)
    await openFacets(user)

    // 2つだけ: 新潟県(空白付きの1本を含む2本) と 未記入3本。**未記入は残余なので最後**
    expect(prefecturePills()).toEqual(['新潟県2', '都道府県が未記入3'])
  })

  it('未記入のピルで3本すべてに絞れる(形の違いで取りこぼさない)', async () => {
    const user = userEvent.setup()
    renderTimeline(mixed)
    await openFacets(user)

    await user.click(screen.getByRole('button', { name: /^都道府県が未記入 3$/ }))
    expect(rows()).toHaveLength(3)
    expect(screen.getByText('該当 3本 / 全 5本')).toBeInTheDocument()

    // 空白付きの県名も県名の側に入る(未記入に混ざらない)
    await user.click(screen.getByRole('button', { name: /^都道府県が未記入 3$/ }))
    await user.click(screen.getByRole('button', { name: /^新潟県 2$/ }))
    expect(rows()).toHaveLength(2)
  })

  it('効いている条件のチップに未記入の名前が出る(空白だけのラベルにしない)', async () => {
    const user = userEvent.setup()
    renderTimeline(mixed)
    await openFacets(user)
    await user.click(screen.getByRole('button', { name: /^都道府県が未記入 3$/ }))
    await user.click(screen.getByRole('button', { name: '絞り込み' })) // 閉じる

    const chip = screen.getByRole('button', { name: '都道府県が未記入 の絞り込みを解除' })
    expect(chip.textContent).toContain('都道府県が未記入')

    await user.click(chip)
    expect(rows()).toHaveLength(5)
  })
})

describe('絞り込み: 評価', () => {
  const records = [
    rec({ id: 'r1', rating: 4 }),
    rec({ id: 'r2', rating: 4, drankOn: '2018-08-09' }),
    rec({ id: 'r3', rating: 2, drankOn: '2017-03-04' }),
    rec({ id: 'r4', rating: null, drankOn: '2017-03-04' }),
  ]

  /** リテラルの件数(1..5 昇順)。**`computeStats` から作らない** — 恒真になる(B15) */
  const ratings: RatingCount[] = [
    { rating: 1, count: 0 },
    { rating: 2, count: 1 },
    { rating: 3, count: 0 },
    { rating: 4, count: 2 },
    { rating: 5, count: 0 },
  ]

  function renderRatings() {
    return renderTimeline(records, undefined, { ratings, unratedCount: 1 })
  }

  it('段のピルで絞れる。**ラベルは数字だけ**（`評価 4` は行の本文と同じ文字列になる）', async () => {
    const user = userEvent.setup()
    renderRatings()
    await openFacets(user)

    await user.click(screen.getByRole('button', { name: /^4 2$/ }))
    expect(rows()).toHaveLength(2)
    expect(screen.getByText('該当 2本 / 全 4本')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^4 2$/ }))
    expect(rows()).toHaveLength(4)
  })

  it('未評価のピルで絞れる（0点として段に混ぜない）', async () => {
    const user = userEvent.setup()
    renderRatings()
    await openFacets(user)

    await user.click(screen.getByRole('button', { name: /^未評価 1$/ }))
    expect(rows()).toHaveLength(1)
  })

  it('0件の段はピルにしない（押しても何も出ない行き止まりを作らない）', async () => {
    const user = userEvent.setup()
    renderRatings()
    await openFacets(user)

    expect(screen.queryByRole('button', { name: /^1 0$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^3 0$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^5 0$/ })).not.toBeInTheDocument()
    // 出るのは実際に記録がある段だけ
    expect(screen.getByRole('button', { name: /^2 1$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^4 2$/ })).toBeInTheDocument()
  })

  it('1..5 の外の値も「未評価」で拾う（ピルの件数と行数が食い違わない）', async () => {
    // `stats.unratedCount` は壊れた値(手で編集したバックアップの 0 や 7)も未評価に数えている。
    // ここで `rating === null` だけを見ると「未評価 2」のピルを押して1行しか出ない
    const user = userEvent.setup()
    // 型では起き得ない値。リテラルからは `as Rating` できないので number を経由する
    // (`stats.test.ts` の「1..5 の外の値」と同じ手)
    const brokenRating: number = 0
    renderTimeline(
      [
        rec({ id: 'b1', rating: null }),
        rec({ id: 'b2', rating: brokenRating as Rating, drankOn: '2018-08-09' }),
        rec({ id: 'b3', rating: 4, drankOn: '2017-03-04' }),
      ],
      undefined,
      {
        ratings: [
          { rating: 1, count: 0 },
          { rating: 2, count: 0 },
          { rating: 3, count: 0 },
          { rating: 4, count: 1 },
          { rating: 5, count: 0 },
        ],
        unratedCount: 2,
      },
    )
    await openFacets(user)

    await user.click(screen.getByRole('button', { name: /^未評価 2$/ }))
    expect(rows()).toHaveLength(2)
    expect(screen.getByText('該当 2本 / 全 3本')).toBeInTheDocument()
  })

  it('チップは「評価 4」で書く（行の外に出るのでピルの「4」だけでは読めない）', async () => {
    const user = userEvent.setup()
    renderRatings()
    await openFacets(user)
    await user.click(screen.getByRole('button', { name: /^4 2$/ }))

    expect(screen.getByRole('button', { name: '評価 4 の絞り込みを解除' })).toBeInTheDocument()
  })

  it('件数はこの画面で数えない — 渡された数がそのまま出る（A10）', async () => {
    // **記録の実数(2本)と食い違う件数を渡す。** 画面が数え直していればここが `4 2` になる。
    // 統計タブと同じ数字を2箇所で数えないための配線で、食い違いは App のバグとして表に出る
    const user = userEvent.setup()
    renderTimeline(records, undefined, {
      ratings: [
        { rating: 1, count: 0 },
        { rating: 2, count: 1 },
        { rating: 3, count: 0 },
        { rating: 4, count: 99 },
        { rating: 5, count: 0 },
      ],
      unratedCount: 1,
    })
    await openFacets(user)

    // 絞り込みそのものは述語で行うので、押した結果は実際の2本
    await user.click(screen.getByRole('button', { name: /^4 99$/ }))
    expect(rows()).toHaveLength(2)
  })
})

describe('絞り込み: 写真', () => {
  const photo = () => new ArrayBuffer(1)

  it('写真あり / 写真なしで絞れる', async () => {
    const user = userEvent.setup()
    renderTimeline([
      rec({ id: 'p1', thumbnail: photo() }),
      rec({ id: 'p2', drankOn: '2018-08-09' }),
      rec({ id: 'p3', drankOn: '2017-03-04' }),
    ])
    await openFacets(user)

    await user.click(screen.getByRole('button', { name: /^写真あり 1$/ }))
    expect(rows()).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /^写真あり 1$/ }))
    await user.click(screen.getByRole('button', { name: /^写真なし 2$/ }))
    expect(rows()).toHaveLength(2)
  })
})

describe('絞り込みにならない軸は行ごと出さない', () => {
  // **実台帳203本は写真が1枚も無く、評価も全て null。** 素直に作ると「写真なし 203」
  // 「未評価 203」という押しても表示が変わらないピルが出る(行き止まり)。
  // 排他な軸で空でないバケツが1つなら、そのバケツは常に全件。
  const uniform = [
    rec({ id: 'u1', prefecture: '福島県', linkStatus: 'auto' }),
    rec({ id: 'u2', prefecture: '福島県', linkStatus: 'auto' }),
    rec({ id: 'u3', prefecture: '福島県', linkStatus: 'auto' }),
  ]

  it('全件が同じ値の軸のピルを出さない（写真・評価・年・県・紐付け）', async () => {
    const user = userEvent.setup()
    renderTimeline(uniform, undefined, { unratedCount: 3 })
    await openFacets(user)

    expect(screen.queryByRole('button', { name: /^写真なし 3$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^未評価 3$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^2019年 3$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^福島県 3$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^自動 3$/ })).not.toBeInTheDocument()
    // 1本も絞れないことを黙って隠さない
    expect(screen.getByText(/絞り込める軸が無い/)).toBeInTheDocument()
    expect(rows()).toHaveLength(3)
  })

  it('バケツが2つになった軸は出る（この検査が恒偽でないことの確認）', async () => {
    const user = userEvent.setup()
    renderTimeline(
      [...uniform, rec({ id: 'u4', drankOn: '2018-08-09', prefecture: '福島県', linkStatus: 'auto' })],
      undefined,
      { unratedCount: 4 },
    )
    await openFacets(user)

    expect(screen.getByRole('button', { name: /^2019年 3$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^2018年 1$/ })).toBeInTheDocument()
    // 年以外は依然として1バケツなので出ない
    expect(screen.queryByRole('button', { name: /^福島県 4$/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/絞り込める軸が無い/)).not.toBeInTheDocument()
  })
})

describe('絞り込み: スペック（味の手がかり）', () => {
  const records = [
    rec({ id: 'y1', spec: '純米大吟醸' }),
    rec({ id: 'y2', spec: '特別純米', drankOn: '2018-08-09' }),
    rec({ id: 'y3', spec: '', drankOn: '2017-03-04' }),
  ]

  /** 重複計上のリテラル: `純米大吟醸` の1本は `大吟醸` にも `純米` にも入る(合計4 > 3本) */
  const styles = styleCounts(
    { term: '純米大吟醸', count: 1 },
    { term: '大吟醸', count: 1 },
    { term: '純米', count: 2 },
  )

  it('語のピルで絞れる（`純米` は `純米大吟醸` の1本も含む = 重複計上）', async () => {
    const user = userEvent.setup()
    renderTimeline(records, undefined, { styles })
    await openFacets(user)

    await user.click(screen.getByRole('button', { name: /^純米 2$/ }))
    expect(rows()).toHaveLength(2)
    expect(screen.getByText('該当 2本 / 全 3本')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^純米 2$/ }))
    await user.click(screen.getByRole('button', { name: /^純米大吟醸 1$/ }))
    expect(rows()).toHaveLength(1)
  })

  it('備考（メモ）は数えない規則が絞り込みにも効く', async () => {
    // 述語は `stats.ts` の `matchesStyleTerm` の1本。スペック列だけを見る
    const user = userEvent.setup()
    renderTimeline(
      [
        rec({ id: 'n1', spec: 'にごり' }),
        rec({ id: 'n2', spec: '', note: 'にごり', drankOn: '2018-08-09' }),
      ],
      undefined,
      { styles: styleCounts({ term: 'にごり', count: 1 }) },
    )
    await openFacets(user)

    await user.click(screen.getByRole('button', { name: /^にごり 1$/ }))
    expect(rows()).toHaveLength(1)
  })

  it('重複計上であることを画面に書く（合計が総本数を超える理由）', async () => {
    const user = userEvent.setup()
    renderTimeline(records, undefined, { styles })
    await openFacets(user)

    // 文言は Dashboard のスタイル分布と同一(同じ現象に2つの説明文を作らない)
    expect(screen.getByText(/重複計上/)).toBeInTheDocument()
    expect(screen.getByText(/合計は総本数を超える/)).toBeInTheDocument()
    expect(screen.getByText(/備考（メモ）は数えない/)).toBeInTheDocument()
  })

  it('0件の語はピルにしない（Timeline の規則。Dashboard は逆に0件の行を残す）', async () => {
    const user = userEvent.setup()
    renderTimeline(records, undefined, {
      styles: styleCounts({ term: '純米', count: 2 }, { term: '本醸造', count: 0 }),
    })
    await openFacets(user)

    expect(screen.getByRole('button', { name: /^純米 2$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^本醸造 0$/ })).not.toBeInTheDocument()
  })

  it('語が1つでも行を出す（重複計上の軸は1バケツでも真部分集合になる）', async () => {
    // 排他な軸(写真・年・…)とは規則が違う。ここで `narrowingOnly` を通すと
    // 「203本中112本が純米」のような**効く絞り込み**が消える
    const user = userEvent.setup()
    renderTimeline(records, undefined, { styles: styleCounts({ term: '純米', count: 2 }) })
    await openFacets(user)

    await user.click(screen.getByRole('button', { name: /^純米 2$/ }))
    expect(rows()).toHaveLength(2)
  })

  it('件数はこの画面で数えない — 渡された数がそのまま出る（A10）', async () => {
    // 記録の実数(2本)と食い違う件数を渡す。画面が数え直していればここが `純米 2` になる
    const user = userEvent.setup()
    renderTimeline(records, undefined, { styles: styleCounts({ term: '純米', count: 99 }) })
    await openFacets(user)

    await user.click(screen.getByRole('button', { name: /^純米 99$/ }))
    expect(rows()).toHaveLength(2)
  })

  it('スペックの絞り込みは他の軸と AND で効く', async () => {
    const user = userEvent.setup()
    renderTimeline(records, undefined, { styles })
    await openFacets(user)

    await user.click(screen.getByRole('button', { name: /^純米 2$/ }))
    await user.click(screen.getByRole('button', { name: /^2019年 1$/ }))
    expect(rows()).toHaveLength(1)
    expect(screen.getByText('該当 1本 / 全 3本')).toBeInTheDocument()

    // 交わらない組み合わせは0件のまま(全件へ戻さない)
    await user.click(screen.getByRole('button', { name: /^2017年 1$/ }))
    expect(rows()).toHaveLength(0)
    expect(screen.getByText('該当なし')).toBeInTheDocument()
  })

  it('チップで解除できる（パネルを閉じても効いている条件が見える）', async () => {
    const user = userEvent.setup()
    renderTimeline(records, undefined, { styles })
    await openFacets(user)
    await user.click(screen.getByRole('button', { name: /^純米 2$/ }))
    await user.click(screen.getByRole('button', { name: '絞り込み' })) // 閉じる

    const chip = screen.getByRole('button', { name: '純米 の絞り込みを解除' })
    expect(rows()).toHaveLength(2)
    await user.click(chip)
    expect(rows()).toHaveLength(3)
  })
})

describe('絞り込み: 味タグ', () => {
  // 合成した味タグの表。**索引の作り方を二重実装しない**ために `decodeFlavorTags` を通す。
  // 銘柄 101 は2語 / 102 は2語 / 103 は行ごと無い(紐付いてもタグが無い銘柄)
  function flavorTagTables(): DecodedFlavorTags {
    return decodeFlavorTags({
      flavorTags: {
        copyright: 'synthetic',
        rows: [
          [1, 'テスト味あ'],
          [2, 'テスト味い'],
          [3, 'テスト味う'],
        ],
      },
      brandFlavorTags: {
        copyright: 'synthetic',
        rows: [
          [101, 1, 2],
          [102, 1, 3],
        ],
      },
    })
  }

  /** 3点セット。**状態だけ渡せる形にしていない**(再試行の無い配線を型で作らせない) */
  function tagSource(
    state: FlavorTagState = { status: 'ready', value: flavorTagTables() },
    over: Partial<Pick<FlavorTagSource, 'onNeeded' | 'onRetry'>> = {},
  ): FlavorTagSource {
    return { state, onNeeded: noop, onRetry: noop, ...over }
  }

  /**
   * 6本。タグを引けるのは4本で、**残り2本(タグが無い銘柄 / 未紐付け)はどのタグにも当たらない**。
   * `テスト味あ` は4本(タグを引けた本数の半数より多い = 既定では畳む)、
   * `テスト味い` と `テスト味う` は2本(ちょうど半数なので既定で出る)。
   */
  const records = [
    rec({ id: 'g1', sakenowaBrandId: 101, linkStatus: 'auto' }),
    rec({ id: 'g2', sakenowaBrandId: 101, linkStatus: 'auto', drankOn: '2018-08-09' }),
    rec({ id: 'g3', sakenowaBrandId: 102, linkStatus: 'auto' }),
    rec({ id: 'g4', sakenowaBrandId: 102, linkStatus: 'auto', drankOn: '2018-08-09' }),
    // 紐付いているがさけのわ側にタグの行が無い銘柄
    rec({ id: 'g5', sakenowaBrandId: 103, linkStatus: 'auto', drankOn: '2017-03-04' }),
    rec({ id: 'g6', drankOn: '2017-03-04' }),
  ]

  it('語のピルで絞れる。紐付いていない記録とタグが無い銘柄の記録は落ちる', async () => {
    const user = userEvent.setup()
    renderTimeline(records, undefined, {}, tagSource())
    await openFacets(user)

    await user.click(screen.getByRole('button', { name: /^テスト味い 2$/ }))
    expect(rows()).toHaveLength(2)
    expect(screen.getByText('該当 2本 / 全 6本')).toBeInTheDocument()

    // 押し直すと解除
    await user.click(screen.getByRole('button', { name: /^テスト味い 2$/ }))
    expect(rows()).toHaveLength(6)
  })

  it('分母を常設する（タグを引けた本数 / 全本数）', async () => {
    const user = userEvent.setup()
    renderTimeline(records, undefined, {}, tagSource())
    await openFacets(user)

    // 6本のうちタグを引けたのは4本。書かないと「絞ったら2本消えた」が説明できない
    expect(screen.getByText(/タグを引けた 4本 \/ 全 6本/)).toBeInTheDocument()
    expect(
      screen.getByText(/紐付いていない記録と、タグが無い銘柄の記録はどのタグにも当たらない/),
    ).toBeInTheDocument()
  })

  it('上流の打ち切りを実データの数で書く（タグが無い ≠ その味がない）', async () => {
    const user = userEvent.setup()
    renderTimeline(records, undefined, {}, tagSource())
    await openFacets(user)

    // 合成表は 1銘柄あたり最大2語 / 2銘柄ともその上限。**リテラルの「20語」を持たない**
    expect(screen.getByText(/上流は銘柄あたり最大2語で打ち切っている/)).toBeInTheDocument()
    expect(screen.getByText(/2銘柄のうち2銘柄がその上限に達している/)).toBeInTheDocument()
    expect(
      screen.getByText(/タグが無いことは「その味がない」ことを意味しない/),
    ).toBeInTheDocument()
  })

  it('半数より多くに付く語は既定で畳み、残数付きのトグルで必ず出せる', async () => {
    const user = userEvent.setup()
    renderTimeline(records, undefined, {}, tagSource())
    await openFacets(user)

    // 4本(タグを引けた4本の全部)に付く語は既定で出さない。件数降順に素直に並べると
    // これが先頭に来て絞り込みとして機能しない
    expect(screen.queryByRole('button', { name: /^テスト味あ 4$/ })).not.toBeInTheDocument()
    // 畳んだ理由と残数を言葉で書く(黙って消さない)
    expect(screen.getByText(/タグを引けた記録の半数より多くに付く語（1語）/)).toBeInTheDocument()
    expect(screen.getByText(/押しても大きくは絞れないので既定では畳んでいる/)).toBeInTheDocument()

    // **どのタグも到達可能**。件数付きで出て、押せば絞れる
    await user.click(screen.getByRole('button', { name: '残り 1語を出す' }))
    await user.click(screen.getByRole('button', { name: /^テスト味あ 4$/ }))
    expect(rows()).toHaveLength(4)

    // 閉じてもチップで見えている(隠れた絞り込みにならない)
    await user.click(screen.getByRole('button', { name: '残り 1語を隠す' }))
    expect(screen.queryByRole('button', { name: /^テスト味あ 4$/ })).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '味タグ テスト味あ の絞り込みを解除' }),
    ).toBeInTheDocument()
    expect(rows()).toHaveLength(4)
  })

  it('他の軸と AND で効く', async () => {
    const user = userEvent.setup()
    renderTimeline(records, undefined, {}, tagSource())
    await openFacets(user)

    await user.click(screen.getByRole('button', { name: /^テスト味い 2$/ }))
    await user.click(screen.getByRole('button', { name: /^2019年 2$/ }))
    expect(rows()).toHaveLength(1)
    expect(screen.getByText('該当 1本 / 全 6本')).toBeInTheDocument()
  })

  it('チップは軸名を付ける（語だけではスペック語と読み分けられない）', async () => {
    const user = userEvent.setup()
    renderTimeline(records, undefined, {}, tagSource())
    await openFacets(user)
    await user.click(screen.getByRole('button', { name: /^テスト味う 2$/ }))
    await user.click(screen.getByRole('button', { name: '絞り込み' })) // 閉じる

    const chip = screen.getByRole('button', { name: '味タグ テスト味う の絞り込みを解除' })
    expect(rows()).toHaveLength(2)
    await user.click(chip)
    expect(rows()).toHaveLength(6)
  })

  it('未取得のあいだ行は消えず「読み込んでいる」を出す', async () => {
    const user = userEvent.setup()
    renderTimeline(records, undefined, {}, tagSource({ status: 'loading' }))
    await openFacets(user)

    expect(screen.getByText('味タグを読み込んでいる')).toBeInTheDocument()
    // 一覧は影響を受けない
    expect(rows()).toHaveLength(6)
  })

  it('要求前（idle）も同じ面を出す（パネルを開いた操作が取得の開始なので)', async () => {
    const user = userEvent.setup()
    renderTimeline(records, undefined, {}, tagSource({ status: 'idle' }))
    await openFacets(user)

    expect(screen.getByText('味タグを読み込んでいる')).toBeInTheDocument()
  })

  it('パネルを開いたときに取得を促す。閉じるときは促さない', async () => {
    const user = userEvent.setup()
    const onNeeded = vi.fn()
    renderTimeline(records, undefined, {}, tagSource({ status: 'idle' }, { onNeeded }))

    await user.click(screen.getByRole('button', { name: '絞り込み' }))
    expect(onNeeded).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '絞り込み' })) // 閉じる
    expect(onNeeded).toHaveBeenCalledTimes(1)
  })

  it('失敗したら理由と再試行を出す（行ごと黙って消さない）', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    renderTimeline(
      records,
      undefined,
      {},
      tagSource({ status: 'error', message: 'オフライン' }, { onRetry }),
    )
    await openFacets(user)

    expect(screen.getByText('味タグを読み込めなかった')).toBeInTheDocument()
    expect(screen.getByText('オフライン')).toBeInTheDocument()
    expect(screen.getByText(/一覧と他の絞り込みは影響を受けない/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '再試行' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('他の絞り込みは味タグの取得状態に影響されない', async () => {
    const user = userEvent.setup()
    renderTimeline(records, undefined, {}, tagSource({ status: 'error', message: 'オフライン' }))
    await openFacets(user)

    await user.click(screen.getByRole('button', { name: /^2019年 2$/ }))
    expect(rows()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /^自動 5$/ }))
    expect(rows()).toHaveLength(2)
  })

  it('選んだ語のまま表を失っても全件に戻らない（定義域外で広げない）', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <Timeline
        records={records}
        counts={counts()}
        onImport={noop}
        onCreate={noop}
        flavorTags={tagSource()}
      />,
    )
    await openFacets(user)
    await user.click(screen.getByRole('button', { name: /^テスト味い 2$/ }))
    expect(rows()).toHaveLength(2)

    // 表が失われた(サイトデータ削除 → 再取得の失敗など)。**黙って全件に広げない**
    rerender(
      <Timeline
        records={records}
        counts={counts()}
        onImport={noop}
        onCreate={noop}
        flavorTags={tagSource({ status: 'error', message: 'オフライン' })}
      />,
    )

    expect(rows()).toHaveLength(0)
    expect(screen.getByText('該当なし')).toBeInTheDocument()
    // 何が効いているかはチップで見え、そこから外せる
    await user.click(screen.getByRole('button', { name: '味タグ テスト味い の絞り込みを解除' }))
    expect(rows()).toHaveLength(6)
  })

  it('タグを引けた記録が0本なら理由を書く（空の行にしない）', async () => {
    const user = userEvent.setup()
    renderTimeline(
      [rec({ id: 'n1' }), rec({ id: 'n2', drankOn: '2018-08-09' })],
      undefined,
      {},
      tagSource(),
    )
    await openFacets(user)

    expect(screen.getByText(/タグを引けた 0本 \/ 全 2本/)).toBeInTheDocument()
    expect(screen.getByText(/この軸では絞れない/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^テスト味あ/ })).not.toBeInTheDocument()
  })

  it('flavorTags を渡さない呼び出し側にはタグの行が出ない', async () => {
    const user = userEvent.setup()
    renderTimeline(records)
    await openFacets(user)

    expect(screen.queryByText(/味タグ/)).not.toBeInTheDocument()
    expect(screen.queryByText('味タグを読み込んでいる')).not.toBeInTheDocument()
    // 他の軸は出る(この検査が恒真でないことの確認)
    expect(screen.getByRole('button', { name: /^2019年 2$/ })).toBeInTheDocument()
  })
})

describe('空状態', () => {
  it('取り込みと1本目の記録の導線2つを出す', async () => {
    const user = userEvent.setup()
    const onImport = vi.fn()
    const onCreate = vi.fn()
    render(
      <Timeline records={[]} counts={counts()} onImport={onImport} onCreate={onCreate} />,
    )

    expect(screen.getByText('まだ1本も記録が無い')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'JSON を取り込む' }))
    await user.click(screen.getByRole('button', { name: '1本目を記録する' }))
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('0本のときは検索欄も絞り込みも出さない（押しても意味が無いので）', () => {
    render(<Timeline records={[]} counts={counts()} onImport={noop} onCreate={noop} />)
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '絞り込み' })).not.toBeInTheDocument()
  })
})
