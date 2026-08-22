import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { setUpdateChecker } from './lib/appUpdate.ts'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root が見つからない')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service Worker は本番のみ。dev で登録すると HMR がキャッシュに阻まれる。
//
// **ここでリロードしない**(B87)。以前は `controllerchange` で無条件に
// `window.location.reload()` していたが、`sw.js` が `skipWaiting()` + `clients.claim()` を
// 呼ぶうえ復帰のたびに `reg.update()` を投げるので、**記録の途中で写真アプリへ切り替えて
// 戻った瞬間**にリロードが起きて入力が全損しうる形だった。いつリロードするかは
// 「いま何が開いているか」を知っている App が決める(`lib/appUpdate.ts`)。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const base = import.meta.env.BASE_URL
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base, updateViaCache: 'none' })
      .then((reg) => {
        // 復帰時の更新確認は登録できてから。**確認するだけでリロードはしない**
        setUpdateChecker(() => {
          void reg.update()
        })
      })
      .catch((err: unknown) => {
        console.error('Service Worker の登録に失敗した', err)
      })
  })
}
