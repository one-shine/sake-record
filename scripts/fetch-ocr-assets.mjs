#!/usr/bin/env node
/**
 * 端末内 OCR の同梱物を `public/ocr/` に用意する。
 *
 *   npm run ocr:assets
 *
 * 何をどこから持ってくるかは `scripts/ocr-assets.mjs`(単一の出所)に書いてある。
 *   - wasm コアと worker は **node_modules から複製**する(バージョンは package-lock で固定)
 *   - 学習データは jsDelivr から**バージョンと sha256 を固定して**取得する
 *
 * **生成物はコミットする。** CI にバイナリ取得の依存を増やさないため(アイコンと同じ方針)。
 * このスクリプトは「依存を上げたときに作り直す」ためのもので、ビルドの前段ではない。
 * 作り直したら `npm run ocr:check` が通ることと、`docs/THIRD_PARTY.md` のバージョンを確かめる。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  DOWNLOADED,
  OCR_DIR,
  PINS,
  VENDORED,
  installedVersion,
  kb,
  root,
  sha256,
} from './ocr-assets.mjs'

const outDir = resolve(root, OCR_DIR)
const rows = []
const problems = []

// --- バージョンの確認 ------------------------------------------------------
// 実体が pin と違うまま複製すると、同梱物と docs/THIRD_PARTY.md がずれる。
for (const pkg of ['tesseract.js', 'tesseract.js-core']) {
  const found = installedVersion(pkg)
  if (found === null) {
    problems.push(`${pkg} が node_modules に無い。先に \`npm ci\` を実行する。`)
  } else if (found !== PINS[pkg]) {
    problems.push(
      `${pkg} の実体は ${found} だが scripts/ocr-assets.mjs の pin は ${PINS[pkg]} — ` +
        'pin と docs/THIRD_PARTY.md を更新してから作り直す。',
    )
  }
}
if (problems.length) {
  console.error(`✗ 同梱物を作れない (${problems.length}件):`)
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}

mkdirSync(join(outDir, 'tessdata'), { recursive: true })

// --- node_modules からの複製 -----------------------------------------------
for (const asset of VENDORED) {
  const src = resolve(root, asset.from)
  if (!existsSync(src)) {
    console.error(`✗ ${asset.from} が無い。${asset.pkg} の構成が変わった可能性がある。`)
    process.exit(1)
  }
  const original = readFileSync(src)
  // 改変が要るものは**この1関数**を通す(検査側も同じ関数を通すので不一致にならない)。
  // 上流にシムの前提が残っているかを先に確かめる — 消えていたら黙って効かなくなるので落とす。
  if (asset.requires !== undefined && !original.includes(asset.requires)) {
    console.error(`✗ ${asset.from} に \`${asset.requires}\` が無い。`)
    console.error('  改変(シム)の前提が上流から消えている。scripts/ocr-assets.mjs を見直す。')
    process.exit(1)
  }
  const buf = asset.patch === undefined ? original : asset.patch(original)
  const dest = join(outDir, asset.dest)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, buf)
  rows.push({
    name: asset.dest,
    size: buf.length,
    from:
      `node_modules (${asset.pkg}@${PINS[asset.pkg]})` + (asset.patch === undefined ? '' : ' + 改変'),
  })
}

// --- 学習データの取得(sha256 で固定) --------------------------------------
for (const asset of DOWNLOADED) {
  const dest = join(outDir, asset.dest)
  // 既に正しいものがあるなら取りに行かない(オフラインでも再実行できる)
  if (existsSync(dest) && sha256(readFileSync(dest)) === asset.sha256) {
    rows.push({ name: asset.dest, size: readFileSync(dest).length, from: '既存 (sha256 一致)' })
    continue
  }

  console.log(`… 取得中: ${asset.url}`)
  let buf
  try {
    const res = await fetch(asset.url)
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    buf = Buffer.from(await res.arrayBuffer())
  } catch (err) {
    console.error(`✗ ${asset.dest} を取得できなかった: ${err.message}`)
    console.error(`  URL: ${asset.url}`)
    process.exit(1)
  }

  const got = sha256(buf)
  if (got !== asset.sha256) {
    // **書かずに落とす**。中身が変わったなら、まず精度を測り直してから pin を更新する。
    console.error(`✗ ${asset.dest} の sha256 が pin と違う(書き込まなかった)`)
    console.error(`    期待 ${asset.sha256}`)
    console.error(`    実際 ${got}`)
    console.error('  上流が差し替わっている。合成ラベルで精度を測り直してから pin を更新する。')
    process.exit(1)
  }
  writeFileSync(dest, buf)
  rows.push({ name: asset.dest, size: buf.length, from: 'jsDelivr (sha256 検証済み)' })
}

let total = 0
for (const r of rows) {
  total += r.size
  console.log(`    ${r.name.padEnd(38)} ${kb(r.size).padStart(10)}  ${r.from}`)
}
console.log(`    ${'合計'.padEnd(37)} ${kb(total).padStart(10)}`)
console.log(`✓ ${OCR_DIR}/ を用意した (${rows.length}ファイル)`)
console.log('  次: `npm run ocr:check` で上限とバージョン整合を確認し、生成物をコミットする。')
