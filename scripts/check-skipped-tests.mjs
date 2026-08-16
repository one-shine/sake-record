#!/usr/bin/env node
/**
 * **skip されたテストを CI のログに名指しで出す**(Phase 7 / BACKLOG B35 の可視化)。
 *
 *   npm run skips:check            (= npm run test:report が書いた JSON を読む)
 *
 * 何が問題か: 実測値(203本 / 2022年65本 / 福島22本 / フレーバー分母190 → 紐付けを解除して189)を
 * 検査しているのは `src/integration/` の3ファイルだけで、これは `data/seed/sake-log-rows.json`
 * (個人の飲酒台帳。public リポジトリなので gitignore)が無いと `describe.skipIf` で丸ごと
 * skip される。**つまり CI ではこの数字が一度も検証されていない**のに `npm run ci` は緑になる。
 * 各ファイルは `src/test/notice.ts` で理由を stderr に出しているが、それは run の途中に流れる
 * 1行で、緑の要約(`Tests 729 passed | 3 skipped`)だけ見ると気づけない。
 *
 * そこで run の**最後**に、skip を件数と場所つきでまとめて出す。落とす条件は2つだけ:
 *   (a) 想定していない場所で skip された … 下の SKIP_ZONES に無いファイルの skip。
 *       skip は「この環境では検証できない」の印なので、増えたなら理由を書いて登録する。
 *   (b) seed があるのに実データ依存のテストが skip された … glob のパスがずれて `hasSeed` が
 *       常に false になる類の壊れ方。**手元でも CI でも黙って緑になる**ので、ここで落とす。
 *
 * seed が無い環境(CI)で skip されること自体は落とさない。落とすと CI が常に赤になり、
 * 「赤が普通」になって本物の赤を隠す。**出すが、止めない。**
 *
 * 実装時に合成レポート(偽の root にこのスクリプトを複写して実行)で確かめた振る舞い。
 * 直すときはここを壊していないか確かめる:
 *   A. seed なし・実データ依存が全部 skip → exit 0 + 「N/3ファイル skip」の警告   … CI の通常形
 *   B. seed ありなのに実データ依存が skip  → exit 1                                … 判定の壊れ
 *   C. 未登録の場所で skip                 → exit 1
 *   D. テストが0ファイル                   → exit 1                                … 無検査を緑にしない
 *   E. レポートが無い                      → exit 1
 *   F. 単発実行で実データ依存が run に無い → exit 0 +「この run に含まれていない」   … 検証したとは言わない
 *   G. 全実行・skip 0件(seed あり)        → exit 0 +「実測値を検証した」
 *   H. 登録した場所が実在しない            → exit 1                                … 登録が何も見ていない
 */
import { existsSync, readFileSync, appendFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const reportPath = resolve(root, process.argv[2] ?? '.vitest/report.json')

/** 台帳(gitignore 済み)。これがあるかどうかで期待する skip が変わる */
const SEED = resolve(root, 'data/seed/sake-log-rows.json')
const hasSeed = existsSync(SEED)

/**
 * skip してよい場所と理由。**`needsSeed` のものは seed があれば skip されてはならない。**
 * ここに無いファイルで skip が出たら落とす(理由の書かれていない skip を増やさない)。
 */
const SKIP_ZONES = [
  {
    file: 'src/integration/seedImport.test.tsx',
    needsSeed: true,
    why: '実データ203本の紐付け内訳(auto 178 / alias 13 / unlinked 7 / unknown 5 / フレーバー190)と203行の DOM',
  },
  {
    file: 'src/integration/screens.test.tsx',
    needsSeed: true,
    why: '実データ203本の4画面(総本数203 / 2022年65本 / 福島県22本 / スタイル延べ314 / 分母190・189 / 産地197本・未進出14県)',
  },
  {
    file: 'src/integration/manualLink.test.tsx',
    needsSeed: true,
    why: '実データの手動紐付け(寫楽5本 → 宮泉2401 / フレーバー分母 185→190 / 解除で別名も消える)',
  },
  {
    file: 'src/lib/image/resize.test.ts',
    needsSeed: false,
    why: '実 canvas(OffscreenCanvas / createImageBitmap)を通す往復。jsdom には無いのでブラウザでしか走らない',
  },
  {
    file: 'src/lib/ocr/recognize.test.ts',
    needsSeed: false,
    why: '実 Worker + 実 WASM(tesseract)を通す往復。jsdom に Worker が無いのでブラウザでしか走らない',
  },
]

if (!existsSync(reportPath)) {
  console.error(`✗ テスト結果 ${relative(root, reportPath)} が無い。`)
  console.error('  `npm run test:report`(vitest の json reporter)を先に走らせる。')
  console.error('  この検査を飛ばすと「何を検証していないか」が誰にも見えないまま緑になる。')
  process.exit(1)
}

let report
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch (err) {
  console.error(`✗ ${relative(root, reportPath)} を JSON として読めない: ${err.message}`)
  process.exit(1)
}

const suites = Array.isArray(report.testResults) ? report.testResults : []
if (suites.length === 0) {
  console.error('✗ テスト結果が0ファイル。テストが1本も走っていないので、この検査も無検査になっている。')
  process.exit(1)
}

/** vitest 4 は `skipped`、jest 互換の呼び名は `pending`。`todo` も未実行なので同じ扱い */
const SKIPPED = new Set(['skipped', 'pending', 'todo'])

/** file(リポジトリ相対) → skip されたテスト名 */
const skippedByFile = new Map()
/** この run に含まれていたファイル。単発実行(`npm test -- <パターン>`)と全実行を区別する */
const filesInRun = new Set()
let totalTests = 0
for (const suite of suites) {
  const rel = relative(root, suite.name)
  filesInRun.add(rel)
  for (const a of suite.assertionResults ?? []) {
    totalTests += 1
    if (!SKIPPED.has(a.status)) continue
    if (!skippedByFile.has(rel)) skippedByFile.set(rel, [])
    skippedByFile.get(rel).push(a.fullName ?? a.title ?? '(名前なし)')
  }
}

const totalSkipped = [...skippedByFile.values()].reduce((n, v) => n + v.length, 0)
const zoneOf = file => SKIP_ZONES.find(z => z.file === file)

// ── 出力(緑でも必ず出す。これが目的) ────────────────────────────────
const lines = []
// **いつの run か**を必ず出す。`npm run ci` では直前の test:report のものだが、
// 単独で叩くと前回の残りを読む。日時が無いと古い結果を今の結果と読み違える。
const startedAt = Number.isFinite(report.startTime)
  ? new Date(report.startTime).toISOString()
  : '(時刻の記録なし)'
lines.push(
  `skip されたテスト: ${totalSkipped}件 / 全${totalTests}件` +
    `(テストファイル ${suites.length}件・seed ${hasSeed ? 'あり' : 'なし'}・run ${startedAt})`,
)
for (const [file, names] of [...skippedByFile].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  const zone = zoneOf(file)
  lines.push(`  ${file} — ${names.length}件`)
  lines.push(`      未検証: ${zone ? zone.why : '**理由が登録されていない skip**'}`)
  for (const n of names) lines.push(`      ・${n}`)
}
for (const line of lines) console.log(line)

/**
 * GitHub Actions のジョブ要約にも同じものを出す。ログは畳まれていて開かないと見えないので、
 * **「何を検証していないか」だけは開かずに見える**ようにする(見えない警告は無いのと同じ)。
 * 落ちるときも書く — 落ちた回こそ状態が見えないと困る。
 */
function writeSummary(verdict) {
  if (!process.env.GITHUB_STEP_SUMMARY) return
  const body = ['### skip されたテスト', '', '```', ...lines, ...verdict, '```', ''].join('\n')
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, body)
  } catch (err) {
    console.log(`    (ジョブ要約に書けなかった: ${err.message})`)
  }
}

// ── 落とす条件 ────────────────────────────────────────────────────────
const problems = []

// 登録した場所が実在するか。名前が変わった / 消えたのに登録だけ残ると、
// 「そのファイルの skip は0件」が永久に真になり、ガードが**何も見ていない**状態になる。
for (const zone of SKIP_ZONES) {
  if (!existsSync(resolve(root, zone.file))) {
    problems.push(
      `SKIP_ZONES に登録された ${zone.file} が存在しない(改名か削除)。` +
        'この登録は何も見ていないので、追随させるか外す。',
    )
  }
}

for (const [file, names] of skippedByFile) {
  const zone = zoneOf(file)
  if (!zone) {
    problems.push(
      `${file} の skip ${names.length}件は想定外。理由を scripts/check-skipped-tests.mjs の SKIP_ZONES に書く` +
        '(理由の無い skip を増やさない)。',
    )
    continue
  }
  if (zone.needsSeed && hasSeed) {
    problems.push(
      `${file} は seed(data/seed/sake-log-rows.json)があるのに ${names.length}件 skip された。` +
        '`import.meta.glob` のパスがずれて hasSeed が常に false になっていないか確認する' +
        '(この壊れ方は手元でも CI でも緑のまま実測値を検証しなくなる)。',
    )
  }
}

if (problems.length > 0) {
  console.error(`✗ skip の状態が想定と違う (${problems.length}件):`)
  for (const p of problems) console.error('  ' + p)
  writeSummary(['', `✗ skip の状態が想定と違う (${problems.length}件):`, ...problems.map(p => '  ' + p)])
  process.exit(1)
}

const seedZones = SKIP_ZONES.filter(z => z.needsSeed)
const seedSkipped = seedZones.filter(z => skippedByFile.has(z.file))
/** この run に**そもそも含まれていない**ファイル。単発実行を「検証した」と言わないため */
const seedAbsent = seedZones.filter(z => !filesInRun.has(z.file))

const verdict = []
if (seedAbsent.length > 0) {
  verdict.push('')
  verdict.push(
    `! 実データ依存のテスト ${seedAbsent.length}/${seedZones.length}ファイルはこの run に含まれていない` +
      '(パターン指定の単発実行)。実測値の検証状態はこの出力からは分からない。',
  )
  for (const z of seedAbsent) verdict.push(`    ${z.file}`)
}
if (seedSkipped.length > 0) {
  // **黙って緑にしない。** CI(seed が無い)では必ずここを通る
  verdict.push('')
  verdict.push(
    `! 実データ依存のテストが ${seedSkipped.length}/${seedZones.length}ファイル skip された。` +
      'この run では実測値(203本 / 2022年65本 / 福島22本 / 分母190・紐付けを解除して189)を**検証していない**。',
  )
  verdict.push('  検証するには data/seed/sake-log-rows.json を用意して `npm run test` を回す')
  verdict.push('  (台帳は public リポジトリに置けないので CI では埋められない — BACKLOG B35 / B23 と同じ制約)。')
} else if (hasSeed && seedAbsent.length === 0) {
  verdict.push(`✓ 実データ依存のテスト ${seedZones.length}ファイルは skip されず実行された(実測値を検証した)。`)
}
verdict.push(`✓ skip の場所はすべて登録済み(${SKIP_ZONES.length}箇所を把握)。`)

for (const line of verdict) console.log(line)
writeSummary(verdict)
