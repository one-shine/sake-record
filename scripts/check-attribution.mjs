#!/usr/bin/env node
/**
 * ビルド成果物にクレジットと noindex が含まれることを検証する(受け入れ基準 A13 / A14)。
 *
 *   npm run attribution:check          (= node scripts/check-attribution.mjs dist)
 *
 * さけのわデータの利用条件はクレジット表示 + https://sakenowa.com へのリンクが必須(省略は禁止事項)。
 * 産地マップの県形状は @svg-maps/japan (CC-BY-4.0) で、作者・タイトル・ライセンス・改変の明示が必要。
 * どちらも「約束したこと」なので、人間の注意力ではなく成果物の検査で守る。
 *
 * 重要: クレジットは React が実行時に描くので dist/index.html には入っていない。
 * ハッシュ付き JS チャンクの中の文字列リテラルを見る(ミニファイでもリテラルは残る)。
 * ここを index.html にすると検査が常に赤 or 素通しになり、守っているつもりで守れない。
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distArg = process.argv[2] ?? 'dist'
const DIST = resolve(root, distArg)

if (!existsSync(DIST)) {
  console.error(`✗ ${distArg} が無い。先に \`npm run build\` を実行する。`)
  process.exit(1)
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const all = walk(DIST)
const rel = p => p.replace(DIST + '/', '')
// 検査するのは**自分たちのバンドル**だけ。`ocr/` は第三者の配布物をそのまま出荷している場所
// (tesseract の worker と 3.9MB の wasm コア)で、ここを混ぜると
//   - 4MB の連結が毎回走る
//   - クレジット文字列がベンダーのコード側に偶然あっても検査が通る = 穴が開く
// ため除外する。ベンダー側の告知義務は docs/THIRD_PARTY.md と public/ocr/LICENSE-Apache-2.0.txt。
const jsFiles = all.filter(
  p => p.endsWith('.js') && !rel(p).startsWith('sw.js') && !rel(p).startsWith('ocr/'),
)
const jsBundle = jsFiles.map(p => readFileSync(p, 'utf8')).join('\n')

const indexPath = resolve(DIST, 'index.html')
const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : ''

const violations = []

if (jsFiles.length === 0) {
  violations.push('JS チャンクが1つも無い(ビルドが壊れている可能性)')
}

// --- さけのわ (必須クレジット) ---
const SAKENOWA_CHECKS = [
  { needle: 'https://sakenowa.com', label: 'さけのわ本体へのリンク' },
  { needle: 'さけのわデータ', label: 'さけのわのクレジット表記' },
]
for (const { needle, label } of SAKENOWA_CHECKS) {
  if (!jsBundle.includes(needle)) {
    violations.push(`JS チャンクに ${label} ("${needle}") が無い — さけのわの禁止事項に触れる`)
  }
}

// --- @svg-maps/japan (CC-BY-4.0) ---
const CCBY_CHECKS = [
  { needle: 'Victor Cazanave', label: '作者名' },
  { needle: 'Map of Japan', label: 'タイトル' },
  { needle: 'creativecommons.org/licenses/by/4.0', label: 'ライセンスへのリンク' },
  { needle: '改変', label: '改変の明示' },
]
for (const { needle, label } of CCBY_CHECKS) {
  if (!jsBundle.includes(needle)) {
    violations.push(`JS チャンクに 産地マップの${label} ("${needle}") が無い — CC-BY-4.0 の表示義務`)
  }
}

// --- noindex (A14) ---
if (!/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(indexHtml)) {
  violations.push('index.html に noindex の robots meta が無い')
}

// --- 同梱データ側のクレジット ---
const brandsPath = resolve(DIST, 'data/sakenowa/brands.json')
if (!existsSync(brandsPath)) {
  violations.push('data/sakenowa/brands.json が成果物に無い(オフライン時にサジェストが空になる)')
} else {
  const brands = JSON.parse(readFileSync(brandsPath, 'utf8'))
  if (brands.copyright !== 'Sakenowa') {
    violations.push(`brands.json の copyright が "Sakenowa" でない (現在: ${String(brands.copyright)})`)
  }
}

if (violations.length) {
  console.error(`✗ クレジット/noindex の検査に失敗 (${violations.length}件):`)
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}

console.log(`✓ クレジット OK: さけのわ(リンク+表記) / @svg-maps/japan(CC-BY 4項目) / noindex`)
console.log(`    検査対象: JS ${jsFiles.length}ファイル + index.html + data/sakenowa/brands.json`)
