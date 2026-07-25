// 振り分けの取り違えは「既存の記録を消してから0件を書く」に直結するので、
// 判定だけを純関数として先に固定する(React も IndexedDB も起動しない)。
//
// データはすべて合成。実際の飲酒記録(`data/seed/` は gitignore)を fixture にしない。
// 日付リテラルは1種類に留める(BACKLOG B22 の台帳ガード)。

import { APP_ID, SCHEMA_VERSION } from '../../domain/backupSchema.ts'
import { detectImportFile } from './detectImportFile.ts'

const ROW = {
  no: 1,
  drankOn: '2020-01-01',
  brandLabel: 'テスト酒',
  prefecture: '福島県',
  spec: '純米',
  note: '',
}

const PAYLOAD = {
  schemaVersion: SCHEMA_VERSION,
  app: APP_ID,
  exportedAt: '2020-01-01T00:00:00.000Z',
  records: [],
  aliases: [{ label: 'てすと', prefecture: null, brandId: 1 }],
}

describe('detectImportFile', () => {
  it('行の配列は記録の元データとして振り分ける', () => {
    const detected = detectImportFile(JSON.stringify([ROW, { ...ROW, no: 2 }]))

    expect(detected.kind).toBe('seed')
    if (detected.kind !== 'seed') return
    expect(detected.rows).toHaveLength(2)
    expect(detected.rows[0].brandLabel).toBe('テスト酒')
  })

  it('封筒を持つオブジェクトはバックアップとして振り分け、本文をそのまま保持する', () => {
    const text = JSON.stringify(PAYLOAD)
    const detected = detectImportFile(text)

    expect(detected.kind).toBe('backup')
    if (detected.kind !== 'backup') return
    // 再直列化せずそのまま importAll に渡す(往復で形が変わる余地を作らない)
    expect(detected.text).toBe(text)
    expect(detected.records).toBe(0)
    expect(detected.aliases).toBe(1)
    expect(detected.exportedAt).toBe('2020-01-01T00:00:00.000Z')
  })

  it('app が無いペイロードも受ける(手書き・古い出力)', () => {
    const { app: _app, ...withoutApp } = PAYLOAD
    expect(detectImportFile(JSON.stringify(withoutApp)).kind).toBe('backup')
  })

  it('未来の schemaVersion は理由を付けて拒否する', () => {
    const detected = detectImportFile(
      JSON.stringify({ ...PAYLOAD, schemaVersion: SCHEMA_VERSION + 1 }),
    )

    expect(detected.kind).toBe('rejected')
    if (detected.kind !== 'rejected') return
    expect(detected.reason).toContain(`v${String(SCHEMA_VERSION + 1)}`)
  })

  it('別アプリのバックアップは理由を付けて拒否する', () => {
    const detected = detectImportFile(JSON.stringify({ ...PAYLOAD, app: 'other-app' }))

    expect(detected.kind).toBe('rejected')
    if (detected.kind !== 'rejected') return
    expect(detected.reason).toContain('other-app')
  })

  it('封筒を持たないオブジェクトは判定できないので拒否する', () => {
    const detected = detectImportFile(JSON.stringify({ foo: 1 }))

    expect(detected.kind).toBe('rejected')
    if (detected.kind !== 'rejected') return
    expect(detected.reason).toContain('バックアップの形が違う')
  })

  it('行の形が違う配列は列を言って拒否する(元データとして読み進めない)', () => {
    const detected = detectImportFile(JSON.stringify([{ ...ROW, drankOn: '2020/01/01' }]))

    expect(detected.kind).toBe('rejected')
    if (detected.kind !== 'rejected') return
    expect(detected.reason).toContain('記録の元データとして読めない')
    expect(detected.reason).toContain('YYYY-MM-DD')
  })

  it('空配列は拒否する(全置換で0件 = 黙って全消去になる)', () => {
    const detected = detectImportFile('[]')

    expect(detected.kind).toBe('rejected')
    if (detected.kind !== 'rejected') return
    expect(detected.reason).toContain('0件')
  })

  it('JSON として読めないものは理由を付けて拒否する', () => {
    const detected = detectImportFile('これは JSON ではない')

    expect(detected.kind).toBe('rejected')
    if (detected.kind !== 'rejected') return
    expect(detected.reason).toContain('JSON として読み取れない')
  })

  it('配列でもオブジェクトでもない JSON は型だけ言って拒否する', () => {
    for (const text of ['203', '"backup"', 'null']) {
      const detected = detectImportFile(text)
      expect(detected.kind).toBe('rejected')
      if (detected.kind !== 'rejected') continue
      expect(detected.reason).toContain('配列でもオブジェクトでもない')
    }
  })
})
