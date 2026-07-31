#!/usr/bin/env node
/**
 * 銘柄名に出る漢字の**読み**を1字ずつ書き出す(B68)。
 *
 *   npm run fetch:readings   → public/data/kanji/readings.json
 *
 * ## なぜ要るのか
 *
 * ラベルの銘柄名は筆文字・草書で刷られていることが多く、**字形からは OCR で読めない**
 * (2026-07-31 に engine を2種で実測して確定 = B67)。一方で**読みは別の形で写真に写っている**:
 * 宮泉のふりがな `みやいずみ` は現行の tesseract が正確に読めていて、照合できるデータが
 * 無いという理由だけで捨てていた。打って探す経路も同じ穴で塞がっている(`きど` で `紀土` に
 * 届かない)。**1つのデータで OCR と手打ちの両方が同時に伸びる**のがこの表の値打ち。
 *
 * ## なぜ「銘柄ごとの読み」ではなく「漢字1字ごとの読み」を持つのか
 *
 * 銘柄ごとに読みを展開すると **3264銘柄で 409,875通り**になる(実測)。字ごとの読みは
 * 音+訓+名乗りを畳んでも **1231字 / raw 49.1KB / gzip 15.9KB** に収まる。照合は「与えられたかなを
 * 銘柄名の読みに分解できるか」を DP で判定する向き(`src/domain/reading.ts`)だけを使い、
 * **展開はしない**。
 *
 * ## 出所とライセンス
 *
 * `kanji` パッケージ(MPL-2.0)が同梱する KANJIDIC(電子辞書研究開発グループ / CC-BY-SA 4.0)。
 * **devDependency にしか置かない** — 実行時の依存を増やさず、ビルド時に絞った表だけを配る。
 * クレジットは「知る」の出典タブに出し、`attribution:check` が成果物を検査する。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { readings as kanjiReadings } from 'kanji'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BRANDS = resolve(root, 'public/data/sakenowa/brands.json')
const OUT_DIR = resolve(root, 'public/data/kanji')
const OUT = resolve(OUT_DIR, 'readings.json')

const HAN = /\p{Script=Han}/u

/** ひらがな → カタカナ。音はカタカナ・訓と名乗りはひらがなで来るので片方に揃える */
const toKatakana = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))

/**
 * KANJIDIC の表記を照合用に均す。
 * `うつ.す`(送り仮名の区切り)・`さか-`(接頭辞の印)の記号は読みそのものではない。
 * **送り仮名まで含めた形は落とす** — `たのしい` は `楽` の読みではなく活用形で、
 * 銘柄名の中では現れない(`萬歳楽` は `ラク`)。
 */
function normalizeReading(raw) {
  const cut = raw.indexOf('.')
  const stem = cut < 0 ? raw : raw.slice(0, cut)
  return toKatakana(stem.replace(/-/g, ''))
}

const brands = JSON.parse(readFileSync(BRANDS, 'utf8')).rows

const chars = new Set()
for (const [, name] of brands) for (const c of name) if (HAN.test(c)) chars.add(c)

const table = {}
const missing = []
for (const c of [...chars].sort()) {
  // 収録外の字は throw ではなく null で返る(JIS X 0213 の外字など)。両方を同じ枝で落とす
  let entry = null
  try {
    entry = kanjiReadings(c)
  } catch {
    /* 収録外 */
  }
  if (entry === null) {
    missing.push(c)
    continue
  }
  const set = new Set(
    [...entry.on, ...entry.kun, ...entry.nanori].map(normalizeReading).filter((s) => s !== ''),
  )
  if (set.size === 0) {
    missing.push(c)
    continue
  }
  // 読みはカンマ区切りの1文字列にする(1字あたり配列を持つと JSON が 1.6倍になる)
  table[c] = [...set].sort().join(',')
}

const json = JSON.stringify({ copyright: 'KANJIDIC', chars: table }) + '\n'
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, json)

// **文字数ではなくバイト数で出す。** カタカナは UTF-8 で3バイトあるので、
// `json.length` を KB と呼ぶと同梱サイズを 1/2 に見誤る(`data:check` の数字と食い違う)
const bytes = Buffer.byteLength(json)
const kb = (n) => (n / 1024).toFixed(1) + 'KB'
console.log(`✓ ${OUT.replace(root + '/', '')}`)
console.log(
  `  銘柄名に出る漢字 ${chars.size}字 / 読みを書けた ${Object.keys(table).length}字 / 書けない ${missing.length}字` +
    (missing.length > 0 ? ` (${missing.join('')})` : ''),
)
console.log(`  raw ${kb(bytes)} / gzip ${kb(gzipSync(json, { level: 9 }).length)}`)
