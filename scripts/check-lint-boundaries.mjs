#!/usr/bin/env node
/**
 * **依存方向の lint ルールが実際に効いているか**を検査する(BACKLOG B21)。
 *
 *   npm run boundaries:check
 *
 * `eslint.config.js` の `no-restricted-imports` は `src/domain/ ← src/data/ + src/store/ ← src/ui/`
 * を宣言している。だが lint ルールそのものは**消しても壊れない** — ブロックを消す / `files` の
 * グロブを打ち間違える / 正規表現を1文字直す、のどれをやっても `npm run lint` は緑のままで、
 * 「違反が0件」と「検査していない」が区別できない。手で `npm run lint` を落として確認する運用は
 * コミット時に走らないので、Phase 2 → 7 の間ずっと無検査になり得た。
 *
 * そこでガード自身を検査する。合成した違反コードを ESLint の API に食わせて、
 * **報告されなければ落ちる**。実ファイルは1つも作らない(`lintText` はディスクを読まない)。
 *
 * 同時に「通ってほしい import」も検査する。禁止を広げすぎて
 * `src/domain/prefecture.ts` の `../../public/data/sakenowa/areas.json`(層ではなく同梱データ)や
 * domain のテストが実表を組み立てる `../data/tables.ts` まで巻き込むと、実装側が
 * ルールを緩める方向に手を入れることになるので、そこも固定する。
 */
import { ESLint } from 'eslint'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RULE = 'no-restricted-imports'

/**
 * `filePath` は**実在しないパスでよい**(lintText は中身を引数で受け取る)。
 * 実在するファイルを使うと、そのファイルを直したときに検査が意図せず変わる。
 */
const CASES = [
  // ── 落ちなければならない(依存方向の逆流) ──
  {
    expect: 'restricted',
    file: 'src/domain/__boundary-probe.ts',
    code: "import { useMemo } from 'react'\nexport const probe = useMemo\n",
    why: 'domain が react を import(node 環境のテストでは捕まらない = B21 の本丸)',
  },
  {
    expect: 'restricted',
    file: 'src/domain/__boundary-probe.ts',
    code: "import { openDb } from '../store/db.ts'\nexport const probe = openDb\n",
    why: 'domain が store を import',
  },
  {
    expect: 'restricted',
    file: 'src/domain/__boundary-probe.ts',
    code: "import { decodeTables } from '../data/tables.ts'\nexport const probe = decodeTables\n",
    why: 'domain(実装)が data を import',
  },
  {
    expect: 'restricted',
    file: 'src/domain/__boundary-probe.test.ts',
    code: "import { openDb } from '../store/db.ts'\nexport const probe = openDb\n",
    why: 'domain の**テスト**が store を import(テストでも逆流は許さない)',
  },
  {
    expect: 'restricted',
    file: 'src/domain/__boundary-probe.test.ts',
    code: "import { useMemo } from 'react'\nexport const probe = useMemo\n",
    why: 'domain の**テスト**が react を import',
  },
  {
    expect: 'restricted',
    file: 'src/store/__boundary-probe.ts',
    code: "import { AppShell } from '../ui/AppShell/AppShell.tsx'\nexport const probe = AppShell\n",
    why: 'store が ui を import',
  },
  {
    expect: 'restricted',
    file: 'src/data/__boundary-probe.ts',
    code: "import { openDb } from '../store/db.ts'\nexport const probe = openDb\n",
    why: 'data が store を import',
  },
  // ── 通らなければならない(禁止の広げすぎを検出する) ──
  {
    expect: 'allowed',
    file: 'src/domain/__boundary-probe.ts',
    code: "import areasJson from '../../public/data/sakenowa/areas.json'\nexport const probe = areasJson\n",
    why: 'domain が同梱 JSON を直接読む(prefecture.ts の実際の形。`public/data/` は層ではない)',
  },
  {
    expect: 'allowed',
    file: 'src/domain/__boundary-probe.test.ts',
    code: "import { decodeTables } from '../data/tables.ts'\nexport const probe = decodeTables\n",
    why: 'domain の**テスト**が実表を fixture にする(linkBrand.test.ts / suggest.test.ts の形)',
  },
  {
    expect: 'allowed',
    file: 'src/store/__boundary-probe.ts',
    code: "import { normalize } from '../domain/normalize.ts'\nexport const probe = normalize\n",
    why: 'store が domain を import(これが正しい向き)',
  },
  {
    expect: 'allowed',
    file: 'src/ui/__boundary-probe.tsx',
    code: "import { useMemo } from 'react'\nexport const probe = useMemo\n",
    why: 'ui は react を使ってよい(最上位の層)',
  },
]

const eslint = new ESLint({ cwd: root })
const failures = []

for (const c of CASES) {
  const [result] = await eslint.lintText(c.code, { filePath: resolve(root, c.file) })
  const hits = (result?.messages ?? []).filter(m => m.ruleId === RULE)
  if (c.expect === 'restricted' && hits.length === 0) {
    failures.push(`✗ 検出されなかった: ${c.file} — ${c.why}`)
  }
  if (c.expect === 'allowed' && hits.length > 0) {
    failures.push(`✗ 誤検出: ${c.file} — ${c.why}\n    ${hits.map(m => m.message).join('\n    ')}`)
  }
  // ルール以外のエラー(パースできない等)は検査が成立していない合図なので落とす
  const fatal = (result?.messages ?? []).filter(m => m.fatal)
  if (fatal.length > 0) {
    failures.push(`✗ 合成コードを parse できない: ${c.file} — ${fatal.map(m => m.message).join(' / ')}`)
  }
}

if (failures.length > 0) {
  console.error(`✗ 依存方向のガードが効いていない (${failures.length}/${CASES.length}件):`)
  for (const f of failures) console.error('  ' + f)
  console.error('  eslint.config.js の `no-restricted-imports` ブロック(B21)を確認する。')
  console.error('  ルールを緩めるのではなく、逆流している import のほうを直す。')
  process.exit(1)
}

const restricted = CASES.filter(c => c.expect === 'restricted').length
const allowed = CASES.length - restricted
console.log(
  `✓ 依存方向のガードが有効: 逆流 ${restricted}件を検出 / 正しい向き ${allowed}件は素通り` +
    ' (domain ← data/store ← ui)',
)
