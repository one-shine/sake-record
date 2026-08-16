// 督促の約束を固定する: **守るものが無いなら黙る / しきい値で2段に切り替わる /
// 一度も書き出していない状態を見逃さない / 永続化を得られていないことを UA 判定なしで言う /
// 書き出したら起点が進む。**
//
// 前半は `BackupNag` 単体(props だけ。DB も時計も触らない)。後半は `ImportExportPanel` との
// 配線を実 IndexedDB(fake-indexeddb)で通す。**`markExported` と `loadBackupState` は
// 差し替えず既定の実装(= store/meta.ts への本物の書き込み)を使う** — ここをモックにすると
// 「パネルが何かを呼んだ」ことしか分からず、`meta` に日時が入るかは一度も検証されない。
//
// `meta` に入るのは文字列だけなので jsdom でも往復は壊れない(store 層のテストを node 環境で
// 回しているのは Blob の structuredClone が潰れるためで、ここは Blob を通らない)。
//
// 日時はすべて合成。台帳の日付は書かない。

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { indexedDB as fakeIndexedDB, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb'
import { clear, closeDb } from '../../store/db.ts'
import { daysSince, getLastExportedAt, setLastExportedAt } from '../../store/meta.ts'
import { BackupNag } from './BackupNag.tsx'
import { ImportExportPanel } from './ImportExportPanel.tsx'
import type { ApplyOutcome, ImportExportActions } from './importActions.ts'

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

/** 判定の基準時刻(合成) */
const NOW = new Date('2020-02-01T00:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

/** `NOW` から `days` 日前の ISO 日時 */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString()
}

describe('BackupNag', () => {
  it('記録が0件なら何も出さない(守るものが無いのに督促しない)', () => {
    const { container } = render(
      <BackupNag recordCount={0} lastExportedAt={null} persistence="denied" now={NOW} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('一度も書き出していなければ、経過日数が無くても督促する', () => {
    render(<BackupNag recordCount={3} lastExportedAt={null} persistence="granted" now={NOW} />)

    expect(screen.getByRole('status')).toHaveTextContent('まだ一度も書き出していない')
    // 分母(何件が危ないのか)を出す
    expect(screen.getByRole('status')).toHaveTextContent('記録は3件')
    // 経過日数が分からないので段は上げない(分からないことを強さで埋めない)
    expect(screen.queryByText(/1か月以上/)).toBeNull()
  })

  it('13日では出さない(しきい値の手前)', () => {
    const { container } = render(
      <BackupNag recordCount={3} lastExportedAt={daysAgo(13)} persistence="granted" now={NOW} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('14日で注意を出す', () => {
    render(
      <BackupNag recordCount={3} lastExportedAt={daysAgo(14)} persistence="granted" now={NOW} />,
    )

    expect(screen.getByText('最後に書き出してから14日経った')).toBeInTheDocument()
    expect(screen.queryByText(/1か月以上/)).toBeNull()
  })

  it('29日はまだ注意の段(境界の手前)', () => {
    render(
      <BackupNag recordCount={3} lastExportedAt={daysAgo(29)} persistence="granted" now={NOW} />,
    )

    expect(screen.getByText('最後に書き出してから29日経った')).toBeInTheDocument()
    expect(screen.queryByText(/1か月以上/)).toBeNull()
  })

  it('30日で強めの段に切り替わる(2段が切り替わる)', () => {
    render(
      <BackupNag recordCount={3} lastExportedAt={daysAgo(30)} persistence="granted" now={NOW} />,
    )

    expect(screen.getByText('最後に書き出してから30日経った（1か月以上）')).toBeInTheDocument()
    // 強めの段だけが足す一文。**「その後に記録が増えた」とは言わない**(見ていない)
    expect(screen.getByRole('status')).toHaveTextContent(
      '最後の書き出しより後に作った記録や編集は、その JSON に入っていない',
    )
  })

  it('読み取れない日時は「一度も書き出していない」に畳まず、読めないと言う', () => {
    render(<BackupNag recordCount={3} lastExportedAt="きのう" persistence="granted" now={NOW} />)

    expect(screen.getByRole('status')).toHaveTextContent('最後に書き出した日時を読み取れない')
    expect(screen.queryByText(/まだ一度も書き出していない/)).toBeNull()
  })

  it('永続化を得られていなければ、ホーム画面への追加と消える条件を案内する', () => {
    render(<BackupNag recordCount={3} lastExportedAt={daysAgo(1)} persistence="denied" now={NOW} />)

    // 経過日数はしきい値未満なので督促は出ないが、退避の案内だけは出る
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText(/ホーム画面に追加/)).toBeInTheDocument()
    expect(screen.getByText('7日間使わなかった時点')).toBeInTheDocument()
    expect(screen.getByText(/サイトデータを削除したとき/)).toBeInTheDocument()
    // **ブラウザを名指ししない**(UA 判定でも UA 依存の文言でもなく、得られなかった事実で分岐する)
    expect(screen.queryByText(/Safari/)).toBeNull()
    expect(screen.queryByText(/iOS/)).toBeNull()
  })

  it('永続化の仕組みが無い環境(unsupported)も案内する。拒否とは別の文言', () => {
    render(
      <BackupNag recordCount={3} lastExportedAt={daysAgo(1)} persistence="unsupported" now={NOW} />,
    )

    expect(screen.getByText(/永続化を要求する仕組みが無い/)).toBeInTheDocument()
    expect(screen.getByText(/ホーム画面に追加/)).toBeInTheDocument()
  })

  it('永続化が得られている(granted)なら案内は出さない', () => {
    render(
      <BackupNag recordCount={3} lastExportedAt={daysAgo(30)} persistence="granted" now={NOW} />,
    )

    expect(screen.getByText(/1か月以上/)).toBeInTheDocument()
    expect(screen.queryByText(/ホーム画面に追加/)).toBeNull()
  })

  it('永続化が未確認(null)なら断定しない(案内も出さない)', () => {
    const { container } = render(
      <BackupNag recordCount={3} lastExportedAt={daysAgo(1)} persistence={null} now={NOW} />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})

// ---------------------------------------------------------------------------
// ImportExportPanel との配線(実 IndexedDB)
// ---------------------------------------------------------------------------

function outcome(over: Partial<ApplyOutcome> = {}): ApplyOutcome {
  return {
    ok: true,
    errors: [],
    applied: ['records 2件'],
    imported: { records: 2, aliases: 0 },
    summary: null,
    ...over,
  }
}

/**
 * `markExported` / `requestPersistence` / `loadBackupState` は**あえて渡さない**
 * (既定の実装 = store への本物の配線を使う)。渡すのは DB を壊す副作用だけを持つもの。
 */
function panelActions(): Partial<ImportExportActions> {
  return {
    exportBackup: vi.fn<ImportExportActions['exportBackup']>(() =>
      Promise.resolve(new Blob(['{"records":[]}'], { type: 'application/json' })),
    ),
    exportFileName: vi.fn<ImportExportActions['exportFileName']>(
      () => 'sake-record-backup-2020-01-01.json',
    ),
    saveBlob: vi.fn<ImportExportActions['saveBlob']>(),
    importSeed: vi.fn<ImportExportActions['importSeed']>(() => Promise.resolve(outcome())),
    importBackup: vi.fn<ImportExportActions['importBackup']>(() => Promise.resolve(outcome())),
    clearAllData: vi.fn<ImportExportActions['clearAllData']>(() => Promise.resolve()),
  }
}

const SEED_ROWS = [
  { no: 1, drankOn: '2020-01-01', brandLabel: 'テスト酒', prefecture: '福島県', spec: '', note: '' },
]

function jsonFile(name: string, value: unknown): File {
  return new File([JSON.stringify(value)], name, { type: 'application/json' })
}

// **同期を入れて事実が変わった(B7)。** 「書き出した JSON 以外に復元手段は無い」は
// 同期を設定していない端末では今も真だが、設定した端末では嘘になる。**どちらにも嘘を言わない**
describe('同期の有無で復元手段の説明を変える(B7)', () => {
  const nag = (synced: boolean) =>
    render(
      <BackupNag
        recordCount={5}
        lastExportedAt={daysAgo(40)}
        persistence="denied"
        synced={synced}
        now={NOW}
      />,
    )

  it('同期していない端末には「ここにしか無い」と言う', () => {
    nag(false)

    expect(screen.getByRole('status')).toHaveTextContent(
      'この端末のブラウザ内（IndexedDB）にしか無く',
    )
    expect(screen.getByText(/どちらも書き出した JSON からしか戻せない/u)).toBeInTheDocument()
  })

  it('同期している端末に「ここにしか無い」と言わない', () => {
    nag(true)

    expect(screen.getByRole('status')).not.toHaveTextContent('にしか無く')
    expect(screen.getByRole('status')).toHaveTextContent('同期先にある')
  })

  // **「同期しているから安全」とも言わない。** 同期先に届いているのは送れた分だけで、
  // オフラインで作った記録はまだこの端末にしか無い
  it('同期していても「送れていない分は戻らない」を言う', () => {
    nag(true)

    expect(screen.getByRole('status')).toHaveTextContent('まだ送れていない分は')
    expect(screen.getByText(/送れていない分は書き出した JSON からしか戻らない/u)).toBeInTheDocument()
  })

  // **同期先も1箇所で、消えるときは一緒に消える。** 世代を残すバックアップではないので
  // 督促そのものは弱めない
  it('同期していても督促の段は下げない', () => {
    nag(true)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/最後の書き出しより後に作った記録や編集/u)).toBeInTheDocument()
  })

  // 既定は「同期していない」。**渡し忘れで安全側の嘘をつかない**
  it('synced を渡さなければ同期していない扱いにする', () => {
    render(
      <BackupNag recordCount={5} lastExportedAt={daysAgo(40)} persistence="denied" now={NOW} />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('にしか無く')
  })
})

describe('ImportExportPanel との配線', () => {
  beforeEach(async () => {
    window.history.replaceState(null, '', window.location.href)
    // jsdom の履歴移動は非同期で、前のテストの戻りが次のテストに届くと落ち方が非決定になる
    vi.spyOn(window.history, 'back').mockImplementation(() => {})
    await clear('meta')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(() => {
    closeDb()
  })

  it('書き出しに成功すると lastExportedAt が書かれる(次から経過日数を数えられる)', async () => {
    const user = userEvent.setup()
    expect(await getLastExportedAt()).toBeNull()

    render(<ImportExportPanel onClose={vi.fn()} actions={panelActions()} />)
    await user.click(screen.getByRole('button', { name: '書き出す' }))
    await screen.findByText(/を書き出した/)

    const at = await getLastExportedAt()
    expect(at).not.toBeNull()
    // 「今」書き出したことになっている(0日前)。null なら daysSince も null で落ちる
    expect(daysSince(at ?? '', new Date())).toBe(0)
    // 起点を書けなかったときだけ出す注記は出ない
    expect(screen.queryByText(/督促は更新されない/)).toBeNull()
  })

  it('書き出しに失敗したら起点を進めない(督促を消して黙らせない)', async () => {
    const user = userEvent.setup()
    const actions = panelActions()
    actions.exportBackup = vi.fn<ImportExportActions['exportBackup']>(() =>
      Promise.reject(new Error('サムネイルを読み取れない')),
    )
    render(<ImportExportPanel onClose={vi.fn()} actions={actions} />)

    await user.click(screen.getByRole('button', { name: '書き出す' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('書き出しに失敗した')

    expect(await getLastExportedAt()).toBeNull()
  })

  it('起点を書けなかったら、書き出しの成功と一緒にそれを言う(無音にしない)', async () => {
    const user = userEvent.setup()
    const actions = panelActions()
    actions.markExported = vi.fn<ImportExportActions['markExported']>(() =>
      Promise.reject(new Error('meta の保存に失敗')),
    )
    render(<ImportExportPanel onClose={vi.fn()} actions={actions} />)

    await user.click(screen.getByRole('button', { name: '書き出す' }))

    // ファイルは書き出せているので「失敗した」とは言わない
    expect(await screen.findByText(/を書き出した/)).toBeInTheDocument()
    expect(screen.getByText(/督促は更新されない/)).toBeInTheDocument()
  })

  it('取り込みの成功(= 初回書き込み)で永続化を要求する', async () => {
    const user = userEvent.setup()
    const actions = panelActions()
    actions.requestPersistence = vi.fn<ImportExportActions['requestPersistence']>(() =>
      Promise.resolve('denied'),
    )
    render(<ImportExportPanel onClose={vi.fn()} actions={actions} />)

    await user.upload(screen.getByLabelText('取り込む JSON ファイル'), jsonFile('rows.json', SEED_ROWS))
    await user.click(await screen.findByRole('button', { name: '取り込む' }))

    expect(await screen.findByText(/記録 2件を取り込んだ/)).toBeInTheDocument()
    expect(actions.requestPersistence).toHaveBeenCalledTimes(1)
  })

  it('永続化の要求が失敗しても取り込みは成功として扱う', async () => {
    const user = userEvent.setup()
    const actions = panelActions()
    actions.requestPersistence = vi.fn<ImportExportActions['requestPersistence']>(() =>
      Promise.reject(new Error('SecurityError')),
    )
    render(<ImportExportPanel onClose={vi.fn()} actions={actions} />)

    await user.upload(screen.getByLabelText('取り込む JSON ファイル'), jsonFile('rows.json', SEED_ROWS))
    await user.click(await screen.findByRole('button', { name: '取り込む' }))

    expect(await screen.findByText(/記録 2件を取り込んだ/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('督促は書き出しで消える(記録があり一度も書き出していない → 書き出した後は出ない)', async () => {
    const user = userEvent.setup()
    const actions = panelActions()
    // 記録2件・未書き出しの状態から始める(件数は store を読まずにこの面で与える)
    actions.loadBackupState = vi.fn<ImportExportActions['loadBackupState']>(async () => ({
      recordCount: 2,
      lastExportedAt: await getLastExportedAt(),
      persistence: 'granted',
      synced: false,
    }))
    render(<ImportExportPanel onClose={vi.fn()} actions={actions} />)

    expect(await screen.findByText('まだ一度も書き出していない')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '書き出す' }))
    await screen.findByText(/を書き出した/)

    // 起点が進んだので督促は消える(読み直しまで配線されている)
    expect(screen.queryByText('まだ一度も書き出していない')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('全消去のあとは督促を出さない(消えた記録の件数を言い続けない)', async () => {
    const user = userEvent.setup()
    const actions = panelActions()
    let recordCount = 2
    actions.clearAllData = vi.fn<ImportExportActions['clearAllData']>(() => {
      recordCount = 0
      return Promise.resolve()
    })
    actions.loadBackupState = vi.fn<ImportExportActions['loadBackupState']>(() =>
      Promise.resolve({ recordCount, lastExportedAt: null, persistence: 'granted', synced: false }),
    )
    render(<ImportExportPanel onClose={vi.fn()} actions={actions} />)
    expect(await screen.findByText('まだ一度も書き出していない')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'すべて消す' }))
    await user.click(await screen.findByRole('button', { name: '消す' }))

    expect(await screen.findByText('記録とエイリアスをすべて消した。')).toBeInTheDocument()
    expect(screen.queryByText('まだ一度も書き出していない')).toBeNull()
  })

  it('既に書き出しから30日経っていれば、開いた時点で強めの督促を出す', async () => {
    await setLastExportedAt(daysAgo(30))
    const actions = panelActions()
    actions.loadBackupState = vi.fn<ImportExportActions['loadBackupState']>(async () => ({
      recordCount: 2,
      lastExportedAt: await getLastExportedAt(),
      persistence: 'granted',
      synced: false,
    }))
    render(<ImportExportPanel onClose={vi.fn()} actions={actions} />)

    // 基準時刻は実時間なので日数は 30 以上。段が「強め」であることだけを見る
    expect(await screen.findByText(/1か月以上/)).toBeInTheDocument()
  })
})
