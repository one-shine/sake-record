// 同期先の受け入れ検査。`wrangler dev` を別窓で上げてから `npm run verify` で回す。
//
//   npm run dev          # 別窓。http://localhost:8787
//   npm run verify       # ここ
//   SYNC_URL=https://... SYNC_PASSWORD=... npm run verify   # 本番に向けても回せる
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
function password() {
  if (process.env.SYNC_PASSWORD) return process.env.SYNC_PASSWORD
  const text = readFileSync(resolve(here, '.dev.vars'), 'utf8')
  const match = /^SYNC_PASSWORD\s*=\s*"?([^"\n]+)"?/m.exec(text)
  if (!match) throw new Error('.dev.vars から SYNC_PASSWORD を読めない')
  return match[1]
}

/**
 * 合言葉を `Authorization` に載せられる形にする。**アプリと同じ変換**
 * (`src/domain/syncWire.ts` の `encodeSyncCredential`)。
 * ヘッダの値は1バイト文字だけなので、日本語の合言葉はそのままでは載らない。
 */
function encodeCredential(value) {
  return Buffer.from(value, 'utf8').toString('base64')
}

const PASSWORD = password()

/** ローカルの `wrangler dev` に向けているか。締め出しの後片付けができるのはこちらだけ */
const LOCAL = BASE.includes('localhost') || BASE.includes('127.0.0.1')

/**
 * 締め出しの検査を行うか。**本番では既定で行わない** — 通すとその回線が15分ほど
 * 同期できなくなり、しかも本番には記録を消す窓口が無い(抜け道を作らないため)。
 */
const LOCKOUT_CHECK = LOCAL || process.env.SYNC_LOCKOUT_CHECK === '1'

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

function call(path, { method = 'GET', body, auth = PASSWORD, headers = {} } = {}) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(auth === null ? {} : { Authorization: `Bearer ${encodeCredential(auth)}` }),
      ...(body !== undefined && !(body instanceof Uint8Array)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...headers,
    },
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
  })
}

/**
 * 続きがある限り辿って全部集める。**本物のクライアントと同じ**(1回の pull には件数の上限がある)。
 * ここを1ページで済ませると、DB に行が溜まった環境でだけ検査が落ちる。
 */
async function pullAll(since = 0) {
  const records = []
  const aliases = []
  const notes = []
  let cursor = since
  for (let page = 0; page < 50; page++) {
    const res = await call(`/changes?since=${cursor}`)
    if (!res.ok) {
      // **形の違う応答を配列として扱わない**(TypeError になって理由が消える)
      throw new Error(`pull が ${String(res.status)}: ${await res.text()}`)
    }
    const body = await res.json()
    records.push(...body.records)
    aliases.push(...body.aliases)
    // **無い応答を配列として扱わない**(古いサーバに当てたときに TypeError で理由が消える)
    notes.push(...(body.notes ?? []))
    cursor = body.cursor
    if (!body.hasMore) break
  }
  return { records, aliases, notes, cursor }
}

/**
 * 打ち間違いの記録を消す(**ローカルだけ**)。
 *
 * この検査は最後にわざと間違えるので、消さないと**次の実行が丸ごと 429 で落ちる**。
 * 本番に向けて回したときは何もしない — サーバに抜け道を作らないため、外から消す窓口は無い
 * (本番で締め出されたら15分待つ。それが正しい)。
 */
async function resetFailures() {
  if (!LOCAL) return
  const { execFileSync } = await import('node:child_process')
  execFileSync(
    resolve(here, 'node_modules/.bin/wrangler'),
    ['d1', 'execute', 'sake-record-sync', '--local', '--command', 'DELETE FROM auth_failures', '-y'],
    { cwd: here, stdio: 'ignore' },
  )
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

// **この検査は捨て置きの記録を書き込む。**
//
// 本番に向けて回したときも同じで、消さずに放っておくと**次に端末が同期したときに降ってくる**
// (アプリから見れば「同期先にある記録」なので、区別する手がかりが無い)。
// 本番で回したら、終わったあとに中身を空にすること:
//
//   wrangler d1 execute sake-record-sync --remote -y \
//     --command "DELETE FROM records; DELETE FROM aliases; DELETE FROM thumbs; \
//                DELETE FROM auth_failures; UPDATE cursor SET n = 0 WHERE only_row = 1;"
//
// **本物の記録が入ったあとは流せない**(区別が付かないので消せない)。本番に向けて回すのは
// 最初の1回だけにし、以後はローカルの `wrangler dev` で確かめる。
//
// 同じ DB に何度も流すので、実行ごとに違う id を使う(前回の行と混ざらない)。
// **秒だけだと同じ秒に2回走らせたときに衝突する**(同じ id・同じ時刻 = 同点なので採用されず、
// 「1件採用された」が落ちる)。乱数を混ぜる
const run = `${Math.floor(Date.now() / 1000).toString(36)}${Math.random().toString(36).slice(2, 6)}`
/** メモの宛先IDに使う実行ごとの番号。**キーが実行間で衝突しない**ようにする(記録の `run` と同じ役) */
const runIndex = Math.floor(Date.now() / 1000) % 100000
/** この実行で作った記録の id と別名のキー。**最後に全部消すために覚えておく** */
const created = { records: new Set(), aliases: new Set(), notes: new Set() }

const ID = (suffix) => {
  const id = `t-${run}-${suffix}`
  created.records.add(id)
  return id
}

async function main() {
  console.log(`同期先: ${BASE}`)

  {
    // 渡された合言葉が短ければ、通信する前に言う(サーバも受け付けない)
    const bytes = Buffer.byteLength(PASSWORD, 'utf8')
    if (bytes < 24) {
      console.log(`\n! 渡された合言葉が短い(${String(bytes)}バイト)。24バイト以上 = ひらがな8文字以上にする。`)
      process.exit(1)
    }
  }

  // **締め出されたまま始めない。** 以降が全部 429 で落ち、本当の失敗と見分けが付かなくなる
  {
    const probe = await call('/changes')
    if (probe.status === 429) {
      console.log('\n! 締め出されている。15分ほど待ってからもう一度実行する。')
      console.log('  すぐ解除するなら(管理者の直接操作。API に窓口は無い):')
      console.log(
        '    wrangler d1 execute sake-record-sync --remote -y --command "DELETE FROM auth_failures"',
      )
      process.exit(1)
    }
    if (probe.status === 503) {
      console.log(`\n! ${(await probe.json()).error}`)
      process.exit(1)
    }
    if (probe.status === 401) {
      console.log('\n! パスワードが合っていない。')
      console.log('  同期先に登録した値と、いま渡した値が同じか確かめる:')
      console.log('    wrangler secret put SYNC_PASSWORD   ← 登録し直す')
      console.log('  登録し直したら、アプリの同期画面でも「消す」→ 新しい合言葉を保存する。')
      process.exit(1)
    }
  }

  // --- 認証 ---------------------------------------------------------------
  console.log('\n認証')
  {
    const res = await call('/changes', { auth: null })
    const text = await res.text()
    check('パスワード無しは 401', res.status === 401, `status=${res.status}`)
    check('401 でも記録を1件も返さない', !text.includes('drankOn'), text.slice(0, 120))
    check(
      '401 にも CORS ヘッダが付く(付かないとブラウザが理由を読めない)',
      res.headers.get('access-control-allow-origin') !== null,
    )
  }
  {
    const res = await call('/changes', { auth: 'wrong-password-wrong-password-wrong-password' })
    check('誤ったパスワードは 401', res.status === 401, `status=${res.status}`)
  }
  {
    // **日本語の合言葉が送れること。** ヘッダの値は1バイト文字しか許さないので、そのまま載せると
    // `fetch` が例外を投げる(ブラウザでも同じ)。ここが通らないと「覚えられる合言葉を使えるように
    // する」という判断そのものが成立しない
    const res = await call('/changes', { auth: '日本語のあいことば' })
    check('日本語のパスワードでも例外にならず 401 が返る', res.status === 401, `status=${res.status}`)
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
    const pulled = await pullAll(cursorBefore)
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
    const pulled = await pullAll(cursorBefore)
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

    const pulled = await pullAll(cursorBefore)
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
    created.aliases.add(key)
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

    const pulled = await pullAll(cursorBefore)
    const found = pulled.aliases.find((entry) => entry.key.startsWith(`寫楽${run}`))
    check('キーが NUL ごとそのまま戻る', found?.key === key,
      `sent=${JSON.stringify(key)} got=${JSON.stringify(found?.key)}`)
    check('県が保たれている', found?.body?.prefecture === '福島県', JSON.stringify(found?.body))
  }

  // --- 銘柄・蔵元のメモ(B76) ----------------------------------------------
  console.log('\n銘柄・蔵元のメモ')
  {
    // `noteKey()` も `target + NUL + targetId`。**銘柄と蔵元で同じ番号を同時に送る** —
    // NUL で切られたり種類を無視したりすると、片方が例外なしに消える
    const brandKey = `brand\u0000${String(770000 + runIndex)}`
    const breweryKey = `brewery\u0000${String(770000 + runIndex)}`
    created.notes.add(brandKey)
    created.notes.add(breweryKey)
    const res = await call('/changes', {
      method: 'POST',
      body: {
        records: [],
        aliases: [],
        notes: [
          {
            key: brandKey,
            updatedAt: iso(1_800_000_000_000),
            deletedAt: null,
            body: { target: 'brand', targetId: 770000 + runIndex, text: `銘柄のメモ${run}` },
          },
          {
            key: breweryKey,
            updatedAt: iso(1_800_000_000_000),
            deletedAt: null,
            body: { target: 'brewery', targetId: 770000 + runIndex, text: `蔵元のメモ${run}` },
          },
        ],
      },
    })
    check('メモを送れる', (await res.json()).accepted === 2)

    const pulled = await pullAll(cursorBefore)
    const brandNote = pulled.notes.find((entry) => entry.key === brandKey)
    const breweryNote = pulled.notes.find((entry) => entry.key === breweryKey)
    check('銘柄のメモが戻る', brandNote?.body?.text === `銘柄のメモ${run}`, JSON.stringify(brandNote))
    // **同じ番号でも別々に保たれる。** 潰れていたらここで片方が消えるか上書きされる
    check('同じ番号の蔵元のメモが別に戻る', breweryNote?.body?.text === `蔵元のメモ${run}`,
      JSON.stringify(breweryNote))
    check('キーが NUL ごとそのまま戻る', brandNote?.key === brandKey,
      `sent=${JSON.stringify(brandKey)} got=${JSON.stringify(brandNote?.key)}`)
  }
  {
    // **古い方は採らない**(紐付けと同じ勝ち負けが効いているか)
    const key = `brand\u0000${String(770000 + runIndex)}`
    const res = await call('/changes', {
      method: 'POST',
      body: {
        records: [],
        aliases: [],
        notes: [
          {
            key,
            updatedAt: iso(1_700_000_000_000),
            deletedAt: null,
            body: { target: 'brand', targetId: 770000 + runIndex, text: '古い上書き' },
          },
        ],
      },
    })
    check('古いメモは採らない', (await res.json()).rejected === 1)
  }
  {
    // **notes を持たない本文でも記録の同期は止まらない**(端末とサーバは別々にデプロイされる)
    const res = await call('/changes', {
      method: 'POST',
      body: { records: [], aliases: [] },
    })
    check('notes が無い push も受ける', res.ok, `status=${res.status}`)
  }

  // --- 断り方 -------------------------------------------------------------
  console.log('\n断り方')
  {
    const many = Array.from({ length: 30 }, (_, i) => recordEnvelope(ID(`many${i}`), iso(1_800_000_000_000)))
    const res = await call('/changes', { method: 'POST', body: { records: many, aliases: [] } })
    check('多すぎる push は断る(黙って切り捨てない)', res.status === 413, `status=${res.status}`)
  }
  {
    const many = Array.from({ length: 30 }, (_, i) => ({
      key: `brand\u0000${String(880000 + i)}`,
      updatedAt: iso(1_800_000_000_000),
      deletedAt: null,
      body: { target: 'brand', targetId: 880000 + i, text: 'x' },
    }))
    const res = await call('/changes', {
      method: 'POST',
      body: { records: [], aliases: [], notes: many },
    })
    check('多すぎるメモの push も断る', res.status === 413, `status=${res.status}`)
  }
  {
    const res = await call('/changes', { headers: { 'X-Sync-Schema': '99' } })
    check('知らない版は断る', res.status === 400, `status=${res.status}`)
  }
  {
    const res = await call('/changes', { method: 'POST', body: { records: [{ id: 'x' }], aliases: [] } })
    check('形の違う変更は断る', res.status === 400, `status=${res.status}`)
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
    // 12件ずつ 10 回 = 120件。1回の pull 上限(100)を越える
    for (let batch = 0; batch < 10; batch++) {
      const records = Array.from({ length: 12 }, (_, i) =>
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

  // --- 回数制限 -----------------------------------------------------------
  //
  // **合言葉を自分で決められるようにした代償。** ここが効いていないと、覚えられる長さの
  // 言葉は機械で総当たりされる。
  //
  // 順序に意味がある: **先に「上限に届かない打ち間違いは消える」を見る**。締め出しの検査を
  // 先にやると、その後は何をしても 429 なので消える側を確かめられない。
  console.log('\n回数制限')
  {
    await resetFailures()
    for (let i = 0; i < 3; i++) await call('/changes', { auth: 'wrong-password-wrong-password' })
    const ok = await call('/changes')
    check('上限に届かない打ち間違いは、正しく入力できれば消える', ok.ok, `status=${ok.status}`)

    // 消えているので、この後さらに数回間違えても締め出されない
    let stillOpen = true
    for (let i = 0; i < 8; i++) {
      const res = await call('/changes', { auth: 'wrong-password-wrong-password' })
      if (res.status === 429) stillOpen = false
    }
    check('消えた分は数え直しになる', stillOpen)

    // **打ち間違いを残したまま終わらない。** 残すと次の実行が最初の数回で上限に届いて
    // 丸ごと落ちる(本番には記録を消す窓口が無いので、次の実行では回復できない)。
    // 上限に届いていないので、正しく入力すれば消える
    const cleared = await call('/changes')
    check('検査の後始末ができている(打ち間違いを残さない)', cleared.ok, `status=${cleared.status}`)
  }

  if (LOCKOUT_CHECK) {
    // **ここを通ると、この回線からは15分ほど同期できなくなる。**
    // 締め出し中は合言葉を見る前に断るので、**正解を出しても解除されない**
    // (解除できてしまうと「正解を混ぜれば何度でも試せる」= 総当たりが止まらない)
    let sawLimit = false
    let lastStatus = 0
    for (let i = 0; i < 14; i++) {
      const res = await call('/changes', { auth: 'wrong-password-wrong-password-wrong' })
      lastStatus = res.status
      if (res.status === 429) {
        sawLimit = true
        check('待ち時間を返す', res.headers.get('retry-after') !== null)
        break
      }
    }
    check('間違いが続くと断る(429)', sawLimit, `最後の応答=${lastStatus}`)

    const blocked = await call('/changes')
    check('締め出し中は正しいパスワードでも断る', blocked.status === 429, `status=${blocked.status}`)

    await resetFailures()
    if (!LOCAL) {
      console.log('  ! この回線は15分ほど締め出される(本番には記録を消す窓口を作っていない)')
    }
  } else {
    // **黙って飛ばさない。** 何を検査しなかったかを毎回言う
    console.log('  - 締め出しの検査は飛ばした(通すとこの回線が15分ほど同期できなくなるため)')
    console.log('    確かめるなら SYNC_LOCKOUT_CHECK=1 を付ける')
  }

  // --- 後片付け -----------------------------------------------------------
  //
  // **この検査が作った記録を消してから終わる。** 消さずに残すと、次に端末が同期したときに
  // 全部降りてくる(アプリから見れば「同期先にある記録」で、区別する手がかりが無い)。
  // 実際に踏んだ: 本番に122本が残り、利用者の画面に並んだ。
  //
  // 削除は**公開されている窓口をそのまま使う**(サーバに掃除用の抜け道を作らない)。
  // 時刻を遠い未来にするのは、検査が作る記録の更新時刻が未来の値だから
  // (それより新しくないと削除が勝てない)。
  console.log('\n後片付け')
  {
    const FAR_FUTURE = '2099-12-31T23:59:59.999Z'
    const records = [...created.records].map((id) => ({
      id,
      updatedAt: FAR_FUTURE,
      deletedAt: FAR_FUTURE,
      hasThumbnail: false,
      body: null,
    }))
    const aliases = [...created.aliases].map((key) => ({
      key,
      updatedAt: FAR_FUTURE,
      deletedAt: FAR_FUTURE,
      body: null,
    }))
    const notes = [...created.notes].map((key) => ({
      key,
      updatedAt: FAR_FUTURE,
      deletedAt: FAR_FUTURE,
      body: null,
    }))

    let sent = 0
    let failed = 0
    // 塊の大きさはサーバの上限に合わせる(records 12 / aliases 6 / notes 6)
    for (let at = 0; at < Math.max(records.length, aliases.length * 2, notes.length * 2); at += 12) {
      const res = await call('/changes', {
        method: 'POST',
        body: {
          records: records.slice(at, at + 12),
          aliases: aliases.slice(at / 2, at / 2 + 6),
          notes: notes.slice(at / 2, at / 2 + 6),
        },
      })
      if (res.ok) sent += (await res.json()).accepted
      else failed++
    }
    check('作った記録を消してから終わる', failed === 0, `送れなかった塊 ${String(failed)}`)
    console.log(`    ${String(sent)} 件を削除として送った`)

    // 残っていないことを、公開されている窓口から確かめる
    const left = await pullAll(0)
    const alive = left.records.filter((entry) => entry.deletedAt === null)
    check('生きている記録が1件も残っていない', alive.length === 0,
      `${String(alive.length)} 件残っている: ${alive.slice(0, 3).map((e) => e.id).join(', ')}`)
    const aliveNotes = left.notes.filter((entry) => entry.deletedAt === null)
    check('生きているメモが1件も残っていない', aliveNotes.length === 0,
      `${String(aliveNotes.length)} 件残っている`)
  }

  console.log(`\n${passed} 件通過 / ${failures.length} 件失敗`)
  if (failures.length > 0) {
    console.log('\n失敗:')
    for (const line of failures) console.log(`  - ${line}`)
    process.exit(1)
  }
}

await main()
