#!/usr/bin/env node
/**
 * 実ラベルの写真で OCR の到達を測る**計測台**(B67 の判断材料)。
 *
 *   npm run build && npm run ocr:bench
 *
 * ## 何のためにあるか
 *
 * 「engine をシーンテキストのモデルに載せ替えるか」(B67)は資産が 7.7MB → 25〜30MB になる
 * 仕様判断で、**合成ラベルの数字では決められない**。決め手は実機の写真で
 *   (a) いま銘柄に到達できているか
 *   (b) 到達できないとき、**銘柄の字が1文字も読めていないのか**(= engine の限界)、
 *       **読めているのに候補の門で落ちているのか**(= 照合の設計)
 * のどちらなのか。(b) が「1文字も読めていない」に寄るなら載せ替えが効く見込みが立ち、
 * 「読めているのに落ちる」に寄るなら載せ替えても変わらない。
 *
 * ## 写真はコミットしない
 *
 * ラベル写真は銘柄そのもの(B24 の allowlist と同じ理由)。`data/ocr-bench/` は gitignore 済みで、
 * この台が書き出す読み取り結果もそこに置く。**この台は CI には入れない**
 * (実写真とブラウザが要るので `npm run ci` からは呼ばない)。
 *
 * ## 測っているもの
 *
 * 本番ビルドを実ブラウザで駆動し、「写真から銘柄を探す」を1回押しただけの状態を見る。
 * 手で囲む経路は測らない(人の操作なので再現性が無い)。
 */
/* eslint-disable no-undef -- `page.evaluate` / `waitForFunction` の引数はブラウザ側で走るので
   `document` を参照する。この設定(node)には DOM の global が無いだけで、実行時には在る */
import { createServer } from 'node:http'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CASES_DIR = resolve(root, 'data/ocr-bench')
const DIST = resolve(root, 'dist')
const PHOTO_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp'])

/** playwright は依存に入れていない(この台だけが使う)。見つからなければ理由を出して止める */
async function loadChromium() {
  const candidates = [
    'playwright',
    '/opt/node22/lib/node_modules/playwright/index.js',
    '/usr/lib/node_modules/playwright/index.js',
  ]
  for (const spec of candidates) {
    try {
      const mod = await import(spec)
      return (mod.default ?? mod).chromium
    } catch {
      /* 次の候補へ */
    }
  }
  return null
}

function usage(reason) {
  console.log(`OCR の計測台: ${reason}`)
  console.log('')
  console.log('置き方:')
  console.log('  1) data/ocr-bench/ を作る（gitignore 済み。写真はコミットされない）')
  console.log('  2) ラベルの写真を置く（<名前>.jpg / .png。原寸のまま。加工しない）')
  console.log('  3) 同じ名前で正解を書く（<名前>.brand.txt に銘柄名を1行だけ）')
  console.log('  4) npm run build && npm run ocr:bench')
  console.log('')
  console.log('出るもの: 写真ごとに 到達(候補/チップ/なし) と 読めた銘柄の字。')
  console.log('  「銘柄の字が0文字」が多い → engine の限界（載せ替えが効く見込み）')
  console.log('  「字は読めているが到達しない」が多い → 照合の門の設計（載せ替えても変わらない）')
}

const cases = []
if (existsSync(CASES_DIR)) {
  for (const name of readdirSync(CASES_DIR).sort()) {
    const ext = extname(name).toLowerCase()
    if (!PHOTO_EXT.has(ext)) continue
    const stem = name.slice(0, -ext.length)
    const brandFile = join(CASES_DIR, `${stem}.brand.txt`)
    if (!existsSync(brandFile)) {
      console.log(`… ${name}: 正解が無いので飛ばす（${stem}.brand.txt を置く）`)
      continue
    }
    const brand = readFileSync(brandFile, 'utf8').trim()
    if (brand === '') {
      console.log(`… ${name}: ${stem}.brand.txt が空`)
      continue
    }
    cases.push({ photo: join(CASES_DIR, name), stem, brand })
  }
}

if (cases.length === 0) {
  usage(existsSync(CASES_DIR) ? '写真が1件も無い' : 'data/ocr-bench/ が無い')
  process.exit(0)
}
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('✗ dist/ が無い。先に `npm run build` を実行する')
  process.exit(1)
}

const chromium = await loadChromium()
if (chromium === null) {
  console.error('✗ playwright が見つからない（この台だけが使うので依存には入れていない）')
  console.error('  `npm i -g playwright` などで入れてから実行する')
  process.exit(1)
}

/** dist を配る最小のサーバ。vite preview を spawn しないのは、終了の面倒を持ちたくないから */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.txt': 'text/plain; charset=utf-8',
}
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0])
  const file = resolve(DIST, '.' + (path === '/' ? '/index.html' : path))
  if (!file.startsWith(DIST) || !existsSync(file)) {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const base = `http://127.0.0.1:${server.address().port}/`

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

const rows = []
for (const { photo, stem, brand } of cases) {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '記録する', exact: true }).click()
  await page.waitForTimeout(300)
  await page.getByLabel(/写真/).first().setInputFiles(photo)
  await page.waitForTimeout(1200)
  const started = Date.now()
  await page.getByRole('button', { name: /写真から銘柄を探す/ }).first().click()
  await page
    .waitForFunction(() => document.body.innerText.includes('読み取った文字'), null, { timeout: 180_000 })
    .catch(() => {})
  await page.waitForTimeout(600)
  const ms = Date.now() - started

  const read = await page.evaluate(() => {
    const ps = [...document.querySelectorAll('p')]
    const pick = (needle) =>
      ps.find((p) => p.textContent?.includes(needle))?.nextElementSibling?.textContent ?? ''
    return (pick('読み取った文字') + pick('照合に使わなかった文字')).replace(/\s+/g, '')
  })

  const rowName = (label) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} を銘柄にする$`)
  const direct = (await page.getByRole('button', { name: rowName(brand) }).count()) > 0

  /** チップを1つずつ押して、1タップで正解に届くかを見る */
  let viaChip = false
  if (!direct) {
    for (const chip of await page.getByRole('button', { name: /を含む銘柄を出す/ }).all()) {
      await chip.click()
      await page.waitForTimeout(150)
      if ((await page.getByRole('button', { name: rowName(brand) }).count()) > 0) {
        viaChip = true
        break
      }
      await chip.click()
      await page.waitForTimeout(80)
    }
  }

  // **これが載せ替えの見込みを分ける数字。** 銘柄の字が読み取りに現れているか
  const chars = [...new Set(brand)].filter((ch) => /\p{L}/u.test(ch))
  const gotChars = chars.filter((ch) => read.includes(ch))

  writeFileSync(join(CASES_DIR, `${stem}.read.txt`), read + '\n')
  rows.push({ stem, brand, direct, viaChip, got: gotChars, total: chars.length, ms })
  console.log(
    `${brand}\t${direct ? '候補' : viaChip ? 'チップ' : 'なし'}\t` +
      `銘柄の字 ${gotChars.length}/${chars.length}${gotChars.length > 0 ? `(${gotChars.join('')})` : ''}\t` +
      `${ms}ms\t読み ${read.length}字`,
  )
}

await browser.close()
server.close()

const reached = rows.filter((r) => r.direct || r.viaChip).length
const noChars = rows.filter((r) => r.got.length === 0).length
const charsButNoReach = rows.filter((r) => r.got.length > 0 && !r.direct && !r.viaChip).length
console.log('')
console.log(`到達 ${reached}/${rows.length}（候補 ${rows.filter((r) => r.direct).length} / チップ ${rows.filter((r) => r.viaChip).length}）`)
console.log(`銘柄の字が0文字 ${noChars}/${rows.length}  ← engine の限界（載せ替えが効く見込み）`)
console.log(`字は読めたが到達せず ${charsButNoReach}/${rows.length}  ← 照合の門の設計（載せ替えても変わらない）`)
console.log(`console error ${errors.length}`)
console.log('')
console.log('読み取り結果は data/ocr-bench/<名前>.read.txt に保存した（コミットされない）。')
