// 同期先の受け入れ検査。`wrangler dev` を別窓で上げてから `npm run verify` で回す。
//
//   npm run dev          # 別窓。http://localhost:8787
//   npm run verify       # ここ
//   SYNC_URL=https://... SYNC_TOKEN=... npm run verify   # 本番に向けても回せる
//
// **単体テストでは届かない層をここで見る。** 認証・CORS・SQL の勝ち負け・BLOB の往復は
// 実際に D1 を通さないと確かめられない(モックで置き換えると、確かめたい当のものが消える)。
//
// 落ちたら**何を期待して何が来たか**を出して 1 で終わる。

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.SYNC_URL ?? 'http://localhost:8787'
const ORIGIN = process.env.SYNC_ORIGIN ?? 'https://one-shine.github.io'

/** ローカル実行なら `.dev.vars` から読む(本番は環境変数で渡す) */
function token() {
  if (process.env.SYNC_TOKEN) return process.env.SYNC_TOKEN
  const text = readFileSync(resolve(here, '.dev.vars'), 'utf8')
  const match = /^SYNC_TOKEN\s*=\s*"?([^"\n]+)"?/m.exec(text)
  if (!match) throw new Error('.dev.vars から SYNC_TOKEN を読めない')
  return match[1]
}

const TOKEN = token()

let passed = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function call(path, { method = 'GET', body, auth = TOKEN, headers = {} } = {}) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(auth === null ? {} : { Authorization: `Bearer ${auth}` }),
      ...(body !== undefined && !(body instanceof Uint8Array)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...headers,
    },
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
  })
}

const iso = (ms) => new Date(ms).toISOString()

/** 記録の中身。サーバは中を見ないが、クライアントの検証を通る形にしておく */
function recordBody(id, updatedAt, note = '') {
  return {
    id,
    drankOn: '2026-08-01',
    brandLabel: 'テスト',
    sakenowaBrandId: null,
    brandName: null,
    linkStatus: 'unlinked',
    prefecture: null,
    spec: '',
    rating: null,
    place: '',
    note,
    sourceNo: null,
    createdAt: updatedAt,
    updatedAt,
  }
}

function recordEnvelope(id, updatedAt, { deletedAt = null, hasThumbnail = false, note = '' } = {}) {
  return {
    id,
    updatedAt,
    deletedAt,
    hasThumbnail,
    body: deletedAt === null ? recordBody(id, updatedAt, note) : null,
  }
}

// 同じ DB に何度も流すので、実行ごとに違う id を使う(前回の行と混ざらない)
const run = Math.floor(Date.now() / 1000).toString(36)
const ID = (suffix) => `t-${run}-${suffix}`

async function main() {
  console.log(`同期先: ${BASE}`)

  // --- 認証 ---------------------------------------------------------------
  console.log('\n認証')
  {
    const res = await call('/changes', { auth: null })
    const text = await res.text()
    check('トークン無しは 401', res.status === 401, `status=${res.status}`)
    check('401 でも記録を1件も返さない', !text.includes('drankOn'), text.slice(0, 120))
    check(
      '401 にも CORS ヘッダが付く(付かないとブラウザが理由を読めない)',
      res.headers.get('access-control-allow-origin') !== null,
    )
  }
  {
    const res = await call('/changes', { auth: 'wrong-token-wrong-token-wrong-token' })
    check('誤ったトークンは 401', res.status === 401, `status=${res.status}`)
  }

  // --- CORS ---------------------------------------------------------------
  console.log('\nCORS')
  {
    const res = await fetch(`${BASE}/changes`, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    })
    check('preflight は 204', res.status === 204, `status=${res.status}`)
    check('preflight は認証を要求しない', res.status !== 401)
    check(
      'Authorization が許可ヘッダに入っている',
      (res.headers.get('access-control-allow-headers') ?? '').toLowerCase().includes('authorization'),
    )
    check('Vary: Origin が付く', (res.headers.get('vary') ?? '').includes('Origin'))
  }

  // --- 往復 ---------------------------------------------------------------
  console.log('\n変更の往復')
  const idA = ID('a')
  let cursorBefore
  {
    const res = await call('/changes')
    const pulled = await res.json()
    cursorBefore = pulled.cursor
    check('pull できる', res.ok, `status=${res.status}`)
    check('位置が整数で返る', Number.isInteger(pulled.cursor))
  }
  {
    const res = await call('/changes', {
      method: 'POST',
      body: { records: [recordEnvelope(idA, iso(1_800_000_000_000), { note: '初回' })], aliases: [] },
    })
    const pushed = await res.json()
    check('push が通る', res.ok, `status=${res.status} ${JSON.stringify(pushed)}`)
    check('1件採用された', pushed.accepted === 1, JSON.stringify(pushed))
    check('位置が進んだ', pushed.cursor > cursorBefore, `${cursorBefore} → ${pushed.cursor}`)
  }
  {
    const res = await call(`/changes?since=${cursorBefore}`)
    const pulled = await res.json()
    const found = pulled.records.find((entry) => entry.id === idA)
    check('送った記録が戻ってくる', found !== undefined)
    check('中身が保たれている', found?.body?.note === '初回', JSON.stringify(found?.body))
    check('削除されていない', found?.deletedAt === null)
  }

  // --- 新しいほうだけ採る -------------------------------------------------
  console.log('\n勝ち負け')
  {
    const res = await call('/changes', {
      method: 'POST',
      body: {
        records: [recordEnvelope(idA, iso(1_700_000_000_000), { note: '古い' })],
        aliases: [],
      },
    })
    const pushed = await res.json()
    check('古い更新は採らない', pushed.accepted === 0 && pushed.rejected === 1, JSON.stringify(pushed))
  }
  {
    const res = await call(`/changes?since=${cursorBefore}`)
    const pulled = await res.json()
    const found = pulled.records.find((entry) => entry.id === idA)
    check('保管されている値は上書きされていない', found?.body?.note === '初回', JSON.stringify(found?.body))
  }
  {
    const res = await call('/changes', {
      method: 'POST',
      body: { records: [recordEnvelope(idA, iso(1_900_000_000_000), { note: '新しい' })], aliases: [] },
    })
    const pushed = await res.json()
    check('新しい更新は採る', pushed.accepted === 1, JSON.stringify(pushed))
  }
  {
    const res = await call('/changes', {
      method: 'POST',
      body: { records: [recordEnvelope(idA, iso(1_900_000_000_000), { note: '同点' })], aliases: [] },
    })
    const pushed = await res.json()
    check('同点は採らない(押し合いにしない)', pushed.accepted === 0, JSON.stringify(pushed))
  }

  // --- サムネイル ---------------------------------------------------------
  console.log('\nサムネイル')
  const idB = ID('b')
  const bytes = new Uint8Array(3000)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) % 256
  {
    await call('/changes', {
      method: 'POST',
      body: { records: [recordEnvelope(idB, iso(1_800_000_000_000), { hasThumbnail: true })], aliases: [] },
    })
    const put = await call(`/thumb/${idB}`, { method: 'PUT', body: bytes })
    check('写真を置ける', put.ok, `status=${put.status}`)

    const got = await call(`/thumb/${idB}`)
    const back = new Uint8Array(await got.arrayBuffer())
    check('写真がバイト単位で一致する', back.length === bytes.length && back.every((v, i) => v === bytes[i]),
      `${bytes.length} → ${back.length}`)
  }
  {
    // 写真を外した記録を送ると、保管されている写真も消える
    await call('/changes', {
      method: 'POST',
      body: { records: [recordEnvelope(idB, iso(1_900_000_000_000), { hasThumbnail: false })], aliases: [] },
    })
    const got = await call(`/thumb/${idB}`)
    check('写真を外すと保管側からも消える', got.status === 404, `status=${got.status}`)
  }
  {
    const big = new Uint8Array(500_000)
    const res = await call(`/thumb/${ID('big')}`, { method: 'PUT', body: big })
    check('大きすぎる写真は断る', res.status === 413, `status=${res.status}`)
  }

  // --- 削除 ---------------------------------------------------------------
  console.log('\n削除')
  const idC = ID('c')
  {
    await call('/changes', {
      method: 'POST',
      body: { records: [recordEnvelope(idC, iso(1_800_000_000_000), { hasThumbnail: true })], aliases: [] },
    })
    await call(`/thumb/${idC}`, { method: 'PUT', body: bytes })
    const mark = await call('/changes', {
      method: 'POST',
      body: {
        records: [recordEnvelope(idC, iso(1_800_000_000_000), { deletedAt: iso(1_900_000_000_000) })],
        aliases: [],
      },
    })
    check('削除を送れる', (await mark.json()).accepted === 1)

    const res = await call(`/changes?since=${cursorBefore}`)
    const pulled = await res.json()
    const found = pulled.records.find((entry) => entry.id === idC)
    check('削除として戻ってくる', found?.deletedAt !== null && found?.body === null, JSON.stringify(found))

    const got = await call(`/thumb/${idC}`)
    check('削除した記録の写真も消える', got.status === 404, `status=${got.status}`)
  }

  // --- 手動紐付け(キーに制御文字が入る) -----------------------------------
  console.log('\n手動紐付けのキー')
  {
    // `aliasKey()` は `normalize(label) + NUL + prefecture` を返す。**この NUL が要点** —
    // SQLite / D1 が NUL で文字列を切るなら、県付きと県なしが同じ行に潰れて片方が黙って消える
    const key = `\u5beb\u697d${run}\u0000\u798f\u5cf6\u770c`
    const res = await call('/changes', {
      method: 'POST',
      body: {
        records: [],
        aliases: [
          {
            key,
            updatedAt: iso(1_800_000_000_000),
            deletedAt: null,
            body: { label: `寫楽${run}`, prefecture: '福島県', brandId: 1234 },
          },
        ],
      },
    })
    check('別名を送れる', (await res.json()).accepted === 1)

    const pulled = await (await call(`/changes?since=${cursorBefore}`)).json()
    const found = pulled.aliases.find((entry) => entry.key.startsWith(`寫楽${run}`))
    check('キーが NUL ごとそのまま戻る', found?.key === key,
      `sent=${JSON.stringify(key)} got=${JSON.stringify(found?.key)}`)
    check('県が保たれている', found?.body?.prefecture === '福島県', JSON.stringify(found?.body))
  }

  // --- 断り方 -------------------------------------------------------------
  console.log('\n断り方')
  {
    const many = Array.from({ length: 30 }, (_, i) => recordEnvelope(ID(`many${i}`), iso(1_800_000_000_000)))
    const res = await call('/changes', { method: 'POST', body: { records: many, aliases: [] } })
    check('多すぎる push は断る(黙って切り捨てない)', res.status === 413, `status=${res.status}`)
  }
  {
    const res = await call('/changes', { headers: { 'X-Sync-Schema': '99' } })
    check('知らない版は断る', res.status === 400, `status=${res.status}`)
  }
  {
    const res = await call('/changes', { method: 'POST', body: { records: [{ id: 'x' }], aliases: [] } })
    check('形の違う封筒は断る', res.status === 400, `status=${res.status}`)
  }
  {
    const res = await call('/nowhere')
    check('知らない窓口は 404', res.status === 404, `status=${res.status}`)
  }
  {
    const res = await call('/changes?since=999999999')
    const pulled = await res.json()
    check(
      '位置が先すぎるときは最初から返す(取りこぼさない)',
      pulled.records.length > 0 || pulled.aliases.length > 0,
      JSON.stringify({ cursor: pulled.cursor, n: pulled.records.length }),
    )
  }

  // --- 件数の区切り -------------------------------------------------------
  console.log('\n件数の区切り')
  {
    let cursor = (await (await call('/changes?since=999999999')).json()).cursor
    // 15件ずつ 8 回 = 120件。1回の pull 上限(100)を越える
    for (let batch = 0; batch < 8; batch++) {
      const records = Array.from({ length: 15 }, (_, i) =>
        recordEnvelope(ID(`p${batch}-${i}`), iso(1_800_000_000_000)),
      )
      const res = await call('/changes', { method: 'POST', body: { records, aliases: [] } })
      if (!res.ok) {
        check('分割 push が通る', false, `batch=${batch} status=${res.status}`)
        break
      }
    }
    const first = await (await call('/changes?since=0')).json()
    check('1回で返しすぎない', first.records.length + first.aliases.length <= 100, String(first.records.length))
    check('続きがあると言う', first.hasMore === true, JSON.stringify(first.hasMore))

    // 続きを最後まで辿ると、途中で止まらずに全件届く
    const seen = new Set()
    let page = first
    let guard = 0
    for (;;) {
      for (const entry of page.records) seen.add(entry.id)
      if (!page.hasMore || guard++ > 20) break
      page = await (await call(`/changes?since=${page.cursor}`)).json()
    }
    const expected = 120
    const mine = [...seen].filter((id) => id.startsWith(`t-${run}-p`)).length
    check('続きを辿ると全件届く', mine === expected, `${mine} / ${expected}`)
    check('位置が進んでいる', page.cursor > cursor, `${cursor} → ${page.cursor}`)
    cursor = page.cursor

    const empty = await (await call(`/changes?since=${cursor}`)).json()
    check('同じ位置から引き直すと空', empty.records.length === 0 && empty.aliases.length === 0,
      JSON.stringify({ n: empty.records.length }))
  }

  console.log(`\n${passed} 件通過 / ${failures.length} 件失敗`)
  if (failures.length > 0) {
    console.log('\n失敗:')
    for (const line of failures) console.log(`  - ${line}`)
    process.exit(1)
  }
}

await main()
