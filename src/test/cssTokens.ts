// `src/index.css` の `@theme` を**値として**読むためのテスト用ヘルパ。
//
// ## なぜ必要か
//
// 画面側は配色を意味的トークン名(`--color-ink` など)でしか持たない。名前を書き写す検査は
// 定義の写経で、index.css 側で値を入れ替えても緑のままになる(恒真に近い)。
// **実値を読んで相対輝度を計算する**ことで、「本文は 4.5:1 以上」「地はクリームに寄らない」
// 「多いほど濃い」といった配色の要求そのものを検査できる。
//
// ## CSS の読み方(`?raw` が使えない)
//
// vitest は `css: false`(vitest.config.ts)なので、**`.css` の import は `?raw` でも空文字になる**
// (実測: `index.css?raw` の length が 0)。よって `readFileSync` で読む。
// `@types/node` はこのリポジトリに入れない(tsconfig.app.json のコメント: 入れると本番 `src` でも
// `process`/`Buffer` が型チェックを通る)ので、`src/test/notice.ts` が `process` に対してやっている
// のと同じ**構造で受ける**手を使う: 指定子を `string` 型の変数にすると TypeScript は
// `import()` の型解決を試みないため、必要な関数の形だけ自分で書ける。
// パスは `import.meta.url` の文字列操作で組む — `new URL(..., import.meta.url)` は vite が
// アセット参照に書き換えるので使えない(tables.test.ts が踏んだ ENOENT と同じ罠)。
//
// **このファイルに旧パレットのクラス名を書かない。** Tailwind v4 の候補抽出は src/ 配下の
// ソースを走査するので、書くとその名前の死んだ規則が本番 CSS に残る。

const fsSpecifier: string = 'node:fs'
const { readFileSync } = (await import(fsSpecifier)) as {
  readFileSync: (path: string, encoding: 'utf8') => string
}

/** `…/src/` の絶対パス(末尾スラッシュ付き) */
const SRC_DIR = decodeURIComponent(import.meta.url.replace(/^file:\/\//, '')).replace(
  /test\/[^/]+$/,
  '',
)

/** `src/` 配下のソースを素のテキストで読む。クラス文字列に埋まった値(不透明度など)を引くのに使う */
export function readSrc(relativePath: string): string {
  return readFileSync(`${SRC_DIR}${relativePath}`, 'utf8')
}

export const INDEX_CSS = readSrc('index.css')

/**
 * コメントを落とした index.css。**検査はこちらを見る** — index.css の散文には
 * 旧い値や `prefers-color-scheme` のような語がそのまま書かれているので、
 * 生のテキストを検査すると「書いてあるだけ」を宣言と読み違える(実際に踏んだ)。
 */
export const CSS_RULES = INDEX_CSS.replace(/\/\*[\s\S]*?\*\//g, ' ')

/**
 * `--color-<name>` の実値。**定義が無ければ落とす** — Tailwind は未定義のトークンでは
 * ユーティリティを生成しないので、綴り違いは例外ではなく「色が付かない」形で本番に出る。
 */
export function hexOf(name: string): string {
  const found = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{3,6})\\s*;`).exec(CSS_RULES)
  if (found === null) throw new Error(`--color-${name} が src/index.css の @theme に無い`)
  return found[1]
}

export function channels(hex: string): readonly number[] {
  const body = hex.slice(1)
  const full = body.length === 3 ? [...body].map((digit) => `${digit}${digit}`).join('') : body
  return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16))
}

/** WCAG 2.x の相対輝度(0=黒 … 1=白) */
export function luminance(hex: string): number {
  const [red, green, blue] = channels(hex).map((value) => {
    const ratio = value / 255
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/** コントラスト比(1..21)。どちらが明るいかに依らない */
export function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

/** 彩度の代わりの粗い指標: RGB の幅。無彩色は 0 に近く、暖色の階調は大きく開く */
export function channelSpread(hex: string): number {
  const values = channels(hex)
  return Math.max(...values) - Math.min(...values)
}

/**
 * 不透明度を掛けた**実効色**。`plot-ink/20` のように薄めて重ねる層は、
 * 宣言された色ではなく合成後の色で読まれる(白地に 20% で置いた線は宣言値より遥かに薄い)。
 * `alpha` は 0..1。ブラウザは sRGB の単純な線形補間で合成する(実測値と一致することを確認済み)。
 */
export function over(foreground: string, background: string, alpha: number): string {
  const front = channels(foreground)
  const back = channels(background)
  const mixed = front.map((value, index) => Math.round(value * alpha + back[index] * (1 - alpha)))
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}
