// 内訳の数え方(画面に出る「紐付け 186 / 未紐付け 12 / 銘柄不明 5 / フレーバー取得済み 185」の元)
// を実データ抜きで固定する。**紐付け済みとフレーバー取得済みが別の数であること**が要点。
//
// データはすべて合成。日付リテラルは1種類に留める(BACKLOG B22 の台帳ガード)。

import { APP_NAME } from '../../config/app.ts'
import { LINK_STATUSES } from '../../domain/backupSchema.ts'
import type { FlavorChart, LinkStatus, SakeRecord } from '../../domain/types.ts'
import { defaultActions, summarize } from './importActions.ts'

function record(linkStatus: LinkStatus, sakenowaBrandId: number | null): SakeRecord {
  return {
    id: `id-${linkStatus}-${String(sakenowaBrandId)}`,
    drankOn: '2020-01-01',
    brandLabel: 'テスト酒',
    sakenowaBrandId,
    brandName: sakenowaBrandId === null ? null : 'テスト酒',
    linkStatus,
    prefecture: '福島県',
    spec: '',
    rating: null,
    place: '',
    note: '',
    thumbnail: null,
    sourceNo: null,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  }
}

function chart(brandId: number): FlavorChart {
  return { brandId, f1: 50, f2: 50, f3: 50, f4: 50, f5: 50, f6: 50 }
}

describe('summarize', () => {
  it('5値すべてを数える(列挙は LINK_STATUSES から引く)', () => {
    const records = LINK_STATUSES.map((status, index) => record(status, index + 1))

    const summary = summarize(records, new Map())

    expect(summary.total).toBe(LINK_STATUSES.length)
    for (const status of LINK_STATUSES) expect(summary.byStatus[status]).toBe(1)
  })

  it('紐付け済みとフレーバー取得済みを別に数える(チャートが無い銘柄がある)', () => {
    const records = [record('auto', 1), record('alias', 2), record('unlinked', null)]
    // 2 は紐付いているがチャートが無い(実データの `ビキニ娘` に相当する状況)
    const flavor = new Map([[1, chart(1)]])

    const summary = summarize(records, flavor)

    expect(summary.byStatus.auto + summary.byStatus.alias).toBe(2)
    expect(summary.withFlavor).toBe(1)
  })

  it('銘柄マスタが無いときは 0 ではなく null(数えていないことを表に出す)', () => {
    const summary = summarize([record('auto', 1)], null)

    expect(summary.withFlavor).toBeNull()
    expect(summary.byStatus.auto).toBe(1)
  })

  it('未紐付けはチャートを持つ銘柄IDが無いので数に入らない', () => {
    const summary = summarize([record('unlinked', null), record('unknown', null)], new Map())

    expect(summary.withFlavor).toBe(0)
  })

  it('空でも 0 を返す(件数が読めないことと 0件を混同しない)', () => {
    const summary = summarize([], new Map())

    expect(summary.total).toBe(0)
    expect(summary.withFlavor).toBe(0)
    for (const status of LINK_STATUSES) expect(summary.byStatus[status]).toBe(0)
  })
})

describe('defaultActions.exportFileName', () => {
  it('日付入りで、表示名(ブランド名)を含まない', () => {
    const fileName = defaultActions.exportFileName(new Date('2026-07-25T12:00:00'))

    expect(fileName).toMatch(/^[a-z-]+-\d{4}-\d{2}-\d{2}\.json$/)
    expect(fileName).toContain('2026-07-25')
    // 改名を表示文字列だけに閉じる方針(naming:check)。書き出すファイル名に表示名を入れない。
    // ブランド名のリテラルはここに書かない(書くと naming:check 自身が落ちる)ので
    // `config/app.ts` から引く。実装側の出所は backupSchema.ts なので恒真にならない(B15)。
    expect(fileName.toLowerCase()).not.toContain(APP_NAME.toLowerCase())
  })
})
