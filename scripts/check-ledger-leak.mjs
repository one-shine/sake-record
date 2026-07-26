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
import { existsSync, readFileSync } from 'node:fs'
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
/** 銘柄表記だけ。**県を含めない**(合成データの検査で使う。県は実在の県名を使ってよい) */
const labels = new Set(cases.map(row => row.label).filter(v => v !== ''))
/** 銘柄と都道府県。**どちらも日付と同居した瞬間に結合キーになる**(B18 で県が実際に鍵になった) */
const columns = new Set(cases.flatMap(row => [row.label, row.prefecture]).filter(v => v !== ''))

if (dates.size === 0 || columns.size === 0) {
  console.error('✗ 射影から日付 / 銘柄を1つも読めなかった。検査が無検査になっている')
  process.exit(1)
}

/**
 * ファイル一覧は git から取る(gitignore を尊重するため = `data/seed/` を読まない)。
 * git が無い / ここがリポジトリでない環境では**例外の生スタックで落ちていた**(BACKLOG B25(4))。
 * 落ちること自体は正しい(検査を飛ばして緑にしてはいけない)が、何が起きたか読めないので
 * 理由と対処を出して終える。**フォールバックで全ファイルを列挙してはいけない** —
 * gitignore を無視して `data/seed/`(台帳そのもの)を読みに行くことになる。
 */
function gitFiles(...args) {
  try {
    return execFileSync('git', [...args, '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  } catch (err) {
    console.error('✗ git からファイル一覧を取れないので、台帳ガードを実行できなかった。')
    console.error(`  git ${args.join(' ')} — ${err.code === 'ENOENT' ? 'git が見つからない' : err.message}`)
    console.error('  この検査は gitignore を尊重するために git を使う(自前で列挙すると data/seed/ を読んでしまう)。')
    console.error('  git のあるリポジトリのチェックアウトで実行する。**検査を飛ばして緑にはしない**。')
    process.exit(1)
  }
}

/** 追跡ファイル(index に載っているもの。`git add` した直後から対象になる) */
function trackedFiles() {
  return [...new Set(gitFiles('ls-files'))]
}

/** 追跡ファイル + 未追跡ファイル(gitignore されたものは除く = `data/seed/` は対象外) */
function listFiles() {
  return [...new Set([...trackedFiles(), ...gitFiles('ls-files', '--others', '--exclude-standard')])]
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

// ---------------------------------------------------------------------------
// 画素は読めない — スクリーンショットは**ファイル名の allowlist** でしか守れない(B24)
// ---------------------------------------------------------------------------
//
// 一覧・詳細・統計・産地の画面には (日付, 銘柄, 都道府県) が同じ行に写る = 上の行単位の検査が
// 見ているのと同じ結合キーだが、PNG は画素なので**この検査器は1バイトも読めない**。
// そこで「追跡してよい画像」を名前で列挙し、それ以外が index に入ったら落とす。
//
// **allowlist の単一の出所は `.gitignore` の `!docs/evidence/...` 行**(2箇所に列挙して
// ドリフトさせない)。`.gitignore` 側は `docs/evidence/*.png` を既定で無視し、目視確認を
// 済ませたファイルだけを `!` で戻す。こちらはその宣言と index の実態が一致するかを見る。
//
// **この検査で防げないこと**(塞いだつもりにならないため書く):
//   - 許可済みの名前のまま**中身を実データのスクショに差し替える**こと。画素は読めないので
//     検出できない。撮り直したら1枚ずつ目で見る、が唯一の検査(手順は docs/evidence/README.md)。
//   - `git add -f` で ignore を越えて追加すること自体は防げない(index に載るのでここが落とす)。
const EVIDENCE_DIR = 'docs/evidence/'
/** 中身を読めない = allowlist でしか守れない拡張子 */
const OPAQUE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.heic'])

const allowedEvidence = new Set(
  readFileSync(resolve(root, '.gitignore'), 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith(`!${EVIDENCE_DIR}`))
    .map(line => line.slice(1)),
)

let trackedImages = 0
for (const rel of trackedFiles()) {
  if (!rel.startsWith(EVIDENCE_DIR)) continue
  if (!OPAQUE_EXT.has(rel.slice(rel.lastIndexOf('.')))) continue
  trackedImages += 1
  if (!allowedEvidence.has(rel)) {
    violations.push(`${rel} — 追跡されているが .gitignore の allowlist(!${EVIDENCE_DIR}…)に無い`)
  }
}
// 実体の無い許可行を残さない(名前だけ残ると、後から同じ名前で置かれた画像が無検査で通る)
for (const rel of allowedEvidence) {
  if (!existsSync(resolve(root, rel))) {
    violations.push(`${rel} — .gitignore が許可しているのにファイルが無い(許可行を消す)`)
  }
}

// ---------------------------------------------------------------------------
// スクショの元になる合成データが台帳と交わらないこと(B33)
// ---------------------------------------------------------------------------
//
// 追跡するスクショは `docs/evidence/demo-backup.json` を取り込んだ画面だけを撮る約束
// (`scripts/make-demo-backup.mjs` が作る)。その約束が守られている限り、画素を読めなくても
// **画面に写り得る値の集合はこの JSON が上限**になる。だからこの JSON を検査すれば足りる。
const DEMO = `${EVIDENCE_DIR}demo-backup.json`
/**
 * 銘柄名ではない表記。台帳にも同じ値があるが一致しても何も漏れない
 * (`不明` = `linkBrand.ts` の `UNKNOWN_KEY`。「銘柄不明の行がある」は台帳について何も言わない)。
 * 出所は `scripts/make-demo-backup.mjs` の同名の定数。
 */
const NON_BRAND_LABELS = new Set(['不明'])

let demoNote = `${DEMO} が無い(合成データのスクショを撮っていない状態)`
if (existsSync(resolve(root, DEMO))) {
  const text = readFileSync(resolve(root, DEMO), 'utf8')
  const demoDates = [...new Set(text.match(DATE_RE) ?? [])].filter(d => dates.has(d))
  if (demoDates.length > 0) {
    violations.push(`${DEMO} — 合成データに台帳の日付が ${demoDates.length}種 入っている`)
  }
  let payload = null
  try {
    payload = JSON.parse(text)
  } catch (err) {
    violations.push(`${DEMO} — JSON として読めない(${err.message})`)
  }
  const demoLabels = new Set(
    (payload?.records ?? []).flatMap(r => [r.brandLabel, r.brandName]).filter(v => typeof v === 'string'),
  )
  const collided = [...demoLabels].filter(v => labels.has(v) && !NON_BRAND_LABELS.has(v))
  if (collided.length > 0) {
    violations.push(`${DEMO} — 合成データの銘柄が台帳の銘柄と ${collided.length}種 一致している`)
  }
  demoNote = `${DEMO}: 記録 ${payload?.records?.length ?? 0}件 — 台帳の日付0種 / 台帳の銘柄0種`
}

if (violations.length) {
  console.error(`✗ 台帳ガードに失敗 (${violations.length}件):`)
  for (const v of violations) console.error('  ' + v)
  console.error('  日付と銘柄が同居している場合: その対はそれ1行で台帳の1行になり、2つの射影を')
  console.error('  突き合わせる鍵にもなる。日付と銘柄を**架空の値**にする(説明は「同日・同銘柄の2件」')
  console.error('  のように構造で書く)。実データを見る検査はスクリプト側で値を持たず構造で確かめる。')
  console.error('  NUL を含む場合: エスケープ(\\u0000)で書けば同じ値のままテキストとして扱える。')
  console.error(`  ${EVIDENCE_DIR} の画像の場合: 実データが写っていないことを1枚ずつ目で見てから`)
  console.error('  .gitignore に `!' + EVIDENCE_DIR + '<名前>` を足す(画素は検査できない)。')
  console.error('  合成データの場合: `node scripts/make-demo-backup.mjs` で作り直す(生成側も同じ検査をする)。')
  process.exit(1)
}

// 対象ファイル数を出す(0件を「合格」と読み違えないため)
console.log(`✓ 台帳の結合キーなし: ${scanned}ファイルを走査(日付 ${dates.size}種 × 銘柄/県 ${columns.size}種)`)
console.log(`    射影3ファイルは対象外(${PROJECTIONS.join(' / ')})`)
// **分母を出す** — 許可済みが何枚で、そのうち今 index に載っているのが何枚か
console.log(`    ${EVIDENCE_DIR} の画像: 追跡 ${trackedImages}枚 / allowlist ${allowedEvidence.size}枚(画素は検査できない = 目視が唯一の検査)`)
console.log(`    ${demoNote}`)
// 飛ばしたファイルは必ず名前を出す(未検査を無音にしない)
for (const s of skipped) console.log(`    未検査: ${s}`)
