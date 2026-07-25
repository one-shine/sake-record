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
