import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'data', 'public/data']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: { globals: globals.browser },
    rules: {
      // `_` 接頭辞の引数は意図的に未使用 — 慣例的に許容
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // ── 依存方向を lint で強制する (BACKLOG B21) ───────────────────────────────
  //
  // 不変条件は `src/domain/ ← src/data/ + src/store/ ← src/ui/`。
  // これまでの守り方は2つとも穴が空いていた:
  //   - 手 `grep` … コミット時にもCIにも走らない。しかもこのハーネスのシェルでは `grep` が
  //     ugrep に差し替わっていて**該当があっても無出力で exit 1** になるので、否定形の検査
  //     (「domain に react の import が無い」)が無検査のまま緑に見える(B21 に実測を記録)。
  //   - domain のテストを `// @vitest-environment node` で回す … `window`/`document` は
  //     捕まえるが、**`import { useMemo } from 'react'` は node でも普通に動くので通る**。
  // → 宣言としてここに置き、`npm run lint` = CI で毎回強制する。
  //
  // 相対パスの層またぎは `regex` で書く(`group` の gitignore 風マッチだと `..` の扱いが
  // 曖昧なうえ、`../../public/data/sakenowa/areas.json` のような**層ではないパス**まで
  // 巻き込みかねない)。`^\.\.(/\.\.)*/(層)/` = 「親を1つ以上さかのぼって層に入る」だけを見る。
  {
    // src/domain/ は React 非依存の純TS。下位の data/store/ui も見ない。
    files: ['src/domain/**/*.ts', 'src/domain/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*', '@testing-library/*'],
              message:
                'src/domain/ は React 非依存の純TS(依存方向 domain ← store ← ui)。React に依存する処理は src/ui/ に置く。',
            },
            {
              regex: '^\\.\\.(/\\.\\.)*/(data|store|ui)/',
              message:
                'src/domain/ は下位層(data/store/ui)を import しない(依存方向 domain ← data/store ← ui)。必要な値は引数か型で受け取る。',
            },
          ],
        },
      ],
    },
  },
  {
    // domain の**テストだけ** `../data/` を許す。
    // linkBrand.test.ts / suggest.test.ts は同梱 JSON を `decodeTables` で解いて
    // 実表を fixture にする(203本の紐付け実測値を実データで固定するため)。
    // テストはバンドルに入らないので出荷される依存方向は変わらない。
    // **react と store/ui の禁止はテストでも解かない**(domain の純度そのものだから)。
    files: ['src/domain/**/*.test.ts', 'src/domain/**/*.test.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*', '@testing-library/*'],
              message:
                'src/domain/ は React 非依存の純TS。DOM を要るテストは src/ui/ か src/integration/ に置く。',
            },
            {
              regex: '^\\.\\.(/\\.\\.)*/(store|ui)/',
              message: 'src/domain/ のテストでも store/ui は import しない(依存方向の逆流)。',
            },
          ],
        },
      ],
    },
  },
  {
    // src/store/ は domain と data に依存してよいが、UI は見ない。
    files: ['src/store/**/*.ts', 'src/store/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.\\.(/\\.\\.)*/ui/',
              message:
                'src/store/ は src/ui/ を import しない(依存方向 store ← ui)。UI が要る値は store が返す形にする。',
            },
          ],
        },
      ],
    },
  },
  {
    // src/data/ は同梱 JSON を domain の型に解く層。store も UI も見ない。
    files: ['src/data/**/*.ts', 'src/data/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.\\.(/\\.\\.)*/(store|ui)/',
              message:
                'src/data/ は store/ui を import しない(依存方向 domain ← data ← store ← ui)。',
            },
          ],
        },
      ],
    },
  },
  {
    // ビルド時スクリプトは Node 環境。ここだけ node グローバルを許す
    // (src 側に node の型/グローバルを漏らさないため、tsconfig ではなく eslint 側で分ける)
    files: ['scripts/**/*.mjs', '*.config.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    // Service Worker は worker グローバル (self, caches, clients)
    files: ['public/sw.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.serviceworker },
    rules: {
      // __CACHE_VERSION__ / __PRECACHE_ASSETS__ はビルド後に実値へ置換されるプレースホルダ
      'no-undef': 'off',
    },
  },
])
