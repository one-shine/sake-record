#!/usr/bin/env node
/**
 * 飲酒台帳の**結合キー**がリポジトリに漏れていないかを見張る(BACKLOG B22)。
 *
 *   npm run ledger:check
 *
 * 背景: このリポジトリは public で、飲酒台帳そのもの(`data/seed/`)は gitignore してある。
 * コミットしているのは3つの射影で、**2つに共通の列を1つも作らない**のが不変条件:
 *   - `src/domain/linkBrand.cases.json` … 銘柄 + 都道府県(日付なし)
 *   - `src/domain/linkBrand.snap.json`  … 同 + 紐付け結果
 *   - `src/domain/stats.cases.json`     … 日付だけ
 * 射影の形は `linkBrand.test.ts` の「コミットする射影の混入規則」が守っているが、**その3ファイル
 * しか見ていない**。実際に何度も、テストの fixture やドキュメントの説明文に「実台帳の日付と銘柄の
 * 対」を書いて漏らしていた(それ1行で台帳の1行が復元でき、2つの射影を突き合わせる鍵にもなる)。
 *
 * そこでリポジトリ全体を見る。**日付だけ・銘柄だけなら射影として公開済みなので違反にしない。**
 * 違反は「同じ行に台帳の日付と、台帳の銘柄(または都道府県)が同居していること」= 結合キー。
 *
 * 検査対象の値は射影ファイルから読む(この検査器自身が値を持つと、検査器が違反になる)。
 * **失敗時の出力にも値を出さない** — CI のログは公開されるので、場所と件数だけを言う。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 射影ファイル自身は対象外(ここに値があるのが正しい) */
const PROJECTIONS = [
  'src/domain/stats.cases.json',
  'src/domain/linkBrand.cases.json',
  'src/domain/linkBrand.snap.json',
]

/** テキストとして読まないもの */
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.ico', '.woff', '.woff2', '.pdf'])

/**
 * **テキストであるべき拡張子**。ここに NUL が混ざったら違反として落とす —
 * NUL が1個あるだけで git は binary 扱いにして差分を出さず、`grep` も行を返さず、
 * この検査も行単位で読めない。つまり**そのファイルだけ静かに無検査になる**
 * (実際に `Timeline.tsx` の番兵と `import-sake-log.mjs` のキーで踏んだ。
 *  必要なら `'\u0000'` のようにエスケープで書けば同じ値でテキストのまま保てる)。
 */
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.md', '.json', '.html', '.css', '.yml', '.yaml', '.sh'])

function readJson(rel) {
  try {
    return JSON.parse(readFileSync(resolve(root, rel), 'utf8'))
  } catch (err) {
    console.error(`✗ 射影 ${rel} を読めない: ${err.message}`)
    console.error('  この検査は射影ファイルから値を読む(検査器に台帳の値を書かないため)。')
    process.exit(1)
  }
}

const dates = new Set(readJson('src/domain/stats.cases.json'))
const cases = readJson('src/domain/linkBrand.cases.json')
/** 銘柄と都道府県。**どちらも日付と同居した瞬間に結合キーになる**(B18 で県が実際に鍵になった) */
const columns = new Set(cases.flatMap(row => [row.label, row.prefecture]).filter(v => v !== ''))

if (dates.size === 0 || columns.size === 0) {
  console.error('✗ 射影から日付 / 銘柄を1つも読めなかった。検査が無検査になっている')
  process.exit(1)
}

/** 追跡ファイル + 未追跡ファイル(gitignore されたものは除く = `data/seed/` は対象外) */
function listFiles() {
  const out = []
  for (const args of [['ls-files', '-z'], ['ls-files', '--others', '--exclude-standard', '-z']]) {
    out.push(...execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0'))
  }
  return [...new Set(out.filter(Boolean))]
}

const DATE_RE = /\d{4}-\d{2}-\d{2}/g

const violations = []
const skipped = []
let scanned = 0

for (const rel of listFiles()) {
  if (PROJECTIONS.includes(rel)) continue
  if (SKIP_EXT.has(rel.slice(rel.lastIndexOf('.')))) continue

  let text
  try {
    text = readFileSync(resolve(root, rel), 'utf8')
  } catch (err) {
    skipped.push(`${rel}(読めない: ${err.code ?? err.message})`)
    continue
  }
  // NUL を含むファイルは行単位で読めない。**黙って飛ばさない** —
  // テキストであるはずの拡張子なら**違反として落とす**(そのファイルだけ静かに無検査になるから)
  if (text.includes('\0')) {
    const ext = rel.slice(rel.lastIndexOf('.'))
    if (TEXT_EXT.has(ext)) {
      violations.push(`${rel} — テキストなのに NUL バイトを含む(git が binary 扱いになり、この検査も効かない)`)
    } else {
      skipped.push(`${rel}(NUL を含む = binary 扱い)`)
    }
    continue
  }
  scanned += 1

  text.split('\n').forEach((line, i) => {
    const onLine = [...new Set(line.match(DATE_RE) ?? [])].filter(d => dates.has(d))
    if (onLine.length === 0) return
    // 値は数えるだけ。**どの日付・どの銘柄かは出力しない**
    const hits = [...columns].filter(value => line.includes(value)).length
    if (hits > 0) violations.push(`${rel}:${i + 1} — 台帳の日付と銘柄/都道府県が同じ行にある`)
  })
}

if (violations.length) {
  console.error(`✗ 台帳ガードに失敗 (${violations.length}件):`)
  for (const v of violations) console.error('  ' + v)
  console.error('  日付と銘柄が同居している場合: その対はそれ1行で台帳の1行になり、2つの射影を')
  console.error('  突き合わせる鍵にもなる。日付と銘柄を**架空の値**にする(説明は「同日・同銘柄の2件」')
  console.error('  のように構造で書く)。実データを見る検査はスクリプト側で値を持たず構造で確かめる。')
  console.error('  NUL を含む場合: エスケープ(\\u0000)で書けば同じ値のままテキストとして扱える。')
  process.exit(1)
}

// 対象ファイル数を出す(0件を「合格」と読み違えないため)
console.log(`✓ 台帳の結合キーなし: ${scanned}ファイルを走査(日付 ${dates.size}種 × 銘柄/県 ${columns.size}種)`)
console.log(`    射影3ファイルは対象外(${PROJECTIONS.join(' / ')})`)
// 飛ばしたファイルは必ず名前を出す(未検査を無音にしない)
for (const s of skipped) console.log(`    未検査: ${s}`)
