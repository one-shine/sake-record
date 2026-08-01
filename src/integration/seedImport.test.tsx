// 取り込み → 永続化 → 画面の**通し**のテスト。層ごとの単体テストが緑でも
// 「ストアは203件なのに画面は202行」は境界でしか起きないので、ここだけが見られる。
//
// jsdom(既定の環境)で回す。**Timeline を実際に描いて DOM の行数を数える**のがこのファイルの
// 存在理由で、件数の自己申告(`records.length`)では A9 の証拠にならない。
// fake-indexeddb + jsdom は `Blob` を `{}` に潰すが、203本は写真が1枚も無い(`thumbnail: null`)
// ので影響しない。サムネイル付きの往復は backup.test.ts が node 環境で見ている。
//
// ## 2部構成 — 後半は CI で走らない
//
// - **前半(常に走る)**: 203件の**合成**行を store に流して Timeline を描き、DOM 行数 = 203 と
//   「同日・同銘柄の重複が潰れない」を固定する。合成なのでどの環境でも走る。
// - **後半(`data/seed/sake-log-rows.json` がある環境だけ)**: 実データ203本を通して
//   紐付けの実測値(auto 173 / alias 13 / unlinked 12 / unknown 5 / フレーバー185)を固定する。
//   **seed は gitignore なので CI には存在せず、この describe はまるごと skip される**
//   (vitest の要約に `skipped` として出るので無音の緑にはならない)。BACKLOG B23 と同じ構造の
//   制約で、実データ側の期待値を守れるのは手元での実行だけ。**skip されている環境では
//   実測値は未検証**であることを忘れない。
//
// ファイルの読み込みに `fs` を使わないのは Node の型を要求しないため
// (`/// <reference types="node" />` は @types/node の global 宣言をプログラム全体に効かせる。
// tsconfig.app.json のコメント参照)。`import.meta.glob` は**マッチが無ければ空オブジェクト**を
// 返すので、存在しないファイルでも解決時エラーにならず skip 判定に使える。
//
// **実データの内容(日付・銘柄・備考)はこのファイルに1文字も書かない。** 期待値は件数と
// 順序の不変条件だけで、失敗時に台帳が端末の外へ出ないよう assert は件数と真偽値に留める
// (要素の配列を toHaveLength に渡すと差分に中身が出るので `.length` を比べる)。

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { indexedDB as fakeIndexedDB, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb'
import areasJson from '../../public/data/sakenowa/areas.json'
import brandsJson from '../../public/data/sakenowa/brands.json'
import breweriesJson from '../../public/data/sakenowa/breweries.json'
import flavorChartsJson from '../../public/data/sakenowa/flavorCharts.json'
import type { SakeLogRow } from '../domain/parseSakeLog.ts'
import { computeStats } from '../domain/stats.ts'
import type {
  AreasFile,
  BrandsFile,
  BreweriesFile,
  FlavorChartsFile,
  LinkResult,
  Linker,
  SakeRecord,
} from '../domain/types.ts'
import { exportAll, importAll } from '../store/backup.ts'
import { clearAll, closeDb } from '../store/db.ts'
import { invalidateTables } from '../store/linking.ts'
import { byNewestFirst, checkImportRows, importRows, listRecords } from '../store/records.ts'
import { notice } from '../test/notice.ts'
import { defaultActions, type ImportSummary } from '../ui/ImportExport/importActions.ts'
import { Timeline } from '../ui/Timeline/Timeline.tsx'

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

const noop = () => {}

/** 行は `<ol><li>`。**要素の配列ではなく件数を比べる**(失敗時に DOM を吐かせない) */
function rowCount(): number {
  return screen.queryAllByRole('listitem').length
}

/**
 * ここは**App と同じ配線**を通す(`counts` に `computeStats(records)` を渡す)。ピルの件数を
 * この面で検査しているわけではないが、実データ203本で「渡した `Stats` の形で描ける」ことは
 * 単体テスト側(リテラルの `counts`)では確かめられない。
 */
function renderTimeline(records: readonly SakeRecord[]) {
  return render(
    <Timeline
      records={records}
      counts={computeStats(records)}
      onImport={noop}
      onCreate={noop}
    />,
  )
}

// ---------------------------------------------------------------------------
// 前半: 合成203件で「ストアの件数 = DOM の行数」を固定する
// ---------------------------------------------------------------------------

/**
 * 203件の合成行。実データの形だけを真似る:
 * - 同じ日に7件ずつ(実データは同日に最大6〜7件)
 * - **各日の最後の2件は日付も銘柄も完全に同じ**(表/裏ラベルとして2本に数えている組の再現)
 *
 * 日付は組み立てて作る(完成した `YYYY-MM-DD` のリテラルをこのファイルに溜めない。B22)。
 */
function syntheticRows(count: number): SakeLogRow[] {
  const rows: SakeLogRow[] = []
  for (let i = 0; i < count; i += 1) {
    const dayIndex = Math.floor(i / 7)
    const day = String((dayIndex % 28) + 1).padStart(2, '0')
    const month = String((Math.floor(dayIndex / 28) % 12) + 1).padStart(2, '0')
    const withinDay = i % 7
    // 6 番目は 5 番目と同じ銘柄にする = 同日・同銘柄・同内容の2件
    rows.push({
      no: i + 1,
      drankOn: `2020-${month}-${day}`,
      brandLabel: `テスト酒${String(withinDay === 6 ? 5 : withinDay)}`,
      prefecture: '',
      spec: '',
      note: '',
    })
  }
  return rows
}

/** 何も紐付けない Linker(前半は紐付けの実測値を見ない。紐付けは後半と linkBrand.test.ts) */
const noLinker: Linker = (): LinkResult => ({
  brandId: null,
  brandName: null,
  status: 'unlinked',
  candidates: [],
})

const noTables = { prefectureOfBrand: () => null }

describe('合成203件: ストアの件数と DOM の行数が一致する', () => {
  beforeAll(async () => {
    await clearAll(['records', 'aliases'])
    await importRows(syntheticRows(203), noLinker, noTables)
  })

  afterAll(() => {
    closeDb()
  })

  it('203件が保存され、DOM も203行になる', async () => {
    const records = await listRecords()
    expect(records.length).toBe(203)

    renderTimeline(records)

    expect(rowCount()).toBe(203)
    expect(screen.getByText('全 203本')).toBeInTheDocument()
  })

  // **初回描画だけでは捕まらない事故**: key が衝突していても React は初回は両方描き、
  // console.error に「同じ key の子が2つ」を出すだけ。
  //
  // **行数で捕まえるには「衝突した行が絞り込みで落ちる」操作でなければならない。**
  // 重複 key の行が表示対象から外れると片方が DOM に取り残される。逆に「全件に一致する
  // 検索語」や「絞り込みパネルの開閉」では表示対象が変わらないので行数はずれず、
  // 検出が dev ビルド限定の警告の文面に依存してしまう(それでは行数で見張れていない)。
  //
  // 合成データは各日 7件のうち `テスト酒5` が2件(同日・同銘柄)。`テスト酒0` で絞ると
  // **その重複2件が毎日落ちる** = 各日1件だけが残るので、203 → 29 → 203 を数える。
  // (mutation で確認: key を `drankOn + brandLabel` にすると 29 と 203 の両方がずれる)
  it('同日・同銘柄の重複が絞り込みで落ちても行数がストアと一致する(29件に絞って戻す)', async () => {
    const user = userEvent.setup()
    const records = await listRecords()
    // 期待値の出所は「ストアに入っている行」。画面が数えた件数ではない
    const expected = records.filter((record) => record.brandLabel === 'テスト酒0').length
    expect(expected).toBe(29) // 203件 = 29日 × 7件。`テスト酒0` は各日1件

    const logged: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => String(arg)).join(' '))
    })
    try {
      renderTimeline(records)
      expect(rowCount()).toBe(203)

      const box = screen.getByRole('searchbox')
      await user.type(box, 'テスト酒0')
      expect(rowCount()).toBe(expected)

      // 解除して戻す(取り残された行があればここで203を超える)
      await user.clear(box)
      expect(rowCount()).toBe(203)
      expect(logged.join('\n')).toBe('')
    } finally {
      spy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// 後半: 実データ203本(seed がある環境だけ)
// ---------------------------------------------------------------------------

/**
 * `data/seed/sake-log-rows.json`(gitignore 済み・203件)。**無ければ空オブジェクト**が返る。
 * 中身はここに転記せず、実行時に読むだけ。
 */
const seedGlob: Record<string, unknown> = import.meta.glob(
  '../../data/seed/sake-log-rows.json',
  { eager: true, import: 'default' },
)
const seedFile: unknown = Object.values(seedGlob)[0] ?? null
const hasSeed = seedFile !== null

if (!hasSeed) {
  // 要約の `skipped` だけでは何が未検証か分からない。**skip を無音にしない**
  // (出力の作り方 = なぜ console では出ないかは `src/test/notice.ts` の1箇所が持つ)
  notice(
    '[seedImport.test] SKIP: data/seed/sake-log-rows.json が無いので、実データ203本の' +
      '紐付け実測値(auto 173 / alias 13 / unlinked 12 / unknown 5 / フレーバー185)と' +
      '203行の DOM を検証していない。',
  )
}

/** 同梱データは `public/` に常にあるので静的 import で読み、fetch だけ差し替える */
const SAKENOWA_FILES: Record<string, unknown> = {
  'areas.json': areasJson as AreasFile,
  'breweries.json': breweriesJson as unknown as BreweriesFile,
  'brands.json': brandsJson as unknown as BrandsFile,
  'flavorCharts.json': flavorChartsJson as unknown as FlavorChartsFile,
}

/** ブラウザと同じ経路(loadTables → fetch → decodeTables)を通すための stub */
function stubSakenowaFetch(): void {
  vi.stubGlobal('fetch', (input: unknown) => {
    const url = String(input)
    const name = url.slice(url.lastIndexOf('/') + 1)
    const body = SAKENOWA_FILES[name]
    if (body === undefined) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  })
}

// `data/seed/` が無い環境(CI)ではこの describe 全体が skip される。
// 要約の `skipped` が「実測値を検証していない」の唯一の合図なので、見落とさないこと。
describe.skipIf(!hasSeed)('実データ203本(data/seed/sake-log-rows.json がある環境のみ)', () => {
  let summary: ImportSummary

  beforeAll(async () => {
    invalidateTables()
    stubSakenowaFetch()
    await clearAll(['records', 'aliases'])
    // UI の「取り込む」が呼ぶのと同じ経路(検証 → テーブル取得 → clear → 保存 → 集計)
    const outcome = await defaultActions.importSeed(mustRows(seedFile))
    expect(outcome.ok).toBe(true)
    expect(outcome.errors).toEqual([])
    if (outcome.summary === null) throw new Error('取り込み後の内訳を数えられなかった')
    summary = outcome.summary
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    invalidateTables()
    closeDb()
  })

  it('行の配列として読める(壊れていたら理由を出して落ちる)', () => {
    const check = checkImportRows(seedFile)
    // 失敗時に理由が読めるように、真偽ではなく文字列で比べる(理由に台帳の値は入らない)
    expect(check.ok ? 'ok' : check.reason).toBe('ok')
  })

  it('203件が保存される', () => {
    expect(summary.total).toBe(203)
  })

  it('紐付けの内訳が実測値と一致する(auto 178 / alias 13 / unlinked 7 / unknown 5)', () => {
    expect(summary.byStatus).toEqual({
      auto: 178,
      alias: 13,
      // 取り込みの Linker は manual を返さない(手動紐付けは Phase 5)
      manual: 0,
      unlinked: 7,
      unknown: 5,
    })
    expect(summary.byStatus.auto + summary.byStatus.alias).toBe(191)
  })

  it('紐付け済み(191) ≠ フレーバー取得済み(190)', () => {
    // 1本(id 2020)は紐付くがさけのわ側にチャートが無い。0 で埋めず 1本足りないまま出す
    expect(summary.withFlavor).toBe(190)
    expect(summary.withFlavor).toBeLessThan(summary.byStatus.auto + summary.byStatus.alias)
  })

  it('DOM も203行になる(ストアの自己申告ではなく画面を数える)', async () => {
    const user = userEvent.setup()
    const records = await listRecords()
    expect(records.length).toBe(203)

    renderTimeline(records)

    expect(rowCount()).toBe(203)
    expect(screen.getByText('全 203本')).toBeInTheDocument()

    // 絞り込みパネルの開閉は表示対象を変えないので、行数は203のまま
    await user.click(screen.getByRole('button', { name: '絞り込み' }))

    expect(rowCount()).toBe(203)
  })

  // **実データで key 衝突を行数として捕まえる。** 重複 key の行が絞り込みで表示対象から
  // 外れると React は片方を DOM に取り残す(合成データでの実測: 1行のはずが2行、
  // 解除後は3行のはずが4行)。したがって**同日・同銘柄の組を含まない年**に絞る必要がある。
  // その年と件数は実行時に選ぶ(台帳の値をこのファイルに書かない)。
  it('同日・同銘柄の組が絞り込みで落ちても、行数がストアと一致する', async () => {
    const user = userEvent.setup()
    const records = await listRecords()
    const { year, count } = pickYearWithoutSameDaySameBrand(records)
    // 絞り込みが「全件」でも「0件」でもないこと = 双子が落ちる部分集合であること
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(records.length)

    renderTimeline(records)
    expect(rowCount()).toBe(203)

    await user.click(screen.getByRole('button', { name: '絞り込み' }))
    // ピルは textContent で探す(getByRole の名前引きは見つからないときに DOM を吐くので、
    // 台帳が失敗ログに出ないようこちらで例外にする)
    const label = `${year}年${String(count)}`
    const pill = screen.queryAllByRole('button').find((button) => button.textContent === label)
    if (pill === undefined) throw new Error('選んだ年の絞り込みピルが見つからない')

    await user.click(pill)
    expect(rowCount()).toBe(count)

    // 解除して戻す(取り残された行があればここで203を超える)
    await user.click(pill)
    expect(rowCount()).toBe(203)
  })

  it('2回取り込んでも406件にならない(全置換)', async () => {
    const again = await defaultActions.importSeed(mustRows(seedFile))

    expect(again.imported.records).toBe(203)
    expect((await listRecords()).length).toBe(203)
  })

  it('新しい順に全順序で並ぶ(同日は No. の逆順で、同値のペアが1組も無い)', async () => {
    const records = await listRecords()

    const newest = [...records].map((record) => record.drankOn).sort().at(-1)
    expect(records[0].drankOn).toBe(newest)

    let sameDayPairs = 0
    for (let i = 1; i < records.length; i += 1) {
      const previous = records[i - 1]
      const current = records[i]
      // 0(= 同値)が1組でもあると並びが engine 依存になる。厳密に「前」であること
      expect(byNewestFirst(previous, current)).toBeLessThan(0)
      if (previous.drankOn === current.drankOn) {
        sameDayPairs += 1
        // 取り込みが createdAt を No. 昇順に厳密増加で振るので、同日は No. の逆順になる
        expect(previous.sourceNo).not.toBeNull()
        expect(current.sourceNo).not.toBeNull()
        expect(Number(previous.sourceNo)).toBeGreaterThan(Number(current.sourceNo))
      }
    }
    // 同日が1組も無いなら上のループは何も検査していない(203本は同日に最大6〜7件ある)
    expect(sameDayPairs).toBeGreaterThan(0)
  })

  it('エクスポート → 全消し → インポートで203件が戻る(A11)', async () => {
    const blob = await exportAll()
    const text = await blobToText(blob)

    await clearAll(['records', 'aliases'])
    expect((await listRecords()).length).toBe(0)

    const result = await importAll(text)

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.imported.records).toBe(203)

    const restored = await listRecords()
    expect(restored.length).toBe(203)
    // 紐付けの根拠も往復で失われない(status だけは復元後も同じ内訳になる)
    const counts = restored.reduce<Record<string, number>>((acc, record) => {
      acc[record.linkStatus] = (acc[record.linkStatus] ?? 0) + 1
      return acc
    }, {})
    expect(counts).toEqual({ auto: 178, alias: 13, unlinked: 7, unknown: 5 })
  })
})

/**
 * Blob → 文字列。**jsdom の `Blob` は `text()` を持たない**ので FileReader で読む
 * (実ブラウザには `Blob.text()` があり、パネル側 `readFileText` も同じ2経路になっている)。
 */
function blobToText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '')
    }
    reader.onerror = () => {
      reject(new Error('バックアップの Blob を読み取れない'))
    }
    reader.readAsText(blob)
  })
}

/**
 * 「同日・同銘柄の2件」を1組も含まない年のうち、いちばん本数の多い年を返す。
 *
 * **返すのは実行時に読んだ値**で、期待値は「その年に属する記録の件数」= ストア側の数え上げ。
 * 画面が出す件数表示から取らないので、DOM とストアの食い違いを検出できる。
 * 選べる年が無ければ落とす(その場合このテストは何も検査していないことになる)。
 */
function pickYearWithoutSameDaySameBrand(records: readonly SakeRecord[]): {
  year: string
  count: number
} {
  const groups = new Map<string, number>()
  for (const record of records) {
    const key = `${record.drankOn} ${record.brandLabel}`
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  const yearsWithTwins = new Set(
    [...groups]
      .filter(([, n]) => n > 1)
      .map(([key]) => key.slice(0, 4)),
  )
  // 同日・同銘柄の組が1つも無いなら、この選び方では key 衝突を作れない = 検査になっていない
  expect(yearsWithTwins.size).toBeGreaterThan(0)

  const counts = new Map<string, number>()
  for (const record of records) {
    const year = record.drankOn.slice(0, 4)
    if (yearsWithTwins.has(year)) continue
    counts.set(year, (counts.get(year) ?? 0) + 1)
  }
  const best = [...counts].sort(([, a], [, b]) => b - a)[0]
  if (best === undefined) throw new Error('同日・同銘柄の組を含まない年が1つも無い')
  return { year: best[0], count: best[1] }
}

/** 検証を通った行だけを返す。壊れていたら理由を言って落ちる(理由に台帳の値は入らない) */
function mustRows(value: unknown): SakeLogRow[] {
  const check = checkImportRows(value)
  if (!check.ok) throw new Error(`data/seed/sake-log-rows.json を取り込めない: ${check.reason}`)
  return check.rows
}
