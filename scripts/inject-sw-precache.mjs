#!/usr/bin/env node
/**
 * ビルド後に public/sw.js のプレースホルダを実値へ置換する(`npm run build` の末尾で走る)。
 *
 *   __CACHE_VERSION__   → ビルドごとに変わるキャッシュ名(activate で旧世代を全削除する)
 *   __PRECACHE_ASSETS__ → dist/assets/* と dist/data/sakenowa/*.json の相対パス配列
 *
 * 必須シェルに何を入れるかが offline 動作の分かれ目:
 *   - JS/CSS が無いとアプリが起動しない
 *   - さけのわデータが無いと起動はするが銘柄サジェストが空になり、新規記録ができない
 *     (受け入れ基準「機内モードで起動して記録の閲覧と新規作成ができる」を満たせない)
 * どちらも任意アセットではないので addAll の原子性に載せる。1件でも取れなければ install ごと
 * 失敗させ、回線が安定した時点で再試行させる。
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(root, 'dist')
const SW = resolve(DIST, 'sw.js')

if (!existsSync(SW)) {
  console.error('✗ dist/sw.js が無い。public/sw.js がコピーされていないか、ビルドが失敗している。')
  process.exit(1)
}

function walk(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

// SW は base 配下に配信され、相対URLは自身の URL 基準で解決される → './' 始まりに揃える
const toRel = p => './' + relative(DIST, p).split('\\').join('/')

const assets = walk(resolve(DIST, 'assets'))
  .filter(p => /\.(js|css)$/.test(p))
  .map(toRel)
  .sort()

const data = walk(resolve(DIST, 'data/sakenowa'))
  .filter(p => p.endsWith('.json'))
  .map(toRel)
  .sort()

const problems = []
if (assets.length === 0) problems.push('dist/assets に JS/CSS が無い')
if (data.length === 0) {
  problems.push('dist/data/sakenowa に JSON が無い(オフラインで銘柄サジェストが空になる)')
}
if (problems.length) {
  console.error(`✗ プリキャッシュ対象の検出に失敗 (${problems.length}件):`)
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}

const precache = [...assets, ...data]

// キャッシュ名はビルドごとに一意にする。activate で `k !== CACHE` を全削除するので、
// 旧版の stale なシェルが残り続ける問題を防げる。
const version = `sake-${Date.now()}`

let sw = readFileSync(SW, 'utf8')
if (!sw.includes('__CACHE_VERSION__') || !sw.includes('__PRECACHE_ASSETS__')) {
  console.error('✗ dist/sw.js にプレースホルダが無い。既に置換済みか public/sw.js が変わっている。')
  process.exit(1)
}
sw = sw
  .replace('__CACHE_VERSION__', version)
  .replace('__PRECACHE_ASSETS__', JSON.stringify(precache))
writeFileSync(SW, sw)

console.log(`✓ sw.js に必須プリキャッシュを注入した: ${precache.length}件 (cache=${version})`)
console.log(`    assets ${assets.length}件 / さけのわデータ ${data.length}件`)
