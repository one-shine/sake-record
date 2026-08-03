#!/usr/bin/env node
/**
 * 蔵元の説明(B78)の同梱データを検査する。
 *
 *   npm run wikipedia:check
 *
 * ## 何を守っているのか
 *
 * **記事名は動く。** `旭酒造` は `獺祭 (企業)` に改名された。取得スクリプトは動いた行を
 * 黙って捨てる(人が確かめたのと別の記事を採らないため)ので、**放っておくと説明が1件ずつ
 * 静かに消える**。画面は正常に見えるし、テストも全部緑のままになる。
 *
 * そこで「**人が確定した行が全部取れているか**」を見る。前回の件数を別に保存しないのは、
 * 確定した表(`src/data/brewery-articles.ts`)そのものが期待値だから — 保存した数と比べると、
 * 減ったまま保存し直したときに気付けない。
 *
 * ## 検査そのものの自己検査
 *
 * **確定した行は当面0件**で、そのあいだ上の判定は一度も発火しない。恒真の検査は
 * 機能を静かに殺すので、`inspect()` を純関数に切り出して**合成の入力で通る/落ちるを固定する**
 * (`check-attribution.mjs` と同じ思想。ファイルは作らない)。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BREWERY_ARTICLES } from '../src/data/brewery-articles.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = resolve(root, 'public/data/wikipedia/brewery-articles.json')
const BREWERIES = resolve(root, 'public/data/sakenowa/breweries.json')

/**
 * 確定した表と同梱データを突き合わせて、問題を並べる。**純関数**。
 *
 * @param confirmed 人が目視で確定した行(`src/data/brewery-articles.ts`)
 * @param data 同梱データを JSON.parse したもの。**まだ無いなら `null`**
 * @param breweryIds 蔵元マスタに在るID
 */
export function inspect(confirmed, data, breweryIds) {
  const problems = []

  if (confirmed.length === 0) {
    // 表を消したのにデータだけ残っていたら、出所の無いテキストを配ることになる
    if (data !== null)
      problems.push('確定した表が空なのに同梱データがある(表を消したならデータも消す)')
    return problems
  }
  if (data === null) {
    problems.push(`${String(confirmed.length)}行を確定しているのに同梱データが無い`)
    return problems
  }

  if (typeof data.copyright !== 'string' || !data.copyright.includes('CC BY-SA 4.0')) {
    problems.push('同梱データに CC BY-SA 4.0 のクレジットが無い(ファイル単位で再配布されうる)')
  }
  if (!Array.isArray(data.rows)) {
    problems.push('rows が配列でない')
    return problems
  }

  const byId = new Map(confirmed.map((entry) => [entry.breweryId, entry]))
  const seen = new Set()
  for (const row of data.rows) {
    const [breweryId, title, extract] = row ?? []
    if (!Number.isInteger(breweryId) || !breweryIds.has(breweryId)) {
      problems.push(`蔵元マスタに無いID: ${String(breweryId)}`)
      continue
    }
    const entry = byId.get(breweryId)
    if (!entry) {
      problems.push(`確定した表に無い蔵元が入っている: ${String(breweryId)}(${String(title)})`)
      continue
    }
    // **人が確かめたのはこの記事名。** 別の記事に差し替わっていたら止める
    if (title !== entry.title) {
      problems.push(`${entry.brewery}: 確定した記事名 ${entry.title} と違う(${String(title)})`)
    }
    if (typeof extract !== 'string' || extract.trim() === '') {
      problems.push(`${entry.brewery}: 書き出しが空`)
    }
    seen.add(breweryId)
  }

  // ここが本題。**減っていたら落ちる**
  for (const entry of confirmed) {
    if (seen.has(entry.breweryId)) continue
    problems.push(
      `${entry.brewery}(${entry.title}) の説明が取れていない — 記事名が動いた可能性。追い直して表を直す`,
    )
  }
  return problems
}

// --- 検査そのものの自己検査 ------------------------------------------------
//
// 期待値を実装から組み立てない(同じ誤りが両側に入ると永久に緑になる)。
// **手で書いた合成の入力**を食わせて、通る/落ちるを1件ずつ固定する。

const IDS = new Set([1, 2])
const CONFIRMED = [
  { breweryId: 1, brewery: '架空酒造', prefecture: '架空県', title: '架空酒造' },
  { breweryId: 2, brewery: '仮想酒造', prefecture: '架空県', title: '仮想酒造 (企業)' },
]
const GOOD = {
  copyright: 'ウィキペディア日本語版 / CC BY-SA 4.0',
  rows: [
    [1, '架空酒造', '架空県にある酒蔵。'],
    [2, '仮想酒造 (企業)', '架空県にある酒造会社。'],
  ],
}
const clone = (value) => JSON.parse(JSON.stringify(value))

const selfTests = [
  ['確定した行が全部そろっていれば通る', () => inspect(CONFIRMED, GOOD, IDS).length === 0],
  ['表もデータも無ければ通る(既定の状態)', () => inspect([], null, IDS).length === 0],
  [
    // ここが本題。記事名が動いて取得が1行落としたときに気付けること
    '1行足りなければ落ちる(記事名が動いて静かに消えるのを止める)',
    () => {
      const short = clone(GOOD)
      short.rows.pop()
      return inspect(CONFIRMED, short, IDS).some((p) => p.includes('仮想酒造'))
    },
  ],
  [
    '確定した記事名と違う記事が入っていたら落ちる',
    () => {
      const swapped = clone(GOOD)
      swapped.rows[0][1] = '獺祭魚'
      return inspect(CONFIRMED, swapped, IDS).some((p) => p.includes('確定した記事名'))
    },
  ],
  [
    '確定した表に無い蔵元が混ざっていたら落ちる',
    () => inspect(CONFIRMED, { ...GOOD, rows: [...GOOD.rows, [2, '別', '別']] }, IDS).length > 0,
  ],
  [
    '蔵元マスタに無いIDは落ちる',
    () => inspect(CONFIRMED, GOOD, new Set([1])).some((p) => p.includes('蔵元マスタに無いID')),
  ],
  [
    '書き出しが空なら落ちる(見出しだけの節を作らない)',
    () => {
      const empty = clone(GOOD)
      empty.rows[0][2] = '  '
      return inspect(CONFIRMED, empty, IDS).some((p) => p.includes('書き出しが空'))
    },
  ],
  [
    'クレジットの無いデータは落ちる(ファイル単位で再配布されうる)',
    () => inspect(CONFIRMED, { ...GOOD, copyright: '' }, IDS).some((p) => p.includes('CC BY-SA')),
  ],
  [
    '表を消したのにデータが残っていたら落ちる(出所の無いテキストを配らない)',
    () => inspect([], GOOD, IDS).length > 0,
  ],
  ['確定しているのにデータが無ければ落ちる', () => inspect(CONFIRMED, null, IDS).length > 0],
]

const selfFailures = selfTests.filter(([, run]) => !run()).map(([name]) => name)
if (selfFailures.length > 0) {
  console.error(`✗ 蔵元の説明の検査そのものが壊れている (${String(selfFailures.length)}件):`)
  for (const name of selfFailures) console.error(`  - ${name}`)
  process.exit(1)
}

// --- 本番の検査 -------------------------------------------------------------

const breweryIds = new Set(JSON.parse(readFileSync(BREWERIES, 'utf8')).rows.map(([id]) => id))
const data = existsSync(DATA) ? JSON.parse(readFileSync(DATA, 'utf8')) : null
const problems = inspect(BREWERY_ARTICLES, data, breweryIds)

if (problems.length > 0) {
  console.error('✗ 蔵元の説明(B78)の検査に失敗した:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(
  BREWERY_ARTICLES.length === 0
    ? '✓ 蔵元の説明: 確定した行が0件(節は出ない)。表を作るには fetch:brewery-notes -- --review'
    : `✓ 蔵元の説明: 確定 ${String(BREWERY_ARTICLES.length)}行がすべて同梱されている`,
)
console.log(`    自己検査: ${String(selfTests.length)}件(表が空のあいだも判定が生きている)`)
