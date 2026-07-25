import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root が見つからない')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service Worker は本番のみ。dev で登録すると HMR がキャッシュに阻まれる。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const base = import.meta.env.BASE_URL
  window.addEventListener('load', () => {
    // 初回訪問(controller 未設定)では controllerchange でリロードしない。
    // 既に旧版が動いていた場合だけ一度リロードして新版を確実に取り込む。
    const hadController = Boolean(navigator.serviceWorker.controller)
    let reloaded = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return
      reloaded = true
      window.location.reload()
    })

    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base, updateViaCache: 'none' })
      .then(reg => {
        // 復帰時に更新を確認する(数日開いたままのタブが旧版に留まるのを防ぐ)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void reg.update()
        })
      })
      .catch((err: unknown) => {
        console.error('Service Worker の登録に失敗した', err)
      })
  })
}
