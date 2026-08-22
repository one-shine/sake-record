// @vitest-environment node
// 判断だけの純関数なので DOM を要らない。
//
// **ここが守っているのは「本人が押していない同期で消えたものを、黙って消させない」**(B82 / A26)。
// 起動時と保存後の同期は成功すると位置(`syncCursor`)を進めるので、ここで鳴らさなかった競合は
// **あとから手で同期しても二度と出ない**。鳴らす/鳴らさないの線引きをここで固定する。

import { describe, expect, it } from 'vitest'
import type { SyncOutcome } from '../../store/sync.ts'
import { autoSyncNotice } from './autoSyncNotice.ts'

function done(over: { conflicts?: number; messages?: string[] } = {}): SyncOutcome {
  return {
    status: 'done',
    result: {
      startedAt: '2026-08-22T00:00:00.000Z',
      localRecords: 10,
      applied: 0,
      removed: 0,
      pushed: 0,
      conflicts: Array.from({ length: over.conflicts ?? 0 }, (_unused, index) => ({
        id: `r${String(index)}`,
        winner: 'remote' as const,
        winnerDeleted: false,
      })),
      messages: over.messages ?? [],
    },
  }
}

describe('autoSyncNotice', () => {
  it('競合があったら件数と「採らなかった側は残っていない」を言う', () => {
    const notice = autoSyncNotice(done({ conflicts: 2 }))
    expect(notice).toContain('2 件')
    expect(notice).toContain('残っていない')
    // 詳しく読む先を指す(ここは割り込みで、全部をここに書かない)
    expect(notice).toContain('同期')
  })

  // 写真の取り直しなども同じ理由で再現しない
  it('報告があれば競合が0でも鳴らす', () => {
    expect(autoSyncNotice(done({ messages: ['1件の写真を同期先から取り直した'] }))).not.toBeNull()
  })

  // 何も起きていない同期は起動のたびに走る。鳴らすと通知そのものが読まれなくなる
  it('何も起きなかった同期では鳴らさない', () => {
    expect(autoSyncNotice(done())).toBeNull()
  })

  it('同期先が未設定なら鳴らさない(通信もしていない)', () => {
    expect(autoSyncNotice({ status: 'not-configured' })).toBeNull()
  })

  // **再試行では直らない失敗だけ鳴らす。** 合言葉が違う端末は毎回静かに失敗し続け、
  // 記録の保存は普通に通るので画面は正常に見える(数週間気付かないことがある)
  it('パスワード違いと版ずれは鳴らす', () => {
    for (const kind of ['unauthorized', 'schema'] as const) {
      const notice = autoSyncNotice({ status: 'failed', kind, message: 'なにか' })
      expect(notice, kind).not.toBeNull()
      expect(notice, kind).toContain('別の端末に届かない')
    }
  })

  // 電波が戻れば直るものを起動のたびに言うと、本当の警告が読まれなくなる
  // (同期の画面を開けば「前回の同期」として読める)
  it('通信・サーバ・保存領域の失敗では鳴らさない', () => {
    for (const kind of ['offline', 'server', 'local'] as const) {
      expect(autoSyncNotice({ status: 'failed', kind, message: 'なにか' }), kind).toBeNull()
    }
  })
})
