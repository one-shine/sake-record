#!/usr/bin/env node
/**
 * brain の飲酒ログ(markdown)を取り込み用の行 JSON に射影する。
 *
 *   npm run import:sake-log            (= node scripts/import-sake-log.mjs [<sake-log.md>])
 *
 * このスクリプトは **markdown → 行 JSON の射影だけ**を行う。紐付けも集計も一切しない。
 * 紐付けの実装は src/domain/linkBrand.ts の1本、集計は src/domain/stats.ts の1本に限る。
 * ここに「年別ヒストグラムの検算」や「銘柄の突合」を足すと二重実装になり、必ずドリフトする
 * (そして画面に出る数字とテストが通る数字が別物になる)。
 *
 * **パース本体は src/domain/parseSakeLog.ts にある**。元 markdown はリポジトリ外(brain)なので、
 * ここで自己検証しても CI では一度も走らない。構造不変条件(とくに「内容が同じ行を dedupe しない」)
 * はリテラルの markdown に対する単体テスト(parseSakeLog.test.ts)で守り、この殻はファイル入出力と
 * 「203件であること」だけを見る。TS を直接 import しているので Node は 22.18+ / 23.6+ が必要
 * (型ストリップ)。パースを2箇所に書かないための選択。
 *
 * 出力を3つに分けているのはプライバシー要件。公開リポジトリなので、飲酒台帳そのものは
 * コミットできない。しかし数値系の受け入れ基準は CI で守りたい。そこで台帳を
 *   - 「日付を持たない酒名+県の集合」 (linkBrand.cases.json)  … A3 / A4 / A5
 *   - 「それ以外の列を一切持たない日付の列」 (stats.cases.json) … A10
 * に射影して分割する。**2つのファイルに共通の列を1つも残さない**のが要件。
 * 県を両方に残すと、県ごとの出現数が両側で一致する(同じ203本の射影なので必ず一致する)ため、
 * 片側で1件しかない県は一意に突き合わせられ「銘柄 × 日付」が復元される
 * (実測: 9県が一意に確定した)。スペックも商品名経由で銘柄名を含む(`赤紀土(赤色系)` など4行)ので
 * 出さない。県別の集計(A10)は linkBrand.cases.json の 203件の県を使えば検証できる —
 * 県の多重集合は片方に置けば足りる。完全な203行は data/seed/(gitignore)に閉じる。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let parseSakeLog
try {
  ;({ parseSakeLog } = await import('../src/domain/parseSakeLog.ts'))
} catch (err) {
  console.error('✗ src/domain/parseSakeLog.ts を読み込めなかった。')
  console.error('  TS を直接 import しているので Node 22.18+ / 23.6+ (型ストリップ)が必要:')
  console.error(`  node ${process.version} / ${err.message}`)
  process.exit(1)
}

/** 元データは brain(セカンドブレイン)側にありリポジトリ外。第1引数で差し替えられる */
const SRC = resolve(root, process.argv[2] ?? '../brain/40_Resources/sake-log.md')

const OUT_SEED = resolve(root, 'data/seed/sake-log-rows.json')
const OUT_LINK_CASES = resolve(root, 'src/domain/linkBrand.cases.json')
const OUT_STATS_CASES = resolve(root, 'src/domain/stats.cases.json')

const EXPECTED_COUNT = 203

/**
 * 同一ボトルの表/裏ラベルの写真が別々に203本に数えられている組が2つある。内容(日付+銘柄)では
 * 区別できないため、素朴な dedupe を入れると静かに201本になる。取り込み時に消えていないことを
 * 固定する(dedupe しないこと自体は parseSakeLog.test.ts が CI で守る。ここは実データ側の確認)。
 *
 * **どの2組かは書かない。** 日付と銘柄の対を公開リポジトリに置くと、コミットしている2つの射影
 * (日付なしの `linkBrand.cases.json` / 日付だけの `stats.cases.json`)を結合するための鍵に
 * なる(冒頭のコメント参照。`npm run ledger:check` が全ファイルを見張る)。値ではなく**構造**で
 * 確かめる: 「(日付, 銘柄) が重複する組は2つだけ・各2件だけ」。
 */
const EXPECTED_DUPLICATE_GROUPS = 2
const EXPECTED_DUPLICATE_SIZE = 2

if (!existsSync(SRC)) {
  console.error(`✗ 元データが無い: ${SRC}`)
  console.error('  brain 側のパスが変わったなら第1引数で渡す: npm run import:sake-log -- <path>')
  process.exit(1)
}

const { rows, problems } = parseSakeLog(readFileSync(SRC, 'utf8'))

// --- 実データ側の期待値 ---------------------------------------------------
if (rows.length !== EXPECTED_COUNT) {
  problems.push(`件数が ${rows.length} 件で ${EXPECTED_COUNT} 件でない`)
}

// (日付, 銘柄) の重複の**形**だけを見る。エラー文にも値を出さない(件数だけを言う)
const duplicateGroups = new Map()
for (const row of rows) {
  const key = `${row.drankOn} ${row.brandLabel}`
  duplicateGroups.set(key, (duplicateGroups.get(key) ?? 0) + 1)
}
const duplicated = [...duplicateGroups.values()].filter(n => n > 1)
if (duplicated.length !== EXPECTED_DUPLICATE_GROUPS) {
  problems.push(
    `(日付, 銘柄) が重複する組が ${duplicated.length} 組(期待 ${EXPECTED_DUPLICATE_GROUPS} 組)。` +
      'dedupe すると203本が崩れる',
  )
}
for (const n of duplicated) {
  if (n !== EXPECTED_DUPLICATE_SIZE) {
    problems.push(
      `(日付, 銘柄) が重複する組の1つが ${n} 件(期待 ${EXPECTED_DUPLICATE_SIZE} 件)。元 md が変わっている`,
    )
  }
}

if (problems.length) {
  console.error(`✗ sake-log.md のパースに失敗 (${problems.length}件):`)
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}

// --- 出力 -----------------------------------------------------------------

/** 1レコード1行で書く。203行の差分がレビューできる形を保つ */
function writeRows(path, list) {
  mkdirSync(dirname(path), { recursive: true })
  const body = list.map(o => '  ' + JSON.stringify(o)).join(',\n')
  writeFileSync(path, `[\n${body}\n]\n`)
}

writeRows(OUT_SEED, rows)

/**
 * label 順に並べ替えて時系列を壊す。比較は localeCompare ではなくコードポイント順にする
 * (ICU のバージョンや実行環境のロケールで並びが変わると、中身が同じでも差分が出る)。
 * 第2キーまで同じ要素は {label, prefecture} として完全に同一なので、
 * 安定ソートが元の順序を保っても日付の情報は残らない。
 */
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const linkCases = rows
  .map(r => ({ label: r.brandLabel, prefecture: r.prefecture }))
  .sort((a, b) => byCodePoint(a.label, b.label) || byCodePoint(a.prefecture, b.prefecture))
writeRows(OUT_LINK_CASES, linkCases)

/**
 * 日付だけの列。**他の列を1つも足さないこと**。
 * 県やスペックを足すと linkBrand.cases.json と共通の列ができて2ファイルが結合可能になり、
 * 「単体では台帳にならず結合もできない」が崩れる(冒頭のコメント参照)。
 * 日付の多重集合(同日に最大6〜7件)は保つ = 年別ヒストグラムの検証にはこれで足りる。
 */
const statsCases = rows.map(r => r.drankOn)
writeRows(OUT_STATS_CASES, statsCases)

const rel = p => p.replace(root + '/', '')
console.log(`✓ sake-log.md を取り込んだ: ${rows.length}件`)
console.log(`    ${rel(OUT_SEED).padEnd(31)} ${rows.length}件  no/drankOn/brandLabel/prefecture/spec/note (gitignore)`)
console.log(`    ${rel(OUT_LINK_CASES).padEnd(31)} ${linkCases.length}件  label/prefecture (日付なし / label順)`)
console.log(`    ${rel(OUT_STATS_CASES).padEnd(31)} ${statsCases.length}件  drankOn のみ (県・スペック・銘柄名なし)`)
console.log('  2ファイルに共通の列は無い(結合キーを残さない)。県別集計は linkBrand.cases.json の県を使う')
console.log('  紐付け・集計はここでは行わない(src/domain/linkBrand.ts と stats.ts の1本に限る)')
