// @vitest-environment node
// domain 層のテストは jsdom を要求しない(CLAUDE.md の依存方向)。
//
// **ここが守っているのは「画面に出す名前が空にならない」の1点(B37)。**
// 空になると、取り消せない削除の確認文が「2026年7月26日の「」を削除する」になり、
// 押す前に何を消すのか確かめられない(実ブラウザで観測した実際の壊れ方)。
import { describe, expect, it } from 'vitest'
import { recordTitle, UNNAMED_RECORD } from './recordTitle.ts'

const record = (brandName: string | null, brandLabel: string) => ({ brandName, brandLabel })

describe('recordTitle', () => {
  it('さけのわ由来の銘柄名を優先する', () => {
    expect(recordTitle(record('加茂錦', '荷札酒'))).toEqual({
      text: '加茂錦',
      named: true,
      rawLabel: '荷札酒',
    })
  })

  it('銘柄名が無ければ本人の表記に落ちる(さけのわに無い銘柄)', () => {
    // `寫楽` はさけのわに無いので紐付かず、本人の表記だけが残る
    expect(recordTitle(record(null, '寫楽'))).toEqual({
      text: '寫楽',
      named: true,
      rawLabel: null,
    })
  })

  it('銘柄名と表記が同じなら併記しない(重ねても情報が増えない)', () => {
    expect(recordTitle(record('紀土', '紀土')).rawLabel).toBeNull()
  })
})

// **ここが本題。** `brandName ?? brandLabel` は `null` しか拾わないので空文字が素通りする
describe('名前が無いとき — 空文字を画面に出さない', () => {
  it('銘柄不明の記録(両方とも空)でも空にならない', () => {
    const title = recordTitle(record(null, ''))
    expect(title.text).toBe(UNNAMED_RECORD)
    expect(title.text).not.toBe('')
    // **代替の語だと分かる形で返す。** 呼び側が鉤括弧の中に入れないための情報
    expect(title.named).toBe(false)
    expect(title.rawLabel).toBeNull()
  })

  it('空白だけの表記も「無い」として扱う(見た目が空なら空)', () => {
    expect(recordTitle(record(null, '   ')).named).toBe(false)
    expect(recordTitle(record('  ', '')).named).toBe(false)
  })

  // バックアップ JSON 由来の `''`。型は `string | null` なので空文字は正当に入ってくる
  it('銘柄名が空文字なら表記に落ちる(`??` では拾えない経路)', () => {
    expect(recordTitle(record('', '寫楽'))).toEqual({
      text: '寫楽',
      named: true,
      rawLabel: null,
    })
  })

  it('銘柄名だけあって表記が空でも併記しない(中身の無い行を作らない)', () => {
    expect(recordTitle(record('紀土', ''))).toEqual({
      text: '紀土',
      named: true,
      rawLabel: null,
    })
  })
})
