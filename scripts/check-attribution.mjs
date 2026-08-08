#!/usr/bin/env node
/**
 * ビルド成果物にクレジットと noindex が含まれることを検証する(受け入れ基準 A13 / A14)。
 *
 *   npm run attribution:check          (= node scripts/check-attribution.mjs dist)
 *
 * さけのわデータの利用条件はクレジット表示 + https://sakenowa.com へのリンクが必須(省略は禁止事項)。
 * 産地マップの県形状は @svg-maps/japan (CC-BY-4.0) で、作者・タイトル・ライセンス・改変の明示が必要。
 * 銘柄の読みは KANJIDIC (CC-BY-SA-4.0) で、同じ4項目が必要(B68)。
 * どれも「約束したこと」なので、人間の注意力ではなく成果物の検査で守る。
 *
 * 重要: クレジットは React が実行時に描くので dist/index.html には入っていない。
 * ハッシュ付き JS チャンクの中の文字列リテラルを見る(ミニファイでもリテラルは残る)。
 * ここを index.html にすると検査が常に赤 or 素通しになり、守っているつもりで守れない。
 *
 * ## この検査の境界(ここを誤解すると「緑なのに義務違反」になる)
 *
 * 見ているのは **文言が成果物のどこかに在るか** だけ。**到達可能性と描画は検査しない** —
 * 文言を持つコンポーネントがどこか1箇所から import されていれば、**義務のある画面が
 * それを描いていなくても**needle は満たされる。
 * 実測: `<MapCredit />` を産地タブ(ライセンス対象の県形状を描く画面)から外しても、
 * 同じコンポーネントを「知る」が描いているので `npm run build && npm run attribution:check`
 * は緑のままだった(exit 0)。
 *
 * → **「その画面に出る」は単体テストが持つ。** CI で必ず走る置き場所:
 *   - `src/ui/Attribution/Attribution.test.tsx` … フッタの1行 / CC-BY をフッタに戻していないこと
 *     / `MapCredit` 単体の4項目
 *   - `src/ui/AreaMap/AreaMap.test.tsx` … **CC-BY 4項目が産地タブに併記されていること**
 *     (合成データだけで回る = seed に依存しない)
 *   - `src/ui/Learn/Learn.test.tsx` … 「知る」の出典節に全文があること
 *   - `src/integration/screens.test.tsx` … 実台帳203本での通し。ただし
 *     **`data/seed/` が無い環境では `describe.skipIf` で丸ごと skip される**
 *     (public リポジトリの CI は seed を持たない)。**ここだけに義務の証拠を置くと素通りする** —
 *     実際に CC-BY の併記はここにしか無く、産地タブから `MapCredit` を消しても CI が緑だった。
 *
 * needle は**このファイルにリテラルで持つ**(`src/config/app.ts` から import しない)。
 * 実装から期待値を import すると、実装を書き換えたときに期待値も一緒に動いて恒真になる。
 *
 * ## needle の選び方 — 「短い文字列を並べる」では守れない(実測)
 *
 * JSX のテキストは `<a>` を挟むたびに別の文字列リテラルへ割れるので、
 * 昔の `…データは <a>さけのわデータ</a> を利用しています` という書き方では成果物に
 * 「さけのわデータを利用しています」が**存在せず**、短い needle しか選べなかった。
 * その結果、次の2件はクレジットを画面から消しても緑のままだった:
 *   - `さけのわデータ` … `さけのわデータを取得できない:` などのエラー文言4箇所で満たされる
 *   - `Map of Japan`  … @svg-maps/japan 自身が持つ `{"label":"Map of Japan"}` で満たされる
 * → **needle を足すのではなくマークアップの形を変えた**(クレジット文を1つのリテラルとして
 * 出す = `Attribution.tsx` のコメント)。定数の補間は実行時連結なので割れたままになる。
 * 下の自己検査がこの偽陽性2件を回帰として固定している。
 *
 * Apache-2.0 (tesseract) はここに足さない。画面表示の義務は無いと判断済みで
 * (`docs/THIRD_PARTY.md`)、告知は `public/ocr/LICENSE-Apache-2.0.txt` が担う。
 * 「検査対象 = 画面表示の義務があるもの」という境界を薄めない。
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// --- 必須の文言(表示義務のあるものだけ) ---
const NEEDLES = [
  {
    duty: 'さけのわ',
    label: 'さけのわ本体へのリンク',
    needle: 'https://sakenowa.com',
    why: 'さけのわの禁止事項(帰属表示を行わない)に触れる',
  },
  {
    duty: 'さけのわ',
    label: 'クレジットの文',
    needle: 'さけのわデータを利用しています',
    why: 'さけのわの禁止事項(帰属表示を行わない)に触れる',
  },
  {
    duty: '@svg-maps/japan',
    label: 'タイトルと作者',
    needle: 'Map of Japan by Victor Cazanave',
    why: 'CC-BY-4.0 §3(a)(1) の表示義務',
  },
  {
    duty: '@svg-maps/japan',
    label: 'ライセンスへのリンク',
    needle: 'creativecommons.org/licenses/by/4.0',
    why: 'CC-BY-4.0 §3(a)(1) の表示義務',
  },
  {
    duty: '@svg-maps/japan',
    label: '改変した旨',
    needle: '本数に応じて着色する改変あり',
    why: 'CC-BY-4.0 §3(a)(1) の表示義務(改変の明示)',
  },
  {
    duty: 'KANJIDIC',
    label: 'タイトルと作者',
    needle: 'KANJIDIC Project by EDRDG',
    why: 'CC-BY-SA-4.0 §3(a)(1) の表示義務',
  },
  {
    duty: 'KANJIDIC',
    label: 'ライセンスへのリンク',
    needle: 'creativecommons.org/licenses/by-sa/4.0',
    why: 'CC-BY-SA-4.0 §3(a)(1) の表示義務',
  },
  {
    duty: 'KANJIDIC',
    label: '改変した旨',
    needle: '銘柄名に出る漢字だけに絞って書き出す改変あり',
    why: 'CC-BY-SA-4.0 §3(a)(1) の表示義務(改変の明示)',
  },
  {
    duty: 'ウィキペディア',
    label: '出所',
    // **`ウィキペディア日本語版` だけにしない。** 同梱データ(`public/data/wikipedia/
    // brewery-articles.json`)の `copyright` 欄に同じ文字列があり、クレジットを1つも描かなくても
    // dist に残る(KANJIDIC で実際に踏んだ形。下の FIXTURE_WITHOUT に入れてある)
    needle: 'ウィキペディア日本語版の執筆者',
    why: 'CC-BY-SA-4.0 §3(a)(1) の表示義務(B78)',
  },
  {
    duty: 'ウィキペディア',
    label: '改変した旨',
    needle: '各記事の冒頭と「概要」節だけを抜き出す改変あり',
    why: 'CC-BY-SA-4.0 §3(a)(1) の表示義務(改変の明示)',
  },
]

const missingNeedles = bundle => NEEDLES.filter(n => !bundle.includes(n.needle))

// --- 検査そのものの自己検査(`check-lint-boundaries.mjs` と同じ思想) ---
//
// 期待値を NEEDLES から組み立ててはいけない(綴りを間違えても両方が同じように間違うので
// 永久に緑になる)。**別に手で書いた合成バンドル**を食わせて、通る/通らないを固定する。
// ファイルは作らない。

// 実際のバンドルに出る形を手で写したもの(needle 全部入り)。**落ちたら検査の綴りが違う。**
const FIXTURE_WITH = [
  'jsx("a",{href:"https://sakenowa.com",target:"_blank",children:"さけのわデータを利用しています"})',
  'jsx("a",{href:"https://github.com/VictorCazanave/svg-maps",children:"Map of Japan by Victor Cazanave"})',
  'jsx("a",{href:"https://creativecommons.org/licenses/by/4.0/",children:"CC BY 4.0"}),"・本数に応じて着色する改変あり）"',
  'jsx("a",{href:"https://www.edrdg.org/wiki/index.php/KANJIDIC_Project",children:"KANJIDIC Project by EDRDG"})',
  'jsx("a",{href:"https://creativecommons.org/licenses/by-sa/4.0/",children:"CC BY-SA 4.0"}),"・銘柄名に出る漢字だけに絞って書き出す改変あり）"',
  'jsx("a",{href:"https://ja.wikipedia.org/",children:"ウィキペディア日本語版の執筆者"})',
  '"・各記事の冒頭と「概要」節だけを抜き出す改変あり。記事名は記録の詳細に出す）"',
].join('\n')

// クレジットを**1つも描いていない**ときにバンドルに残る文字列だけを並べたもの。
// 過去に短い needle を満たしてしまった実物(偽陽性2件)が入っている。**通ったら検査が穴。**
const FIXTURE_WITHOUT = [
  '{"id":"jp","label":"Map of Japan","viewBox":"0 0 1000 1000"}',
  '"さけのわデータを取得できない: "',
  '"さけのわデータの6軸(華やか/芳醇/重厚/穏やか/ドライ/軽快)"',
  '"元データは銘柄をさけのわデータに照合して紐付ける"',
  '"さけのわデータの再取得に失敗した"',
  '"https://muro.sakenowa.com/sakenowa-data/"',
  '"この改変は保存されない"',
  '"本数に応じて色の濃さが変わる"',
  // 読み表そのもの(`public/data/kanji/readings.json` の copyright 欄)。**クレジットを
  // 描かなくても dist に残る**ので、`KANJIDIC` の1語を needle にしてはいけない
  '{"copyright":"KANJIDIC","chars":{"一":"イチ,カズ,ヒト"',
  '"銘柄はかなでも探せる"',
  // 蔵元の説明そのもの(`public/data/wikipedia/brewery-articles.json` の copyright 欄)と、
  // 「知る」の地の文。**どちらもクレジットを描かなくても dist に残る**
  '{"copyright":"テキストはウィキペディア日本語版の各記事より。CC BY-SA 4.0"',
  '"蔵元の説明はウィキペディア日本語版の記事の冒頭と「概要」節を"',
].join('\n')

const selfTestFailures = []
for (const n of missingNeedles(FIXTURE_WITH)) {
  selfTestFailures.push(
    `検査が正しい成果物を落とす: ${n.duty} の${n.label} ("${n.needle}") — needle の綴りを確認する`,
  )
}
for (const n of NEEDLES) {
  if (FIXTURE_WITHOUT.includes(n.needle)) {
    selfTestFailures.push(
      `needle が偽造できる: ${n.duty} の${n.label} ("${n.needle}") は` +
        'クレジットを描かなくても残る文字列で満たされる — needle を長くするか文言の形を変える',
    )
  }
}
if (selfTestFailures.length > 0) {
  console.error(`✗ クレジット検査の自己検査に失敗 (${selfTestFailures.length}件):`)
  for (const f of selfTestFailures) console.error('  ' + f)
  process.exit(1)
}

// --- 成果物の検査 ---
const distArg = process.argv[2] ?? 'dist'
const DIST = resolve(root, distArg)

if (!existsSync(DIST)) {
  console.error(`✗ ${distArg} が無い。先に \`npm run build\` を実行する。`)
  process.exit(1)
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const all = walk(DIST)
const rel = p => p.replace(DIST + '/', '')
// 検査するのは**自分たちのバンドル**だけ。`ocr/` は第三者の配布物をそのまま出荷している場所
// (tesseract の worker と 3.9MB の wasm コア)で、ここを混ぜると
//   - 4MB の連結が毎回走る
//   - クレジット文字列がベンダーのコード側に偶然あっても検査が通る = 穴が開く
// ため除外する。ベンダー側の告知義務は docs/THIRD_PARTY.md と public/ocr/LICENSE-Apache-2.0.txt。
//
// なお @svg-maps/japan は**自分たちのチャンクの中に**バンドルされるので、ファイル単位では
// 分離できない(`{"label":"Map of Japan"}` を除外できない)。だから needle 側を強くする。
const jsFiles = all.filter(
  p => p.endsWith('.js') && !rel(p).startsWith('sw.js') && !rel(p).startsWith('ocr/'),
)
const jsBundle = jsFiles.map(p => readFileSync(p, 'utf8')).join('\n')

const indexPath = resolve(DIST, 'index.html')
const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : ''

const violations = []

if (jsFiles.length === 0) {
  violations.push('JS チャンクが1つも無い(ビルドが壊れている可能性)')
}

for (const n of missingNeedles(jsBundle)) {
  violations.push(`JS チャンクに ${n.duty} の${n.label} ("${n.needle}") が無い — ${n.why}`)
}

// --- noindex (A14) ---
if (!/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(indexHtml)) {
  violations.push('index.html に noindex の robots meta が無い')
}

// --- 同梱データ側のクレジット ---
// **データ自身にも出所を持たせる。** バンドルのクレジットは画面の義務で、こちらは
// 「配ったファイルだけを見た人が出所を辿れるか」の担保(ファイル単位で再配布されうる)。
const DATA_COPYRIGHT = [
  { path: 'data/sakenowa/brands.json', want: 'Sakenowa', broken: 'オフライン時にサジェストが空になる' },
  { path: 'data/kanji/readings.json', want: 'KANJIDIC', broken: 'オフライン時にかなで探せなくなる' },
  {
    // **無くてよい唯一のファイル。** 確定した行が0件なら生成されず、そのときは
    // 蔵元の説明の節が出ないだけ(`wikipedia:check` が「表が空ならファイルも無い」を見る)。
    // 在るなら出所が要る。文言が長いので**含むか**で見る
    path: 'data/wikipedia/brewery-articles.json',
    want: 'CC BY-SA 4.0',
    optional: true,
    contains: true,
    broken: '蔵元の説明が出所不明のまま配られる',
  },
]
for (const { path, want, broken, optional = false, contains = false } of DATA_COPYRIGHT) {
  const full = resolve(DIST, path)
  if (!existsSync(full)) {
    if (!optional) violations.push(`${path} が成果物に無い(${broken})`)
    continue
  }
  const body = JSON.parse(readFileSync(full, 'utf8'))
  const copyright = String(body.copyright)
  const ok = contains ? copyright.includes(want) : body.copyright === want
  if (!ok) {
    violations.push(`${path} の copyright が "${want}" ${contains ? 'を含まない' : 'でない'} (現在: ${copyright})`)
  }
}

if (violations.length) {
  console.error(`✗ クレジット/noindex の検査に失敗 (${violations.length}件):`)
  for (const v of violations) console.error('  ' + v)
  console.error('  文言は src/ui/Attribution/Attribution.tsx の1箇所。needle を消して通すのは無し。')
  process.exit(1)
}

console.log(
  '✓ クレジット OK: さけのわ(リンク+文) / @svg-maps/japan(CC-BY 3項目) / ' +
    'KANJIDIC(CC-BY-SA 3項目) / ウィキペディア(CC-BY-SA 2項目) / noindex',
)
console.log(`    自己検査: needle ${NEEDLES.length}件が合成バンドル(クレジット無し)では満たされない`)
console.log(
  `    検査対象: JS ${jsFiles.length}ファイル + index.html + 同梱データ ${DATA_COPYRIGHT.length}件`,
)
console.log(
  `    注意: 文字列の有無だけを見る。どの画面に出るかは Attribution / AreaMap / Learn の単体テストが持つ`,
)
