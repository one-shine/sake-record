// テストの**スキップを無音にしない**ための1行出力。
//
// 「テストは緑なのに、その環境では一度も検証していない」状態(実 canvas が無い / 実データの
// seed が無い)は、要約の `skipped` だけでは何が未検証なのか分からない。ファイルごとに理由を
// 1行出して、緑の run に残す。
//
// **`console.log` / `console.warn` では出ない**: vitest の既定レポーターは*成功した*ファイルの
// console 出力を捨てる(実測。失敗したときだけ表示される)。ファイル全体がスキップされた場合も
// 同じで、モジュール読み込み時の console はどこにも出ない。stderr へ直接書くと素通りするので
// そちらを使う。
//
// `process` を型ではなく構造で取っているのは、このリポジトリに `@types/node` が無く
// `/// <reference types="node" />` を足すと本番 `src` に node のグローバルが漏れるため
// (tsconfig.app.json のコメント / backup.test.ts と同じ制約)。ブラウザ側の実行環境では
// `process` が無いので `console.warn` に落ちる。

export function notice(message: string): void {
  const proc = (globalThis as { process?: { stderr?: { write?: (chunk: string) => unknown } } })
    .process
  if (typeof proc?.stderr?.write === 'function') {
    proc.stderr.write(`${message}\n`)
    return
  }
  console.warn(message)
}
