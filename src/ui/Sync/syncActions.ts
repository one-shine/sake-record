// 同期パネルが呼ぶ副作用を1箇所に集める。**画面はここを差し替えてテストする**
// (`ui/ImportExport/importActions.ts` と同じ作法)。
//
// 依存方向は domain ← store ← ui。ここは ui 層なので store を呼んでよい(逆は不可)。
// パネル本体(.tsx)から store の import を外に出しているのは、コンポーネントのテストが
// IndexedDB と fetch を要らなくなるため。

import { SYNC_URL } from '../../config/app.ts'
import type { SyncConflict } from '../../domain/syncMerge.ts'
import { getLastSyncedAt, getSyncPassword, setSyncPassword } from '../../store/meta.ts'
import { listRecords } from '../../store/records.ts'
import { sync, type SyncOutcome } from '../../store/sync.ts'

/** 画面に出す設定の状態。**3つを1回で読む**(食い違った組み合わせを出せないようにする) */
export type SyncViewState = {
  /** 同期先の URL。空文字は「まだ用意していない」 */
  endpoint: string
  /** パスワードが入っているか。**値そのものは画面に返さない**(出す理由が無い) */
  hasPassword: boolean
  /** 最後に同期した時刻(ISO8601)。まだなら `null` */
  lastSyncedAt: string | null
}

/**
 * 競合を画面に出す形。**`id` だけでは本人に何も伝わらない**ので、この端末に残っていれば
 * 日付と銘柄を添える。負けて消えた記録は引けないので、その旨を書く。
 */
export type SyncConflictView = SyncConflict & { label: string | null }

export type SyncRunResult = { outcome: SyncOutcome; conflicts: SyncConflictView[] }

export type SyncActions = {
  loadState: () => Promise<SyncViewState>
  savePassword: (password: string) => Promise<void>
  clearPassword: () => Promise<void>
  runSync: () => Promise<SyncRunResult>
}

async function loadState(): Promise<SyncViewState> {
  const [password, lastSyncedAt] = await Promise.all([getSyncPassword(), getLastSyncedAt()])
  return { endpoint: SYNC_URL, hasPassword: password !== null, lastSyncedAt }
}

/**
 * 同期を1回走らせ、競合に日付と銘柄を添える。
 *
 * 記録を読み直すのは**同期のあと**。先に読むと、当てた結果ではなく当てる前の値で説明することになる。
 */
async function runSync(): Promise<SyncRunResult> {
  const outcome = await sync()
  if (outcome.status !== 'done' || outcome.result.conflicts.length === 0) {
    return { outcome, conflicts: [] }
  }
  let byId = new Map<string, string>()
  try {
    const records = await listRecords()
    byId = new Map(records.map((record) => [record.id, `${record.drankOn} ${record.brandLabel}`]))
  } catch {
    // 説明を付けられないだけ。**競合そのものは必ず出す**(黙って捨てない)
  }
  return {
    outcome,
    conflicts: outcome.result.conflicts.map((conflict) => ({
      ...conflict,
      label: byId.get(conflict.id) ?? null,
    })),
  }
}

/** 既定の配線 */
export const defaultSyncActions: SyncActions = {
  loadState,
  savePassword: setSyncPassword,
  clearPassword: () => setSyncPassword(''),
  runSync,
}
