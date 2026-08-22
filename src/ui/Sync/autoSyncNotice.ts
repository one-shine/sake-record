// 自動同期の結果を**画面に割り込ませるかどうか**の判断。純関数1本にして、
// 起動時と保存後の2経路が同じ基準で鳴るようにする(B82)。
//
// 依存方向は domain ← store ← ui。ここは ui 層なので store の型を引いてよい。

import type { SyncOutcome } from '../../store/sync.ts'

/**
 * 自動同期(起動時・保存後)の結果のうち、**本人に割り込んででも言うべきこと**(B82)。
 * 言うことが無ければ `null`。
 *
 * 判断を1つの純関数に寄せるのは、起動時と保存後の2経路が同じ基準で鳴るようにするため
 * (経路ごとに条件を書くと、足した日に片方だけ抜ける — `syncAfterWrite` を作った理由と同じ)。
 *
 * ## 何を鳴らし、何を鳴らさないか
 *
 * - **競合は必ず鳴らす。** 負けた側の内容はもう無く、成功時に位置が進むので**あとから
 *   手で押しても同じ競合は二度と出ない**。ここで言わなければ言う機会が永久に無い。
 * - **写真の取り直しなどの報告も鳴らす。** 同じく再現しない。
 * - **`unauthorized` / `schema` は鳴らす。** 再試行では直らず、放っておくと毎回静かに
 *   失敗し続ける(記録の保存は普通に通るので画面は正常に見える)。
 * - **`offline` / `server` / `local` は鳴らさない。** 電波が戻れば直るものを起動のたびに
 *   言うと、本当の警告が読まれなくなる。同期の画面を開けば「前回の同期」として読める。
 */
export function autoSyncNotice(outcome: SyncOutcome): string | null {
  if (outcome.status === 'not-configured') return null
  if (outcome.status === 'failed') {
    if (outcome.kind !== 'unauthorized' && outcome.kind !== 'schema') return null
    return outcome.kind === 'unauthorized'
      ? '同期できていない — パスワードが合っていない。直すまでこの端末の記録は別の端末に届かない。「同期」を開いて入れ直す。'
      : '同期できていない — この端末のアプリと同期先の版が合っていない。直すまでこの端末の記録は別の端末に届かない。「同期」を開いて詳しく見る。'
  }
  const { conflicts, messages } = outcome.result
  if (conflicts.length === 0 && messages.length === 0) return null
  const head =
    conflicts.length > 0
      ? `同期で ${String(conflicts.length)} 件が別の端末の内容に置き換わった（更新の新しいほうを採った。採らなかった側の内容は残っていない）。`
      : '同期で伝えることがある。'
  return `${head}「同期」を開くと何が起きたか読める。`
}
