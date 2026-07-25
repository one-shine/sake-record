// ImportExportPanel が呼ぶ副作用を1箇所に集める。**画面はここを差し替えてテストする。**
//
// 依存方向は domain ← store ← ui。ここは ui 層なので store を呼んでよい(逆は不可)。
// パネル本体(.tsx)から store の import を外に出しているのは:
// (a) コンポーネントのテストが IndexedDB と fetch を要らなくなる
// (b) 「取り込みの前に clearRecords する」のような**順序が意味を持つ手順**を1箇所に閉じられる
//
// ## 全置換であることをここで固定する
//
// `importRows` は既存の記録を消さない(dedupe もしない)。UI から2回取り込むと 203 → 406 件に
// なるので、**取り込みの直前に `clearRecords()` を呼ぶ**。バックアップ側は `importAll` の既定
// (`replace`)が同じことをする。どちらの経路も「ファイルの状態に戻る」で揃える。
//
// aliases は seed 取り込みでは消さない。手動紐付け(Phase 5)の判断は台帳の行とは別の資産で、
// 元データを読み直しただけで失う理由が無い。

import { LINK_STATUSES } from '../../domain/backupSchema.ts'
import type { SakeLogRow } from '../../domain/parseSakeLog.ts'
import type { FlavorChart, LinkStatus, SakeRecord } from '../../domain/types.ts'
import { exportAll, exportFileName as backupFileName, importAll } from '../../store/backup.ts'
import { clearAll } from '../../store/db.ts'
import { buildLinker, getTables } from '../../store/linking.ts'
import { checkImportRows, clearRecords, importRows, listRecords } from '../../store/records.ts'

/**
 * 取り込み後の内訳。**紐付け済みとフレーバー取得済みを別に数える**
 * (実測で 186 ≠ 185。`ビキニ娘` は紐付くがチャートが無い)。
 */
export type ImportSummary = {
  total: number
  byStatus: Record<LinkStatus, number>
  /**
   * フレーバーチャートを引けた件数。**銘柄マスタを読めなかったときは `null`**
   * (0 で埋めると「1本もフレーバーが無い」と嘘をつくことになる)。
   */
  withFlavor: number | null
}

export type ApplyOutcome = {
  /** 1つ以上のストアに反映できたか */
  ok: boolean
  /** 断った理由・飛ばした行。画面にそのまま出す */
  errors: string[]
  /** 反映したストアと件数(store 層の文言) */
  applied: string[]
  imported: { records: number; aliases: number }
  /** 取り込み後の状態。数えられなかったときは `null` */
  summary: ImportSummary | null
}

/** パネルが必要とする副作用の全部。テストはこの面だけを差し替える */
export type ImportExportActions = {
  exportBackup: () => Promise<Blob>
  exportFileName: (now?: Date) => string
  saveBlob: (blob: Blob, fileName: string) => void
  importBackup: (text: string) => Promise<ApplyOutcome>
  importSeed: (rows: readonly SakeLogRow[]) => Promise<ApplyOutcome>
  clearAllData: () => Promise<void>
}

// ---------------------------------------------------------------------------
// 集計(純関数)
// ---------------------------------------------------------------------------

function emptyCounts(): Record<LinkStatus, number> {
  // 5値は LINK_STATUSES(domain の実行時列挙)から引く。ここに文字列を書き並べない
  const counts = {} as Record<LinkStatus, number>
  for (const status of LINK_STATUSES) counts[status] = 0
  return counts
}

/**
 * 記録の集合を内訳にする。`flavorByBrandId` に `null` を渡すと
 * `withFlavor` は `null`(= 数えていない)になる。**0 に丸めない。**
 */
export function summarize(
  records: readonly SakeRecord[],
  flavorByBrandId: ReadonlyMap<number, FlavorChart> | null,
): ImportSummary {
  const byStatus = emptyCounts()
  let withFlavor: number | null = flavorByBrandId === null ? null : 0
  for (const record of records) {
    // 列挙外の値(壊れた DB)は数えない。undefined + 1 = NaN を画面に出さない
    if (Object.hasOwn(byStatus, record.linkStatus)) byStatus[record.linkStatus] += 1
    if (
      flavorByBrandId !== null &&
      withFlavor !== null &&
      record.sakenowaBrandId !== null &&
      flavorByBrandId.has(record.sakenowaBrandId)
    ) {
      withFlavor += 1
    }
  }
  return { total: records.length, byStatus, withFlavor }
}

// ---------------------------------------------------------------------------
// 既定の実装(store への配線)
// ---------------------------------------------------------------------------

/**
 * 取り込み後のストアの状態を数える。**フレーバー用のテーブルが取れなくても取り込みは成功扱い**
 * (数えられないことは `withFlavor: null` で表に出す)。
 */
async function summarizeStore(): Promise<ImportSummary | null> {
  try {
    const records = await listRecords()
    let flavor: ReadonlyMap<number, FlavorChart> | null = null
    try {
      flavor = (await getTables()).flavorChartByBrandId
    } catch {
      flavor = null
    }
    return summarize(records, flavor)
  } catch {
    // 件数が読めないだけ。取り込み自体の成否は importAll の戻りが持っている
    return null
  }
}

async function importBackup(text: string): Promise<ApplyOutcome> {
  // 既定は replace(ファイルの状態に戻す)。確認はパネル側で取ってから呼ぶ
  const result = await importAll(text)
  return {
    ok: result.ok,
    errors: result.errors,
    applied: result.applied,
    imported: result.imported,
    summary: result.ok ? await summarizeStore() : null,
  }
}

async function importSeed(rows: readonly SakeLogRow[]): Promise<ApplyOutcome> {
  // **消す前に検証する。** importRows も同じ検証をして1件も保存しないが、それは clear の後なので
  // 「消えただけ」の状態になる。順序は 検証 → テーブル取得 → clear → 保存 でなければならない
  const check = checkImportRows(rows)
  if (!check.ok) throw new Error(`取り込めない行がある: ${check.reason}`)
  // buildLinker も内部で getTables() を使う(キャッシュ済みなので fetch は1回)
  const [linker, tables] = await Promise.all([buildLinker(), getTables()])
  // **全置換。先に消さないと2回目の取り込みで倍になる**
  await clearRecords()
  const records = await importRows(rows, linker, tables)
  return {
    ok: records.length > 0,
    errors: [],
    applied: [`records ${String(records.length)}件`],
    imported: { records: records.length, aliases: 0 },
    summary: summarize(records, tables.flavorChartByBrandId),
  }
}

/**
 * Blob をダウンロードさせる。`URL.createObjectURL` は同期に revoke するとダウンロードが
 * 始まらない実装があるので、次のタスクで捨てる。
 */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

/**
 * 既定の配線。**`meta` は消さない**(最終エクスポート日時は端末側の事実で、
 * 記録の一部ではない。Phase 7 のバックアップ督促がここを読む)。
 */
export const defaultActions: ImportExportActions = {
  exportBackup: exportAll,
  exportFileName: backupFileName,
  saveBlob,
  importBackup,
  importSeed,
  clearAllData: () => clearAll(['records', 'aliases']),
}
