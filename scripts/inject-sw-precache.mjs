#!/usr/bin/env node
/**
 * ビルド後に public/sw.js のプレースホルダを実値へ置換する(`npm run build` の末尾で走る)。
 *
 *   __CACHE_VERSION__   → ビルドごとに変わるアプリシェルのキャッシュ名(activate で旧世代を全削除)
 *   __OCR_CACHE__       → OCR 資産のキャッシュ名。**中身のハッシュ**で決まるのでデプロイでは変わらない
 *   __PRECACHE_ASSETS__ → 起動に必要な資産(= 原子的な addAll に載せるもの)
 *
 * ## 必須シェルに何を入れるかが offline 動作の分かれ目
 *   - JS/CSS が無いとアプリが起動しない
 *   - さけのわデータが無いと起動はするが銘柄サジェストが空になり、新規記録ができない
 *     (受け入れ基準「機内モードで起動して記録の閲覧と新規作成ができる」を満たせない)
 * どちらも任意アセットではないので addAll の原子性に載せる。1件でも取れなければ install ごと
 * 失敗させ、回線が安定した時点で再試行させる。
 *
 * ## なぜ dist/assets/*.js の glob をやめて vite のマニフェストから決めるのか
 * OCR エンジン(tesseract.js)は**動的 import** で、ビルドすると `dist/assets/` に別チャンクとして
 * 出る。置き場が同じなので glob で拾うと原子的シェルに混ざる — つまり「OCR のチャンクが1件
 * 取れないと install ごと reject され、アプリのオフライン起動が恒久的に壊れる」形になる。
 * ファイル名で除外するのは脆い(チャンク名は入力次第で変わる)。
 * マニフェストの `imports` は**静的 import だけ**を並べ、`dynamicImports` は別に持つので、
 * エントリから静的 import だけを辿った閉包 = 「起動に必要なもの」を機械的に取り出せる。
 * 将来ほかの機能を遅延読み込みにしても、勝手に原子的シェルの外側に置かれる。
 *
 * マニフェスト自体は出荷しない(実行時に読む人がいないビルド時のメタデータで、出すと
 * ソースツリーの構成が成果物から見えるだけ)。ここで使い終えたら削除する。
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXPECTED as OCR_EXPECTED } from './ocr-assets.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(root, 'dist')
const SW = resolve(DIST, 'sw.js')
const MANIFEST = resolve(DIST, '.vite/manifest.json')

/** package.json に依存があるときだけ OCR の検査を強制する(依存を外したら検査ごと消える) */
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const hasOcrDep = Boolean(pkg.dependencies?.['tesseract.js'])

const problems = []
const die = () => {
  console.error(`✗ プリキャッシュの注入に失敗 (${problems.length}件):`)
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}

if (!existsSync(SW)) {
  problems.push('dist/sw.js が無い。public/sw.js がコピーされていないか、ビルドが失敗している。')
  die()
}
if (!existsSync(MANIFEST)) {
  problems.push(
    'dist/.vite/manifest.json が無い。vite.config.ts の build.manifest が落ちている ' +
      '(起動に必要な資産と遅延チャンクを区別できないので、ここで止める)。',
  )
  die()
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

// ── 1. 起動に必要な資産 = エントリからの静的 import 閉包 ─────────────────────
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const entryKeys = Object.keys(manifest).filter(key => manifest[key].isEntry)
if (entryKeys.length === 0) problems.push('マニフェストに isEntry のチャンクが無い')

/** マニフェスト上のファイル名(dist からの相対)。閉包に入ったものだけがシェルに載る */
const bootFiles = new Set()
const visited = new Set()
const stack = [...entryKeys]
while (stack.length > 0) {
  const key = stack.pop()
  if (visited.has(key)) continue
  visited.add(key)
  const chunk = manifest[key]
  if (!chunk) {
    problems.push(`マニフェストが未知のチャンク "${key}" を参照している`)
    continue
  }
  if (chunk.file) bootFiles.add(chunk.file)
  for (const css of chunk.css ?? []) bootFiles.add(css)
  // **静的 import だけ**辿る。dynamicImports は「必要になってから取るもの」なので辿らない。
  for (const dep of chunk.imports ?? []) stack.push(dep)
}

const assets = [...bootFiles].sort().map(f => './' + f)

// ── 2. 同梱データ(ハッシュが付かないのでマニフェストに載らない) ─────────────
// **`data/` の下を丸ごと**入れる。出所ごとに列挙すると、新しい出所を足したときに
// 「オンラインでは効くがオフラインでは効かない」機能が静かに生まれる(B68 の読み表)。
const data = walk(resolve(DIST, 'data'))
  .filter(p => p.endsWith('.json'))
  .map(toRel)
  .sort()

if (assets.length === 0) problems.push('起動に必要な JS/CSS が閉包に1件も無い')
// 出所ごとに「無いと何が壊れるか」を書く。まとめて数えると欠けた側が分からない
const REQUIRED_DATA = [
  { prefix: './data/sakenowa/', broken: 'オフラインで銘柄サジェストが空になる' },
  { prefix: './data/kanji/', broken: 'オフラインで読み(かな)による検索ができなくなる' },
]
for (const req of REQUIRED_DATA) {
  if (!data.some(p => p.startsWith(req.prefix))) {
    problems.push(`dist${req.prefix.slice(1)} に JSON が無い(${req.broken})`)
  }
}

// ── 3. dist/assets に「説明の付かない」ファイルが無いか ──────────────────────
// マニフェストに現れないチャンクがあると、起動に必要かどうかを判断できないまま
// シェルから落とすことになる(オフライン起動が静かに壊れる形)。名前で判断せず、必ず落とす。
const described = new Set()
for (const chunk of Object.values(manifest)) {
  if (chunk.file) described.add(chunk.file)
  for (const css of chunk.css ?? []) described.add(css)
  for (const asset of chunk.assets ?? []) described.add(asset)
}
const unaccounted = walk(resolve(DIST, 'assets'))
  .filter(p => /\.(js|css)$/.test(p))
  .map(p => relative(DIST, p).split('\\').join('/'))
  .filter(f => !described.has(f))
if (unaccounted.length > 0) {
  problems.push(
    `dist/assets にマニフェストが説明しないファイルがある: ${unaccounted.join(', ')} — ` +
      '起動に必要か判断できない(必要なら閉包に、不要なら遅延チャンクとして出るはず)',
  )
}

// ── 4. OCR エンジンが遅延チャンクのままか ────────────────────────────────────
// 静的 import に戻すと (a) 初期バンドルが太り (b) 原子的シェルに載って install の原子性に
// 巻き込まれる。どちらもこの機能の前提(「補助」であってアプリの起動条件ではない)を壊す。
if (hasOcrDep) {
  const ocrChunks = Object.entries(manifest).filter(([key]) => key.includes('tesseract.js'))
  if (ocrChunks.length === 0) {
    problems.push(
      'tesseract.js のチャンクがマニフェストに無い — 静的 import に変わって初期バンドルへ ' +
        '取り込まれた可能性がある(OCR は動的 import のままにする)',
    )
  }
  for (const [key, chunk] of ocrChunks) {
    if (!chunk.isDynamicEntry) {
      problems.push(`${key} が動的チャンクではない — OCR は動的 import のままにする`)
    }
    if (bootFiles.has(chunk.file)) {
      problems.push(
        `${chunk.file} (OCR エンジン) が起動時の閉包に入っている — ` +
          '原子的な addAll に載ると、OCR の取得失敗でアプリのオフライン起動ごと壊れる',
      )
    }
  }
}

const precache = [...assets, ...data]

// 念のため(上の作り方なら起きないが、不変条件は明示して落とす)。
for (const entry of precache) {
  if (entry.startsWith('./ocr/')) {
    problems.push(`OCR 資産 ${entry} が原子的シェルに混ざっている(install の原子性に載せない)`)
  }
}

// ── 5. OCR 層のキャッシュ名 = 資産そのもののハッシュ ─────────────────────────
// ビルドごとに変わる CACHE と同じ名前にすると、デプロイのたびに 7.7MB を捨てて取り直させる
// ことになる(資産はバージョン固定で内容が変わらないのに)。中身から名前を作れば、
// 資産を差し替えたときだけ層が入れ替わる。
const OCR_DIST = resolve(DIST, 'ocr')
const ocrFiles = walk(OCR_DIST).sort()
if (hasOcrDep) {
  if (ocrFiles.length === 0) {
    problems.push('dist/ocr/ が空 — OCR 資産が成果物に入っていない(`npm run ocr:assets`)')
  }
  // 同梱物の一覧は scripts/ocr-assets.mjs が単一の出所。出荷側でも同じ表に突き合わせる
  // (publicDir の設定変更などで静かに落ちるのを防ぐ)。
  const shipped = new Set(ocrFiles.map(p => relative(OCR_DIST, p).split('\\').join('/')))
  for (const name of OCR_EXPECTED) {
    if (!shipped.has(name)) problems.push(`dist/ocr/${name} が成果物に無い(OCR が実機で 404 になる)`)
  }
}

const ocrHash = createHash('sha256')
for (const p of ocrFiles) {
  ocrHash.update(relative(DIST, p))
  ocrHash.update('\0')
  ocrHash.update(readFileSync(p))
  ocrHash.update('\0')
}
const ocrBytes = ocrFiles.reduce((sum, p) => sum + statSync(p).size, 0)
const ocrCache = `sake-ocr-${ocrHash.digest('hex').slice(0, 12)}`

if (problems.length > 0) die()

// ── 6. 置換 ─────────────────────────────────────────────────────────────────
// キャッシュ名はビルドごとに一意にする。activate で「CACHE でも OCR_CACHE でもない」ものを
// 全削除するので、旧版の stale なシェルが残り続ける問題を防げる。
const version = `sake-${Date.now()}`

let sw = readFileSync(SW, 'utf8')
const PLACEHOLDERS = ['__CACHE_VERSION__', '__OCR_CACHE__', '__PRECACHE_ASSETS__']
const missing = PLACEHOLDERS.filter(p => !sw.includes(p))
if (missing.length > 0) {
  problems.push(
    `dist/sw.js にプレースホルダが無い: ${missing.join(', ')} — ` +
      '既に置換済みか public/sw.js が変わっている',
  )
  die()
}
sw = sw
  .replace('__CACHE_VERSION__', version)
  .replace('__OCR_CACHE__', ocrCache)
  .replace('__PRECACHE_ASSETS__', JSON.stringify(precache))
writeFileSync(SW, sw)

// ビルド時のメタデータなので出荷しない(実行時に読む人がいない)
rmSync(resolve(DIST, '.vite'), { recursive: true, force: true })

const mb = n => (n / 1024 / 1024).toFixed(2) + 'MB'
console.log(`✓ sw.js に必須プリキャッシュを注入した: ${precache.length}件 (cache=${version})`)
console.log(`    assets ${assets.length}件 / さけのわデータ ${data.length}件`)
console.log(
  `    OCR ${ocrFiles.length}件 ${mb(ocrBytes)} は別層 ${ocrCache} — ` +
    'install では取らず、使ったときの fetch で埋める',
)
