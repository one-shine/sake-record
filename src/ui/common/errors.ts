// 例外を「画面に出せる1行」にする。UI 層で唯一の出所にする。
//
// 無音で失敗させないのがこの層の約束なので、catch した値を捨てず必ず文字列にして表示に載せる。
// store 側(backup.ts)にも同名の内部関数があるが、あちらは errors 配列に積む文言を作るための
// 非 export の関数。ここは UI が catch した例外を描くためのもので、両者は別の経路にある。

/** `name: message` を優先し、それが無ければ String() に落とす(理由を落とさない) */
export function describeError(cause: unknown): string {
  if (cause === null || cause === undefined) return '原因不明'
  if (typeof cause === 'object' && 'name' in cause && 'message' in cause) {
    return `${String((cause as { name: unknown }).name)}: ${String((cause as { message: unknown }).message)}`
  }
  return String(cause)
}
