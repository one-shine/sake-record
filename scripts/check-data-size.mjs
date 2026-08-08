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
// **無いと機能が壊れる出所だけ**を挙げる。取り直し方が出所ごとに違うので、
// 欠けたときに叩くコマンドまで含めてここに書く。
// **数える対象の列挙ではない** — 数えるのは下で `public/data/` を走査した全部で、
// ここに書き足さなくても新しい出所が枠に乗る(冒頭の宣言どおり漏れる形にしない)。
const REQUIRED = [
  { dir: 'sakenowa', label: 'さけのわデータ', how: 'npm run fetch:sakenowa' },
  { dir: 'kanji', label: '漢字の読み表', how: 'npm run fetch:readings' },
]

const jsonNamesIn = (dir) =>
  readdirSync(dir)
    .filter((n) => n.endsWith('.json') && n !== 'meta.json')
    .sort()

for (const source of REQUIRED) {
  const dir = join(DATA_DIR, source.dir)
  if (!existsSync(dir)) {
    console.error(`✗ public/data/${source.dir} が無い。先に \`${source.how}\` を実行する。`)
    process.exit(1)
  }
  if (jsonNamesIn(dir).length === 0) {
    console.error(`✗ ${source.label}が1件も無い。先に \`${source.how}\` を実行する。`)
    process.exit(1)
  }
}

// 任意の出所(蔵元の説明 B78 など)は**在れば数える**。無いこと自体は違反ではない
const files = []
for (const entry of readdirSync(DATA_DIR, { withFileTypes: true }).sort((a, b) =>
  a.name.localeCompare(b.name),
)) {
  if (!entry.isDirectory()) continue
  for (const name of jsonNamesIn(join(DATA_DIR, entry.name))) files.push(join(entry.name, name))
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
