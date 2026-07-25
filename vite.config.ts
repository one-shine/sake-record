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
})
