#!/usr/bin/env node
/**
 * **画面が書いた配色クラスが `@theme` のトークンに解決するか**を検査する(BACKLOG B45)。
 *
 *   npm run colors:check
 *
 * ## なぜ要るか
 *
 * 配色は約365箇所あるのに、既存のテストが見ているのは**トークン側の値**だけ
 * (`src/theme.test.ts` が対比を計算し、`fillSteps.test.ts` が段の向きを固定する)。
 * **使う側は1件も見ていない** — `bg-surface-raised` を `bg-surface-rased` と打ち間違えても、
 * Tailwind は「知らないクラス」として**規則を出さないだけ**で、型もテストもビルドも緑のまま
 * その部品の背景が透明になる。CI が緑であることが配色の証拠にならない状態だった。
 *
 * ここが見るのは2つ。どちらも「静的に決まること」だけで、実際に描かれる色は見ない
 * (それは実ブラウザの実測が担う分担で、CLAUDE.md と BACKLOG B45 にそう書いてある)。
 *
 * 1. **色のユーティリティの接尾辞が `@theme` の `--color-*` に在る。**
 *    在庫に無い名前を書いたらここで落ちる。
 * 2. **スケール値(パレット名 + 数値)を直に書いていない。**
 *    `bg-stone-800` のような書き方は CLAUDE.md が禁じている(トークンが配色の単一の出所で、
 *    直書きするとダークを足すときに利用箇所を全部触ることになる)。今まで散文だけが守っていた。
 *
 * ## 色ではない接尾辞
 *
 * `text-xs` / `border-2` / `fill-none` のように、同じ接頭辞で色以外の軸も来る。
 * それを許すのに**ワイルドカードを使わない** — 緩めると打ち間違いまで通ってしまうので、
 * 実際に使っている語を `NON_COLOR` に列挙する。新しい語を使ったらここに足す(足す手間が
 * 「本当に色ではないか」を1度考える機会になる)。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = resolve(root, 'src')
const THEME = resolve(SRC, 'index.css')

/** 色を取る接頭辞。**接頭辞ごとに別々の在庫を持たない**(Tailwind は同じ `--color-*` から作る) */
const PREFIXES = [
  'bg',
  'text',
  'border',
  'fill',
  'stroke',
  'decoration',
  'ring',
  'outline',
  'placeholder',
  'caret',
  'accent',
  'divide',
  // **グラデーションの `from` / `via` / `to` は入れない。** 語が一般的すぎて
  // `imageOrientation: 'from-image'` や id の `'from-server'` を掴む。
  // このアプリはグラデーションを使わない(飾り罫と同じ理由で入れない方針)ので、
  // 使うことになった日にここへ足して、そのとき誤検出を潰す。
]

/**
 * 色ではない接尾辞。**接頭辞ごとに分ける** — `text-none` は色の名前かもしれないが
 * `outline-none` は確実に色ではない、のような差を潰さないため。
 */
const NON_COLOR = {
  text: ['xs', 'sm', 'base', 'lg', 'xl', 'left', 'right', 'center', 'justify', 'nowrap'],
  border: ['collapse', 'separate', 'solid', 'dashed'],
  // `fill-none` / `outline-none` は「塗らない」で、色の名前ではない。
  // `fill-opacity` は SVG の属性名(クラスではない)。掴むと属性を書いた場所で赤くなる
  fill: ['none', 'opacity'],
  stroke: ['none', 'opacity', 'width', 'linecap', 'linejoin'],
  outline: ['none', 'hidden'],
  decoration: ['solid', 'dashed', 'dotted', 'wavy'],
}

/**
 * 辺と太さ(`border-b` / `border-b-2` / `divide-y`)。**色の在庫とは別に扱う** —
 * `border-b-2` の接尾辞は `b-2` で、色の名前として在庫に問い合わせても意味が無い。
 */
const SIDE = /^(?:t|b|l|r|x|y|s|e)(?:-\d+)?$/

/**
 * Tailwind の組み込みキーワード。`@theme` に宣言が無くても常に在る。
 * **`black` / `white` は入れない** — スケール値の直書きと同じで、地と面はトークンから引く。
 */
const BUILTIN = new Set(['transparent', 'current', 'inherit'])

/** Tailwind の既定パレット。**この名前 + 数値は書かない**(トークンを引く) */
const PALETTE =
  '(?:slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)'

const PREFIX_GROUP = `(${PREFIXES.join('|')})`
/** `bg-surface-raised/60` / `hover:bg-surface-raised` のどちらも拾う */
const UTILITY = new RegExp(`\\b${PREFIX_GROUP}-([a-z][a-z0-9-]*)(?:/\\d+)?\\b`, 'g')
const SCALE = new RegExp(`\\b${PREFIX_GROUP}-${PALETTE}-\\d{2,3}\\b`, 'g')
/** スケール値は SCALE 側が名指しで説明する。在庫照合でも重ねて上げない(1件を2回言わない) */
const SCALE_SUFFIX = new RegExp(`^${PALETTE}-\\d{2,3}$`)

function readTokens() {
  const css = readFileSync(THEME, 'utf8')
  const names = [...css.matchAll(/^\s*--color-([a-z0-9-]+)\s*:/gm)].map((m) => m[1])
  if (names.length === 0) {
    console.error(`✗ ${THEME} から --color-* を1つも読めなかった(検査が成立していない)`)
    process.exit(1)
  }
  return new Set(names)
}

/**
 * コメントを落とす。**コメントはクラス名を語る場所**で、しかも
 * 「こう書いてはいけない」の見本(`fill-scale-${n}` / `bg-stone-800`)を書くのが
 * このリポジトリの作法なので、そのまま走査すると解説が違反として上がる。
 *
 * 字句解析はしない。**行ごとに「ここから先はコメント」を決めるだけ**にする —
 * 正規表現リテラルの中の `//` を誤ってコメントの開始と読む危険はあるが、
 * 落とすのは行の残りだけで、**コード行の末尾にクラス名が来ることは無い**
 * (クラスは文字列かテンプレートの中にあり、その後ろに `//` は書かない)。
 */
function withoutComments(text) {
  const out = []
  let inBlock = false
  for (const line of text.split('\n')) {
    const trimmed = line.trimStart()
    if (inBlock) {
      const end = line.indexOf('*/')
      if (end < 0) continue
      inBlock = false
      out.push(line.slice(end + 2))
      continue
    }
    if (trimmed.startsWith('/*')) {
      inBlock = !line.includes('*/', line.indexOf('/*') + 2)
      continue
    }
    const slashes = line.indexOf('//')
    out.push(slashes < 0 ? line : line.slice(0, slashes))
  }
  return out.join('\n')
}

function sources(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name)
    if (statSync(p).isDirectory()) out.push(...sources(p))
    else if (['.ts', '.tsx'].includes(extname(p))) out.push(p)
  }
  return out
}

const tokens = readTokens()

/** 1つのソースを走査して違反の説明を返す。**自己検査も同じ関数を通す** */
function scan(text, rel) {
  const found = []
  const stripped = withoutComments(text)
  let counted = 0

  for (const m of stripped.matchAll(SCALE)) {
    found.push(
      `✗ ${rel}: \`${m[0]}\` はスケール値の直書き。` +
        `意味的トークン(src/index.css の @theme)を引く — トークンが配色の単一の出所`,
    )
  }

  for (const m of stripped.matchAll(UTILITY)) {
    const [, prefix, suffix] = m
    if ((NON_COLOR[prefix] ?? []).includes(suffix)) continue
    if (BUILTIN.has(suffix)) continue
    // 数値だけの接尾辞(`border-2` / `ring-1`)と辺(`border-b` / `border-b-2`)は色ではない
    if (/^\d+$/.test(suffix)) continue
    if (['border', 'divide'].includes(prefix) && SIDE.test(suffix)) continue
    if (SCALE_SUFFIX.test(suffix)) continue
    counted += 1
    if (tokens.has(suffix)) continue
    found.push(
      `✗ ${rel}: \`${prefix}-${suffix}\` に対応する --color-${suffix} が @theme に無い。` +
        `打ち間違いなら直す / 色ではない語なら scripts/check-color-tokens.mjs の NON_COLOR に足す`,
    )
  }
  return { found, counted }
}

// **自己検査。** 恒偽の条件は静かに機能を殺す(B41 の作法)。この門は普段1件も上げないので、
// 検査器自身が「打ち間違い」「スケール値の直書き」「コメントは見逃す」を毎回実演する。
// 実ファイルは1つも作らない。
const PROBES = [
  { code: 'const a = "bg-surfce-raised"', want: 1, why: 'トークン名の打ち間違い' },
  { code: 'const a = "bg-stone-800"', want: 1, why: 'スケール値の直書き' },
  { code: 'const a = "bg-surface"', want: 0, why: '実在するトークンは通す' },
  { code: '// bg-stone-800 と書いてはいけない', want: 0, why: 'コメントの中の見本は上げない' },
]
for (const probe of PROBES) {
  const { found } = scan(probe.code, '<自己検査>')
  if (found.length !== probe.want) {
    console.error(
      `✗ 自己検査が成立していない: ${probe.why} — ` +
        `期待 ${String(probe.want)}件 / 実際 ${String(found.length)}件`,
    )
    process.exit(1)
  }
}

const files = sources(SRC)
const violations = []
let checked = 0
for (const file of files) {
  const { found, counted } = scan(readFileSync(file, 'utf8'), file.replace(root + '/', ''))
  violations.push(...found)
  checked += counted
}

if (violations.length > 0) {
  console.error(`✗ 配色クラスが @theme に解決しない (${String(violations.length)}件):`)
  for (const v of violations) console.error(`  ${v}`)
  process.exit(1)
}

console.log(
  `✓ 配色クラスはすべて @theme に解決する: ` +
    `${String(checked)}箇所 / トークン ${String(tokens.size)}件 (${String(files.length)}ファイルを走査` +
    `。自己検査 ${String(PROBES.length)}件)`,
)
