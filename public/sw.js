// Service Worker — オフライン対応(アプリシェル + さけのわデータ + ハッシュ付き資産)。
// CACHE 名と PRECACHE_ASSETS はビルド後に scripts/inject-sw-precache.mjs がプレースホルダを実値へ置換する。
const CACHE = '__CACHE_VERSION__'

// 相対パス: SW は base 配下(例 /<repo>/sw.js)に配信され、相対URLは自身の URL 基準で解決される。
// これによりルート配信(custom domain)でもサブパス配信(Pages)でも同じコードが動く。
const SHELL = ['./', './index.html', './manifest.json', './favicon.svg']

// ビルドで dist/assets/* と dist/data/sakenowa/*.json を注入する。
// 銘柄マスタが無いとサジェストが空になり「起動はするが記録できない」状態になるため、
// これらは任意アセットではなく必須シェル扱いにする。
const PRECACHE_ASSETS = __PRECACHE_ASSETS__

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache =>
        // 必須シェルは原子的にキャッシュする。1件(特に './')でも失敗したら addAll が throw →
        // install ごと reject → ブラウザが次回ナビゲーションで install を再試行する(回線が安定した
        // 時点でシェル一式が確実に入る = 完全オフライン保証)。
        // best-effort にすると欠落したまま install 成功扱いになり二度と再試行されず、
        // オフライン起動が恒久的に不成立になる。
        cache.addAll([...SHELL, ...PRECACHE_ASSETS]),
      )
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// caches.match は既定で Vary ヘッダを尊重する。`vite preview` は同一オリジンのレスポンスにも
// `Vary: Origin` を付けるため、install 時に cache.addAll が保存したエントリと、ブラウザが
// 文書の <script>/<link> のために出すリクエストとで Vary の突合に失敗し、キャッシュヒットしない。
// → オフラインで HTML だけ復元され JS/CSS が ERR_FAILED になる(実測して踏んだ)。
// アプリシェルは同一オリジンの静的ファイルしかないので Vary は無視して URL で引く。
const CACHE_MATCH = { ignoreVary: true }

/** オフラインかつ未キャッシュのときに undefined を respondWith しないための明示的な失敗応答 */
function offlineFailure() {
  return new Response('', { status: 504, statusText: 'オフラインでキャッシュにも無い' })
}

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // クロスオリジンは素通し

  // ナビゲーションは network-first(新しいデプロイを優先的に取り込む)、
  // オフライン時はキャッシュ済みのシェルにフォールバックする。
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached =
          (await caches.match(request, CACHE_MATCH)) ?? (await caches.match('./', CACHE_MATCH))
        return cached ?? offlineFailure()
      }),
    )
    return
  }

  // 資産とデータは cache-first。
  // ファイル名にハッシュが付く資産は内容アドレス指定なので再検証が不要で、
  // ハッシュの付かない data/sakenowa/*.json も CACHE 名がビルドごとに変わり
  // activate で旧世代を全削除するため、デプロイのたびに必ず入れ替わる。
  // (オフライン時に無駄な失敗リクエストを出さない利点もある)
  event.respondWith(
    (async () => {
      const cached = await caches.match(request, CACHE_MATCH)
      if (cached) return cached
      try {
        const res = await fetch(request)
        if (res.ok && res.type !== 'opaque') {
          const cache = await caches.open(CACHE)
          void cache.put(request, res.clone())
        }
        return res
      } catch {
        return offlineFailure()
      }
    })(),
  )
})
