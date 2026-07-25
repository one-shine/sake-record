// 産地マップの表示テスト。**合成データだけ**を使う。
//
// 集計は `computeStats()` に通す(この画面の入力は集計の戻り値なので、Stats のリテラルを手で
// 組むと `computeStats` の分割規則とずれた入力でも緑になる)。ただし **`drankOn` は空文字**にする:
// 日付と県名を同じテストに書くと、その対が台帳の結合キーになりうる(`npm run ledger:check`)。
// この画面は日付を一切読まないので、空文字で `undatedCount` に落ちても検査対象に影響しない。
//
// 県名と本数は台帳の値ではないので、ここで使う組み合わせは実台帳と無関係な合成値。

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { computeStats, type Stats } from '../../domain/stats.ts'
import type { SakeRecord } from '../../domain/types.ts'
import { AreaMap } from './AreaMap.tsx'
import { JAPAN_LOCATIONS } from './areaRows.ts'

function record(prefecture: string | null, index: number): SakeRecord {
  return {
    id: `r${String(index)}`,
    // 日付は使わない画面なので空にする(台帳の結合キーをテストに書かないため)
    drankOn: '',
    brandLabel: `合成銘柄${String(index)}`,
    sakenowaBrandId: null,
    brandName: null,
    linkStatus: 'unlinked',
    prefecture,
    spec: '',
    rating: null,
    place: '',
    note: '',
    thumbnail: null,
    sourceNo: null,
    createdAt: '',
    updatedAt: '',
  }
}

/** `[県名 | null, 本数]` の並びから Stats を作る */
function statsOf(entries: readonly (readonly [string | null, number])[]): Stats {
  const records: SakeRecord[] = []
  for (const [prefecture, times] of entries) {
    for (let i = 0; i < times; i += 1) records.push(record(prefecture, records.length))
  }
  return computeStats(records)
}

/**
 * 合成の台帳。塗りの4段すべてに県が入り、地図に塗れない記録が2種類ある形。
 * 塗った27本 + 県が決まらない1本 + 県が空の2本 = 30本。
 */
const SAMPLE = statsOf([
  ['北海道', 14],
  ['秋田県', 8],
  ['三重県', 4],
  ['香川県', 1],
  ['青森県または秋田県', 1],
  [null, 2],
])

function map() {
  return screen.getByRole('img', { name: /日本地図/ })
}

function prefectureList() {
  return screen.getByRole('list', { name: '都道府県の一覧' })
}

/** 選択中の県を出す live region。凡例にも同じ語が出るのでここに限定して読む */
function selection() {
  return within(screen.getByRole('status'))
}

describe('AreaMap', () => {
  it('47県すべての path を描画する', () => {
    const { container } = render(<AreaMap stats={SAMPLE} />)

    expect(JAPAN_LOCATIONS).toHaveLength(47)
    const paths = container.querySelectorAll('svg path[data-romaji]')
    expect(paths).toHaveLength(47)
    // どの形も県コードに解決できている = 黙って落とした形が無い
    for (const path of paths) {
      expect(path.getAttribute('data-step')).not.toBe('unresolved')
    }
  })

  it('県コードに解決できない形が無いので警告を出さない', () => {
    render(<AreaMap stats={SAMPLE} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/対応付けられなかった/)).not.toBeInTheDocument()
  })

  it('本数0の県を未進出の段で塗り、本数の多い県と区別できる', () => {
    const { container } = render(<AreaMap stats={SAMPLE} />)

    const hokkaido = container.querySelector('path[data-romaji="hokkaido"]')
    const kagawa = container.querySelector('path[data-romaji="kagawa"]')
    const okinawa = container.querySelector('path[data-romaji="okinawa"]')

    expect(hokkaido?.getAttribute('data-count')).toBe('14')
    expect(hokkaido?.getAttribute('data-step')).toBe('4')
    expect(kagawa?.getAttribute('data-step')).toBe('1')
    // 未出現の県はキーが無いので 0本。**全件や他県に落ちない**
    expect(okinawa?.getAttribute('data-count')).toBe('0')
    expect(okinawa?.getAttribute('data-step')).toBe('0')

    // 段が違えば塗りのクラスも違う(段の区別が色に出ている)
    expect(hokkaido?.getAttribute('class')).not.toBe(okinawa?.getAttribute('class'))
    expect(kagawa?.getAttribute('class')).not.toBe(okinawa?.getAttribute('class'))
  })

  it('凡例に段と県数を出す(未進出が段として読める)', () => {
    render(<AreaMap stats={SAMPLE} />)

    const legend = within(screen.getByRole('list', { name: '塗りの段' }))
    expect(legend.getByText('未進出（0本）')).toBeInTheDocument()
    expect(legend.getByText('11本以上')).toBeInTheDocument()
    // 47県 - 出現4県 = 43県が未進出
    expect(legend.getByText('43県')).toBeInTheDocument()
  })

  it('塗った本数と全本数を見出しに並べる(差が目で追える)', () => {
    render(<AreaMap stats={SAMPLE} />)

    expect(screen.getByText('訪問 4県 / 47県')).toBeInTheDocument()
    expect(screen.getByText('地図に塗った 27本')).toBeInTheDocument()
    expect(screen.getByText('全 30本')).toBeInTheDocument()
  })

  it('県が確定していない記録を地図の外に件数で出す', () => {
    render(<AreaMap stats={SAMPLE} />)

    const heading = screen.getByText('地図に塗れなかった 3本')
    expect(heading).toBeInTheDocument()
    // 「地図の外」であること: 見出しも内訳も SVG の中に無い
    expect(map()).not.toContainElement(heading)

    // 内訳は丸めず、記録の表記のまま出す
    expect(screen.getByText('青森県または秋田県')).toBeInTheDocument()
    expect(screen.getByText('県の記入なし')).toBeInTheDocument()
    expect(screen.getByText('2本')).toBeInTheDocument()
  })

  it('一覧表に47県が出る(0本の県も行として読める)', () => {
    render(<AreaMap stats={SAMPLE} />)

    const list = within(prefectureList())
    expect(list.getAllByRole('listitem')).toHaveLength(47)
    expect(list.getByRole('button', { name: '北海道 14本' })).toBeInTheDocument()
    // 地図では数px しかない県も一覧では同じ大きさの行になる
    expect(list.getByRole('button', { name: '香川県 1本' })).toBeInTheDocument()
    expect(list.getByRole('button', { name: '大阪府 未進出' })).toBeInTheDocument()
  })

  it('一覧の並びを本数順と北から順で切り替えても47県のまま', async () => {
    const user = userEvent.setup()
    render(<AreaMap stats={SAMPLE} />)

    const names = () =>
      within(prefectureList())
        .getAllByRole('button')
        .map((button) => button.textContent)

    // 既定は本数順
    expect(names()[0]).toContain('北海道')
    expect(names()[1]).toContain('秋田県')

    await user.click(screen.getByRole('button', { name: '北から順' }))
    expect(names()).toHaveLength(47)
    expect(names()[1]).toContain('青森県')
  })

  it('一覧で県を押すと地図がその県を強調し、本数を文字で出す', async () => {
    const user = userEvent.setup()
    const { container } = render(<AreaMap stats={SAMPLE} />)

    expect(container.querySelector('[data-selected]')).toBeNull()

    const kagawa = within(prefectureList()).getByRole('button', { name: '香川県 1本' })
    await user.click(kagawa)

    expect(kagawa).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelector('[data-selected]')).not.toBeNull()
    expect(selection().getByText('香川県')).toBeInTheDocument()
    expect(selection().getByText('1本')).toBeInTheDocument()

    // もう一度押すと解除
    await user.click(kagawa)
    expect(kagawa).toHaveAttribute('aria-pressed', 'false')
    expect(container.querySelector('[data-selected]')).toBeNull()
  })

  it('未進出の県も選べて、0本であることを言う', async () => {
    const user = userEvent.setup()
    const { container } = render(<AreaMap stats={SAMPLE} />)

    await user.click(within(prefectureList()).getByRole('button', { name: '大阪府 未進出' }))

    const selected = container.querySelector('[data-selected]')
    expect(selected).not.toBeNull()
    expect(selection().getByText('大阪府')).toBeInTheDocument()
    expect(selection().getByText('未進出（0本）')).toBeInTheDocument()
    // 大阪府の形が強調されている(隣県ではない)
    expect(selected?.getAttribute('d')).toBe(
      JAPAN_LOCATIONS.find((location) => location.id === 'osaka')?.path,
    )
  })

  it('記録が0本のときは47県すべて未進出で、地図の外の別枠は出さない', () => {
    const { container } = render(<AreaMap stats={statsOf([])} />)

    expect(screen.getByText('訪問 0県 / 47県')).toBeInTheDocument()
    expect(screen.getByText(/記録が1本も無いので/)).toBeInTheDocument()
    expect(screen.queryByText(/地図に塗れなかった/)).not.toBeInTheDocument()

    const paths = container.querySelectorAll('svg path[data-step="0"]')
    expect(paths).toHaveLength(47)
    expect(within(prefectureList()).getAllByRole('listitem')).toHaveLength(47)
  })
})
