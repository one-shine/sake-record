import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base は完全相対。GitHub Pages のプロジェクトサイト(/<repo>/)でもルート配信でも同じ成果物が動く。
// 副作用として、リポジトリ名もブランド名もビルド設定に一切現れない(受け入れ基準 A17)。
//
// 制約: 相対 base と history ルーティングは併用できない。文書 URL が /<repo>/foo/bar になると
// './sw.js' が /<repo>/foo/sw.js に解決されて壊れる。このアプリは URL ルーティングを持たず
// (共有機能が恒久スコープ外なので共有する URL が存在しない)、オーバーレイの開閉だけを
// pushState(同一URL) で履歴に積むため、文書 URL は常に配信ルートのままになる。
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    // マニフェストを出す理由は Service Worker のプリキャッシュ範囲を**構造から**決めるため。
    // `dist/assets/*.js` を glob で拾うと、動的 import された OCR エンジンのチャンクまで
    // 原子的な `cache.addAll` に混ざる(1件でも失敗すると install ごと reject されて
    // オフライン起動が恒久的に壊れる)。マニフェストの `imports` は**静的 import だけ**を
    // 並べるので、「起動に必要な閉包」と「必要になってから取るもの」を機械的に分けられる。
    // 詳細は scripts/inject-sw-precache.mjs。成果物には残さない(同スクリプトが削除する)。
    manifest: true,
  },
})
