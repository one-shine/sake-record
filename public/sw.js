// Service Worker — オフライン対応(アプリシェル + さけのわデータ + ハッシュ付き資産)。
// CACHE / OCR_CACHE / PRECACHE_ASSETS はビルド後に scripts/inject-sw-precache.mjs が
// プレースホルダを実値へ置換する。
//
// ## キャッシュを2層に分ける
//   CACHE     … アプリシェル。**ビルドごとに名前が変わり** activate で旧世代を全削除する。
//               中身は install で**原子的に**入れる(下記)。
//   OCR_CACHE … 端末内 OCR の資産(worker / wasm コア / 学習データ で計 7.7MB)。
//               **install では取らず**、実際に OCR を使ったときの fetch で埋まる。
//               名前は中身のハッシュから作るので、デプロイを重ねても資産が同一なら同じ名前
//               = activate の掃除で消えない(下の KEEP)。
// 層を分けない場合に何が起きるかは、それぞれの箇所のコメントに書く。
const CACHE = '__CACHE_VERSION__'
const OCR_CACHE = '__OCR_CACHE__'

// 相対パス: SW は base 配下(例 /<repo>/sw.js)に配信され、相対URLは自身の URL 基準で解決される。
// これによりルート配信(custom domain)でもサブパス配信(Pages)でも同じコードが動く。
const SHELL = ['./', './index.html', './manifest.json', './favicon.svg']

// ビルドで「起動に必要な資産」(エントリの静的 import 閉包)と dist/data/sakenowa/*.json を注入する。
// 銘柄マスタが無いとサジェストが空になり「起動はするが記録できない」状態になるため、
// これらは任意アセットではなく必須シェル扱いにする。
// **動的 import されるチャンク(OCR エンジン)はここに入らない** — 判定はビルド側が
// vite のマニフェストから機械的に行う(scripts/inject-sw-precache.mjs)。
const PRECACHE_ASSETS = __PRECACHE_ASSETS__

/** OCR 資産の置き場。SW 自身の URL 基準で解決するのでサブパス配信でも効く */
const OCR_SCOPE = new URL('./ocr/', self.location.href).pathname

/** その要求が OCR 資産か(= どちらの層に入れるか)。層ごとに寿命が違うのでここだけで振り分ける */
function isOcrAsset(url) {
  return url.pathname.startsWith(OCR_SCOPE)
}

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
        //
        // **OCR 資産(7.7MB)をここに足してはいけない。** 理由は2つあり、どちらも単独で致命的:
        //   1. 原子性の巻き添え — 7.7MB のうち1件でも失敗すれば install ごと reject される。
        //      アプリの起動に不要なものが、アプリのオフライン起動を人質に取る形になる。
        //   2. 回線の乱暴さ — install はアプリを初めて開いた瞬間(多くはモバイル回線)に走る。
        //      OCR を一度も使わない利用者にも 7.7MB を無条件に取らせることになる。
        // → OCR は「使ったときに取り、次回からキャッシュで動く」に倒す。埋めるのは下の fetch
        //   ハンドラで、best-effort のプリキャッシュもしない(install を跨いだ 7.7MB の
        //   バックグラウンド取得は、失敗しても成功しても利用者に何も伝わらないので、
        //   「読み取る」を押した文脈で進捗と一緒に取る方が説明できる)。
        cache.addAll([...SHELL, ...PRECACHE_ASSETS]),
      )
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  // 現世代のシェルと OCR 層だけ残す。OCR_CACHE の名前は**資産の中身**で決まるので、
  // デプロイのたびに変わる CACHE と違い、資産が同じなら生き残る
  // (毎デプロイで 7.7MB を再取得させないための層分け)。
  // 資産を差し替えたときは名前が変わり、この掃除で古い層が消える。
  const KEEP = [CACHE, OCR_CACHE]
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// caches.match は既定で Vary ヘッダを尊重する。`vite preview` は同一オリジンのレスポンスにも
// `Vary: Origin` を付けるため、install 時に cache.addAll が保存したエントリと、ブラウザが
// 文書の <script>/<link> のために出すリクエストとで Vary の突合に失敗し、キャッシュヒットしない。
// → オフラインで HTML だけ復元され JS/CSS が ERR_FAILED になる(実測して踏んだ)。
// アプリシェルは同一オリジンの静的ファイルしかないので Vary は無視して URL で引く。
const CACHE_MATCH = { ignoreVary: true }

/**
 * オフラインかつ未キャッシュのときに undefined を respondWith しないための明示的な失敗応答。
 * statusText は ByteString(ISO-8859-1)なので日本語を入れると Response の構築自体が TypeError で
 * 落ち、respondWith が reject して「明示的な失敗応答」がそのままネットワークエラーになる
 * (この関数が避けようとしていた状態と同じになる)。理由の日本語は本文に置く。
 */
function offlineFailure() {
  return new Response('オフラインでキャッシュにも無い', {
    status: 504,
    statusText: 'Gateway Timeout',
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
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
  //
  // OCR 資産だけは書き込み先を OCR_CACHE に振り分ける。ここが「初回に取得され、以降
  // キャッシュから使える」の実体で、install を太らせずにオフライン動作を成立させている。
  // 読み出しは層を指定しない `caches.match`(全層を見る)のままでよい — 2つの層で
  // 同じ URL が入ることは無い(OCR 層に入るのは `./ocr/` 配下だけ)ので取り違えは起きない。
  event.respondWith(
    (async () => {
      const cached = await caches.match(request, CACHE_MATCH)
      if (cached) return cached
      try {
        const res = await fetch(request)
        if (res.ok && res.type !== 'opaque') {
          const cache = await caches.open(isOcrAsset(url) ? OCR_CACHE : CACHE)
          void cache.put(request, res.clone())
        }
        return res
      } catch {
        return offlineFailure()
      }
    })(),
  )
})
