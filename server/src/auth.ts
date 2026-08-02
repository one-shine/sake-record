// 同期先の認証。**秘密はパスワード1本だけ**(PHASE 8 / 受け入れ基準 A29)。
//
// ここに置いたのは、この1本が漏れたら記録が読まれるという意味で**同期の安全の全部**が
// 乗っているから。1ファイルに閉じて、テストで固定できる形にしてある。
//
// ## なぜ `a === b` で書かないのか
//
// 文字列比較は**最初に違う文字で打ち切る**ので、応答時間に「何文字目まで合っていたか」が漏れる。
// 総当たりが1文字ずつ確定できる形になり、長いランダム値という前提が意味を失う。
//
// ## なぜ長さを揃えてから比べるのか
//
// 定数時間の比較は**同じ長さ**でしか成立しない(長さが違えば分岐が要る)。そこで両方を
// SHA-256 に通してから比べる。ダイジェストは常に32バイトなので、
// **パスワードの長さそのものも漏れない**。ハッシュは秘密を隠すためではなく長さを揃えるために使う。
//
// `crypto.subtle.digest` は Workers にも Node にもある。Workers 専用の
// `crypto.subtle.timingSafeEqual` を使わないのは、**同じコードを単体テストで回すため**
// (Node には無いので、あちらを使うと一番落としてはいけない関数だけが無検査になる)。

import { MIN_PASSWORD_BYTES, decodeSyncCredential } from '../../src/domain/syncWire.ts'

/**
 * 最小の長さは **domain の1箇所**から引いて再輸出する(サーバとアプリで違う値を見ない —
 * 片方だけ緩めると、アプリでは保存できるのにサーバが 401 を返す値が作れる)。
 */
export { MIN_PASSWORD_BYTES }

/**
 * `Authorization: Bearer <password>` から password を取り出す。読めなければ `null`。
 *
 * 大文字小文字を無視するのは HTTP の scheme が case-insensitive だから。
 * **前後の空白は許すが、password の中の空白は許さない**(空白入りのパスワードを受けると、
 * 貼り付け事故で切れた値が「短いパスワード」として通り得る)。
 */
export function bearerValue(header: string | null | undefined): string | null {
  if (typeof header !== 'string') return null
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header)
  return match ? match[1] : null
}

/**
 * 同期先に設定された合言葉が**使える形か**。
 *
 * 短すぎる / 設定されていないときは誰も通れないが、**返るのが 401 だけだと運用者にも
 * その理由が見えない**(「合言葉が違う」としか出ないので、設定の問題だと気付けない)。
 * 呼び側はこれを見て、認証の失敗とは別の応答を返す。
 *
 * **これを漏洩と考えない。** 分かるのは「同期先の設定が済んでいない」ことだけで、
 * その状態では誰も通れないのだから、守るものが無い。
 */
export function passwordConfigured(expected: string | null | undefined): boolean {
  if (typeof expected !== 'string') return false
  return new TextEncoder().encode(expected).length >= MIN_PASSWORD_BYTES
}

/** SHA-256 の32バイト。長さを揃えるためだけに通す */
async function digest(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}

/**
 * 定数時間の比較。**長さが違ったら即 false を返さない** —
 * ここに渡るのは常に32バイトのダイジェストなので、長さの分岐は起こり得ないほうが正しい
 * (それでも防御的に見て、違えば結果に混ぜる)。
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    // 範囲外は 0 として畳む。**途中で return しない**(それが定数時間の全部)
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return diff === 0
}

/**
 * 提示された値が正しいか。**受け取るのは base64 にした合言葉**(`encodeSyncCredential`)。
 *
 * **設定されていないときは必ず false**(fail closed)。`SYNC_PASSWORD` を入れ忘れた Worker が
 * 「秘密が無いので誰でも通る」状態でデプロイされるのが、この種の穴で一番起きやすい。
 * 短すぎる秘密も同じ理由で断る(設定ミスを黙って受けない)。
 */
export async function passwordMatches(
  presented: string | null | undefined,
  expected: string | null | undefined,
): Promise<boolean> {
  if (!passwordConfigured(expected)) return false
  // `passwordConfigured` が文字列であることまで確かめているが、型には伝わらない
  const secret = expected as string
  if (typeof presented !== 'string' || presented === '') return false
  // ヘッダに載せるため base64 で来る。戻せない値は照合するまでもなく違う
  const decoded = decodeSyncCredential(presented)
  if (decoded === null || decoded === '') return false
  const [a, b] = await Promise.all([digest(decoded), digest(secret)])
  return constantTimeEqual(a, b)
}
