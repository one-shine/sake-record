#!/usr/bin/env node
/**
 * **ビルド成果物に、知らない宛先が入っていないことを検査する**(受け入れ基準 A30)。
 *
 *   npm run endpoints:check
 *
 * SPEC は「記録が出て行く先は**本人が用意した同期先だけ**」と約束している。この約束は
 * 文書に書いただけでは守られない — 依存を1つ足したときに解析用のエンドポイントが紛れ込んでも、
 * 画面には何も出ないし、テストも全部緑のままになる。
 *
 * そこで `dist` の中の URL のホスト名を全部拾い、**理由を書いた表に載っていないものがあれば落とす**。
 * 増やすときは表に1行足すことになるので、そのとき「なぜこの宛先が要るのか」を必ず言葉にする。
 *
 * **これは「通信しない」ことの証明ではない**(文字列があること = 呼ばれること、ではない)。
 * 証明できるのは「知らない宛先が増えていない」ことだけで、それがこの検査の役目。
 * 実際に呼ばれる経路の検査は別にある(OCR の同梱物は `ocr:check`、クレジットは `attribution:check`)。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, process.argv[2] ?? 'dist')

/**
 * 通ってよいホストと、その理由。**理由の無い行を作らない。**
 *
 * `null` の理由は「表示するだけで通信しない」の意味では使わない — どれも1行で書く。
 */
const ALLOWED = new Map([
  ['www.w3.org', 'SVG / XML の名前空間。URL の形をしているが取りに行かない'],
  ['github.com', '産地マップ(@svg-maps/japan)の出所リンク。CC-BY の表示義務'],
  ['creativecommons.org', 'ライセンス本文へのリンク。CC-BY / CC-BY-SA の表示義務'],
  ['sakenowa.com', 'さけのわのクレジット。利用条件でリンクが必須'],
  ['muro.sakenowa.com', 'さけのわデータの出所。**取得はビルド時**(CORS が無いので実行時 fetch は不可能)'],
  ['www.edrdg.org', 'KANJIDIC(銘柄の読み)の出所。CC-BY-SA の表示義務'],
  ['www.nta.go.jp', '「知る」の特定名称の出典(国税庁の告示)'],
  [
    'cdn.jsdelivr.net',
    'tesseract.js に同梱された既定値の文字列。**この経路は使わない** — ' +
      '`ocr:check` が「src 側が corePath / workerPath / langPath を明示で渡している」ことを検査している',
  ],
  ['react.dev', 'React が例外メッセージに埋める案内の URL'],
  ['rolldown.rs', 'ビルドツールが埋める案内の URL'],
  ['tailwindcss.com', 'CSS に残るツールの案内の URL'],
  ['opencollective.com', '同梱した第三者コードの寄付案内(tesseract の worker)'],
  ['localhost:3000', '第三者コードに残る開発時の既定値'],
])

/** 同期先。`src/config/app.ts` の `SYNC_URL` と一致することまで見る(打ち間違いを通さない) */
const SYNC_URL_RE = /export const SYNC_URL = '([^']*)'/
const configText = readFileSync(resolve(root, 'src/config/app.ts'), 'utf8')
const syncMatch = SYNC_URL_RE.exec(configText)
if (!syncMatch) {
  console.error('✗ src/config/app.ts から SYNC_URL を読めない。同期先の出所が壊れている。')
  process.exit(1)
}
const syncUrl = syncMatch[1]
const syncHost = syncUrl === '' ? null : new URL(syncUrl).host
if (syncHost) {
  ALLOWED.set(syncHost, '本人が用意した同期先(src/config/app.ts の SYNC_URL と一致)')
}

const SCAN_EXT = ['.js', '.css', '.html', '.json', '.webmanifest', '.svg']
const URL_RE = /https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/g

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

let files
try {
  files = walk(dist)
} catch {
  console.error(`✗ ${dist} が無い。先に \`npm run build\` する。`)
  process.exit(1)
}

/** ホスト → それが出てきたファイル */
const found = new Map()
for (const abs of files) {
  if (!SCAN_EXT.some((ext) => abs.endsWith(ext))) continue
  const text = readFileSync(abs, 'utf8')
  for (const raw of text.matchAll(URL_RE)) {
    let host
    try {
      host = new URL(raw[0]).host
    } catch {
      continue
    }
    if (!found.has(host)) found.set(host, new Set())
    found.get(host).add(abs.slice(dist.length + 1))
  }
}

const unknown = [...found.keys()].filter((host) => !ALLOWED.has(host)).sort()

if (unknown.length > 0) {
  console.error(`✗ ビルド成果物に知らない宛先がある (${unknown.length}件):`)
  for (const host of unknown) {
    console.error(`  ${host}`)
    for (const file of [...found.get(host)].slice(0, 4)) console.error(`    ${file}`)
  }
  console.error(
    '\n  SPEC は「記録が出て行く先は本人が用意した同期先だけ」と約束している(A30)。',
  )
  console.error('  意図して足したなら scripts/check-endpoints.mjs の ALLOWED に**理由ごと**書く。')
  process.exit(1)
}

// 同期先を設定したのに成果物へ届いていない = `SYNC_URL` を使っていない配線になっている
if (syncHost && !found.has(syncHost)) {
  console.error(`✗ 同期先 ${syncHost} が成果物のどこにも出てこない。`)
  console.error('  SYNC_URL を書いたのに配線から外れていると、同期は黙って何もしない。')
  process.exit(1)
}

console.log(`✓ 宛先 OK: ${found.size}ホストすべてが理由付きで登録済み`)
console.log(`    同期先: ${syncHost ?? '(未設定)'}`)
for (const host of [...found.keys()].sort()) {
  console.log(`    ${host} — ${ALLOWED.get(host)}`)
}
