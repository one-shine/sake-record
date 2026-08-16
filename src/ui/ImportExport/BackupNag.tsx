// バックアップ督促。SPEC の「アプリ側で『最終エクスポートからの経過日数』を警告表示して
// 緩和する」と BACKLOG B7(iOS Safari の7日間ストレージ退避)を1つの面で受ける。
//
// 依存方向は domain ← store ← ui。ここは ui 層なので store の `meta.ts` を引いてよい。
// **状態は持たない** — 材料(記録の件数 / 最終書き出し日時 / 永続化の状態)は全部 props で
// 受ける。督促は「時系列の上」にも「書き出し画面」にも置き得るので、読み込みを内側に隠すと
// 置く場所ごとに DB を叩く数が変わってしまう(読むのは呼び側の1箇所)。
//
// ## この画面が負っている約束
//
// 1. **記録が0件なら何も言わない。** 守るものが無いのに督促するのは、内容の無い警告に
//    慣れさせるだけ(次に本物が出たときに読まれなくなる)。
// 2. **脅さないが、消える条件は具体的に書く。** 「消えるかもしれません」ではなく
//    「サイトデータを削除したとき」「7日間使わなかったとき」と条件を名指しする。
// 3. **分からないことを強さで埋めない。** 一度も書き出していない場合、経過日数は分からない
//    (記録が入った日は見ていない)ので**段は上げず**「まだ一度も書き出していない」と事実だけ言う。
// 4. **UA を判定しない。** 「ホーム画面に追加すると消えにくい」の案内は
//    **永続化が得られなかったという事実**(`persistence !== 'granted'`)で分岐する。
//    ブラウザ名で分岐すると、名前が変わった / 別のブラウザが同じ挙動になった瞬間に外れる。
//    そもそも `persist()` を無視するのが iOS Safari だけだとは検証できていない。
//
// 文言は常体。絵文字は使わない(アイコン代わりの絵文字は情報を持たない)。

import { daysSince, type PersistStatus } from '../../store/meta.ts'

type Props = {
  /** この端末の記録の件数。**0 なら何も出さない**(守るものが無い) */
  recordCount: number
  /** 最終書き出し日時(ISO 8601)。`null` = 一度も書き出していない */
  lastExportedAt: string | null
  /**
   * 永続化の状態。`granted` 以外なら「消えにくくする」案内を出す。
   * `null` = まだ確認していないので何も言わない(**分からないことを断定しない**)。
   */
  persistence: PersistStatus | null
  /**
   * この端末で同期が使える状態か(B7)。**復元手段の説明が変わる。**
   *
   * 同期を入れる前は「書き出した JSON 以外に復元手段は無い」が常に真だったが、
   * 同期を設定した端末では**送れている分は同期先にもある**。`false` の端末では
   * 今までどおり真なので、言い分けないと片方で嘘になる。
   *
   * **`true` でも督促の強さは下げない。** 同期先も1箇所で、消えるときは一緒に消える
   * (同期は端末間で持ち合うだけで、世代を残すバックアップではない)。
   */
  synced?: boolean
  /** 判定の基準時刻。既定は現在時刻(テストが時計を固定できるように受ける) */
  now?: Date
}

/**
 * 注意のしきい値。SPEC の「経過日数を警告表示」を2段に分ける(PHASE_7 の完了条件)。
 * **`export` してあるのは「知る」の保存の節が引くため** — あちらに 14/30 を書き写すと、
 * しきい値を直したときに説明だけが古い日数のまま残る(画面は正しく見える)。
 */
export const BACKUP_NOTICE_DAYS = 14
/** 強めのしきい値 */
export const BACKUP_STRONG_DAYS = 30
const NOTICE_DAYS = BACKUP_NOTICE_DAYS
const STRONG_DAYS = BACKUP_STRONG_DAYS

type Level = 'none' | 'notice' | 'strong'

/**
 * 経過の3状態。**`unreadable` を `never` に畳まない** — 値はあるのに読めないのと、
 * 一度も書き出していないのは別の事実で、前者は DB か版の問題を疑う手がかりになる。
 */
type Elapsed =
  | { kind: 'never' }
  | { kind: 'unreadable'; raw: string }
  | { kind: 'days'; days: number }

function elapsedOf(lastExportedAt: string | null, now: Date): Elapsed {
  if (lastExportedAt === null) return { kind: 'never' }
  const days = daysSince(lastExportedAt, now)
  if (days === null) return { kind: 'unreadable', raw: lastExportedAt }
  return { kind: 'days', days }
}

function levelOf(elapsed: Elapsed): Level {
  // 一度も書き出していない / 日時が読めない = 経過日数が分からない。**段は上げない**
  if (elapsed.kind !== 'days') return 'notice'
  if (elapsed.days >= STRONG_DAYS) return 'strong'
  if (elapsed.days >= NOTICE_DAYS) return 'notice'
  return 'none'
}

function headingOf(elapsed: Elapsed, level: Level): string {
  if (elapsed.kind === 'never') return 'まだ一度も書き出していない'
  if (elapsed.kind === 'unreadable') {
    return `最後に書き出した日時を読み取れない（${elapsed.raw}）`
  }
  const days = String(elapsed.days)
  // 強めの段は見出しで言い切る(「注意」と同じ文で色だけ変えると、段が変わったことが伝わらない)
  return level === 'strong'
    ? `最後に書き出してから${days}日経った（1か月以上）`
    : `最後に書き出してから${days}日経った`
}

/** 段ごとの見た目。**赤は使わない** — 失敗の色(このアプリでは `role="alert"` の赤)と混ぜない */
const BOX: Record<Exclude<Level, 'none'>, string> = {
  notice: 'border-notice-line bg-notice-surface text-notice-ink',
  strong: 'border-alert-line bg-alert-surface text-alert-ink',
}

const BOX_BASE = 'rounded border px-3 py-2.5 text-xs leading-relaxed'
const HINT_BOX = `${BOX_BASE} border-line-strong bg-canvas text-ink-muted`

export function BackupNag({
  recordCount,
  lastExportedAt,
  persistence,
  synced = false,
  now,
}: Props) {
  // 記録が0件なら督促も永続化の案内も出さない(消えて困るものがまだ無い)
  if (recordCount <= 0) return null

  const elapsed = elapsedOf(lastExportedAt, now ?? new Date())
  const level = levelOf(elapsed)
  // `null`(未確認)では出さない。`granted` は消えにくい状態なので言うことが無い
  const showPersistHint = persistence === 'denied' || persistence === 'unsupported'
  if (level === 'none' && !showPersistHint) return null

  return (
    <section className="flex flex-col gap-2 px-4 pt-4">
      {level !== 'none' && (
        // `role="status"` は polite。**`alert` にしない** — 画面を開いた時点で出る常設の督促で、
        // 操作の失敗(このアプリの `role="alert"`)と同じ強さで割り込むものではない
        <div role="status" className={`${BOX_BASE} ${BOX[level]}`}>
          <p className={level === 'strong' ? 'font-semibold' : 'font-medium'}>
            {headingOf(elapsed, level)}
          </p>
          {/* **同期の有無で事実が変わる。** 設定していない端末に「同期先にもある」と
              言わないのはもちろん、設定した端末に「ここにしか無い」と言うのも嘘になる */}
          <p className="mt-1.5">
            {synced ? (
              <>
                記録は{recordCount}
                件。この端末のブラウザ内（IndexedDB）と、同期先にある。まだ送れていない分は、書き出した JSON 以外に復元手段が無い。
              </>
            ) : (
              <>
                記録は{recordCount}
                件。この端末のブラウザ内（IndexedDB）にしか無く、書き出した JSON 以外に復元手段は無い。
              </>
            )}
          </p>
          {/* **「その後に記録が増えた」とは言わない**(増えたかどうかは見ていない)。
              書き出しの中身についての事実だけを言う */}
          {level === 'strong' && (
            <p className="mt-1.5">
              最後の書き出しより後に作った記録や編集は、その JSON に入っていない。「書き出す」で今の状態を保存する。
            </p>
          )}
        </div>
      )}

      {showPersistHint && (
        <div className={HINT_BOX}>
          <p className="font-medium text-ink">
            {persistence === 'unsupported'
              ? 'このブラウザには保存領域の永続化を要求する仕組みが無い'
              : 'このブラウザから保存領域の永続化を得られなかった'}
          </p>
          <p className="mt-1.5">
            ホーム画面に追加（インストール）すると消えにくい。インストールしていない状態では、
            <strong className="font-medium text-ink">7日間使わなかった時点</strong>
            で保存領域を自動で退避するブラウザがある。
          </p>
          <p className="mt-1.5">
            消えるのは次の場合。(1) ブラウザのサイトデータを削除したとき。(2)
            上の7日間の自動退避が起きたとき。
            {synced
              ? '同期先に送れている分は次の同期で戻る。送れていない分は書き出した JSON からしか戻らない。'
              : 'どちらも書き出した JSON からしか戻せない。'}
          </p>
        </div>
      )}
    </section>
  )
}
