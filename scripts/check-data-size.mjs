#!/usr/bin/env node
/**
 * 同梱データの gzip 合計サイズを検証する(受け入れ基準 A1)。
 *
 *   npm run data:check
 *
 * 「約束したこと」を人間の注意力ではなくビルド出力の検査で守る。上流が膨らんだときに
 * 月次更新ワークフローがコミット前にここで落ちる(壊れたデータが main に入らない)。
 *
 * **見るのは `public/data/` の全体**(さけのわだけではない)。A1 の約束は「同梱データを
 * 200KB に収める」であって出所ごとの枠ではないので、読み表(B68)のような別の出所を足しても
 * 同じ1つの数字で守る。ディレクトリを足したときに検査から漏れる形にしない。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = resolve(root, 'public/data')
const LIMIT_BYTES = 200 * 1024
// 出所ごとの取り直し方が違うので、欠けたときに叩くコマンドまで含めてここに書く
const SOURCES = [
  { dir: 'sakenowa', label: 'さけのわデータ', how: 'npm run fetch:sakenowa' },
  { dir: 'kanji', label: '漢字の読み表', how: 'npm run fetch:readings' },
]

const files = []
for (const source of SOURCES) {
  const dir = join(DATA_DIR, source.dir)
  if (!existsSync(dir)) {
    console.error(`✗ public/data/${source.dir} が無い。先に \`${source.how}\` を実行する。`)
    process.exit(1)
  }
  const names = readdirSync(dir)
    .filter(n => n.endsWith('.json') && n !== 'meta.json')
    .sort()
  if (names.length === 0) {
    console.error(`✗ ${source.label}が1件も無い。先に \`${source.how}\` を実行する。`)
    process.exit(1)
  }
  for (const name of names) files.push(join(source.dir, name))
}

let totalRaw = 0
let totalGz = 0
const rows = []

for (const name of files) {
  const buf = readFileSync(join(DATA_DIR, name))
  const gz = gzipSync(buf, { level: 9 }).length
  totalRaw += buf.length
  totalGz += gz
  rows.push({ name, raw: buf.length, gz })
}

const kb = n => (n / 1024).toFixed(1) + 'KB'

for (const r of rows) {
  console.log(`    ${r.name.padEnd(30)} raw ${kb(r.raw).padStart(8)}  gzip ${kb(r.gz).padStart(8)}`)
}
console.log(`    ${'合計'.padEnd(29)} raw ${kb(totalRaw).padStart(8)}  gzip ${kb(totalGz).padStart(8)}`)

if (totalGz > LIMIT_BYTES) {
  console.error(`✗ gzip 合計 ${kb(totalGz)} が上限 ${kb(LIMIT_BYTES)} を超えた。`)
  console.error('  タプル化の見直し、または不要なエンドポイントの同梱をやめることを検討する。')
  process.exit(1)
}

console.log(`✓ データサイズ OK: gzip ${kb(totalGz)} ≤ ${kb(LIMIT_BYTES)} (${files.length}ファイル)`)
