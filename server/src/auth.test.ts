// @vitest-environment node
//
// 同期先の認証。**このアプリで唯一「漏れたら記録が読まれる」場所**なので、
// Worker を立てずに回せる形にしてある(`auth.ts` が Cloudflare 独自 API を使わない理由)。
//
// node 環境にするのは `crypto.subtle` を本物で回すため。jsdom の差し替えで通ると、
// 実際には検査していないのに緑になる。

import { describe, expect, it } from 'vitest'
import { MIN_TOKEN_BYTES, bearerToken, constantTimeEqual, tokenMatches } from './auth.ts'

/** 検査用の十分な長さの値。実物は `openssl rand -base64 32` 相当 */
const TOKEN = 'x'.repeat(MIN_TOKEN_BYTES + 8)

describe('bearerToken', () => {
  it('Bearer の後ろを取り出す', () => {
    expect(bearerToken('Bearer abc123')).toBe('abc123')
  })

  it('scheme の大文字小文字を問わない(HTTP の仕様)', () => {
    expect(bearerToken('bearer abc123')).toBe('abc123')
    expect(bearerToken('BEARER abc123')).toBe('abc123')
  })

  it('前後の空白は許す', () => {
    expect(bearerToken('  Bearer   abc123  ')).toBe('abc123')
  })

  it('値の中に空白があるものは受けない(貼り付けで切れた値を短いトークンとして通さない)', () => {
    expect(bearerToken('Bearer abc 123')).toBeNull()
  })

  it('別の scheme / 空 / 欠落は null', () => {
    expect(bearerToken('Basic abc123')).toBeNull()
    expect(bearerToken('Bearer')).toBeNull()
    expect(bearerToken('Bearer ')).toBeNull()
    expect(bearerToken(null)).toBeNull()
    expect(bearerToken(undefined)).toBeNull()
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

describe('tokenMatches', () => {
  it('一致すれば真', async () => {
    await expect(tokenMatches(TOKEN, TOKEN)).resolves.toBe(true)
  })

  it('違えば偽', async () => {
    await expect(tokenMatches(`${TOKEN}x`, TOKEN)).resolves.toBe(false)
    await expect(tokenMatches(TOKEN.slice(0, -1), TOKEN)).resolves.toBe(false)
  })

  // **設定漏れで全開放にしない。** 秘密を入れ忘れた Worker がデプロイされるのは、
  // この種の穴で一番起きやすい経路
  it('秘密が設定されていなければ、何を出しても偽', async () => {
    await expect(tokenMatches(TOKEN, undefined)).resolves.toBe(false)
    await expect(tokenMatches(TOKEN, null)).resolves.toBe(false)
    await expect(tokenMatches('', '')).resolves.toBe(false)
    await expect(tokenMatches(undefined, undefined)).resolves.toBe(false)
  })

  it('秘密が短すぎれば偽(総当たりで割れる値を黙って受けない)', async () => {
    const short = 'a'.repeat(MIN_TOKEN_BYTES - 1)
    await expect(tokenMatches(short, short)).resolves.toBe(false)
  })

  it('境界のちょうどの長さは受ける', async () => {
    const exact = 'a'.repeat(MIN_TOKEN_BYTES)
    await expect(tokenMatches(exact, exact)).resolves.toBe(true)
  })

  it('提示が無ければ偽', async () => {
    await expect(tokenMatches(null, TOKEN)).resolves.toBe(false)
    await expect(tokenMatches('', TOKEN)).resolves.toBe(false)
  })

  // 長さの検査はバイト単位。マルチバイトの秘密を「文字数」で数えると短い値が通る
  it('秘密の長さは文字数ではなくバイト数で見る', async () => {
    const kana = 'あ'.repeat(8) // 24バイト = ちょうど下限
    await expect(tokenMatches(kana, kana)).resolves.toBe(true)
    const shorter = 'あ'.repeat(7) // 21バイト
    await expect(tokenMatches(shorter, shorter)).resolves.toBe(false)
  })
})
