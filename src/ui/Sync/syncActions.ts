// 同期パネルが呼ぶ副作用を1箇所に集める。**画面はここを差し替えてテストする**
// (`ui/ImportExport/importActions.ts` と同じ作法)。
//
// 依存方向は domain ← store ← ui。ここは ui 層なので store を呼んでよい(逆は不可)。
// パネル本体(.tsx)から store の import を外に出しているのは、コンポーネントのテストが
// IndexedDB と fetch を要らなくなるため。

import { SYNC_URL } from '../../config/app.ts'
import type { SyncConflict } from '../../domain/syncMerge.ts'
import {
  getLastSyncReport,
  getLastSyncedAt,
  getSyncPassword,
  setSyncPassword,
  type LastSyncReport,
} from '../../store/meta.ts'
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
  /**
   * 前回の同期の結果(B82)。**自動同期の分も入る。**
   *
   * この画面が持つ `result` は本人がこの場で押した分だけなので、これが無いと
   * 起動時・保存後に起きた競合と失敗を読む場所がアプリ内に1つも無い。
   */
  lastReport: LastSyncReport | null
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
  const [password, lastSyncedAt, lastReport] = await Promise.all([
    getSyncPassword(),
    getLastSyncedAt(),
    getLastSyncReport().catch(() => null),
  ])
  return { endpoint: SYNC_URL, hasPassword: password !== null, lastSyncedAt, lastReport }
}

/**
 * 同期を1回走らせ、競合に日付と銘柄を添える。
 *
 * ## 同期の**前後**を両方読む(B90)
 *
 * 以前は同期の**あと**だけを読んでいたので、**負けて消えた記録は必ず引けなかった**
 * (もうこの端末に無い)。頭注は「その旨を書く」と約束していたが、実際に出ていたのは
 * 生の uuid で、何が消えたのか本人には確かめようが無かった。
 *
 * - **前**のスナップショット … 消えた記録の名前はここにしか無い
 * - **あと**の一覧 … 当てた結果を反映した名前(同期でサーバの値に置き換わった記録)
 *
 * あとを優先し、無ければ前に落ちる。**前を読めなくても同期は止めない**(説明が付かないだけ)。
 */
async function runSync(): Promise<SyncRunResult> {
  const before = await snapshotLabels()
  const outcome = await sync()
  if (outcome.status !== 'done' || outcome.result.conflicts.length === 0) {
    return { outcome, conflicts: [] }
  }
  const after = await snapshotLabels()
  return {
    outcome,
    conflicts: outcome.result.conflicts.map((conflict) => ({
      ...conflict,
      // **記録以外は id が内部キー**(紐付けは `表記|県`、メモは `種類:ID`)なので、
      // 記録の辞書を引かない。呼び側が種類ごとに言い方を変える
      label:
        conflict.kind === 'record'
          ? (after.get(conflict.id) ?? before.get(conflict.id) ?? null)
          : null,
    })),
  }
}

/** 記録の id → 「日付 表記」。**読めなくても投げない**(説明が付かないだけ) */
async function snapshotLabels(): Promise<Map<string, string>> {
  try {
    const records = await listRecords()
    return new Map(records.map((record) => [record.id, `${record.drankOn} ${record.brandLabel}`]))
  } catch {
    return new Map()
  }
}

/** 既定の配線 */
export const defaultSyncActions: SyncActions = {
  loadState,
  savePassword: setSyncPassword,
  clearPassword: () => setSyncPassword(''),
  runSync,
}
