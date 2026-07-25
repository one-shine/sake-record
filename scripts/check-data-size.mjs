#!/usr/bin/env node
/**
 * 同梱するさけのわデータの gzip 合計サイズを検証する(受け入れ基準 A1)。
 *
 *   npm run data:check
 *
 * 「約束したこと」を人間の注意力ではなくビルド出力の検査で守る。上流が膨らんだときに
 * 月次更新ワークフローがコミット前にここで落ちる(壊れたデータが main に入らない)。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = resolve(root, 'public/data/sakenowa')
const LIMIT_BYTES = 200 * 1024

if (!existsSync(DATA_DIR)) {
  console.error(`✗ ${DATA_DIR.replace(root + '/', '')} が無い。先に \`npm run fetch:sakenowa\` を実行する。`)
  process.exit(1)
}

const files = readdirSync(DATA_DIR)
  .filter(n => n.endsWith('.json') && n !== 'meta.json')
  .sort()

if (files.length === 0) {
  console.error('✗ さけのわデータが1件も無い。先に `npm run fetch:sakenowa` を実行する。')
  process.exit(1)
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
  console.log(`    ${r.name.padEnd(22)} raw ${kb(r.raw).padStart(8)}  gzip ${kb(r.gz).padStart(8)}`)
}
console.log(`    ${'合計'.padEnd(21)} raw ${kb(totalRaw).padStart(8)}  gzip ${kb(totalGz).padStart(8)}`)

if (totalGz > LIMIT_BYTES) {
  console.error(`✗ gzip 合計 ${kb(totalGz)} が上限 ${kb(LIMIT_BYTES)} を超えた。`)
  console.error('  タプル化の見直し、または不要なエンドポイントの同梱をやめることを検討する。')
  process.exit(1)
}

console.log(`✓ データサイズ OK: gzip ${kb(totalGz)} ≤ ${kb(LIMIT_BYTES)} (${files.length}ファイル)`)
