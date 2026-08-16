// 画面としての約束を固定する: **振り分けを取り違えない / 判定できないものを理由付きで断る /
// 取り消せない操作を一手挟まずに実行しない / 結果を無音にしない。**
//
// 副作用(store への書き込み)は `actions` を差し替えて観測する。IndexedDB と fetch を
// 起動しないので jsdom で足りる(store 層の往復は src/store/*.test.ts が node 環境で見ている)。
//
// `history.back()` はスタブする: jsdom の履歴移動は非同期で、前のテストの戻りが次のテストの
// popstate として届くと落ち方が非決定になる。
//
// データはすべて合成。実際の飲酒記録(`data/seed/` は gitignore)を fixture にしない。
// 日付リテラルは2種類に留める(BACKLOG B22 の台帳ガード)。件数(203/186/12/5/185)は
// docs に既にある集計値で、台帳の行そのものではない。

import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { APP_ID, SCHEMA_VERSION } from '../../domain/backupSchema.ts'
import { ImportExportPanel } from './ImportExportPanel.tsx'
import type { ApplyOutcome, ImportExportActions, ImportSummary } from './importActions.ts'

const SEED_ROWS = [
  {
    no: 1,
    drankOn: '2020-01-01',
    brandLabel: 'テスト酒',
    prefecture: '福島県',
    spec: '純米',
    note: '',
  },
  { no: 2, drankOn: '2020-01-01', brandLabel: 'サンプル酒', prefecture: '', spec: '', note: '' },
]

const BACKUP = {
  schemaVersion: SCHEMA_VERSION,
  app: APP_ID,
  exportedAt: '2020-01-02T00:00:00.000Z',
  records: [
    {
      id: 'r1',
      drankOn: '2020-01-01',
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
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
  ],
  aliases: [{ label: 'てすと', prefecture: null, brandId: 1 }],
}

/** 実データで期待している内訳(auto 173 + alias 13 = 紐付け 186 / 未紐付け 12 / 不明 5) */
const SUMMARY: ImportSummary = {
  total: 203,
  byStatus: { auto: 173, alias: 13, manual: 0, unlinked: 12, unknown: 5 },
  withFlavor: 185,
}

function seedOutcome(): ApplyOutcome {
  return {
    ok: true,
    errors: [],
    applied: ['records 203件'],
    imported: { records: 203, aliases: 0 },
    summary: SUMMARY,
  }
}

function backupOutcome(): ApplyOutcome {
  return {
    ok: true,
    errors: [],
    applied: ['records 203件', 'aliases 8件'],
    imported: { records: 203, aliases: 8 },
    summary: SUMMARY,
  }
}

function makeActions() {
  return {
    exportBackup: vi.fn<ImportExportActions['exportBackup']>(() =>
      Promise.resolve(new Blob(['{"records":[]}'], { type: 'application/json' })),
    ),
    exportFileName: vi.fn<ImportExportActions['exportFileName']>(
      () => 'sake-record-backup-2020-01-01.json',
    ),
    saveBlob: vi.fn<ImportExportActions['saveBlob']>(),
    importBackup: vi.fn<ImportExportActions['importBackup']>(() =>
      Promise.resolve(backupOutcome()),
    ),
    importSeed: vi.fn<ImportExportActions['importSeed']>(() => Promise.resolve(seedOutcome())),
    clearAllData: vi.fn<ImportExportActions['clearAllData']>(() => Promise.resolve()),
    markExported: vi.fn<ImportExportActions['markExported']>(() => Promise.resolve()),
    requestPersistence: vi.fn<ImportExportActions['requestPersistence']>(() =>
      Promise.resolve('granted'),
    ),
    // **記録0件で返す** = このファイルでは BackupNag が何も描かない(督促の検査は BackupNag.test.tsx)。
    // 既定の実装に落とすと IndexedDB を触ってしまい、この画面のテストが jsdom で回らなくなる
    loadBackupState: vi.fn<ImportExportActions['loadBackupState']>(() =>
      Promise.resolve({ recordCount: 0, lastExportedAt: null, persistence: 'granted', synced: false }),
    ),
  }
}

function jsonFile(name: string, value: unknown): File {
  return new File([JSON.stringify(value)], name, { type: 'application/json' })
}

function fileInput(): HTMLElement {
  return screen.getByLabelText('取り込む JSON ファイル')
}

describe('ImportExportPanel', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', window.location.href)
    vi.spyOn(window.history, 'back').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('保存先の制約(サイトデータ削除で消える / 書き出しが唯一のバックアップ)を伝える', async () => {
    render(<ImportExportPanel onClose={vi.fn()} actions={makeActions()} />)

    const dialog = screen.getByRole('dialog', { name: 'インポート / エクスポート' })
    expect(dialog).toHaveTextContent('サイトデータを削除すると消える')
    expect(dialog).toHaveTextContent('唯一のバックアップ手段')

    // このファイルで唯一、**待つものが何も無い**テスト。督促の材料を読む effect の解決が
    // テストの外に落ちて「act(...) で包まれていない」警告が毎回 stderr に出るので、
    // ここで act の中に閉じる(本物の警告がこの1件に埋もれるのを避ける)
    await act(async () => {})
  })

  it('行の配列は記録の元データとして取り込み、内訳を出す', async () => {
    const user = userEvent.setup()
    const actions = makeActions()
    const onDataChanged = vi.fn()
    render(
      <ImportExportPanel onClose={vi.fn()} onDataChanged={onDataChanged} actions={actions} />,
    )

    await user.upload(fileInput(), jsonFile('rows.json', SEED_ROWS))
    expect(await screen.findByText(/記録の元データとして読んだ/)).toBeInTheDocument()
    // 選んだだけでは書かない(取り込みは全置換なので一手挟む)
    expect(actions.importSeed).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '取り込む' }))

    expect(actions.importSeed).toHaveBeenCalledTimes(1)
    expect(actions.importBackup).not.toHaveBeenCalled()
    expect(actions.importSeed.mock.calls[0][0]).toHaveLength(2)
    expect(await screen.findByText(/記録 203件を取り込んだ/)).toBeInTheDocument()
    // 紐付け 173 + 13 + 0 = 186。未紐付けと銘柄不明を畳まない
    expect(screen.getByText('紐付け 186')).toBeInTheDocument()
    expect(screen.getByText('未紐付け 12')).toBeInTheDocument()
    expect(screen.getByText('銘柄不明 5')).toBeInTheDocument()
    // 紐付け済み(186) ≠ フレーバー取得済み(185) を画面でも保つ
    expect(screen.getByText('フレーバー取得済み 185')).toBeInTheDocument()
    expect(screen.getByText('反映: records 203件')).toBeInTheDocument()
    expect(onDataChanged).toHaveBeenCalledTimes(1)
  })

  it('手動紐付け(manual)も紐付けとして数える(5値すべてが内訳のどこかで発火する)', async () => {
    const user = userEvent.setup()
    const actions = makeActions()
    actions.importSeed = vi.fn<ImportExportActions['importSeed']>(() =>
      Promise.resolve({
        ...seedOutcome(),
        imported: { records: 5, aliases: 0 },
        summary: {
          total: 5,
          byStatus: { auto: 1, alias: 1, manual: 1, unlinked: 1, unknown: 1 },
          withFlavor: 2,
        },
      }),
    )
    render(<ImportExportPanel onClose={vi.fn()} actions={actions} />)

    await user.upload(fileInput(), jsonFile('rows.json', SEED_ROWS))
    await user.click(await screen.findByRole('button', { name: '取り込む' }))

    expect(await screen.findByText('紐付け 3')).toBeInTheDocument()
    expect(screen.getByText('未紐付け 1')).toBeInTheDocument()
    expect(screen.getByText('銘柄不明 1')).toBeInTheDocument()
  })

  it('バックアップ形式はバックアップとして取り込む(元データ経路に流さない)', async () => {
    const user = userEvent.setup()
    const actions = makeActions()
    render(<ImportExportPanel onClose={vi.fn()} actions={actions} />)

    await user.upload(fileInput(), jsonFile('backup.json', BACKUP))
    expect(await screen.findByText(/バックアップとして読んだ/)).toBeInTheDocument()
    expect(screen.getByText(/記録 1件 \/ エイリアス 1件/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '取り込む' }))

    expect(actions.importBackup).toHaveBeenCalledTimes(1)
    expect(actions.importSeed).not.toHaveBeenCalled()
    expect(actions.importBackup.mock.calls[0][0]).toContain('"schemaVersion"')
    expect(await screen.findByText(/記録 203件 \/ エイリアス 8件を取り込んだ/)).toBeInTheDocument()
  })

  it('判定できない JSON は理由を出して拒否し、どちらの経路も呼ばない', async () => {
    const user = userEvent.setup()
    const actions = makeActions()
    render(<ImportExportPanel onClose={vi.fn()} actions={actions} />)

    await user.upload(fileInput(), jsonFile('unknown.json', { foo: 1 }))

    const message = await screen.findByText(/unknown\.json は取り込めない/)
    expect(message).toHaveTextContent('バックアップの形が違う')
    expect(screen.queryByRole('button', { name: '取り込む' })).toBeNull()
    expect(actions.importBackup).not.toHaveBeenCalled()
    expect(actions.importSeed).not.toHaveBeenCalled()
  })

  it('未来の schemaVersion は版を示して拒否する', async () => {
    const user = userEvent.setup()
    const actions = makeActions()
    render(<ImportExportPanel onClose={vi.fn()} actions={actions} />)

    await user.upload(
      fileInput(),
      jsonFile('v2.json', { ...BACKUP, schemaVersion: SCHEMA_VERSION + 1 }),
    )

    const message = await screen.findByText(/v2\.json は取り込めない/)
    expect(message).toHaveTextContent(`v${String(SCHEMA_VERSION + 1)}`)
    expect(actions.importBackup).not.toHaveBeenCalled()
  })

  it('記録が0件のバックアップは「すべて消える」と明示する', async () => {
    const user = userEvent.setup()
    render(<ImportExportPanel onClose={vi.fn()} actions={makeActions()} />)

    await user.upload(fileInput(), jsonFile('empty.json', { ...BACKUP, records: [] }))

    expect(
      await screen.findByText(/このファイルには記録が0件。取り込むと記録はすべて消える/),
    ).toBeInTheDocument()
  })

  it('飛ばした行と「1件も反映できなかった」を画面に出す', async () => {
    const user = userEvent.setup()
    const actions = makeActions()
    const onDataChanged = vi.fn()
    actions.importBackup = vi.fn<ImportExportActions['importBackup']>(() =>
      Promise.resolve({
        ok: false,
        errors: ['records[0] は形が違うので取り込まなかった'],
        applied: [],
        imported: { records: 0, aliases: 0 },
        summary: null,
      }),
    )
    render(
      <ImportExportPanel onClose={vi.fn()} onDataChanged={onDataChanged} actions={actions} />,
    )

    await user.upload(fileInput(), jsonFile('backup.json', BACKUP))
    await user.click(await screen.findByRole('button', { name: '取り込む' }))

    expect(
      await screen.findByText('records[0] は形が違うので取り込まなかった'),
    ).toBeInTheDocument()
    expect(screen.getByText(/1件も反映できなかった/)).toBeInTheDocument()
    expect(onDataChanged).not.toHaveBeenCalled()
  })

  it('取り込みが失敗したら理由を出す(無音で終わらない)', async () => {
    const user = userEvent.setup()
    const actions = makeActions()
    actions.importSeed = vi.fn<ImportExportActions['importSeed']>(() =>
      Promise.reject(new Error('銘柄マスタを取得できない')),
    )
    render(<ImportExportPanel onClose={vi.fn()} actions={actions} />)

    await user.upload(fileInput(), jsonFile('rows.json', SEED_ROWS))
    await user.click(await screen.findByRole('button', { name: '取り込む' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('取り込みに失敗した')
    expect(alert).toHaveTextContent('銘柄マスタを取得できない')
  })

  it('書き出しは日付入りのファイル名で保存し、結果を画面に出す', async () => {
    const user = userEvent.setup()
    const actions = makeActions()
    render(<ImportExportPanel onClose={vi.fn()} actions={actions} />)

    await user.click(screen.getByRole('button', { name: '書き出す' }))

    expect(actions.exportBackup).toHaveBeenCalledTimes(1)
    expect(actions.saveBlob).toHaveBeenCalledTimes(1)
    const [blob, fileName] = actions.saveBlob.mock.calls[0]
    expect(fileName).toBe('sake-record-backup-2020-01-01.json')
    expect(blob.type).toBe('application/json')
    expect(
      await screen.findByText(/sake-record-backup-2020-01-01\.json を書き出した/),
    ).toBeInTheDocument()
  })

  it('全消去は ConfirmDialog を経ないと実行されない', async () => {
    const user = userEvent.setup()
    const actions = makeActions()
    const onDataChanged = vi.fn()
    render(
      <ImportExportPanel onClose={vi.fn()} onDataChanged={onDataChanged} actions={actions} />,
    )

    await user.click(screen.getByRole('button', { name: 'すべて消す' }))
    // ダイアログが出ただけで消えてはいない
    const dialog = screen.getByRole('dialog', { name: 'すべて消す' })
    expect(actions.clearAllData).not.toHaveBeenCalled()
    expect(dialog).toHaveTextContent('この操作は取り消せない')
    expect(dialog).toHaveTextContent('先にエクスポートすることを推奨')

    // 取りやめても実行されない
    await user.click(within(dialog).getByRole('button', { name: 'やめる' }))
    expect(screen.queryByRole('dialog', { name: 'すべて消す' })).toBeNull()
    expect(actions.clearAllData).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'すべて消す' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'すべて消す' })).getByRole('button', {
        name: '消す',
      }),
    )

    expect(actions.clearAllData).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('記録とエイリアスをすべて消した。')).toBeInTheDocument()
    expect(onDataChanged).toHaveBeenCalledTimes(1)
  })

  it('閉じるボタンで onClose を呼ぶ', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ImportExportPanel onClose={onClose} actions={makeActions()} />)

    await user.click(screen.getByRole('button', { name: '閉じる' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
