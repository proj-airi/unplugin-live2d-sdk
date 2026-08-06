import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Live2DSDKError, resolveCoreSource, sha256Hex } from '../src/vite/core-source'
import { withTemporaryDirectory } from './helpers/temporary-directory'

const fixture = 'globalThis.Live2D = { testFixture: true }'
const digest = sha256Hex(new TextEncoder().encode(fixture))

describe('core-source resolution', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fails if no sources are provided and required', async () => {
    await expect(resolveCoreSource({ sources: [], required: true, viteRoot: '' })).rejects.toThrowError(Live2DSDKError)
  })

  it('returns undefined if no sources are provided and not required', async () => {
    expect(await resolveCoreSource({ sources: [], viteRoot: '' })).toBeUndefined()
  })

  it('resolves a valid local file', async () => {
    await withTemporaryDirectory(async (root) => {
      const path = join(root, 'live2d.min.js')
      await writeFile(path, fixture)
      const result = await resolveCoreSource({ sources: [{ path }], viteRoot: root })
      expect(result?.sha256).toBe(digest)
    })
  })

  it('skips missing optional local file', async () => {
    await withTemporaryDirectory(async (root) => {
      const result = await resolveCoreSource({ sources: [{ path: 'missing.js', optional: true }], viteRoot: root })
      expect(result).toBeUndefined()
    })
  })

  it('fails on missing required local file', async () => {
    await withTemporaryDirectory(async (root) => {
      await expect(resolveCoreSource({ sources: [{ path: 'missing.js' }], viteRoot: root })).rejects.toThrowError(/not found/i)
    })
  })

  it('resolves a valid URL', async () => {
    await withTemporaryDirectory(async (root) => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response(fixture))
      const result = await resolveCoreSource({
        sources: [{ url: 'https://example.com/live2d.min.js', sha256: digest }],
        viteRoot: root,
      })
      expect(result?.sha256).toBe(digest)
    })
  })

  it('fails on non-2xx URL', async () => {
    await withTemporaryDirectory(async (root) => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
      await expect(resolveCoreSource({
        sources: [{ url: 'https://example.com/live2d.min.js', sha256: digest }],
        viteRoot: root,
      })).rejects.toThrowError(/HTTP 404/i)
    })
  })

  it('fails on timeout', async () => {
    await withTemporaryDirectory(async (root) => {
      vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => setTimeout(resolve, 100)))
      await expect(resolveCoreSource({
        sources: [{ url: 'https://example.com/live2d.min.js', sha256: digest }],
        timeout: 10,
        viteRoot: root,
      })).rejects.toThrowError(/timed out/i)
    })
  })

  it('fails on digest mismatch', async () => {
    await withTemporaryDirectory(async (root) => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response(`${fixture}bad`))
      await expect(resolveCoreSource({
        sources: [{ url: 'https://example.com/live2d.min.js', sha256: digest }],
        viteRoot: root,
      })).rejects.toThrowError(/do not match mandatory SHA-256/i)
    })
  })

  it('uses valid cache hit', async () => {
    await withTemporaryDirectory(async (root) => {
      const cacheDir = '.cache'
      await mkdir(join(root, cacheDir))
      await writeFile(join(root, cacheDir, digest), fixture)

      const result = await resolveCoreSource({
        sources: [{ url: 'https://example.com/live2d.min.js', sha256: digest }],
        cacheDir,
        viteRoot: root,
      })
      expect(result?.sha256).toBe(digest)
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  it('ignores corrupt cache and fetches', async () => {
    await withTemporaryDirectory(async (root) => {
      const cacheDir = '.cache'
      await mkdir(join(root, cacheDir))
      await writeFile(join(root, cacheDir, digest), `${fixture}bad`)

      vi.mocked(fetch).mockResolvedValueOnce(new Response(fixture))
      const result = await resolveCoreSource({
        sources: [{ url: 'https://example.com/live2d.min.js', sha256: digest }],
        cacheDir,
        viteRoot: root,
      })
      expect(result?.sha256).toBe(digest)
      expect(fetch).toHaveBeenCalledTimes(1)
    })
  })

  it('optional URL followed by valid file', async () => {
    await withTemporaryDirectory(async (root) => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'))
      const path = join(root, 'live2d.min.js')
      await writeFile(path, fixture)

      const result = await resolveCoreSource({
        sources: [
          { url: 'https://example.com/live2d.min.js', sha256: digest, optional: true },
          { path },
        ],
        viteRoot: root,
      })
      expect(result?.sha256).toBe(digest)
      expect(result?.path).toBe(path)
    })
  })

  it('optional file followed by valid URL', async () => {
    await withTemporaryDirectory(async (root) => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response(fixture))

      const result = await resolveCoreSource({
        sources: [
          { path: 'missing.js', optional: true },
          { url: 'https://example.com/live2d.min.js', sha256: digest },
        ],
        viteRoot: root,
      })
      expect(result?.sha256).toBe(digest)
      expect(result?.path).toBeUndefined()
    })
  })
})
