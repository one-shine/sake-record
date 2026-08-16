#!/usr/bin/env node
/**
 * さけのわデータを取得して public/data/sakenowa/*.json を生成する。
 *
 *   npm run fetch:sakenowa
 *
 * なぜビルド時取得なのか: さけのわの API は Access-Control-Allow-Origin ヘッダを返さないため、
 * ブラウザから直接 fetch できない。静的ホスティング + バックエンド無しの構成では実行時取得が
 * 不可能なので、取得してリポジトリにコミットする。結果としてオフライン動作も得られる。
 *
 * なぜ public/ なのか: Service Worker の原子的シェルに './data/sakenowa/*.json' という
 * 安定した既知パスを書けるため。src/ に置くとハッシュ付き JS チャンクに畳み込まれ、
 * どのチャンクを必須プリキャッシュに入れるかを vite manifest から特定する処理が必要になり、
 * 取り違えると「起動はするがサジェストが空」という半端なオフライン状態を生む。
 *
 * 出力形式はタプル。素の JSON では gzip 170KB で受け入れ基準(≤200KB)に張り付くが、
 * タプル化 + フレーバー値を 0-100 整数に丸めると gzip 約92KB に落ちる。
 *
 * 注意: fetchedAt のような取得時刻をデータに入れてはいけない。入れると毎月必ず差分が出て、
 * 月次更新ワークフローの `git diff --quiet` ガードが無意味になる。
 * 上流が変わったときだけ変わる etag / last-modified を meta.json に記録する。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = resolve(root, 'public/data/sakenowa')
const API = 'https://muro.sakenowa.com/sakenowa-data/api'

/**
 * 期待件数は計画時に実測した値。API 側の増減で多少動くため下限として扱い、
 * 「取得に失敗して空/半端な配列が入る」ことを検出する。
 * 桁が変わるほどの減少は上流の異常なので落とす。
 */
const ENDPOINTS = [
  { path: 'areas', key: 'areas', out: 'areas', minCount: 40 },
  { path: 'breweries', key: 'breweries', out: 'breweries', minCount: 1600 },
  { path: 'brands', key: 'brands', out: 'brands', minCount: 3000 },
  { path: 'flavor-charts', key: 'flavorCharts', out: 'flavorCharts', minCount: 1200 },
  { path: 'flavor-tags', key: 'tags', out: 'flavorTags', minCount: 120 },
  { path: 'brand-flavor-tags', key: 'flavorTags', out: 'brandFlavorTags', minCount: 2700 },
]

/**
 * 実測した罠: 上流の CDN は accept-encoding ごとに別のキャッシュ変種を持ち、
 * **中身の世代がずれる**。同時刻に叩いても
 *   accept-encoding: gzip     → age 33508s / weak etag / flavorCharts 1342件
 *   accept-encoding: identity → age  8861s / strong etag / flavorCharts 1344件
 * だった。Node の fetch は既定で gzip を要求し、curl は既定で無圧縮なので、
 * 手で curl した結果とスクリプトの結果が食い違う。
 *
 * 放置すると月次更新ジョブが変種の間で往復し、毎回無意味な差分を作って
 * データを古い世代へ巻き戻す。identity に固定して世代を安定させる
 * (ビルド時の1回だけの転送なので 218KB の非圧縮は問題にならない)。
 */
async function get(path) {
  const res = await fetch(`${API}/${path}`, { headers: { 'accept-encoding': 'identity' } })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return {
    json: await res.json(),
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  }
}

/** areas は id をそのまま添字にする(1..47 が JIS 都道府県コード、0 は「その他」) */
function encodeAreas(rows) {
  const maxId = Math.max(...rows.map(a => a.id))
  const out = new Array(maxId + 1).fill('')
  for (const a of rows) out[a.id] = a.name
  return out
}

/**
 * **前回の同梱データの行数。上書きする前に読む。**
 *
 * `minCount` は「空/一部だけ」を弾く粗い下限で、**世代の取り違えは捕まえられない** —
 * B13 で踏んだ CDN の変種違いは flavorCharts 1344 → **1342** で、下限 1200 を悠々と通る。
 * 前回と比べて**減っていたら止める**のがこの罠に効く唯一の判定で、
 * 取得の前後の両方の数を持っているのはこのスクリプトだけ。
 *
 * かつては `src/data/tables.test.ts` が件数をリテラルで固定して代用していたが、
 * **上流が1件増えるだけで赤くなり月次更新が止まる**ので、判定をここへ移した(B41)。
 * こちらは方向を持つ = 増えるのは通し、減るときだけ止める。
 */
function previousCounts() {
  const out = {}
  for (const ep of ENDPOINTS) {
    const path = resolve(OUT_DIR, `${ep.out}.json`)
    if (!existsSync(path)) continue
    try {
      const rows = JSON.parse(readFileSync(path, 'utf8')).rows
      if (Array.isArray(rows)) out[ep.out] = rows.length
    } catch {
      // 読めない前回分は「比べない」に落とす(取得そのものを止める理由にはならない)
    }
  }
  return out
}

/**
 * 件数の門。通れば `null`、駄目なら理由。**2つの別の事故を見ている:**
 *   - 下限割れ … 取得が空 / 一部だけ(粗いが絶対的)
 *   - 前回より減った … 世代の取り違え(B13。下限では通る -2 を捕まえる唯一の判定)
 */
function countProblem(ep, count, before, allowShrink) {
  if (count < ep.minCount) return `${ep.path}: ${count}件は下限 ${ep.minCount} を下回る`
  if (before === undefined || allowShrink || count >= before) return null
  return (
    `${ep.path}: ${count}件は前回の ${before}件より ${before - count}件少ない` +
    '(上流の CDN が古い世代を返している疑い。上流が本当に消したなら --allow-shrink)'
  )
}

// --- 門そのものの自己検査(`check-brewery-notes.mjs` と同じ思想) ---
//
// **この門は普段1度も発火しない**(上流は増えるだけ)。恒偽の条件は静かに機能を殺すので、
// 合成の数で通る/落ちるを毎回固定する。ファイルは作らない。
{
  const ep = { path: 'x', minCount: 100 }
  const cases = [
    ['下限を下回れば落ちる', countProblem(ep, 99, undefined, false) !== null],
    ['下限ちょうどは通る', countProblem(ep, 100, undefined, false) === null],
    ['前回より1件でも減れば落ちる', countProblem(ep, 1342, 1344, false) !== null],
    ['同数は通る', countProblem(ep, 1344, 1344, false) === null],
    ['増えたら通る(上流の成長で止めない)', countProblem(ep, 1345, 1344, false) === null],
    ['--allow-shrink なら減っても通る', countProblem(ep, 1342, 1344, true) === null],
    ['前回が無ければ比べない', countProblem(ep, 1342, undefined, false) === null],
  ]
  const failed = cases.filter(([, ok]) => !ok).map(([name]) => name)
  if (failed.length) {
    console.error(`✗ 件数の門そのものが壊れている (${failed.length}件):`)
    for (const name of failed) console.error(`  - ${name}`)
    process.exit(1)
  }
}

/** 上流が本当に行を消したときの逃げ道。**既定では通さない**(黙って縮ませない) */
const allowShrink = process.argv.includes('--allow-shrink')
const previous = previousCounts()

const problems = []
const meta = {}
const counts = {}

mkdirSync(OUT_DIR, { recursive: true })

for (const ep of ENDPOINTS) {
  let payload
  try {
    payload = await get(ep.path)
  } catch (err) {
    problems.push(`${ep.path}: 取得失敗 (${err.message})`)
    continue
  }

  const rows = payload.json[ep.key]
  if (!Array.isArray(rows)) {
    problems.push(`${ep.path}: レスポンスに配列 "${ep.key}" が無い`)
    continue
  }
  const countIssue = countProblem(ep, rows.length, previous[ep.out], allowShrink)
  if (countIssue !== null) {
    problems.push(countIssue)
    continue
  }

  // 上流の配列順は保証されない。id 昇順に固定しないと、順序が入れ替わっただけで
  // 月次更新が全行差分になりレビュー不能になる(かつ SW のキャッシュも無駄に入れ替わる)。
  const byId = (a, b) => a - b

  let encoded
  switch (ep.out) {
    case 'areas':
      encoded = encodeAreas(rows)
      break
    case 'breweries':
      encoded = rows.map(b => [b.id, b.name, b.areaId]).sort((x, y) => byId(x[0], y[0]))
      break
    case 'brands':
      encoded = rows.map(b => [b.id, b.name, b.breweryId]).sort((x, y) => byId(x[0], y[0]))
      break
    case 'flavorCharts':
      // f1..f6 は 0.0-1.0 の float。0-100 の整数に丸めると raw 213KB → 32KB になる。
      // 表示は6軸レーダーと散布図なので、小数第2位相当の分解能で足りる。
      encoded = rows
        .map(c => [
          c.brandId,
          Math.round(c.f1 * 100),
          Math.round(c.f2 * 100),
          Math.round(c.f3 * 100),
          Math.round(c.f4 * 100),
          Math.round(c.f5 * 100),
          Math.round(c.f6 * 100),
        ])
        .sort((x, y) => byId(x[0], y[0]))
      break
    case 'flavorTags':
      encoded = rows.map(t => [t.id, t.tag]).sort((x, y) => byId(x[0], y[0]))
      break
    case 'brandFlavorTags':
      // tagIds が空の銘柄は行ごと落とす。tagIds 内の順序も上流では不定なので昇順に揃える。
      encoded = rows
        .filter(x => x.tagIds?.length)
        .map(x => [x.brandId, ...[...x.tagIds].sort(byId)])
        .sort((x, y) => byId(x[0], y[0]))
      break
    default:
      problems.push(`${ep.out}: エンコーダ未定義`)
      continue
  }

  // copyright をデータ側にも残す。クレジット義務を UI だけでなく成果物データにも係留し、
  // check-attribution.mjs で検証できるようにする。
  writeFileSync(
    resolve(OUT_DIR, `${ep.out}.json`),
    JSON.stringify({ copyright: payload.json.copyright ?? 'Sakenowa', rows: encoded }) + '\n',
  )
  counts[ep.out] = rows.length
  meta[ep.out] = { etag: payload.etag, lastModified: payload.lastModified }
}

if (problems.length) {
  console.error(`✗ さけのわデータの取得に失敗 (${problems.length}件):`)
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}

writeFileSync(resolve(OUT_DIR, 'meta.json'), JSON.stringify({ source: API, endpoints: meta }, null, 2) + '\n')

console.log('✓ さけのわデータを生成した: public/data/sakenowa/')
for (const [k, v] of Object.entries(counts)) {
  const before = previous[k]
  // **増減を出す。** 数字だけだと「増えたのか同じなのか」が読めず、変種違いに気付けない
  const delta = before === undefined ? '(新規)' : v === before ? '' : ` (前回 ${before} / +${v - before})`
  console.log(`    ${k.padEnd(16)} ${String(v)}件${delta}`)
}
console.log('  クレジット表示義務: さけのわ + https://sakenowa.com へのリンク(省略は禁止事項)')
