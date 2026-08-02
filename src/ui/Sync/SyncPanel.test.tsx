// 同期パネル。**副作用は差し替える**(`actions`)ので IndexedDB も通信も要らない。
//
// ここで見るのは「何を画面に出すか」だけ。取りこぼしや順序の検査は `src/store/sync.test.ts`、
// 実際のサーバとの往復は `server/verify.mjs` の分担。

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SyncPanel } from './SyncPanel.tsx'
import type { SyncActions, SyncRunResult, SyncViewState } from './syncActions.ts'

const ENDPOINT = 'https://example.workers.dev'
/** 24バイト以上(下限ちょうどでは境界の検査にならないので少し長く) */
const LONG_ENOUGH = 'kotobawo-yonkosanarabeta'

function state(over: Partial<SyncViewState> = {}): SyncViewState {
  return { endpoint: ENDPOINT, hasPassword: true, lastSyncedAt: null, ...over }
}

function done(): SyncRunResult {
  return {
    outcome: {
      status: 'done',
      result: {
        startedAt: '2026-08-01T10:00:00.000Z',
        localRecords: 5,
        applied: 0,
        removed: 0,
        pushed: 0,
        conflicts: [],
        messages: [],
      },
    },
    conflicts: [],
  }
}

function setup(actions: Partial<SyncActions> = {}, onDataChanged = vi.fn()) {
  const wired: Partial<SyncActions> = {
    loadState: () => Promise.resolve(state()),
    savePassword: () => Promise.resolve(),
    clearPassword: () => Promise.resolve(),
    runSync: () => Promise.resolve(done()),
    ...actions,
  }
  render(<SyncPanel onClose={vi.fn()} onDataChanged={onDataChanged} actions={wired} />)
  return { onDataChanged }
}

describe('同期先が未設定のとき', () => {
  // A28。設定していない端末では何も起きないことを、画面が言い切る
  it('同期先が無いことと、これまでどおり動くことを言う', async () => {
    setup({ loadState: () => Promise.resolve(state({ endpoint: '', hasPassword: false })) })

    expect(await screen.findByText(/同期先がまだ用意されていない/)).toBeInTheDocument()
    // 設定の欄も同期のボタンも出さない(押せない操作を並べない)
    expect(screen.queryByRole('button', { name: 'いま同期する' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('同期のパスワード')).not.toBeInTheDocument()
  })
})

describe('パスワード', () => {
  it('未設定なら「まだ同期しない」と言い、同期のボタンを押せない', async () => {
    setup({ loadState: () => Promise.resolve(state({ hasPassword: false })) })

    expect(await screen.findByText(/パスワードが未設定なので、まだ同期しない/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'いま同期する' })).toBeDisabled()
  })

  it('貼り付けて保存すると、保存したことを言う', async () => {
    const savePassword = vi.fn((_value: string) => undefined)
    let hasPassword = false
    setup({
      loadState: () => Promise.resolve(state({ hasPassword })),
      savePassword: (value: string) => {
        hasPassword = true
        savePassword(value)
        return Promise.resolve()
      },
    })

    const field = await screen.findByLabelText('同期のパスワード')
    await userEvent.type(field, LONG_ENOUGH)
    await userEvent.click(screen.getByRole('button', { name: '保存する' }))

    await waitFor(() => {
      expect(savePassword).toHaveBeenCalledWith(LONG_ENOUGH)
    })
    expect(await screen.findByText('パスワードを保存した')).toBeInTheDocument()
  })

  // 短いと同期先が受け付けないが、返るのは 401 だけ。**保存する前に言わないと**
  // 「パスワードが違う」としか見えず、短いのが原因だと本人には分からない
  it('短い合言葉は保存せずに理由を言う', async () => {
    const savePassword = vi.fn((_value: string) => undefined)
    setup({
      loadState: () => Promise.resolve(state({ hasPassword: false })),
      savePassword: (value: string) => {
        savePassword(value)
        return Promise.resolve()
      },
    })

    await userEvent.type(await screen.findByLabelText('同期のパスワード'), 'みじかい')
    await userEvent.click(screen.getByRole('button', { name: '保存する' }))

    expect(await screen.findByText(/合言葉が短い/)).toBeInTheDocument()
    expect(savePassword).not.toHaveBeenCalled()
  })

  it('日本語8文字なら保存できる(下限ちょうど)', async () => {
    const savePassword = vi.fn((_value: string) => undefined)
    setup({
      loadState: () => Promise.resolve(state({ hasPassword: false })),
      savePassword: (value: string) => {
        savePassword(value)
        return Promise.resolve()
      },
    })

    await userEvent.type(await screen.findByLabelText('同期のパスワード'), 'あいことばはちもじ')
    await userEvent.click(screen.getByRole('button', { name: '保存する' }))

    await waitFor(() => {
      expect(savePassword).toHaveBeenCalledWith('あいことばはちもじ')
    })
  })

  it('空のまま保存は押せない', async () => {
    setup({ loadState: () => Promise.resolve(state({ hasPassword: false })) })
    expect(await screen.findByRole('button', { name: '保存する' })).toBeDisabled()
  })

  // 値そのものを画面に出す理由が無い(肩越しに見られる場所で開くこともある)
  it('保存済みのパスワードの値は画面に出さない', async () => {
    setup({ loadState: () => Promise.resolve(state({ hasPassword: true })) })
    await screen.findByText('パスワードは保存されている')
    expect(screen.getByLabelText('同期のパスワード')).toHaveValue('')
  })
})

describe('同期の結果', () => {
  it('件数を出す(0件でも出す)', async () => {
    setup({
      runSync: () =>
        Promise.resolve({
          outcome: {
            status: 'done',
            result: {
              startedAt: '2026-08-01T10:00:00.000Z',
              localRecords: 5,
              applied: 3,
              removed: 1,
              pushed: 2,
              conflicts: [],
              messages: [],
            },
          },
          conflicts: [],
        }),
    })

    await userEvent.click(await screen.findByRole('button', { name: 'いま同期する' }))

    expect(await screen.findByText(/受け取って反映した記録 3 件/)).toBeInTheDocument()
    expect(screen.getByText(/消した記録 1 件/)).toBeInTheDocument()
    expect(screen.getByText(/送った変更 2 件/)).toBeInTheDocument()
  })

  // A26。採否を黙って決めない
  it('競合を、どちらを採ったかと一緒に出す', async () => {
    setup({
      runSync: () =>
        Promise.resolve({
          outcome: {
            status: 'done',
            result: {
              startedAt: '2026-08-01T10:00:00.000Z',
              localRecords: 5,
              applied: 1,
              removed: 0,
              pushed: 0,
              conflicts: [{ id: 'r1', winner: 'remote', winnerDeleted: false }],
              messages: [],
            },
          },
          conflicts: [
            { id: 'r1', winner: 'remote', winnerDeleted: false, label: '2026-07-01 而今' },
          ],
        }),
    })

    await userEvent.click(await screen.findByRole('button', { name: 'いま同期する' }))

    expect(await screen.findByText(/両方の端末で変わっていた記録 1 件/)).toBeInTheDocument()
    expect(screen.getByText(/2026-07-01 而今/)).toBeInTheDocument()
    expect(screen.getByText(/別の端末の変更のほうが新しかった/)).toBeInTheDocument()
  })

  it('負けた側が削除だったときは、そう言う(「編集したのに消えた」と言い分ける)', async () => {
    setup({
      runSync: () =>
        Promise.resolve({
          outcome: {
            status: 'done',
            result: {
              startedAt: '2026-08-01T10:00:00.000Z',
              localRecords: 5,
              applied: 0,
              removed: 1,
              pushed: 0,
              conflicts: [{ id: 'r1', winner: 'remote', winnerDeleted: true }],
              messages: [],
            },
          },
          conflicts: [{ id: 'r1', winner: 'remote', winnerDeleted: true, label: null }],
        }),
    })

    await userEvent.click(await screen.findByRole('button', { name: 'いま同期する' }))
    expect(await screen.findByText(/別の端末で消されていたので消した/)).toBeInTheDocument()
  })

  it('断ったことを黙って捨てない', async () => {
    setup({
      runSync: () =>
        Promise.resolve({
          outcome: {
            status: 'done',
            result: {
              startedAt: '2026-08-01T10:00:00.000Z',
              localRecords: 5,
              applied: 0,
              removed: 0,
              pushed: 0,
              conflicts: [],
              messages: ['記録 r9 の写真がまだ同期先に無い。次の同期で取り直す'],
            },
          },
          conflicts: [],
        }),
    })

    await userEvent.click(await screen.findByRole('button', { name: 'いま同期する' }))
    expect(await screen.findByText(/r9 の写真がまだ同期先に無い/)).toBeInTheDocument()
  })

  it('成功したら一覧の読み直しを親に頼む(同期は記録を書き換えるため)', async () => {
    const { onDataChanged } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'いま同期する' }))
    await waitFor(() => {
      expect(onDataChanged).toHaveBeenCalled()
    })
  })
})

describe('失敗の言い分け', () => {
  // A29。「通信できない」と同じ顔にすると、パスワードを間違えている本人が延々と再試行する
  it('パスワードが違うときは、入れ直すことと回数制限を言う', async () => {
    setup({
      runSync: () =>
        Promise.resolve({
          outcome: { status: 'failed', kind: 'unauthorized', message: 'パスワードが違う(401)' },
          conflicts: [],
        }),
    })

    await userEvent.click(await screen.findByRole('button', { name: 'いま同期する' }))

    expect(await screen.findByText('パスワードが違う')).toBeInTheDocument()
    expect(screen.getByText(/入れ直す/)).toBeInTheDocument()
    expect(screen.getByText(/10回続けて間違えると/)).toBeInTheDocument()
    expect(screen.getByText(/記録は何も変わっていない/)).toBeInTheDocument()
  })

  it('通信できないときは、電波と同期先の設定を言う', async () => {
    setup({
      runSync: () =>
        Promise.resolve({
          outcome: { status: 'failed', kind: 'offline', message: '同期先に届かなかった' },
          conflicts: [],
        }),
    })

    await userEvent.click(await screen.findByRole('button', { name: 'いま同期する' }))

    expect(await screen.findAllByText(/同期先に届かなかった/)).not.toHaveLength(0)
    expect(screen.getByText(/電波を確かめて/)).toBeInTheDocument()
  })

  it('失敗しても一覧の読み直しは頼まない(何も変わっていない)', async () => {
    const { onDataChanged } = setup({
      runSync: () =>
        Promise.resolve({
          outcome: { status: 'failed', kind: 'server', message: '5xx' },
          conflicts: [],
        }),
    })

    await userEvent.click(await screen.findByRole('button', { name: 'いま同期する' }))
    await screen.findByText('同期先が処理に失敗した')
    expect(onDataChanged).not.toHaveBeenCalled()
  })
})

// **0件の理由を言い分ける。** 「送るものが無かった」と「既に送り終えていた」は同じ0件だが、
// 打てる手が違う(前者は記録の入っているブラウザを開く)。実際にここで詰まった
describe('送信が0件のとき', () => {
  function outcomeWith(localRecords: number, pushed: number): SyncRunResult {
    return {
      outcome: {
        status: 'done',
        result: {
          startedAt: '2026-08-01T10:00:00.000Z',
          localRecords,
          applied: 0,
          removed: 0,
          pushed,
          conflicts: [],
          messages: [],
        },
      },
      conflicts: [],
    }
  }

  it('この端末に記録が無いなら、そう言って別のブラウザを促す', async () => {
    setup({ runSync: () => Promise.resolve(outcomeWith(0, 0)) })
    await userEvent.click(await screen.findByRole('button', { name: 'いま同期する' }))
    expect(await screen.findByText(/記録が1件も入っていないので/)).toBeInTheDocument()
  })

  it('記録はあるが送る変更が無いなら、送り終えていると言う', async () => {
    setup({ runSync: () => Promise.resolve(outcomeWith(203, 0)) })
    await userEvent.click(await screen.findByRole('button', { name: 'いま同期する' }))
    expect(await screen.findByText(/203 件は、前回までに送り終えている/)).toBeInTheDocument()
  })

  it('送ったときは件数の内訳を言う', async () => {
    setup({ runSync: () => Promise.resolve(outcomeWith(203, 12)) })
    await userEvent.click(await screen.findByRole('button', { name: 'いま同期する' }))
    expect(await screen.findByText(/203 件のうち、前回から変わった分を送った/)).toBeInTheDocument()
  })
})

// **iOS は `type="password"` の欄で日本語入力を無効にする**(実機で踏んだ。コピペしか手が無くなる)。
// 打つ瞬間だけ見せられれば済むので、切り替えを1つ置いた
describe('合言葉を打つとき', () => {
  it('既定では隠れている(開いた画面に合言葉を出さない)', async () => {
    setup({ loadState: () => Promise.resolve(state({ hasPassword: false })) })
    expect(await screen.findByLabelText('同期のパスワード')).toHaveAttribute('type', 'password')
  })

  it('「見せる」で打てる状態にでき、もう一度押すと隠れる', async () => {
    setup({ loadState: () => Promise.resolve(state({ hasPassword: false })) })

    const toggle = await screen.findByRole('button', { name: '見せる' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle)

    expect(screen.getByLabelText('同期のパスワード')).toHaveAttribute('type', 'text')
    const hide = screen.getByRole('button', { name: '隠す' })
    expect(hide).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(hide)
    expect(screen.getByLabelText('同期のパスワード')).toHaveAttribute('type', 'password')
  })

  it('見せている間も打った値はそのまま保存できる', async () => {
    const savePassword = vi.fn((_value: string) => undefined)
    setup({
      loadState: () => Promise.resolve(state({ hasPassword: false })),
      savePassword: (value: string) => {
        savePassword(value)
        return Promise.resolve()
      },
    })

    await userEvent.click(await screen.findByRole('button', { name: '見せる' }))
    await userEvent.type(screen.getByLabelText('同期のパスワード'), 'あいことばはちもじ')
    await userEvent.click(screen.getByRole('button', { name: '保存する' }))

    await waitFor(() => {
      expect(savePassword).toHaveBeenCalledWith('あいことばはちもじ')
    })
  })

  it('打てない理由と打ち方を書いてある', async () => {
    setup({ loadState: () => Promise.resolve(state({ hasPassword: false })) })
    expect(await screen.findByText(/iPhone では隠したままだと日本語を打てない/)).toBeInTheDocument()
  })
})
