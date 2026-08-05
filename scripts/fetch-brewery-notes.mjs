#!/usr/bin/env node
/**
 * 蔵元の説明(ja.wikipedia の書き出し)を取り出す(B78)。
 *
 *   npm run fetch:brewery-notes -- --review   候補を並べる → data/brewery-article-candidates.tsv
 *   npm run fetch:brewery-notes               確定した表を取りに行く → public/data/wikipedia/breweries.json
 *
 * ## 2段に割る理由
 *
 * **名前から自動で引くと誤配する**(実測: `獺祭` → 記事「獺祭魚」= カワウソが魚を並べる習性 /
 * `月桂冠` → 月桂樹の冠 / `菊姫` → 武家の女性名 / `小林酒造` → 4県すべてを列挙する曖昧さ回避
 * なので**県一致でも弾けない**)。だから `--review` は**候補を並べるところで止まり**、
 * 採否は人が記事を読んで `src/data/brewery-articles.ts` に写す。本取得はその表しか見ない。
 *
 * ## それでも機械にできる分は機械にやらせる
 *
 * 上の誤配のうち**カテゴリで落ちるものが大半**(`獺祭魚` は故事成語、`月桂冠`(植物)は
 * 古代ギリシア、`菊姫`(人名)は戦国時代の女性のカテゴリ)。落ちないのは**同名の別の蔵**だけで、
 * `小林酒造` は北海道・栃木・福岡に実在し**3つとも酒造のカテゴリを持つ**(しかも曖昧さ回避の
 * ページが4県を列挙するので県一致でも切れない)。
 *
 * そこで人に残す仕事を**「74行を転記する」から「◎ の行を眺めておかしいものを消す」**に変えた。
 * `◎`(カテゴリが蔵 + 県が本文に出る)の行は `data/brewery-articles-ready.txt` に
 * **そのまま貼れる形**で書き出す。
 *
 * ## 書き出しを一字も変えない
 *
 * CC BY-SA 4.0 の継承(§3(b))は "if You Share Adapted Material" なので**無改変の抜粋には
 * 及ばない**。要約・言い換えをした時点で及ぶので、API が返した `exintro` の文をそのまま使い、
 * 長すぎるときは**文の切れ目で後ろを落とすだけ**にする(語を書き換えない)。
 *
 * ## さけのわと同じくビルド時に取る
 *
 * 実行時 fetch にしない。オフラインでも出せる必要があるうえ、1回の表示ごとに ja.wikipedia を
 * 叩くのは相手に対しても筋が悪い。取った JSON はコミットする(`fetch:sakenowa` と同じ作法)。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { BREWERY_ARTICLES } from '../src/data/brewery-articles.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BREWERIES = resolve(root, 'public/data/sakenowa/breweries.json')
const AREAS = resolve(root, 'public/data/sakenowa/areas.json')
const BRANDS = resolve(root, 'public/data/sakenowa/brands.json')
const SEED = resolve(root, 'data/seed/sake-log-rows.json')
const OUT_DIR = resolve(root, 'public/data/wikipedia')
const OUT = resolve(OUT_DIR, 'brewery-articles.json')
const REVIEW_OUT = resolve(root, 'data/brewery-article-candidates.tsv')
/** `◎` の行だけを `src/data/brewery-articles.ts` にそのまま貼れる形で書き出す先 */
const READY_OUT = resolve(root, 'data/brewery-articles-ready.txt')

const API = 'https://ja.wikipedia.org/w/api.php'

/**
 * 名乗り。**必ず付ける** — Wikimedia の API 利用方針が求めているうえ、
 * 落とされたときに相手側から連絡が付く形にしておく。
 */
const USER_AGENT = 'sake-record-build/1.0 (https://github.com/one-shine/sake-record)'

/** 1件の書き出しの上限(文字)。**文の切れ目でしか切らない**ので目安 */
const MAX_EXTRACT_CHARS = 400

/** API を叩く間隔(ms)。相手に負荷をかけない */
const THROTTLE_MS = 200

const args = process.argv.slice(2)
const reviewMode = args.includes('--review')
const explicit = args.find((a) => a.startsWith('--breweries='))

const areas = JSON.parse(readFileSync(AREAS, 'utf8')).rows
const breweries = JSON.parse(readFileSync(BREWERIES, 'utf8')).rows
const breweryById = new Map(breweries.map(([id, name, areaId]) => [id, { id, name, areaId }]))
const prefectureOf = (brewery) =>
  brewery === undefined || brewery.areaId === 0 ? '' : (areas[brewery.areaId] ?? '')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(params) {
  const url = `${API}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2' }).toString()}`
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!response.ok) throw new Error(`${url} → HTTP ${String(response.status)}`)
  return response.json()
}

/**
 * 記事1本を引く。**曖昧さ回避のページは中身を返さない**(`pageprops.disambiguation`)。
 * 見つからない / 曖昧さ回避 / 中身が空 のときは `null`。
 *
 * **カテゴリも取る。** 「その記事が酒蔵の記事か」は本文の言い回しより**カテゴリのほうが
 * はっきり分かる**(`獺祭魚` は故事成語、`月桂冠`(植物)は古代ギリシア、`菊姫`(人名)は
 * 戦国時代の女性のカテゴリに入る)。これで人が見る行を大幅に減らせる。
 */
async function fetchArticle(title) {
  const data = await api({
    action: 'query',
    titles: title,
    prop: 'extracts|pageprops|categories',
    exintro: '1',
    explaintext: '1',
    redirects: '1',
    cllimit: 'max',
    clshow: '!hidden',
  })
  const page = data?.query?.pages?.[0]
  if (!page || page.missing) return null
  const categories = Array.isArray(page.categories)
    ? page.categories.map((c) => String(c.title).replace(/^Category:/u, ''))
    : []
  if (page.pageprops && 'disambiguation' in page.pageprops) {
    return { resolved: page.title, extract: '', categories, reason: '曖昧さ回避' }
  }
  const extract = typeof page.extract === 'string' ? page.extract.trim() : ''
  if (extract === '') {
    return { resolved: page.title, extract: '', categories, reason: '書き出しが空' }
  }
  return { resolved: page.title, extract, categories, reason: '' }
}

/**
 * カテゴリ名に出る語で「酒を造る会社の記事か」を見る。**カテゴリ名そのものを列挙しない** —
 * ウィキペディアのカテゴリ体系は改名も再編もされるので、完全一致で持つと静かに空振りする。
 * 語で見れば `日本酒の酒蔵` / `秋田県の企業` / `日本の酒類メーカー` のどれでも拾える。
 */
const BREWERY_CATEGORY_WORDS = ['酒造', '酒蔵', '醸造', '酒類', '日本酒', '酒メーカー']

const looksLikeBrewery = (categories) =>
  categories.some((name) => BREWERY_CATEGORY_WORDS.some((word) => name.includes(word)))

/**
 * 長い書き出しを縮める。**文の切れ目でしか切らない**(語を書き換えると Adapted Material になる)。
 * 1文目だけで上限を超えるときは**そのまま返す** — 途中で切ると文が壊れる。
 */
function trimToSentences(text, max) {
  if (text.length <= max) return text
  const sentences = text.split(/(?<=。)/u)
  let out = ''
  for (const sentence of sentences) {
    if (out !== '' && out.length + sentence.length > max) break
    out += sentence
  }
  return out === '' ? text : out
}

// ---------------------------------------------------------------------------
// --review: 候補を並べる(採否は人が決める)
// ---------------------------------------------------------------------------

/**
 * 見に行く蔵元を決める。**1,749蔵には広げない** — 目で確かめられない量になり、
 * 同梱データの枠(gzip 200KB)の半分を確認できない誤配で埋めることになる。
 *
 * 既定は**手元の台帳に出てくる蔵元**(`data/seed/`。gitignore なのでこの環境にしか無い)。
 * 無ければ `--breweries=1,2,3` で明示する。**どちらも無ければ止まる**(全件に落ちない)。
 */
function reviewTargets() {
  if (explicit) {
    const ids = explicit
      .slice('--breweries='.length)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
    if (ids.length === 0) throw new Error('--breweries= に蔵元IDが1つも入っていない')
    return ids
  }

  let rows
  try {
    rows = JSON.parse(readFileSync(SEED, 'utf8'))
  } catch {
    throw new Error(
      `${SEED} が無い。手元の台帳から蔵元を割り出せないので、` +
        '`--breweries=<id,id,...>` で明示する(全件には広げない)。',
    )
  }
  const brands = JSON.parse(readFileSync(BRANDS, 'utf8')).rows
  const breweryOfBrand = new Map(brands.map(([id, , breweryId]) => [id, breweryId]))
  const ids = new Set()
  for (const row of rows) {
    const brandId = row?.sakenowaBrandId
    if (!Number.isInteger(brandId)) continue
    const breweryId = breweryOfBrand.get(brandId)
    if (breweryId !== undefined) ids.add(breweryId)
  }
  if (ids.size === 0) throw new Error('台帳から紐付いた蔵元が1件も出なかった')
  return [...ids].sort((a, b) => a - b)
}

async function review() {
  const targets = reviewTargets()
  console.log(`候補を調べる: ${String(targets.length)}蔵`)

  const lines = [
    'breweryId\t蔵元名\t都道府県\t候補記事名\t判定\t書き出し(先頭120字)\tカテゴリ',
  ]
  /** `◎` の行だけを、そのまま貼れる形で組んでおく(人の仕事を「転記」から「削除」に変える) */
  const ready = []
  let hits = 0
  for (const [i, id] of targets.entries()) {
    const brewery = breweryById.get(id)
    if (!brewery) {
      lines.push(`${String(id)}\t(蔵元マスタに無い)\t\t\t対象外\t`)
      continue
    }
    const prefecture = prefectureOf(brewery)
    let found
    try {
      found = await fetchArticle(brewery.name)
    } catch (cause) {
      lines.push(`${String(id)}\t${brewery.name}\t${prefecture}\t\t取得失敗: ${String(cause)}\t`)
      continue
    }
    await sleep(THROTTLE_MS)

    if (found === null) {
      lines.push(`${String(id)}\t${brewery.name}\t${prefecture}\t\t× 記事なし\t`)
      continue
    }

    // **判定は3段。** カテゴリで「酒を造る会社の記事か」が大半決まり、県一致で
    // 「同名の別の蔵」の疑いが減る。**◎ でも人が消せる形で出す** — カテゴリで落ちないのが
    // 同名の別の蔵(`小林酒造` は北海道・栃木・福岡に実在し、3つとも酒造のカテゴリを持つ)
    const verdict =
      found.reason !== ''
        ? `× ${found.reason}`
        : !looksLikeBrewery(found.categories)
          ? '× 蔵の記事ではない'
          : prefecture !== '' && !found.extract.includes(prefecture)
            ? '○ 蔵だが県が出てこない'
            : '◎ 蔵で県も一致'
    if (verdict.startsWith('◎')) {
      hits += 1
      ready.push(
        `  { breweryId: ${String(id)}, brewery: '${brewery.name}', ` +
          `prefecture: '${prefecture}', title: '${found.resolved}' },`,
      )
    }
    const head = found.extract.replace(/\s+/gu, ' ').slice(0, 120)
    lines.push(
      `${String(id)}\t${brewery.name}\t${prefecture}\t${found.resolved}\t${verdict}\t${head}\t${found.categories.join(' / ')}`,
    )
    if ((i + 1) % 20 === 0) console.log(`  ${String(i + 1)}/${String(targets.length)}`)
  }

  mkdirSync(dirname(REVIEW_OUT), { recursive: true })
  writeFileSync(REVIEW_OUT, `${lines.join('\n')}\n`)
  writeFileSync(READY_OUT, `${ready.join('\n')}\n`)
  console.log(`\n${REVIEW_OUT}      … 全 ${String(targets.length)}蔵の判定`)
  console.log(`${READY_OUT}  … ◎ の ${String(hits)}行(そのまま貼れる形)`)
  console.log('')
  console.log('  次にやること:')
  console.log(`    1. ${REVIEW_OUT} を開き、◎ の行の「書き出し」を眺める`)
  console.log('       - 別の蔵の説明になっていないか(同名の蔵は実在する)')
  console.log('       - 県の言い換えだけで終わっていないか(だけなら採らないほうがよい)')
  console.log(`    2. ${READY_OUT} の中身を src/data/brewery-articles.ts の配列に貼り、`)
  console.log('       1 で外した行を消す')
  console.log('    3. npm run fetch:brewery-notes → npm run wikipedia:check')
  console.log('')
  console.log('  ○(蔵だが県が出てこない)は自動では採らない。拾いたいものがあれば手で足す。')
}

// ---------------------------------------------------------------------------
// 本取得: 確定した表だけを見る
// ---------------------------------------------------------------------------

async function build() {
  if (BREWERY_ARTICLES.length === 0) {
    console.log('src/data/brewery-articles.ts が空。まず `--review` を回して表を確定する。')
    console.log('(空のまま出荷してよい — 蔵元の説明の節が出ないだけ)')
    return
  }

  const rows = []
  const missing = []
  for (const entry of BREWERY_ARTICLES) {
    const found = await fetchArticle(entry.title)
    await sleep(THROTTLE_MS)
    if (found === null || found.extract === '') {
      missing.push(`${entry.brewery}(${entry.title}) — ${found?.reason ?? '記事なし'}`)
      continue
    }
    // **記事名が動いたら黙って別の記事を採らない。** 確定したのはこの名前で、
    // リダイレクト先が変わっていれば人が確かめ直す必要がある
    if (found.resolved !== entry.title) {
      missing.push(`${entry.brewery}(${entry.title}) — 記事名が ${found.resolved} に動いている`)
      continue
    }
    rows.push([entry.breweryId, entry.title, trimToSentences(found.extract, MAX_EXTRACT_CHARS)])
  }

  const payload = {
    // **同梱データ自身にもクレジットを持たせる。** ファイル単位で再配布されうるので、
    // バンドルのクレジット(画面)とは別に検査する(さけのわの各ファイルと同じ作法)
    copyright:
      'テキストはウィキペディア日本語版の各記事より。' +
      'CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)。' +
      '記事名から https://ja.wikipedia.org/wiki/<記事名> で原文と執筆者の履歴を辿れる。',
    rows: rows.sort((a, b) => a[0] - b[0]),
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const json = `${JSON.stringify(payload)}\n`
  writeFileSync(OUT, json)

  const raw = Buffer.byteLength(json)
  const gzip = gzipSync(json).length
  console.log(`${OUT}`)
  console.log(
    `  ${String(rows.length)}/${String(BREWERY_ARTICLES.length)}蔵` +
      ` raw ${(raw / 1024).toFixed(1)}KB / gzip ${(gzip / 1024).toFixed(1)}KB`,
  )
  if (missing.length > 0) {
    console.log(`\n取れなかった ${String(missing.length)}件:`)
    for (const line of missing) console.log(`  - ${line}`)
    console.log('  → 記事名を追い直して src/data/brewery-articles.ts を直す')
  }
}

try {
  await (reviewMode ? review() : build())
} catch (cause) {
  console.error(`✗ ${cause instanceof Error ? cause.message : String(cause)}`)
  process.exit(1)
}
