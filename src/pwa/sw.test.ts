// @vitest-environment node
// `public/sw.js`(Service Worker)の回帰テスト。**DOM を持たない worker グローバルで走るコード**なので
// node 環境で回す。この環境の `Response` は Node(undici)の実装で、実ブラウザと同じく `statusText` を
// ByteString(ISO-8859-1)として検査する — それがこのファイルを書いた直接の理由。
//
// 何が起きたか(Phase 7 の実機検証で観測):
//   `offlineFailure()` が `new Response('', { status: 504, statusText: 'オフラインでキャッシュにも無い' })`
//   を返していた。`statusText` は ByteString なので日本語を入れると**Response の構築自体が TypeError**
//   (実測: "Cannot convert argument to a ByteString because the character at index 0 has a value of
//   12458 which is greater than 255")。結果 `respondWith` に渡した promise が reject し、
//   「undefined を respondWith しないための明示的な失敗応答」が**避けようとしていた素の
//   ネットワークエラーそのもの**になっていた(実測: preview を止めた Chromium で 504 ではなく
//   "Failed to fetch")。`src/data/tables.ts` の `if (!res.ok) throw new Error('さけのわデータを
//   取得できない: ... (${res.status})')` も到達不能になり、原因を名指しする文言が出なくなる。
//
// この経路を覆うテストは1本も無かった(だから実ブラウザで踏むまで誰も気づけなかった)。
// SW は `public/` に置かれてビルドで**そのままコピー**されるため import できない。写しを作ると
// 「写しだけが正しい」状態になるので、**出荷されるファイルの中身を `?raw` で読んで評価する**。
// ビルド後に `scripts/inject-sw-precache.mjs` が置換する2つのプレースホルダだけ、ここでも同じ
// 2箇所を置換する(置換の契約が壊れていないかもテストする)。
//
// 覆っていないもの: 実 CacheStorage の細かい意味論(Vary の突合・容量・LRU)、実ブラウザの
// install/activate のライフサイクル、`clients.claim()` の効果。それらは実機/実ブラウザの担当。

import swSource from '../../public/sw.js?raw'
import { OCR_ASSET_DIR } from '../lib/ocr/recognize'

/** ビルドが置換する3箇所。ここが変わったら inject-sw-precache.mjs も追随が必要 */
const CACHE_VERSION_PLACEHOLDER = '__CACHE_VERSION__'
const OCR_CACHE_PLACEHOLDER = '__OCR_CACHE__'
const PRECACHE_PLACEHOLDER = '__PRECACHE_ASSETS__'

/** 置換後の実値に相当するテスト用の値 */
const CACHE = 'sake-test-1'
/** OCR 層。実ビルドでは**資産の中身のハッシュ**が入る(デプロイでは変わらない) */
const OCR_CACHE = 'sake-ocr-testhash'
const PRECACHE_ASSETS = [
  './assets/index-Bgfn5RMp.js',
  './assets/index-BSquqqeP.css',
  './data/sakenowa/brands.json',
]

/**
 * 配信ルートは**サブパス**にする(GitHub Pages のプロジェクトサイトと同じ形)。
 * SW 内の相対URL('./' や './index.html')が SW 自身の URL 基準で解けることも同時に検査できる。
 */
const SW_URL = 'https://example.test/some-base/sw.js'
const BASE = 'https://example.test/some-base/'

interface SwRequest {
  method: string
  url: string
  mode?: string
}

type Fetcher = (input: SwRequest | string) => Promise<Response>

/** Cache API と同じく絶対URLで引く。相対文字列は SW の URL 基準で解決する */
function keyOf(input: SwRequest | string): string {
  return new URL(typeof input === 'string' ? input : input.url, SW_URL).href
}

class FakeCache {
  readonly entries = new Map<string, Response>()
  /** `addAll` の呼び出し履歴。原子性(1回で全部)を確かめるために回数と引数を残す */
  readonly addAllCalls: string[][] = []
  private readonly fetcher: Fetcher

  constructor(fetcher: Fetcher) {
    this.fetcher = fetcher
  }

  /** 実ブラウザと同じ原子性: 1件でも取れない/ok でないなら**何も入れずに** reject する */
  async addAll(requests: string[]): Promise<void> {
    this.addAllCalls.push([...requests])
    const fetched: [string, Response][] = []
    for (const req of requests) {
      const res = await this.fetcher(req)
      if (!res.ok) throw new TypeError(`addAll: ${req} が ${res.status} を返した`)
      fetched.push([keyOf(req), res])
    }
    for (const [key, res] of fetched) this.entries.set(key, res)
  }

  async put(request: SwRequest | string, response: Response): Promise<void> {
    this.entries.set(keyOf(request), response)
  }

  /** 実 Cache API は毎回新しい Response を返す。body の使い回しで挙動が変わらないよう clone する */
  async match(request: SwRequest | string): Promise<Response | undefined> {
    return this.entries.get(keyOf(request))?.clone()
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>()
  /** `caches.match` に渡された options を残す(`ignoreVary` の回帰を見るため) */
  readonly matchCalls: { key: string; options: unknown }[] = []
  private readonly fetcher: Fetcher

  constructor(fetcher: Fetcher) {
    this.fetcher = fetcher
  }

  async open(name: string): Promise<FakeCache> {
    const existing = this.caches.get(name)
    if (existing) return existing
    const created = new FakeCache(this.fetcher)
    this.caches.set(name, created)
    return created
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()]
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name)
  }

  async match(request: SwRequest | string, options?: unknown): Promise<Response | undefined> {
    this.matchCalls.push({ key: keyOf(request), options })
    for (const cache of this.caches.values()) {
      const hit = await cache.match(request)
      if (hit) return hit
    }
    return undefined
  }
}

/** `public/sw.js` を評価して登録されたリスナを取り出す */
function loadSw(fetcher: Fetcher) {
  const fetchSpy = vi.fn(fetcher)
  const cacheStorage = new FakeCacheStorage(fetchSpy)
  const listeners = new Map<string, (event: unknown) => void>()
  const skipWaiting = vi.fn(() => Promise.resolve())
  const claim = vi.fn(() => Promise.resolve())
  const swSelf = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener)
    },
    location: new URL(SW_URL),
    skipWaiting,
    clients: { claim },
  }

  const source = swSource
    .replace(CACHE_VERSION_PLACEHOLDER, CACHE)
    .replace(OCR_CACHE_PLACEHOLDER, OCR_CACHE)
    .replace(PRECACHE_PLACEHOLDER, JSON.stringify(PRECACHE_ASSETS))
  // self / caches / fetch だけ差し替える。Response と URL は Node の実装をそのまま使う
  // (statusText の ByteString 検査を効かせたいので、ここを自作に替えてはいけない)。
  //
  // `new Function` に渡すのは**リポジトリ内の `public/sw.js` そのもの**と、この
  // ファイルが持つ定数だけ。外部入力もユーザ入力も通らない(テスト専用の評価器)。
  const evaluate = new Function('self', 'caches', 'fetch', source) as (
    swGlobal: unknown,
    cacheStorageArg: unknown,
    fetchArg: unknown,
  ) => void
  evaluate(swSelf, cacheStorage, fetchSpy)

  return { listeners, cacheStorage, fetchSpy, skipWaiting, claim }
}

type Sw = ReturnType<typeof loadSw>

function listenerOf(sw: Sw, type: string): (event: unknown) => void {
  const listener = sw.listeners.get(type)
  if (!listener) throw new Error(`${type} リスナが登録されていない`)
  return listener
}

function fireExtendable(sw: Sw, type: 'install' | 'activate'): Promise<unknown> {
  let waited: Promise<unknown> | undefined
  listenerOf(sw, type)({
    waitUntil: (promise: Promise<unknown>) => {
      waited = promise
    },
  })
  if (!waited) throw new Error(`${type} が waitUntil を呼んでいない`)
  return waited
}

/** respondWith されなければ `undefined`(= SW が介入せず素通しした) */
function fireFetch(sw: Sw, request: SwRequest): Promise<Response> | undefined {
  let responded: Promise<Response> | undefined
  listenerOf(sw, 'fetch')({
    request,
    respondWith: (promise: Promise<Response>) => {
      responded = promise
    },
  })
  return responded
}

function respondedFor(sw: Sw, request: SwRequest): Promise<Response> {
  const responded = fireFetch(sw, request)
  if (!responded) throw new Error(`respondWith が呼ばれていない: ${request.method} ${request.url}`)
  return responded
}

function cacheOf(sw: Sw, name = CACHE): FakeCache {
  const cache = sw.cacheStorage.caches.get(name)
  if (!cache) throw new Error(`キャッシュ ${name} が開かれていない`)
  return cache
}

/** 配信元が生きている状態。中身に URL を入れて「どのエントリが返ったか」を確かめられるようにする */
const online: Fetcher = async input =>
  new Response(`body:${keyOf(input)}`, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })

/** 配信元が止まっている状態(vite preview 停止 / 機内モード)。fetch は reject する */
const offline: Fetcher = () => Promise.reject(new TypeError('Failed to fetch'))

describe('sw.js のビルド契約', () => {
  it('置換されるプレースホルダが3つとも public/sw.js にある', () => {
    expect(swSource).toContain('__CACHE_VERSION__')
    expect(swSource).toContain('__OCR_CACHE__')
    expect(swSource).toContain('__PRECACHE_ASSETS__')
  })

  // `__CACHE_VERSION__` が `__OCR_CACHE__` の部分文字列だったりすると、注入側の
  // 単発 `String.replace` が別のプレースホルダを食い合う。名前が互いに独立であることを固定する。
  it('OCR 層に振り分けるパスが src 側の資産の置き場と一致している', () => {
    // SW は `./ocr/` 配下だけを OCR 層(デプロイを跨いで残る層)に入れる。src 側が
    // 資産の置き場を変えるとここがずれ、**OCR 資産がシェル層に入って毎デプロイで
    // 7.7MB を取り直す**ようになる。動作は壊れないので実機でも気づけない → ここで固定する。
    expect(OCR_ASSET_DIR).toBe('ocr/')
    expect(swSource).toContain(`'./${OCR_ASSET_DIR}'`)
  })

  it('プレースホルダ同士が部分文字列になっていない', () => {
    const names = ['__CACHE_VERSION__', '__OCR_CACHE__', '__PRECACHE_ASSETS__']
    for (const a of names) {
      for (const b of names) {
        if (a !== b) expect(b.includes(a)).toBe(false)
      }
    }
  })
})

describe('sw.js install', () => {
  it('シェル4件と注入資産3件を1回の addAll で原子的に入れる', async () => {
    const sw = loadSw(online)

    await fireExtendable(sw, 'install')

    // 期待値はリテラルで書く(実装から読むと恒真になる)。SHELL の4件が欠けると
    // オフライン起動が成立せず、さけのわ JSON が欠けると起動しても銘柄サジェストが空になる。
    expect(cacheOf(sw).addAllCalls).toEqual([
      [
        './',
        './index.html',
        './manifest.json',
        './favicon.svg',
        './assets/index-Bgfn5RMp.js',
        './assets/index-BSquqqeP.css',
        './data/sakenowa/brands.json',
      ],
    ])
    expect(cacheOf(sw).entries.size).toBe(7)
    expect(sw.fetchSpy.mock.calls.length).toBe(7)
    expect(sw.skipWaiting).toHaveBeenCalledTimes(1)
  })

  it('OCR 資産(7.7MB)は install で取りに行かない', async () => {
    const sw = loadSw(online)

    await fireExtendable(sw, 'install')

    // 原子的な addAll に OCR を載せると、7.7MB のうち1件の失敗で install ごと reject され、
    // **アプリのオフライン起動**が巻き添えで壊れる(OCR はアプリの起動条件ではない)。
    // install で取りに行った URL に `/ocr/` が1つも無いことを直接固定する。
    const requested = sw.fetchSpy.mock.calls.map(([input]) => keyOf(input))
    expect(requested.filter(url => url.includes('/ocr/'))).toEqual([])
    expect(sw.cacheStorage.caches.has(OCR_CACHE)).toBe(false)
  })

  it('1件でも取れなければ install ごと失敗し、キャッシュに何も残さない', async () => {
    const broken = './data/sakenowa/brands.json'
    const flaky: Fetcher = async input =>
      keyOf(input) === keyOf(broken) ? new Response('', { status: 503 }) : new Response('ok')
    const sw = loadSw(flaky)

    // best-effort にすると欠落したまま install 成功扱いになり二度と再試行されない。
    // 落ちることが仕様(ブラウザが次のナビゲーションで install を再試行する)。
    await expect(fireExtendable(sw, 'install')).rejects.toThrow()
    expect(cacheOf(sw).entries.size).toBe(0)
    expect(sw.skipWaiting).not.toHaveBeenCalled()
  })
})

describe('sw.js activate', () => {
  it('現世代以外のキャッシュを消して clients.claim する', async () => {
    const sw = loadSw(online)
    await sw.cacheStorage.open('sake-1700000000000')
    await sw.cacheStorage.open(CACHE)

    await fireExtendable(sw, 'activate')

    expect(await sw.cacheStorage.keys()).toEqual([CACHE])
    expect(sw.claim).toHaveBeenCalledTimes(1)
  })

  it('OCR 層はデプロイを跨いで残し、資産が入れ替わった旧世代だけ消す', async () => {
    const sw = loadSw(online)
    await sw.cacheStorage.open('sake-1700000000000') // 旧シェル(毎デプロイで名前が変わる)
    await sw.cacheStorage.open('sake-ocr-oldbytes') // 旧 OCR 層(資産を差し替えた前世代)
    await sw.cacheStorage.open(CACHE)
    await sw.cacheStorage.open(OCR_CACHE)

    await fireExtendable(sw, 'activate')

    // OCR 層の名前は**資産の中身**で決まる。シェルと同じ命名にすると、資産が1バイトも
    // 変わっていないのにデプロイのたびに 7.7MB を捨てて取り直させることになる。
    expect((await sw.cacheStorage.keys()).sort()).toEqual([CACHE, OCR_CACHE].sort())
  })
})

describe('sw.js fetch — OCR 層', () => {
  const OCR_URL = `${BASE}ocr/tessdata/jpn.traineddata.gz`

  it('OCR 資産は OCR 層に入る(シェル層を汚さない)', async () => {
    const sw = loadSw(online)
    await fireExtendable(sw, 'install')

    const res = await respondedFor(sw, { method: 'GET', url: OCR_URL })

    expect(await res.text()).toBe(`body:${OCR_URL}`)
    expect(cacheOf(sw, OCR_CACHE).entries.has(OCR_URL)).toBe(true)
    // シェル層に入れてしまうと、次のデプロイの activate で 7.7MB ごと消える
    expect(cacheOf(sw, CACHE).entries.has(OCR_URL)).toBe(false)
  })

  it('2回目以降はオフラインでもキャッシュから返す', async () => {
    const sw = loadSw(online)
    await respondedFor(sw, { method: 'GET', url: OCR_URL })
    const afterFirst = sw.fetchSpy.mock.calls.length
    sw.fetchSpy.mockImplementation(offline)

    const res = await respondedFor(sw, { method: 'GET', url: OCR_URL })

    // 「初回に取得され、以降キャッシュから使える」= install を太らせずにオフラインで OCR が動く
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(`body:${OCR_URL}`)
    expect(sw.fetchSpy.mock.calls.length).toBe(afterFirst)
  })

  it('OCR エンジンのチャンク(assets 配下)はシェル層に入る', async () => {
    // 振り分けは `./ocr/` の**パス接頭辞**だけで決める。動的 import のチャンクは
    // ハッシュ付きで assets/ に出るので、通常の資産と同じ扱いでよい(内容アドレス指定)。
    const sw = loadSw(online)
    const url = `${BASE}assets/src-PSSG285w.js`

    await respondedFor(sw, { method: 'GET', url })

    expect(cacheOf(sw, CACHE).entries.has(url)).toBe(true)
    expect(sw.cacheStorage.caches.has(OCR_CACHE)).toBe(false)
  })
})

describe('sw.js fetch — オフラインかつ未キャッシュ', () => {
  it('504 の Response を返す(構築に失敗して素のネットワークエラーにしない)', async () => {
    const sw = loadSw(offline)

    const res = await respondedFor(sw, { method: 'GET', url: `${BASE}data/sakenowa/brands.json` })

    expect(res.status).toBe(504)
    // 理由は**本文**に置く。statusText に日本語を入れると Response の構築が TypeError で落ちる。
    expect(await res.text()).toBe('オフラインでキャッシュにも無い')
    expect(res.statusText).toBe('Gateway Timeout')
    // statusText は ByteString(ISO-8859-1)。範囲外(> 0xff)の文字が1つも無いことを直接固定する。
    const outOfByteStringRange = [...res.statusText].filter(ch => (ch.codePointAt(0) ?? 0) > 0xff)
    expect(outOfByteStringRange).toEqual([])
    // `!res.ok` なので src/data/tables.ts の「さけのわデータを取得できない: ... (504)」に到達する
    expect(res.ok).toBe(false)
  })

  it('ナビゲーションはキャッシュ済みシェルに落ちる', async () => {
    const sw = loadSw(online)
    await fireExtendable(sw, 'install')
    sw.fetchSpy.mockImplementation(offline)

    // ホーム画面から起動した文書URL(クエリ付き)は './' と一致しないので、シェルに落ちる経路を通る
    const res = await respondedFor(sw, {
      method: 'GET',
      url: `${BASE}?from=homescreen`,
      mode: 'navigate',
    })

    expect(res.status).toBe(200)
    expect(await res.text()).toBe(`body:${BASE}`)
  })

  it('ナビゲーションでシェルも無ければ 504 を返す(reject しない)', async () => {
    const sw = loadSw(offline)

    const res = await respondedFor(sw, { method: 'GET', url: BASE, mode: 'navigate' })

    expect(res.status).toBe(504)
    expect(res.statusText).toBe('Gateway Timeout')
    expect(await res.text()).toBe('オフラインでキャッシュにも無い')
  })
})

describe('sw.js fetch — cache-first', () => {
  it('キャッシュにあればネットワークに出ない', async () => {
    const sw = loadSw(online)
    await fireExtendable(sw, 'install')
    expect(sw.fetchSpy.mock.calls.length).toBe(7)

    const url = `${BASE}data/sakenowa/brands.json`
    const res = await respondedFor(sw, { method: 'GET', url })

    expect(await res.text()).toBe(`body:${url}`)
    expect(sw.fetchSpy.mock.calls.length).toBe(7)
  })

  it('未キャッシュは取得して次回のためにキャッシュへ入れる', async () => {
    const sw = loadSw(online)
    const url = `${BASE}assets/late-DEADBEEF.js`

    const res = await respondedFor(sw, { method: 'GET', url })

    expect(await res.text()).toBe(`body:${url}`)
    expect(cacheOf(sw).entries.has(url)).toBe(true)
  })

  it('ok でない応答はそのまま返し、キャッシュには入れない', async () => {
    const notFound: Fetcher = async () => new Response('missing', { status: 404 })
    const sw = loadSw(notFound)

    const res = await respondedFor(sw, { method: 'GET', url: `${BASE}assets/typo.js` })

    expect(res.status).toBe(404)
    expect(sw.cacheStorage.caches.size).toBe(0)
  })

  it('caches.match には ignoreVary: true を渡す', async () => {
    // vite preview は同一オリジンの応答にも `Vary: Origin` を付ける。Vary を尊重すると
    // install で入れたエントリと文書が出す要求が突合せず、オフラインで JS/CSS が落ちる(実測済み)。
    // オンラインの fetcher で回す — オフラインにすると offlineFailure の不具合でも落ちて、
    // 「Vary を見なくなった」以外の理由で赤くなる(失敗の原因が1対1にならない)。
    const sw = loadSw(online)
    const url = `${BASE}assets/index-Bgfn5RMp.js`

    await respondedFor(sw, { method: 'GET', url })

    expect(sw.cacheStorage.matchCalls).toEqual([{ key: url, options: { ignoreVary: true } }])
  })
})

describe('sw.js fetch — 介入しない要求', () => {
  it('クロスオリジンは respondWith しない', () => {
    const sw = loadSw(online)

    expect(
      fireFetch(sw, { method: 'GET', url: 'https://other.test/some-base/index.js' }),
    ).toBeUndefined()
  })

  it('GET 以外は respondWith しない', () => {
    const sw = loadSw(online)

    expect(
      fireFetch(sw, { method: 'POST', url: `${BASE}data/sakenowa/brands.json` }),
    ).toBeUndefined()
  })
})
