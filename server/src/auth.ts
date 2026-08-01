// 同期先の認証。**秘密はトークン1本だけ**(PHASE 8 / 受け入れ基準 A29)。
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
// **トークンの長さそのものも漏れない**。ハッシュは秘密を隠すためではなく長さを揃えるために使う。
//
// `crypto.subtle.digest` は Workers にも Node にもある。Workers 専用の
// `crypto.subtle.timingSafeEqual` を使わないのは、**同じコードを単体テストで回すため**
// (Node には無いので、あちらを使うと一番落としてはいけない関数だけが無検査になる)。

/** 同期トークンの最小の長さ(バイト)。これより短い秘密は総当たりで割れる */
export const MIN_TOKEN_BYTES = 24

/**
 * `Authorization: Bearer <token>` から token を取り出す。読めなければ `null`。
 *
 * 大文字小文字を無視するのは HTTP の scheme が case-insensitive だから。
 * **前後の空白は許すが、token の中の空白は許さない**(空白入りのトークンを受けると、
 * 貼り付け事故で切れた値が「短いトークン」として通り得る)。
 */
export function bearerToken(header: string | null | undefined): string | null {
  if (typeof header !== 'string') return null
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header)
  return match ? match[1] : null
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
 * 提示されたトークンが正しいか。
 *
 * **設定されていないときは必ず false**(fail closed)。`SYNC_TOKEN` を入れ忘れた Worker が
 * 「秘密が無いので誰でも通る」状態でデプロイされるのが、この種の穴で一番起きやすい。
 * 短すぎる秘密も同じ理由で断る(設定ミスを黙って受けない)。
 */
export async function tokenMatches(
  presented: string | null | undefined,
  expected: string | null | undefined,
): Promise<boolean> {
  if (typeof expected !== 'string' || new TextEncoder().encode(expected).length < MIN_TOKEN_BYTES) {
    return false
  }
  if (typeof presented !== 'string' || presented === '') return false
  const [a, b] = await Promise.all([digest(presented), digest(expected)])
  return constantTimeEqual(a, b)
}
