#!/usr/bin/env node
/**
 * スクリーンショット用の**合成データ**(デモ用バックアップ JSON)を作る。BACKLOG B24 / B33。
 *
 *   node scripts/make-demo-backup.mjs        # docs/evidence/demo-backup.json を書き出す
 *   node scripts/make-demo-backup.mjs --check # 書かずに既存ファイルと一致するかだけ見る
 *
 * ## なぜ必要か(B24)
 *
 * 一覧・詳細・統計・産地の画面には **(日付, 銘柄, 都道府県) が同じ行に写る**。これは B18 で
 * 「射影から復元できた」と問題にした**飲酒台帳の結合キーそのもの**で、PNG は画素なので
 * `npm run ledger:check`(テキスト検査)の射程外 = 混入しても CI は緑になる。
 * そのため実データのスクショは追跡できず、Phase 3〜6 の完了条件「390px / 1280px のスクショ」が
 * すべて未達のまま積んでいた(B33)。
 *
 * ## 決めた分担
 *
 *   - **数値の観測は実データ**(203本 / 年別 / 県別 / 分母185→190)で行い、DOM の実測値と
 *     `docs/phases/PHASE_*.md` の本文で証拠にする。スクショにはしない。
 *   - **スクショは合成データ**で撮り `docs/evidence/` に追跡する。
 *
 * 合成データで**出ない**もの(限界。埋めずに明示する):
 *   - 203行の一覧をスクロールしたときの体裁(この生成物は 27件)
 *   - 34区分198本の県別一覧の高さ、47県の一覧の折り返し
 *   - 延べ314本のスタイル分布で棒が潰れる/軸ラベルが重なる現象
 *   これらは合成データの件数では再現しないので、**実データでの DOM 実測でしか確認できない**。
 *
 * ## なぜ「アプリに埋める `?demo=1`」にしなかったか
 *
 * (a) **本番バンドルに1バイトも入らない**。`?demo=1` やシード投入関数を `src/` に置くと、
 *     tree-shaking が効いたかどうかに証拠の安全性が依存する(効かなければ公開サイトに
 *     デモ投入の導線が載る)。この経路なら判断は「スクリプトを実行するかどうか」だけになる。
 * (b) **実データを上書きしない保証を新しく作らなくてよい**。生成物はこのアプリの
 *     バックアップ JSON そのもので、取り込みは既存の「読んだ内容を見せる → 取り込む」の2段
 *     (`ImportExportPanel`)を必ず通る。デモ投入だけが確認を飛ばす裏口を作らない。
 * (c) 撮影手順が**アプリの本番経路をそのまま通る**(A11 のインポートを毎回1回踏むことになる)。
 *
 * ## 合成データが満たす不変条件(`npm run ledger:check` が CI で強制する)
 *
 *   1. `drankOn` は**台帳の日付集合と交わらない**(台帳は 2020..2026。ここは 2017..2019)
 *   2. 銘柄表記 / 銘柄名は**台帳の銘柄集合(94種)と1つも一致しない**
 *
 * 都道府県だけは実在の県名を使う(産地の塗り分けが要る)。県名は `linkBrand.cases.json` で
 * 公開済みの列で、**日付と同居しなければ結合キーにならない** — 1 により同居し得ない。
 *
 * 銘柄名はさけのわの銘柄マスタ(`public/data/sakenowa/brands.json` = 公開データ)から採る。
 * 完全な架空名にすると `sakenowaBrandId` が引けず、味タブのレーダー/散布図と詳細の6軸が
 * 空になって**その画面のスクショが証拠にならない**ため。「架空の銘柄」ではなく
 * 「**実在するが本人が飲んでいない銘柄 × 架空の日付・場所・備考**」で作る。
 *
 * 出力は**決定的**(取得時刻を持たない)。何度実行してもバイト一致する
 * = `scripts/fetch-sakenowa.mjs` と同じ約束で、差分レビューが効く。
 */
import { deflateSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = 'docs/evidence/demo-backup.json'

const read = (rel) => JSON.parse(readFileSync(resolve(root, rel), 'utf8'))

// ---------------------------------------------------------------------------
// デモの内容(ここだけが手書き。ほかは全部この表から導く)
// ---------------------------------------------------------------------------

/**
 * 台帳の年(2020..2026)と重ならない年だけを使う。**未来日にしない** —
 * 未来の日付が並んだスクショは「壊れている画面」に見えて証拠として読めない。
 */
const DEMO_YEARS = ['2017', '2018', '2019']

/**
 * 1行 = 1記録。`brand` はさけのわの銘柄名(存在チェックあり)。
 * `label` を書いた行は「記録の表記 ≠ 銘柄名」で、一覧に `記録の表記:` の行が出る。
 *
 * 5つの `linkStatus` を全部出す(バッジ5値・絞り込みピル5値がスクショに写る)。
 * `place` は全行に「デモ」を入れる — **スクショだけを見た人が合成データだと分かる**ようにする。
 */
const ROWS = [
  // --- auto: 銘柄名の一致で機械が紐付けた(大半はこれ) ---
  { date: '2017-03-11', brand: '国士無双', spec: '特別純米', rating: 3, place: 'デモ酒場 一号店', note: '' },
  { date: '2019-12-21', brand: '南部美人', spec: '純米大吟醸', rating: 5, place: 'デモ酒販 本店', note: 'デモ用の備考。長い行の折り返しを確かめるために、意味のない文をここに入れている。実際の記録は1件も含まれない。' },
  { date: '2019-12-28', brand: '雪の茅舎', spec: '純米吟醸', rating: 4, place: 'デモ酒場 一号店', note: '', thumb: 'a' },
  { date: '2017-09-16', brand: '楯野川', spec: '純米大吟醸 無濾過', rating: 4, place: '自宅(デモ)', note: '' },
  { date: '2017-11-23', brand: '大七', spec: '本醸造', rating: 2, place: 'デモ立ち飲み 二番', note: '' },
  { date: '2018-01-06', brand: '上善如水', spec: '純米 しぼりたて', rating: 3, place: 'デモ酒場 一号店', note: '' },
  { date: '2018-02-17', brand: '明鏡止水', spec: '純米吟醸 生原酒', rating: 5, place: 'デモ角打ち', note: '' },
  { date: '2018-04-07', brand: '遊穂', spec: '純米 無濾過生原酒', rating: 4, place: 'デモ酒販 本店', note: '' },
  { date: '2018-05-26', brand: '羽根屋', spec: '純米吟醸 しぼりたて', rating: 5, place: '自宅(デモ)', note: '' },
  { date: '2018-07-14', brand: '磯自慢', spec: '大吟醸', rating: 5, place: 'デモ酒場 二号店', note: '' },
  { date: '2018-08-25', brand: '半蔵', spec: '純米大吟醸', rating: 4, place: 'デモ酒場 一号店', note: '' },
  { date: '2018-10-13', brand: '富翁', spec: '純米 原酒', rating: 3, place: 'デモ角打ち', note: '' },
  { date: '2018-11-03', brand: '百楽門', spec: '純米吟醸 ひやおろし', rating: 4, place: 'デモ酒販 本店', note: '' },
  { date: '2018-12-29', brand: '雑賀', spec: '純米吟醸 にごり', rating: 3, place: '自宅(デモ)', note: '' },
  { date: '2019-01-19', brand: '天寶一', spec: '純米吟醸', rating: 4, place: 'デモ酒場 二号店', note: '' },
  { date: '2019-03-02', brand: '五橋', spec: '純米', rating: 3, place: 'デモ立ち飲み 二番', note: '' },
  { date: '2019-12-07', brand: '七田', spec: '純米 無濾過生原酒', rating: 5, place: 'デモ酒場 一号店', note: '', thumb: 'b' },
  { date: '2019-06-08', brand: '出雲富士', spec: '純米吟醸 原酒', rating: 4, place: 'デモ酒販 本店', note: '' },
  { date: '2019-07-27', brand: '笑四季', spec: '純米大吟醸 生', rating: 5, place: 'デモ角打ち', note: '' },
  // --- alias: 別名表で紐付けた(記録の表記とさけのわの銘柄名が違う) ---
  { date: '2019-11-30', brand: '日高見', label: '日高見(平孝酒造)', status: 'alias', spec: '純米吟醸', rating: 4, place: 'デモ酒場 二号店', note: '' },
  { date: '2019-09-07', brand: 'ほまれ麒麟', label: 'ほまれきりん', status: 'alias', spec: '純米大吟醸', rating: 4, place: 'デモ酒販 本店', note: '' },
  // --- manual: 本人が手動で紐付けた(この2件はエイリアスにも載せる) ---
  { date: '2019-11-16', brand: '文佳人', label: 'ぶんかじん', status: 'manual', spec: '純米吟醸 ひやおろし', rating: 5, place: 'デモ酒場 一号店', note: '' },
  { date: '2019-10-26', brand: '蜻蛉', label: 'とんぼ', status: 'manual', spec: '純米 にごり', rating: 3, place: 'デモ角打ち', note: '' },
  // --- unlinked: さけのわに該当が無い / 候補を絞れない ---
  { date: '2019-08-17', label: 'デモ架空酒 青ラベル', prefecture: '新潟県', status: 'unlinked', spec: '純米吟醸', rating: 3, place: 'デモ立ち飲み 二番', note: 'さけのわに無い銘柄。フレーバーは取れない' },
  { date: '2017-05-20', label: 'デモ架空酒 生酛', prefecture: '', status: 'unlinked', spec: '純米 生原酒', rating: null, place: '自宅(デモ)', note: '' },
  // --- unknown: 記録した時点で銘柄が判読できていない ---
  { date: '2019-10-05', label: '不明', prefecture: '長野県または新潟県', status: 'unknown', spec: '純米', rating: 2, place: 'デモ酒場 一号店', note: '県の表記も1つに定まっていない行' },
  { date: '2017-07-01', label: '不明', prefecture: '', status: 'unknown', spec: '', rating: null, place: 'デモ角打ち', note: '' },
]

/** 手動紐付け(`manual`)の根拠。バックアップの往復で `manual` が維持されることまで含めて撮る */
const ALIAS_ROWS = ROWS.filter((row) => row.status === 'manual')

// ---------------------------------------------------------------------------
// さけのわの公開データ(銘柄 → 蔵 → 県 / フレーバーチャート)
// ---------------------------------------------------------------------------

const areas = read('public/data/sakenowa/areas.json').rows
const breweries = new Map(
  read('public/data/sakenowa/breweries.json').rows.map(([id, name, areaId]) => [id, { name, areaId }]),
)
const brandsByName = new Map()
for (const [id, name, breweryId] of read('public/data/sakenowa/brands.json').rows) {
  const bucket = brandsByName.get(name)
  if (bucket) bucket.push({ id, breweryId })
  else brandsByName.set(name, [{ id, breweryId }])
}
const chartIds = new Set(read('public/data/sakenowa/flavorCharts.json').rows.map((row) => row[0]))

const fail = (message) => {
  console.error(`✗ ${message}`)
  process.exit(1)
}

/** 銘柄名 → { id, prefecture }。**同名が複数ある銘柄は使わない**(どの蔵か決まらない) */
function lookupBrand(name) {
  const bucket = brandsByName.get(name) ?? []
  if (bucket.length === 0) fail(`デモの銘柄「${name}」がさけのわの銘柄マスタに無い(上流で消えた可能性)`)
  if (bucket.length > 1) fail(`デモの銘柄「${name}」は同名が${bucket.length}件ある。一意に決まる銘柄を選ぶ`)
  const brand = bucket[0]
  const brewery = breweries.get(brand.breweryId)
  if (!brewery) fail(`デモの銘柄「${name}」の蔵元を引けない`)
  if (brewery.areaId === 0) fail(`デモの銘柄「${name}」は都道府県に落ちない(areaId 0)`)
  if (!chartIds.has(brand.id)) fail(`デモの銘柄「${name}」にフレーバーチャートが無い。味タブの証拠にならない`)
  return { id: brand.id, prefecture: areas[brewery.areaId] }
}

// ---------------------------------------------------------------------------
// 台帳と交わらないことの検査(生成の時点で落とす。CI 側は ledger:check が同じことを見る)
// ---------------------------------------------------------------------------

const ledgerDates = new Set(read('src/domain/stats.cases.json'))
const ledgerLabels = new Set(read('src/domain/linkBrand.cases.json').map((row) => row.label))

/**
 * 銘柄名ではない表記。**台帳にも同じ値があるが、一致しても何も漏れない**ので例外にする —
 * `不明` は `linkBrand.ts` の `UNKNOWN_KEY` で「記録した時点で銘柄が読めていない」ことを表す札。
 * 「デモに銘柄不明の行がある」という事実は台帳について何も言っていない。
 * ここを例外にしないと `unknown` の行をアプリの実際の慣習どおりに作れない
 * (別の札にすると、スクショに写る値だけが本番と違うものになる)。
 */
const NON_BRAND_LABELS = new Set(['不明'])

// ---------------------------------------------------------------------------
// サムネイル(合成 PNG)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, body) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, crc])
}

/**
 * 写真の代わりの合成画像。**写真付きの行の体裁**(サムネイル + 折り返し)を証拠にするために要る。
 * 長辺400px は `src/lib/image/resize.ts` が作るサムネイルと同じ寸法。斜めの帯にして
 * 「撮った写真ではない」ことが一目で分かるようにする。
 */
function demoPng(width, height, hue) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  let at = 0
  for (let y = 0; y < height; y++) {
    raw[at++] = 0 // filter: None
    for (let x = 0; x < width; x++) {
      const band = (Math.floor((x + y) / 28) + hue) % 3
      const shade = 60 + ((x + y) % 28) * 3
      raw[at++] = band === 0 ? shade : 32
      raw[at++] = band === 1 ? shade : 32
      raw[at++] = band === 2 ? shade : 40
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const THUMBS = {
  a: `data:image/png;base64,${demoPng(300, 400, 0).toString('base64')}`,
  b: `data:image/png;base64,${demoPng(300, 400, 1).toString('base64')}`,
}

// ---------------------------------------------------------------------------
// 組み立て
// ---------------------------------------------------------------------------

const records = ROWS.map((row, index) => {
  const status = row.status ?? 'auto'
  const linked = status === 'auto' || status === 'alias' || status === 'manual'
  const brand = linked ? lookupBrand(row.brand) : null
  const label = row.label ?? row.brand
  const prefecture = row.prefecture ?? brand?.prefecture ?? ''

  if (ledgerDates.has(row.date)) fail(`デモの日付が台帳の日付と一致している(行 ${index + 1})`)
  if (!DEMO_YEARS.includes(row.date.slice(0, 4))) fail(`デモの日付が想定の年(${DEMO_YEARS.join('/')})の外にある(行 ${index + 1})`)
  for (const value of [label, row.brand]) {
    if (value !== undefined && !NON_BRAND_LABELS.has(value) && ledgerLabels.has(value)) {
      fail(`デモの銘柄「${value}」が台帳の銘柄と一致している。別の銘柄を選ぶ(行 ${index + 1})`)
    }
  }

  return {
    id: `demo-${String(index + 1).padStart(2, '0')}`,
    drankOn: row.date,
    brandLabel: label,
    sakenowaBrandId: brand?.id ?? null,
    brandName: linked ? row.brand : null,
    linkStatus: status,
    prefecture,
    spec: row.spec,
    rating: row.rating ?? null,
    place: row.place,
    note: row.note,
    thumbnail: row.thumb ? THUMBS[row.thumb] : null,
    // 元ログの No. は持たない(このデータはアプリの外から来た台帳ではない)
    sourceNo: null,
    // **取得時刻を入れない。** 実行するたびに差分が出ると、生成物のレビューが効かなくなる
    createdAt: `${row.date}T12:00:00.000Z`,
    updatedAt: `${row.date}T12:00:00.000Z`,
  }
})

const aliases = ALIAS_ROWS.map((row) => ({
  label: row.label,
  prefecture: lookupBrand(row.brand).prefecture,
  brandId: lookupBrand(row.brand).id,
}))

// 1行1件で書く(`store/backup.ts` の exportAll と同じ形 = 人が差分を読める)
const json =
  '{' +
  '"schemaVersion":1,' +
  '"app":"sake-record",' +
  // 固定値。書き出し時刻を今にすると毎回差分が出る
  '"exportedAt":"2019-12-28T13:00:00.000Z",' +
  `"aliases":${JSON.stringify(aliases)},` +
  '"records":[\n' +
  records.map((record) => JSON.stringify(record)).join(',\n') +
  '\n]}\n'

const checkOnly = process.argv.includes('--check')
const path = resolve(root, OUT)
if (checkOnly) {
  const current = readFileSync(path, 'utf8')
  if (current !== json) fail(`${OUT} が生成結果と一致しない。\`node scripts/make-demo-backup.mjs\` で作り直す`)
  console.log(`✓ ${OUT} は生成結果と一致(記録 ${records.length}件 / エイリアス ${aliases.length}件)`)
} else {
  writeFileSync(path, json)
  const years = new Map()
  for (const record of records) {
    const year = record.drankOn.slice(0, 4)
    years.set(year, (years.get(year) ?? 0) + 1)
  }
  const byStatus = new Map()
  for (const record of records) byStatus.set(record.linkStatus, (byStatus.get(record.linkStatus) ?? 0) + 1)
  console.log(`✓ ${OUT} を書き出した(${(json.length / 1024).toFixed(1)} KB)`)
  console.log(`    記録 ${records.length}件 / エイリアス ${aliases.length}件 / サムネイル ${records.filter((r) => r.thumbnail !== null).length}件`)
  console.log(`    年別 ${[...years].sort().map(([y, n]) => `${y}:${n}`).join(' ')}`)
  console.log(`    紐付け ${[...byStatus].map(([s, n]) => `${s}:${n}`).join(' ')}`)
  console.log(`    県 ${new Set(records.map((r) => r.prefecture).filter((p) => p !== '')).size}種`)
}
