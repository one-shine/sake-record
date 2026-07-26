#!/usr/bin/env node
/**
 * 同梱する OCR 資産(`public/ocr/`)の**サイズと出所の整合**を検証する。
 *
 *   npm run ocr:check
 *
 * `npm run data:check` とは**別の門**にする。あちらは さけのわデータの gzip ≤200KB を見ており、
 * OCR の 8MB を同じ予算に混ぜると さけのわ側の余裕が見えなくなる(壊れ方も原因も別)。
 *
 * 見るもの:
 *   1. 同梱物が揃っていること / **列挙していないファイルが残っていないこと**
 *      (変種名を変えたときに旧コア 3.7MB が居残ると、予算だけ静かに食われる)
 *   2. 生の合計サイズが上限以内であること(初回取得はモバイル回線で起きる)
 *   3. node_modules から複製したファイルが**今の依存と同一バイト**であること
 *      = 依存を上げたのに同梱物が古いまま、を検出する(生成物をコミットする方針の裏返し)
 *   4. 取得した学習データの sha256 が pin と一致すること
 *   5. `docs/THIRD_PARTY.md` に各成果物のバージョンと入手元が書かれていること
 *      = Apache-2.0 §4 の告知が同梱物とずれないようにする
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import {
  DOWNLOADED,
  EXPECTED,
  LIMIT_BYTES,
  OCR_DIR,
  PINS,
  RUNTIME_PATHS,
  VENDORED,
  installedVersion,
  kb,
  mb,
  root,
  sha256,
} from './ocr-assets.mjs'

const outDir = resolve(root, OCR_DIR)
const violations = []

if (!existsSync(outDir)) {
  console.error(`✗ ${OCR_DIR}/ が無い。\`npm run ocr:assets\` で用意する。`)
  process.exit(1)
}

/** `.DS_Store` は gitignore 済み(= コミットされ得ない)ので数えない */
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (name === '.DS_Store') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const present = walk(outDir).map(p => relative(outDir, p).split('\\').join('/')).sort()

// --- 1. 揃っているか / 余計なものが無いか ----------------------------------
for (const name of EXPECTED) {
  if (!present.includes(name)) violations.push(`${OCR_DIR}/${name} が無い(\`npm run ocr:assets\`)`)
}
for (const name of present) {
  if (!EXPECTED.includes(name)) {
    violations.push(
      `${OCR_DIR}/${name} は同梱物の一覧に無い — 消すか scripts/ocr-assets.mjs に足す(残骸が予算を食う)`,
    )
  }
}

// --- 2. サイズ --------------------------------------------------------------
let total = 0
const rows = []
for (const name of present) {
  const size = statSync(join(outDir, name)).size
  total += size
  rows.push({ name, size })
}

// --- 3. node_modules との同一性 --------------------------------------------
for (const pkg of ['tesseract.js', 'tesseract.js-core']) {
  const found = installedVersion(pkg)
  if (found === null) {
    violations.push(`${pkg} が node_modules に無い。\`npm ci\` の後に実行する(検査を飛ばさない)`)
  } else if (found !== PINS[pkg]) {
    violations.push(
      `${pkg} の実体 ${found} と pin ${PINS[pkg]} が違う — ` +
        '`npm run ocr:assets` で作り直し、scripts/ocr-assets.mjs と docs/THIRD_PARTY.md を更新する',
    )
  }
}
for (const asset of VENDORED) {
  const src = resolve(root, asset.from)
  const dest = join(outDir, asset.dest)
  if (!existsSync(src) || !existsSync(dest)) continue // 上で報告済み
  const original = readFileSync(src)
  // 改変を当てているものは**同じ関数を通してから**比べる(でないと恒常的に不一致になる)。
  // 上流に改変の前提(printErr の受け口)が残っていることも見る — 消えるとシムは例外を出さずに
  // 何もしなくなり、console error だけが静かに戻る。
  if (asset.requires !== undefined && !original.includes(asset.requires)) {
    violations.push(
      `${asset.from} に \`${asset.requires}\` が無い — 改変(シム)の前提が上流から消えている。` +
        'scripts/ocr-assets.mjs の CORE_QUIET_SHIM を見直す',
    )
  }
  const expected = asset.patch === undefined ? original : asset.patch(original)
  if (sha256(expected) !== sha256(readFileSync(dest))) {
    violations.push(
      `${OCR_DIR}/${asset.dest} が ${asset.from}${asset.patch === undefined ? '' : '(+改変)'} と` +
        '一致しない — `npm run ocr:assets` で作り直す(依存だけ上がって同梱物が古い状態)',
    )
  }
}

// --- 4. 学習データの sha256 ------------------------------------------------
for (const asset of DOWNLOADED) {
  const dest = join(outDir, asset.dest)
  if (!existsSync(dest)) continue // 上で報告済み
  const got = sha256(readFileSync(dest))
  if (got !== asset.sha256) {
    violations.push(`${OCR_DIR}/${asset.dest} の sha256 が pin と違う(${got.slice(0, 12)}…)`)
  }
  if (!asset.url.includes(`@${PINS[asset.pkg]}/`)) {
    violations.push(`${asset.dest} の URL がバージョンを固定していない: ${asset.url}`)
  }
}

// --- 5. 出典表(Apache-2.0 §4 の告知)との整合 ------------------------------
const THIRD_PARTY = 'docs/THIRD_PARTY.md'
if (!existsSync(resolve(root, THIRD_PARTY))) {
  violations.push(`${THIRD_PARTY} が無い — Apache-2.0 は再配布時に告知を要求する`)
} else {
  const doc = readFileSync(resolve(root, THIRD_PARTY), 'utf8')
  for (const [pkg, version] of Object.entries(PINS)) {
    if (!doc.includes(`${pkg}@${version}`)) {
      violations.push(`${THIRD_PARTY} に \`${pkg}@${version}\` が無い(同梱物と出典表がずれている)`)
    }
  }
  for (const asset of DOWNLOADED) {
    if (!doc.includes(asset.url)) violations.push(`${THIRD_PARTY} に入手元 URL が無い: ${asset.url}`)
  }
  if (!doc.includes('Apache-2.0')) violations.push(`${THIRD_PARTY} にライセンス表記(Apache-2.0)が無い`)
}

// --- 6. corePath の形 ------------------------------------------------------
// tesseract.js は corePath が "js" で終わるときだけ**その1ファイル**を読む。
// ディレクトリを渡すと simd を実行時検出して**同梱していない変種**を CDN から取りに行く
// (= オフラインで壊れ、写真を端末外に出さない前提も崩れる)。
if (!RUNTIME_PATHS.corePath.endsWith('js')) {
  violations.push(
    'RUNTIME_PATHS.corePath が "js" で終わっていない — ' +
      'ディレクトリを渡すと tesseract.js が同梱外の変種を CDN から取りに行く',
  )
}
for (const lang of RUNTIME_PATHS.langs) {
  const rel = `${RUNTIME_PATHS.langPath.replace(/^ocr\//, '')}/${lang}.traineddata.gz`
  if (!EXPECTED.includes(rel)) {
    violations.push(`言語 ${lang} の学習データ(${rel})が同梱物の一覧に無い`)
  }
}

// --- 出力 ------------------------------------------------------------------
for (const r of rows) {
  console.log(`    ${r.name.padEnd(38)} ${kb(r.size).padStart(10)}`)
}
console.log(`    ${'合計'.padEnd(37)} ${kb(total).padStart(10)}  (上限 ${mb(LIMIT_BYTES)})`)

if (total > LIMIT_BYTES) {
  violations.push(`生の合計 ${mb(total)} が上限 ${mb(LIMIT_BYTES)} を超えた`)
}

if (violations.length) {
  console.error(`✗ OCR 同梱物の検査に失敗 (${violations.length}件):`)
  for (const v of violations) console.error('  ' + v)
  console.error('  同梱物の一覧・入手元・pin は scripts/ocr-assets.mjs が単一の出所。')
  console.error('  作り直しは `npm run ocr:assets`(生成物はコミットする)。')
  process.exit(1)
}

console.log(`✓ OCR 同梱物 OK: ${mb(total)} ≤ ${mb(LIMIT_BYTES)} (${rows.length}ファイル)`)
console.log(
  `    tesseract.js@${PINS['tesseract.js']} / tesseract.js-core@${PINS['tesseract.js-core']} / ` +
    `学習データ 4.0.0_best_int (jpn, jpn_vert) — すべて Apache-2.0(出典: ${THIRD_PARTY})`,
)
// 実装側が推測しないで済むように、createWorker に渡す値をここから印字する(base は相対)
console.log('    src/ 側が渡すパス(BASE_URL を前置する):')
console.log(`      corePath   = ${RUNTIME_PATHS.corePath}`)
console.log(`      workerPath = ${RUNTIME_PATHS.workerPath}`)
console.log(`      langPath   = ${RUNTIME_PATHS.langPath}   langs = ${RUNTIME_PATHS.langs.join(' / ')}`)
