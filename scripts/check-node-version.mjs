#!/usr/bin/env node
/**
 * `package.json` の `engines.node` を**実際に強制する**(BACKLOG B23)。
 *
 *   npm run node:check
 *
 * 検査は2つ:
 *   1. 走っている Node が engines を満たすか
 *   2. `.github/workflows/*.yml` の `node-version:` が engines を満たすか
 *
 * なぜ要るか: `scripts/import-sake-log.mjs` が `src/domain/parseSakeLog.ts` を**直接 import**
 * している(パースを二重実装しないための選択)。TS の型ストリップが要るので Node 22.18+ / 23.6+
 * が必須で、それ未満だと `npm run import:sake-log` だけが落ちる。**そのスクリプトは実データ
 * (リポジトリ外の markdown)が無い CI では一度も走らない**ので、Node を下げたことに気づく
 * 経路が無い(気づくのは手元で取り込もうとしたときだけ)。宣言を置いて毎回検査する。
 *
 * `engines` は `npm ci` では**既定で強制されない**(`engine-strict=true` が要る)。`.npmrc` で
 * 強制すると依存側の engines まで巻き込んで install が落ちるので、ここで自分の分だけ見る。
 *
 * semver ライブラリは入れない(依存を1つ増やすほどの範囲を書いていない)。下のパーサは
 * `>= > <= < =` と空白の AND、`||` の OR だけを解釈する**部分実装**で、それ以外の記法
 * (`^` `~` `x` `-`)が来たら**黙って通さず落ちる**。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOW_DIR = resolve(root, '.github/workflows')

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const range = pkg.engines?.node
if (typeof range !== 'string' || range.trim() === '') {
  console.error('✗ package.json に engines.node が無い。必要な Node 版を宣言する(B23)。')
  process.exit(1)
}

/** `'22.18.0'` → `[22, 18, 0]`。欠けた桁は `fill` で埋める */
function parseVersion(text, fill = 0) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(text.trim())
  if (!m) return null
  return [Number(m[1]), m[2] === undefined ? fill : Number(m[2]), m[3] === undefined ? fill : Number(m[3])]
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return 0
}

/** 部分実装。解釈できない記法は例外にする(通してしまうと無検査になる) */
function satisfies(version, rangeText) {
  return rangeText.split('||').some(clause =>
    clause
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every(comparator => {
        const m = /^(>=|<=|>|<|=)?(.+)$/.exec(comparator)
        const bound = m && parseVersion(m[2])
        if (!bound || /[\^~x*-]/.test(m[2])) {
          throw new Error(`engines.node に未対応の記法がある: ${comparator}`)
        }
        const c = compare(version, bound)
        switch (m[1] ?? '=') {
          case '>=':
            return c >= 0
          case '>':
            return c > 0
          case '<=':
            return c <= 0
          case '<':
            return c < 0
          default:
            return c === 0
        }
      }),
  )
}

const problems = []

/** 部分実装のパーサが読めない記法は**例外で止める**。素通りさせると無検査になる */
function satisfiesOrDie(version, rangeText) {
  try {
    return satisfies(version, rangeText)
  } catch (err) {
    console.error(`✗ ${err.message}`)
    console.error('  この検査器は `>= > <= < =` と `||` だけを解釈する部分実装(scripts/check-node-version.mjs)。')
    console.error('  engines.node をその記法で書き直すか、検査器を拡張する。**読めない範囲を通してはいけない**。')
    process.exit(1)
  }
}

// ── 1. 走っている Node ────────────────────────────────────────────────
const current = parseVersion(process.version)
if (!satisfiesOrDie(current, range)) {
  problems.push(
    `走っている Node ${process.version} が engines.node "${range}" を満たさない。\n` +
      '    22.18 未満 / 23.0〜23.5 では TS の型ストリップが無く `npm run import:sake-log` が落ちる。',
  )
}

// ── 2. ワークフローの node-version ────────────────────────────────────
// YAML パーサは入れない。`node-version:` の行だけを見る単純な走査で、
// **1件も見つからなければ落とす**(見つからないことを「合格」と読み違えないため)。
const workflows = readdirSync(WORKFLOW_DIR)
  .filter(n => n.endsWith('.yml') || n.endsWith('.yaml'))
  .sort()
const pins = []
for (const name of workflows) {
  const text = readFileSync(join(WORKFLOW_DIR, name), 'utf8')
  const usesSetupNode = /uses:\s*actions\/setup-node@/.test(text)
  const found = [...text.matchAll(/^\s*node-version:\s*['"]?([^'"\s#]+)/gm)].map(m => m[1])
  if (usesSetupNode && found.length === 0) {
    problems.push(`${name} が actions/setup-node を使っているのに node-version を指定していない(ランナー既定の Node で走る)。`)
    continue
  }
  for (const spec of found) {
    // setup-node は `22` のような別名を**その系列の最新**に解決する。
    // だから満たすべきなのは「その系列の上端」。欠けた桁を大きい値で埋めて判定する
    // (`22` → 22.9999.9999 / `22.14` → 22.14.9999)。engines が上限を持たない限りこれで足りる。
    const resolved = parseVersion(spec, 9999)
    if (!resolved) {
      problems.push(`${name}: node-version "${spec}" を版として読めない。`)
      continue
    }
    pins.push(`${name}: ${spec}`)
    if (!satisfiesOrDie(resolved, range)) {
      problems.push(
        `${name}: node-version "${spec}" が engines.node "${range}" を満たさない` +
          `(この指定が解決しうる最新 ${resolved.join('.')} でも範囲外)。`,
      )
    }
  }
}
if (workflows.length === 0) {
  problems.push('.github/workflows/ にワークフローが1つも無い(検査が無検査になっている)。')
}

if (problems.length > 0) {
  console.error(`✗ Node 版の宣言と実体がずれている (${problems.length}件):`)
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}

console.log(
  `✓ Node ${process.version} は engines.node "${range}" を満たす` +
    `(ワークフロー ${workflows.length}件 / node-version 指定 ${pins.length}件を検査)`,
)
for (const p of pins) console.log(`    ${p}`)
