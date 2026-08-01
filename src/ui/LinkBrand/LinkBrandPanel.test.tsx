// 手動紐付け画面の通しテスト。**store を差し替えず fake-indexeddb に本物を書く** —
// 「画面では紐付いたのに永続化されていない」「解除したのに別名が残る」は境界でしか起きないので、
// 副作用をモックすると見られない(モックで固定する側は applyManualLink.test.ts が持っている)。
//
// jsdom で回す。この画面は `thumbnail` を触らないので Blob が `{}` に潰れる罠(Phase 3)には当たらない。
//
// ## このファイルが見張っているもの(PHASE_5 の完了条件)
//
// 1. e2e手順12 の形: 同じ表記の5件のうち1件を紐付けると**5件すべてが `manual`** になり、
//    **「他4本にも適用した」**と件数が画面に出る(無音で一括変更しない)。
// 2. 件数 N が実績値で、1本だけのときは件数を言わない文言に変わる。
// 3. 確認する前は1件も変わらない。
// 4. リロード相当(`listAliases` 再読込 → `mergeAliases` → `createLinker`)でも判断が効く。
// 5. **候補が0件でも全件検索に到達でき、0件は0件のまま**(3264件に広げない)。
// 6. **候補が1件あってもアプリが決めない** — 紐付けを拒否して `unlinked` のまま残せる。
// 7. 解除で `unlinked` に戻り、**保存した別名も消える**(県を埋めた後でも消える)。
// 8. runtime の別名が組み込み8件を上書きする。
//
// データは全部合成。銘柄・蔵元・県名は架空(`甲酒` / `甲蔵` / `甲県`)、日付は1種類だけ
// (`data/seed/` は gitignore。実台帳の日付と銘柄の対をテストに書かない)。例外は
// `BRAND_ALIASES` の label で、これはコミット済みのソースを**実行時に**引いている。

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { indexedDB as fakeIndexedDB, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb'
import { BRAND_ALIASES } from '../../data/brand-aliases.ts'
import { decodeTables, type RawSakenowaFiles } from '../../data/tables.ts'
import { createLinker } from '../../domain/linkBrand.ts'
import type { BrandAlias, SakeRecord } from '../../domain/types.ts'
import { clearAliases, listAliases, mergeAliases } from '../../store/aliases.ts'
import { closeDb } from '../../store/db.ts'
import { clearRecords, createRecord, getRecord, listRecords } from '../../store/records.ts'
import { LinkBrandPanel } from './LinkBrandPanel.tsx'

function installFakeIndexedDb(): void {
  Object.defineProperty(globalThis, 'indexedDB', {
    value: fakeIndexedDB,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'IDBKeyRange', {
    value: FakeIDBKeyRange,
    configurable: true,
    writable: true,
  })
}
installFakeIndexedDb()

// ---------------------------------------------------------------------------
// 合成テーブル
// ---------------------------------------------------------------------------
//
// **本物の `decodeTables` を通す**(索引の張り方や areaId 0 の扱いを写さない)。
// - `甲酒`(101) だけが一意な名前。検索から選ぶ的として使う
// - `同名酒` は3件(303 甲県 / 404 乙県 / 505 甲県)。**同名を1つに丸めない**ことと
//   「県一致を先に出す」並びを見るための組
// - 蔵 33 は**名前が空**(さけのわに48件ある「その県の蔵元不明」の受け皿と同じ形)
// - チャートは 101 / 202 / 303 / 606 だけ。紐付け済み ≠ フレーバー取得済みを行に出せるか

const RAW: RawSakenowaFiles = {
  // areas.json は**添字が areaId**。0 は「その他」で都道府県ではない
  areas: { copyright: '合成', rows: ['その他', '甲県', '乙県'] },
  breweries: {
    copyright: '合成',
    rows: [
      [11, '甲蔵', 1],
      [22, '乙蔵', 2],
      [33, '', 1],
    ],
  },
  brands: {
    copyright: '合成',
    rows: [
      [101, '甲酒', 11],
      [202, '乙酒', 22],
      [303, '同名酒', 11],
      [404, '同名酒', 22],
      [505, '同名酒', 33],
      [606, 'かくうしゅ', 11],
    ],
  },
  flavorCharts: {
    copyright: '合成',
    rows: [
      [101, 70, 60, 30, 50, 40, 65],
      [202, 41, 42, 43, 44, 45, 46],
      [303, 51, 52, 53, 54, 55, 56],
      [606, 61, 62, 63, 64, 65, 66],
    ],
  },
}

const TABLES = decodeTables(RAW)

/** さけのわに無い表記。手動紐付けの対象そのもの(名称一致では絶対に解決しない) */
const LABEL = 'てすとしゅ'

// ---------------------------------------------------------------------------
// 下ごしらえ
// ---------------------------------------------------------------------------

async function seed(over: Partial<SakeRecord> = {}): Promise<SakeRecord> {
  return createRecord({
    drankOn: '2020-01-01',
    brandLabel: LABEL,
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
    ...over,
  })
}

/** 同じ表記の記録を count 件。返りは作成順 */
async function seedSameLabel(count: number, over: Partial<SakeRecord> = {}): Promise<SakeRecord[]> {
  const records: SakeRecord[] = []
  for (let index = 0; index < count; index += 1) records.push(await seed(over))
  return records
}

function renderPanel(
  record: SakeRecord,
  records: readonly SakeRecord[],
  opts: { onChanged?: () => void; onClose?: () => void } = {},
) {
  return render(
    <LinkBrandPanel
      record={record}
      records={records}
      tables={TABLES}
      onClose={opts.onClose ?? (() => undefined)}
      onChanged={opts.onChanged}
    />,
  )
}

/** 見出しで節を掴む(候補の節と検索の節は同じ行の形なので、節で絞らないと取り違える) */
function section(name: string): HTMLElement {
  const found = screen.getByRole('heading', { name }).closest('section')
  if (found === null) throw new Error(`節が見つからない: ${name}`)
  return found
}

const candidateSection = () => section('表記が一致する候補')
const searchSection = () => section('すべての銘柄から探す')

function searchBox(): HTMLElement {
  return within(searchSection()).getByLabelText(/銘柄名/)
}

/** 節の中の選択ボタン(1行 = 1ボタン)の読み上げ名 */
function rowNames(scope: HTMLElement): string[] {
  return within(scope)
    .queryAllByRole('button', { name: /を選ぶ$/ })
    .map((button) => button.getAttribute('aria-label') ?? '')
}

/** 検索で1行を選び、確認ダイアログを出す */
async function choose(user: ReturnType<typeof userEvent.setup>, query: string, name: string) {
  await user.type(searchBox(), query)
  await user.click(within(searchSection()).getByRole('button', { name: `${name} を選ぶ` }))
}

const statusText = () => screen.getByRole('status').textContent ?? ''

/** 保存済みの別名を組み込み表と畳んで linker を組み直す = リロード相当 */
function linkerAfterReload(runtime: readonly BrandAlias[]) {
  return createLinker({
    brands: TABLES.brands,
    breweries: TABLES.breweries,
    areas: TABLES.areas,
    aliases: mergeAliases(BRAND_ALIASES, runtime),
  })
}

beforeEach(async () => {
  await clearRecords()
  await clearAliases()
})

afterAll(() => {
  closeDb()
})

// ---------------------------------------------------------------------------

describe('LinkBrandPanel — 手順12(同じ表記へ波及する)', () => {
  it('5件のうち1件を紐付けると5件すべてが manual になり、他4本と報告する', async () => {
    const user = userEvent.setup()
    const records = await seedSameLabel(5)
    const onChanged = vi.fn()
    renderPanel(records[0], records, { onChanged })

    // 出発点: 未紐付けのバッジが出ていて、表記一致の候補は0件
    expect(within(screen.getByRole('dialog')).getByText('未紐付け')).toBeInTheDocument()
    expect(rowNames(candidateSection())).toEqual([])
    expect(within(candidateSection()).getByText(/表記が一致する銘柄は無い/)).toBeInTheDocument()

    await choose(user, '甲酒', '甲酒')

    // 確認ダイアログが**適用する本数を先に**出す(無音で一括変更しない)
    expect(screen.getByText(/同じ表記で未紐付けの他4本/)).toBeInTheDocument()
    expect(screen.getByText(/都道府県が空の記録には 甲県 を入れる/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '紐付ける' }))

    await waitFor(() => {
      expect(statusText()).toBe('「甲酒」として紐付けた。同じ表記の他4本にも適用した。')
    })
    expect(onChanged).toHaveBeenCalled()

    // **5件すべてが manual**。1件だけ紐付いて残りが未紐付けのまま残らない
    const stored = await listRecords()
    expect(stored).toHaveLength(5)
    for (const row of stored) {
      expect(row.linkStatus).toBe('manual')
      expect(row.sakenowaBrandId).toBe(101)
      expect(row.brandName).toBe('甲酒')
      // 空だった県はさけのわ由来で埋まる
      expect(row.prefecture).toBe('甲県')
    }

    // 画面のバッジも手動に変わる(B28: manual バッジが実際に出ることの回収)
    expect(within(screen.getByRole('dialog')).getByText('手動')).toBeInTheDocument()
  })

  it('同じ表記が1件だけなら件数を言わない文言になる(「他0本」と言わない)', async () => {
    const user = userEvent.setup()
    const record = await seed()
    renderPanel(record, [record])

    await choose(user, '甲酒', '甲酒')
    expect(screen.getByText(/適用するのはこの1本だけ/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '紐付ける' }))

    await waitFor(() => {
      expect(statusText()).toBe('「甲酒」として紐付けた。適用したのはこの1本だけ。')
    })
    expect(statusText()).not.toContain('他0本')
  })

  it('同じ表記でも既に紐付いている記録は変えず、変えなかった本数を出す', async () => {
    const user = userEvent.setup()
    const [origin, other] = await seedSameLabel(2)
    const alreadyLinked = await seed({
      linkStatus: 'auto',
      sakenowaBrandId: 202,
      brandName: '乙酒',
      prefecture: '乙県',
    })
    renderPanel(origin, [origin, other, alreadyLinked])

    await choose(user, '甲酒', '甲酒')
    expect(screen.getByText(/同じ表記で未紐付けの他1本/)).toBeInTheDocument()
    expect(screen.getByText(/既に紐付いている1本は変えない/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '紐付ける' }))

    await waitFor(() => {
      expect(statusText()).toContain('他1本にも適用した')
    })
    expect(screen.getByText(/既に紐付いている1本は変えていない/)).toBeInTheDocument()

    // 機械が紐付けた記録は上書きされない
    const kept = await getRecord(alreadyLinked.id)
    expect(kept?.linkStatus).toBe('auto')
    expect(kept?.sakenowaBrandId).toBe(202)
  })

  it('確認をやめると記録も別名も1つも変わらない', async () => {
    const user = userEvent.setup()
    const records = await seedSameLabel(3)
    const onChanged = vi.fn()
    renderPanel(records[0], records, { onChanged })

    await choose(user, '甲酒', '甲酒')
    await user.click(screen.getByRole('button', { name: 'やめる' }))

    expect(screen.queryByText(/同じ表記で未紐付けの他2本/)).not.toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
    for (const row of await listRecords()) expect(row.linkStatus).toBe('unlinked')
    expect(await listAliases()).toEqual([])
  })

  it('保存した別名はリロード相当(listAliases 再読込)でも効く', async () => {
    const user = userEvent.setup()
    const records = await seedSameLabel(2)
    renderPanel(records[0], records)

    await choose(user, '甲酒', '甲酒')
    await user.click(screen.getByRole('button', { name: '紐付ける' }))
    await waitFor(() => {
      expect(statusText()).toContain('紐付けた')
    })

    // 県が空の記録から紐付けたのでワイルドカードで保存される
    const runtime = await listAliases()
    // `updatedAt`(同期の勝ち負けを決める値)が付くので、紐付けに効く3項目だけを見る
    expect(runtime).toMatchObject([{ label: LABEL, prefecture: null, brandId: 101 }])

    // 取り込み直しの経路でも同じ銘柄に解決する(次からは alias として効く)
    expect(linkerAfterReload(runtime)(LABEL, null)).toMatchObject({
      brandId: 101,
      brandName: '甲酒',
      status: 'alias',
    })
    // 表記が違う記録に波及はしない(別名は表記のキーで効く)
    expect(linkerAfterReload(runtime)('別のてすと', null).status).toBe('unlinked')
  })

  it('runtime の別名が組み込み8件を上書きする(mergeAliases の規則がここでも効く)', async () => {
    const user = userEvent.setup()
    // 組み込みの県なしエントリと同じキーを本人が上書きする。**label はソースから実行時に引く**
    const builtin = BRAND_ALIASES.find((alias) => alias.prefecture === null)
    if (builtin === undefined) throw new Error('組み込み表に県なしのエントリが無い')

    const record = await seed({ brandLabel: builtin.label })
    renderPanel(record, [record])

    await choose(user, '甲酒', '甲酒')
    await user.click(screen.getByRole('button', { name: '紐付ける' }))
    await waitFor(() => {
      expect(statusText()).toContain('紐付けた')
    })

    const merged = mergeAliases(BRAND_ALIASES, await listAliases())
    // 同じキーなので行は増えず、値だけが本人の判断に置き換わる
    expect(merged).toHaveLength(BRAND_ALIASES.length)
    expect(merged.filter((alias) => alias.label === builtin.label)).toEqual([
      { label: builtin.label, prefecture: null, brandId: 101 },
    ])
    expect(linkerAfterReload(await listAliases())(builtin.label, null).brandId).toBe(101)
  })
})

describe('LinkBrandPanel — 候補と全件検索', () => {
  it('候補が0件でも全件検索から選べる(候補0件を全件に広げない)', async () => {
    const user = userEvent.setup()
    const record = await seed()
    renderPanel(record, [record])

    // 候補0件。ここで 3264件(合成では6件)を並べない
    expect(rowNames(candidateSection())).toEqual([])
    // 検索も未入力では0件(空クエリで全件を出さない)
    expect(rowNames(searchSection())).toEqual([])
    expect(within(searchSection()).getByText(/銘柄名を入力すると候補が出る/)).toBeInTheDocument()

    // 一致0件は0件のまま。「該当なし」と言って全件に落ちない
    await user.type(searchBox(), '該当しない表記')
    expect(rowNames(searchSection())).toEqual([])
    expect(within(searchSection()).getByText(/該当なし/)).toBeInTheDocument()

    await user.clear(searchBox())
    await user.type(searchBox(), '甲酒')
    expect(rowNames(searchSection())).toEqual(['甲酒 を選ぶ'])
  })

  it('同名の候補を丸めず、都道府県・蔵元・フレーバーの有無で選び分けられる', async () => {
    const user = userEvent.setup()
    // 甲県には `同名酒` が2件あるので機械は決められない(候補は県違いも含めて全部見せる)
    const record = await seed({ brandLabel: '同名酒', prefecture: '甲県' })
    renderPanel(record, [record])

    // 県一致(303 / 505)を先に出し、県違いの同名(404)も落とさない
    expect(rowNames(candidateSection())).toEqual([
      '同名酒 を選ぶ',
      '同名酒 を選ぶ',
      '同名酒 を選ぶ',
    ])
    const rows = within(candidateSection()).getAllByRole('button', { name: '同名酒 を選ぶ' })
    expect(rows[0].textContent).toContain('記録と同じ都道府県')
    expect(rows[0].textContent).toContain('甲蔵')
    expect(rows[0].textContent).toContain('フレーバーあり')
    // 蔵元名が空の行は空欄にせず「無い」と書く(取得できているように見せない)
    expect(rows[1].textContent).toContain('蔵元名がデータに無い')
    expect(rows[1].textContent).toContain('フレーバー無し')
    // 3件目は県が違うので印が付かない
    expect(rows[2].textContent).toContain('乙県')
    expect(rows[2].textContent).not.toContain('記録と同じ都道府県')

    // 選ぶと確認ダイアログが県の食い違いを隠さずに出す
    await user.click(rows[2])
    expect(screen.getByText(/別の蔵の同名かもしれない/)).toBeInTheDocument()
    expect(screen.getByText(/記録の値を残す/)).toBeInTheDocument()
  })

  it('IME の変換中は「該当なし」を出さない', async () => {
    const user = userEvent.setup()
    const record = await seed()
    renderPanel(record, [record])

    const input = searchBox()
    // かな入力はマスタに読みが無いので0件。変換確定前に「該当なし」を出すと機能が壊れて見える
    await user.click(input)
    fireEvent.compositionStart(input)
    await user.type(input, 'こうしゅ')
    expect(within(searchSection()).getByText('変換中。')).toBeInTheDocument()
    expect(within(searchSection()).queryByText(/該当なし/)).not.toBeInTheDocument()

    fireEvent.compositionEnd(input)
    expect(within(searchSection()).getByText(/該当なし/)).toBeInTheDocument()
  })
})

describe('LinkBrandPanel — 拒否と解除', () => {
  it('候補が1件あってもアプリが決めない。拒否すれば未紐付けのまま残り別名も作られない', async () => {
    const user = userEvent.setup()
    // さけのわの同名は甲県、記録は丙県(= 別の蔵の別物かもしれない)。SPEC は本人判断に委ねる
    const record = await seed({ brandLabel: 'かくうしゅ', prefecture: '丙県' })
    const onChanged = vi.fn()
    renderPanel(record, [record], { onChanged })

    // 候補は1件出るが、勝手に選ばれてはいない
    expect(rowNames(candidateSection())).toEqual(['かくうしゅ を選ぶ'])
    expect(screen.queryByRole('button', { name: '紐付ける' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '別物として紐付けない' }))

    expect(statusText()).toContain('未紐付けのまま残した')
    expect(statusText()).toContain('別名は保存していない')
    const stored = await getRecord(record.id)
    expect(stored?.linkStatus).toBe('unlinked')
    expect(stored?.sakenowaBrandId).toBeNull()
    expect(stored?.prefecture).toBe('丙県')
    expect(await listAliases()).toEqual([])
    expect(onChanged).not.toHaveBeenCalled()

    // 判断は後から変えられる(候補も検索もそのまま残っている)
    expect(rowNames(candidateSection())).toEqual(['かくうしゅ を選ぶ'])
  })

  it('解除で未紐付けに戻り、保存した別名も消える(紐付けで県が埋まった後でも消える)', async () => {
    const user = userEvent.setup()
    const records = await seedSameLabel(3)
    const first = renderPanel(records[0], records)

    await choose(user, '甲酒', '甲酒')
    await user.click(screen.getByRole('button', { name: '紐付ける' }))
    await waitFor(() => {
      expect(statusText()).toContain('他2本にも適用した')
    })
    expect(await listAliases()).toHaveLength(1)
    first.unmount()

    // **画面を開き直してから解除する**(記録は県が埋まった状態で DB から来る)。
    // 消すキーを記録の県から組み立てる実装だと、ここで別名だけが残る
    const linked = await listRecords()
    expect(linked.every((row) => row.prefecture === '甲県')).toBe(true)
    const onChanged = vi.fn()
    renderPanel(linked[0], linked, { onChanged })

    expect(within(screen.getByRole('dialog')).getByText('手動')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '紐付けを解除する' }))
    await user.click(screen.getByRole('button', { name: '解除する' }))

    await waitFor(() => {
      expect(statusText()).toContain('未紐付けに戻した')
    })
    expect(statusText()).toContain('他2本も戻した')
    expect(statusText()).toContain('別名も消した')
    expect(onChanged).toHaveBeenCalled()

    // 3件とも未紐付けに戻り、別名も消えている = 取り込み直しで復活しない
    for (const row of await listRecords()) {
      expect(row.linkStatus).toBe('unlinked')
      expect(row.sakenowaBrandId).toBeNull()
      expect(row.brandName).toBeNull()
    }
    expect(await listAliases()).toEqual([])
    expect(linkerAfterReload(await listAliases())(LABEL, null).status).toBe('unlinked')

    // 解除した画面からもう一度選び直せる(候補と検索が戻ってくる)
    expect(within(screen.getByRole('dialog')).getByText('未紐付け')).toBeInTheDocument()
    expect(searchBox()).toBeInTheDocument()
  })

  it('解除をやめると紐付けも別名も残る', async () => {
    const user = userEvent.setup()
    const record = await seed()
    renderPanel(record, [record])

    await choose(user, '甲酒', '甲酒')
    await user.click(screen.getByRole('button', { name: '紐付ける' }))
    await waitFor(() => {
      expect(statusText()).toContain('紐付けた')
    })

    await user.click(screen.getByRole('button', { name: '紐付けを解除する' }))
    await user.click(screen.getByRole('button', { name: 'やめる' }))

    expect((await getRecord(record.id))?.linkStatus).toBe('manual')
    expect(await listAliases()).toHaveLength(1)
  })
})
