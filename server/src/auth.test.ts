// @vitest-environment node
//
// 同期先の認証。**このアプリで唯一「漏れたら記録が読まれる」場所**なので、
// Worker を立てずに回せる形にしてある(`auth.ts` が Cloudflare 独自 API を使わない理由)。
//
// node 環境にするのは `crypto.subtle` を本物で回すため。jsdom の差し替えで通ると、
// 実際には検査していないのに緑になる。

import { describe, expect, it } from 'vitest'
import { encodeSyncCredential } from '../../src/domain/syncWire.ts'
import { MIN_PASSWORD_BYTES, bearerValue, constantTimeEqual, passwordMatches } from './auth.ts'

/** 検査用の十分な長さの値。実物は `openssl rand -base64 32` 相当 */
const PASSWORD = 'x'.repeat(MIN_PASSWORD_BYTES + 8)

describe('bearerValue', () => {
  it('Bearer の後ろを取り出す', () => {
    expect(bearerValue('Bearer abc123')).toBe('abc123')
  })

  it('scheme の大文字小文字を問わない(HTTP の仕様)', () => {
    expect(bearerValue('bearer abc123')).toBe('abc123')
    expect(bearerValue('BEARER abc123')).toBe('abc123')
  })

  it('前後の空白は許す', () => {
    expect(bearerValue('  Bearer   abc123  ')).toBe('abc123')
  })

  it('値の中に空白があるものは受けない(貼り付けで切れた値を短いパスワードとして通さない)', () => {
    expect(bearerValue('Bearer abc 123')).toBeNull()
  })

  it('別の scheme / 空 / 欠落は null', () => {
    expect(bearerValue('Basic abc123')).toBeNull()
    expect(bearerValue('Bearer')).toBeNull()
    expect(bearerValue('Bearer ')).toBeNull()
    expect(bearerValue(null)).toBeNull()
    expect(bearerValue(undefined)).toBeNull()
  })
})

describe('constantTimeEqual', () => {
  it('同じ内容なら真', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true)
  })

  it('1バイトでも違えば偽', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false)
    // 先頭が違う場合も末尾が違う場合も同じく偽(早期 return していれば通ってしまう検査ではない)
    expect(constantTimeEqual(new Uint8Array([9, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(false)
  })

  it('長さが違えば偽', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false)
    expect(constantTimeEqual(new Uint8Array([]), new Uint8Array([1]))).toBe(false)
  })

  it('両方空なら真', () => {
    expect(constantTimeEqual(new Uint8Array([]), new Uint8Array([]))).toBe(true)
  })
})

describe('passwordMatches', () => {
  it('一致すれば真', async () => {
    await expect(passwordMatches(encodeSyncCredential(PASSWORD), PASSWORD)).resolves.toBe(true)
  })

  it('違えば偽', async () => {
    await expect(passwordMatches(encodeSyncCredential(`${PASSWORD}x`), PASSWORD)).resolves.toBe(false)
    await expect(passwordMatches(encodeSyncCredential(PASSWORD.slice(0, -1)), PASSWORD)).resolves.toBe(false)
  })

  // **設定漏れで全開放にしない。** 秘密を入れ忘れた Worker がデプロイされるのは、
  // この種の穴で一番起きやすい経路
  it('秘密が設定されていなければ、何を出しても偽', async () => {
    await expect(passwordMatches(encodeSyncCredential(PASSWORD), undefined)).resolves.toBe(false)
    await expect(passwordMatches(encodeSyncCredential(PASSWORD), null)).resolves.toBe(false)
    await expect(passwordMatches('', '')).resolves.toBe(false)
    await expect(passwordMatches(undefined, undefined)).resolves.toBe(false)
  })

  it('秘密が短すぎれば偽(総当たりで割れる値を黙って受けない)', async () => {
    const short = 'a'.repeat(MIN_PASSWORD_BYTES - 1)
    await expect(passwordMatches(encodeSyncCredential(short), short)).resolves.toBe(false)
  })

  it('境界のちょうどの長さは受ける', async () => {
    const exact = 'a'.repeat(MIN_PASSWORD_BYTES)
    await expect(passwordMatches(encodeSyncCredential(exact), exact)).resolves.toBe(true)
  })

  it('提示が無ければ偽', async () => {
    await expect(passwordMatches(null, PASSWORD)).resolves.toBe(false)
    await expect(passwordMatches('', PASSWORD)).resolves.toBe(false)
  })

  // 長さの検査はバイト単位。マルチバイトの秘密を「文字数」で数えると短い値が通る
  it('秘密の長さは文字数ではなくバイト数で見る', async () => {
    const kana = 'あ'.repeat(8) // 24バイト = ちょうど下限
    await expect(passwordMatches(encodeSyncCredential(kana), kana)).resolves.toBe(true)
    const shorter = 'あ'.repeat(7) // 21バイト
    await expect(passwordMatches(encodeSyncCredential(shorter), shorter)).resolves.toBe(false)
  })
})

// 実際に踏んだ不具合: 日本語の合言葉をそのままヘッダに載せて `fetch` が例外を投げた
describe('日本語の合言葉', () => {
  const kotoba = '日本語のためしのあいことば'

  it('base64 にして送れば通る', async () => {
    await expect(passwordMatches(encodeSyncCredential(kotoba), kotoba)).resolves.toBe(true)
  })

  it('base64 になっていない値は通さない', async () => {
    await expect(passwordMatches(kotoba, kotoba)).resolves.toBe(false)
  })

  it('base64 として壊れている値も例外にせず false', async () => {
    await expect(passwordMatches('!!!!', kotoba)).resolves.toBe(false)
  })
})
