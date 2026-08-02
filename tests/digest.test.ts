import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { Live2DSDKError, normalizeSha256Hex, sha256Hex, sha256Sri, verifySha256 } from '../src/vite/cubism2-core'

describe('cubism 2 Core digests', () => {
  const bytes = new TextEncoder().encode('globalThis.Live2D = { testFixture: true }')
  const digest = createHash('sha256').update(bytes).digest('hex')

  it('normalizes lowercase and uppercase hexadecimal digests', () => {
    expect(normalizeSha256Hex(digest)).toBe(digest)
    expect(normalizeSha256Hex(digest.toUpperCase())).toBe(digest)
  })

  it.each(['abc', `${'0'.repeat(63)}g`])('rejects invalid digest %s', (value) => {
    expect(() => normalizeSha256Hex(value)).toThrow(Live2DSDKError)
  })

  it('hashes empty bytes', () => {
    expect(sha256Hex(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('verifies matching bytes and rejects mismatches', () => {
    expect(() => verifySha256(bytes, digest)).not.toThrow()
    expect(() => verifySha256(new Uint8Array([1]), digest)).toThrowError(/verification failed/)
  })

  it('generates SRI', () => {
    expect(sha256Sri(bytes)).toBe(`sha256-${createHash('sha256').update(bytes).digest('base64')}`)
  })
})
