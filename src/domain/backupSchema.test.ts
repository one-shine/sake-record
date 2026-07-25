// @vitest-environment node
// backupSchema は純TS(DOM も React も要らない)。node 環境で回すこと自体がその実証で、
// window/document に触る実装が混ざった瞬間にこのファイルが落ちる。
//
// テストデータは**すべて合成**。実際の飲酒記録(`data/seed/` は gitignore)を転記しない。
import {
  APP_ID,
  LINK_STATUSES,
  SCHEMA_VERSION,
  checkExportPayload,
  isBrandAlias,
  isExportPayload,
  isExportedRecord,
  isLinkStatus,
  isRating,
  toDomainRecord,
  toExportedRecord,
} from './backupSchema.ts'
import type { ExportPayload, ExportedRecord } from './backupSchema.ts'
import type { SakeRecord } from './types.ts'

function wireRecord(over: Partial<ExportedRecord> = {}): ExportedRecord {
  return {
    id: 'id-1',
    drankOn: '2020-01-01',
    brandLabel: 'テスト酒',
    sakenowaBrandId: null,
    brandName: null,
    linkStatus: 'unknown',
    prefecture: null,
    spec: '',
    rating: null,
    place: '',
    note: '',
    thumbnail: null,
    sourceNo: null,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    ...over,
  }
}

function domainRecord(over: Partial<SakeRecord> = {}): SakeRecord {
  return { ...wireRecord(), thumbnail: null, ...over }
}

function payload(over: Partial<ExportPayload> = {}): ExportPayload {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: '2020-03-04T05:06:07.000Z',
    records: [],
    aliases: [],
    ...over,
  }
}

describe('SCHEMA_VERSION / APP_ID', () => {
  it('版は 1 から始まる', () => {
    expect(SCHEMA_VERSION).toBe(1)
  })

  it('アプリ識別子は中立名(表示名を含まない)', () => {
    // ブランド名は表示文字列の3ファイルにだけ置く方針。scripts/check-naming.mjs が全 src を見張る
    expect(APP_ID).toMatch(/^[a-z0-9-]+$/)
  })
})

describe('isLinkStatus / isRating', () => {
  it('linkStatus の実行時列挙は型の5値と一致する', () => {
    expect([...LINK_STATUSES].sort()).toEqual(['alias', 'auto', 'manual', 'unknown', 'unlinked'])
  })

  it('5値を受け、それ以外を弾く', () => {
    for (const status of LINK_STATUSES) expect(isLinkStatus(status)).toBe(true)
    expect(isLinkStatus('linked')).toBe(false)
    expect(isLinkStatus('')).toBe(false)
    expect(isLinkStatus(null)).toBe(false)
    // Object.prototype 由来のキーを拾わない
    expect(isLinkStatus('toString')).toBe(false)
  })

  it('rating は 1..5 の整数だけ', () => {
    for (const value of [1, 2, 3, 4, 5]) expect(isRating(value)).toBe(true)
    for (const value of [0, 6, 3.5, -1, '3', null]) expect(isRating(value)).toBe(false)
  })
})

describe('isExportedRecord', () => {
  it('合成の1件を受ける', () => {
    expect(isExportedRecord(wireRecord())).toBe(true)
  })

  it('thumbnail は data URL 文字列か null だけ', () => {
    expect(isExportedRecord(wireRecord({ thumbnail: 'data:image/jpeg;base64,/9j/AQID' }))).toBe(true)
    expect(isExportedRecord(wireRecord({ thumbnail: null }))).toBe(true)
    // JSON 経由で Blob が `{}` に潰れた入力・素のパスなどは受けない
    expect(isExportedRecord({ ...wireRecord(), thumbnail: {} })).toBe(false)
    expect(isExportedRecord(wireRecord({ thumbnail: '/photos/1.jpg' }))).toBe(false)
  })

  it('欠けた項目・型違いを弾く', () => {
    expect(isExportedRecord(wireRecord({ id: '' }))).toBe(false)
    expect(isExportedRecord(wireRecord({ drankOn: '2020-1-1' }))).toBe(false)
    expect(isExportedRecord(wireRecord({ drankOn: '' }))).toBe(false)
    expect(isExportedRecord({ ...wireRecord(), linkStatus: 'linked' })).toBe(false)
    expect(isExportedRecord({ ...wireRecord(), rating: 6 })).toBe(false)
    expect(isExportedRecord({ ...wireRecord(), spec: null })).toBe(false)
    expect(isExportedRecord({ ...wireRecord(), sourceNo: 1.5 })).toBe(false)
    const { note: _note, ...withoutNote } = wireRecord()
    expect(isExportedRecord(withoutNote)).toBe(false)
  })

  it('rating が null(未評価)の203本の形を受ける', () => {
    expect(isExportedRecord(wireRecord({ rating: null, sourceNo: 203 }))).toBe(true)
  })

  it('object でない値を弾く', () => {
    for (const value of [null, undefined, 1, 'x', [wireRecord()]]) {
      expect(isExportedRecord(value)).toBe(false)
    }
  })
})

describe('isBrandAlias', () => {
  it('label / prefecture / brandId を見る', () => {
    expect(isBrandAlias({ label: 'てすとしゅ', prefecture: null, brandId: 1 })).toBe(true)
    expect(isBrandAlias({ label: 'てすとしゅ', prefecture: '福島県', brandId: 1 })).toBe(true)
    expect(isBrandAlias({ label: '', prefecture: null, brandId: 1 })).toBe(false)
    expect(isBrandAlias({ label: 'てすとしゅ', prefecture: null })).toBe(false)
    expect(isBrandAlias({ label: 'てすとしゅ', prefecture: null, brandId: '1' })).toBe(false)
  })
})

describe('isExportPayload — 封筒の形', () => {
  it('4項目そろっていれば受ける(app は任意)', () => {
    expect(isExportPayload(payload())).toBe(true)
    expect(isExportPayload({ ...payload(), app: APP_ID })).toBe(true)
  })

  it('項目が欠けたら弾く', () => {
    const { aliases: _aliases, ...withoutAliases } = payload()
    expect(isExportPayload(withoutAliases)).toBe(false)
    const { records: _records, ...withoutRecords } = payload()
    expect(isExportPayload(withoutRecords)).toBe(false)
    expect(isExportPayload({ ...payload(), schemaVersion: '1' })).toBe(false)
    expect(isExportPayload({ ...payload(), exportedAt: '' })).toBe(false)
    expect(isExportPayload({ ...payload(), records: {} })).toBe(false)
  })

  it('配列や null は封筒ではない', () => {
    expect(isExportPayload([payload()])).toBe(false)
    expect(isExportPayload(null)).toBe(false)
  })

  it('要素の中身は見ない(壊れた1件で全滅させず、部分インポートに回せるようにする)', () => {
    const mixed = payload({ records: [wireRecord({ id: 'ok' }), wireRecord({ id: '' })] })
    expect(isExportPayload(mixed)).toBe(true)
    expect(isExportedRecord(mixed.records[0])).toBe(true)
    expect(isExportedRecord(mixed.records[1])).toBe(false)
  })
})

describe('checkExportPayload — 版とアプリの検査', () => {
  it('現在の版を受け、payload をそのまま返す', () => {
    const value = payload()
    const result = checkExportPayload(value)
    expect(result).toEqual({ ok: true, payload: value })
  })

  it('未来の版は拒否し、理由に「拒否した版」を書く(知らない項目を黙って捨てない)', () => {
    // 版はリテラルで書く。`SCHEMA_VERSION + 1` で作ると理由文の「読めるのは vN まで」の節にも
    // `vN+1` が現れず、素の `/v2/` は**どちらの節にも当たる恒真**になる(SCHEMA_VERSION を 2 に
    // 変異させても緑のまま通っていた)。**拒否した版だけを見る**形にする。
    const result = checkExportPayload(payload({ schemaVersion: 2 }))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('新しい形式のバックアップ(v2)')
    // 読める上限も理由に出す(いま読めるのは v1 まで)
    expect(result.ok === false && result.reason).toContain('読めるのは v1 まで')
  })

  it('不正な版は拒否する', () => {
    expect(checkExportPayload(payload({ schemaVersion: 0 })).ok).toBe(false)
    expect(checkExportPayload(payload({ schemaVersion: -1 })).ok).toBe(false)
  })

  it('app が別アプリなら理由を付けて拒否する', () => {
    const result = checkExportPayload({ ...payload(), app: 'other-app' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/other-app/)
  })

  it('app が無いペイロードは受ける(手書き・古い出力でも読める)', () => {
    expect(checkExportPayload(payload()).ok).toBe(true)
  })

  it('形が違うときは理由を返す(無音で空にしない)', () => {
    const result = checkExportPayload({ records: [] })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason.length).toBeGreaterThan(0)
  })

  it('JSON.parse を通した往復でも受ける', () => {
    const value = payload({ records: [wireRecord()], aliases: [{ label: 'x', prefecture: null, brandId: 1 }] })
    const parsed: unknown = JSON.parse(JSON.stringify({ ...value, app: APP_ID }))
    const result = checkExportPayload(parsed)
    expect(result.ok).toBe(true)
    expect(result.ok === true && result.payload.records).toHaveLength(1)
  })
})

describe('ドメイン型 ↔ wire 型', () => {
  it('toExportedRecord は thumbnail 以外を素通しし、thumbnail を data URL に差し替える', () => {
    const url = 'data:image/jpeg;base64,/9j/AQID'
    const exported = toExportedRecord(domainRecord({ id: 'a', spec: '純米大吟醸' }), url)
    expect(exported.thumbnail).toBe(url)
    expect(exported.spec).toBe('純米大吟醸')
    expect(isExportedRecord(exported)).toBe(true)
  })

  it('往復で項目が1つも落ちない', () => {
    const original = domainRecord({
      id: 'a',
      brandLabel: 'テスト酒',
      sakenowaBrandId: 1,
      brandName: 'テスト酒',
      linkStatus: 'alias',
      prefecture: '福島県',
      spec: '純米',
      rating: 4,
      place: '自宅',
      note: 'めも',
      sourceNo: 7,
    })
    const back = toDomainRecord(toExportedRecord(original, null), null)
    expect(back).toEqual(original)
    // spread ではなく項目を書き並べているので、キー集合の一致自体が意味を持つ
    expect(Object.keys(back).sort()).toEqual(Object.keys(original).sort())
  })

  it('Blob は wire 型に入らない / data URL はドメイン型に入らない(型で区別を強制する)', () => {
    // @ts-expect-error thumbnail: Blob は wire 型(data URL 文字列)に代入できない
    const wrongWire: ExportedRecord = { ...domainRecord(), thumbnail: new Blob(['x']) }
    // @ts-expect-error thumbnail: data URL 文字列はドメイン型(Blob)に代入できない
    const wrongDomain: SakeRecord = { ...wireRecord(), thumbnail: 'data:image/jpeg;base64,/9j/' }
    expect(wrongWire.thumbnail).toBeDefined()
    expect(wrongDomain.thumbnail).toBeDefined()
  })
})
