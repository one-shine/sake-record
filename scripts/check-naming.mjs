#!/usr/bin/env node
/**
 * ブランド名の出現範囲を検証する(受け入れ基準 A17)。
 *
 *   npm run naming:check
 *
 * 背景: 表示名と同名の企業(日本酒レビューサイト)が運営中で、同じ領域で名前が衝突している。
 * プロダクト名は変わるので、リポジトリ名・ビルドの base・公開URL・バンドルIDにブランドを入れると
 * 改名が全レイヤーに波及する。逆に「表示名だけに閉じ込める」状態を保てば、改名は3ファイルの操作で済む。
 *
 * 検査は2本:
 *   1. ブランド名の出現を ALLOWED の3ファイルに限定する
 *   2. vite.config.ts の base が './'(完全相対) であることを確認する
 *      — 相対にしておくとリポジトリ名すらビルド設定に現れず、公開先の変更も base 変更だけで済む
 *
 * ブランド名はこのファイルに書かず src/config/app.ts の APP_NAME から読む
 * (検査対象の文字列を検査器が持つと自分自身を違反として検出してしまうため)。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** ブランド名を書いてよい場所(= 表示文字列の出所) */
const ALLOWED = new Set(['index.html', 'public/manifest.json', 'src/config/app.ts'])

const APP_CONFIG = 'src/config/app.ts'
const brandMatch = /export const APP_NAME = '([^']+)'/.exec(
  readFileSync(resolve(root, APP_CONFIG), 'utf8'),
)
if (!brandMatch) {
  console.error(`✗ ${APP_CONFIG} から APP_NAME を読めない。表示名の出所が壊れている。`)
  process.exit(1)
}
const BRAND = brandMatch[1].toLowerCase()

/** 走査対象。node_modules / dist / .git / docs は対象外(docs は仕様書なので名前が出て当然) */
const SCAN_DIRS = ['src', 'public', 'scripts']
const SCAN_ROOT_FILES = [
  'index.html',
  'package.json',
  'vite.config.ts',
  'vitest.config.ts',
  'eslint.config.js',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
]
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.ico', '.woff', '.woff2'])

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'data') continue
      out.push(...walk(p))
    } else {
      out.push(p)
    }
  }
  return out
}

const targets = [
  ...SCAN_ROOT_FILES.map(f => resolve(root, f)),
  ...SCAN_DIRS.flatMap(d => {
    const p = resolve(root, d)
    return statSync(p, { throwIfNoEntry: false })?.isDirectory() ? walk(p) : []
  }),
].filter(p => statSync(p, { throwIfNoEntry: false })?.isFile())

const violations = []
const found = []

for (const abs of targets) {
  const rel = abs.replace(root + '/', '')
  if (SKIP_EXT.has(rel.slice(rel.lastIndexOf('.')))) continue

  const text = readFileSync(abs, 'utf8')
  const lines = text.split('\n')
  const hits = []
  lines.forEach((line, i) => {
    if (line.toLowerCase().includes(BRAND)) hits.push(i + 1)
  })
  if (hits.length === 0) continue

  if (ALLOWED.has(rel)) {
    found.push(`${rel} (${hits.length}箇所)`)
  } else {
    violations.push(`${rel}:${hits.join(',')} — ブランド名 "${BRAND}" は表示文字列の3ファイルにのみ置く`)
  }
}

// base が完全相対であること
const viteConfig = readFileSync(resolve(root, 'vite.config.ts'), 'utf8')
if (!/base:\s*'\.\/'/.test(viteConfig)) {
  violations.push(
    "vite.config.ts の base が './' でない — 相対 base にしてリポジトリ名をビルド設定から出さない",
  )
}

if (violations.length) {
  console.error(`✗ 命名の検査に失敗 (${violations.length}件):`)
  for (const v of violations) console.error('  ' + v)
  console.error('  改名を3ファイルの操作で済ませるための不変条件。許可先: ' + [...ALLOWED].join(' / '))
  process.exit(1)
}

console.log(`✓ 命名 OK: base は './' / ブランド名は表示文字列のみ`)
for (const f of found) console.log(`    ${f}`)
