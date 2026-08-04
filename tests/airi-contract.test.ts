import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { build } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Cubism2Core, sha256Hex } from '../src/vite/cubism2-core'
import { withTemporaryDirectory } from './helpers/temporary-directory'

const fixture = 'globalThis.Live2D = { testFixture: true }'
const digest = sha256Hex(new TextEncoder().encode(fixture))

describe('aIRI contract fixture', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function createAiriProject(root: string) {
    await writeFile(join(root, 'index.html'), '<script type="module" src="/src.ts"></script>')
    await writeFile(join(root, 'src.ts'), `
      import { cubism2Core } from 'virtual:live2d-sdk/cores'
      console.log(JSON.stringify(cubism2Core))
    `)
  }

  it('local source succeeds without a network request', async () => {
    await withTemporaryDirectory(async (root) => {
      await createAiriProject(root)
      await writeFile(join(root, 'local.js'), fixture)
      const plugin = Cubism2Core({
        sources: [
          { path: 'local.js', optional: true },
          { url: 'https://example.com/remote.js', sha256: digest, optional: true },
        ],
      })
      await build({ root, plugins: [plugin], build: { write: false }, logLevel: 'silent' })
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  it('local source misses and URL succeeds', async () => {
    await withTemporaryDirectory(async (root) => {
      await createAiriProject(root)
      vi.mocked(fetch).mockResolvedValueOnce(new Response(fixture))
      const plugin = Cubism2Core({
        sources: [
          { path: 'missing.js', optional: true },
          { url: 'https://example.com/remote.js', sha256: digest, optional: true },
        ],
      })
      await build({ root, plugins: [plugin], build: { write: false }, logLevel: 'silent' })
      expect(fetch).toHaveBeenCalledTimes(1)
    })
  })

  it('valid cache prevents a network request', async () => {
    await withTemporaryDirectory(async (root) => {
      await createAiriProject(root)
      await mkdir(join(root, '.cache'))
      await writeFile(join(root, '.cache', digest), fixture)
      const plugin = Cubism2Core({
        cacheDir: '.cache',
        sources: [
          { url: 'https://example.com/remote.js', sha256: digest, optional: true },
        ],
      })
      await build({ root, plugins: [plugin], build: { write: false }, logLevel: 'silent' })
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  it('all optional sources fail and capability reports unavailable', async () => {
    await withTemporaryDirectory(async (root) => {
      await createAiriProject(root)
      vi.mocked(fetch).mockRejectedValueOnce(new Error('timeout'))
      const plugin = Cubism2Core({
        sources: [
          { path: 'missing.js', optional: true },
          { url: 'https://example.com/remote.js', sha256: digest, optional: true },
        ],
      })
      const output = await build({ root, plugins: [plugin], build: { write: false }, logLevel: 'silent' })
      const outputs = Array.isArray(output) ? output.flatMap(i => i.output) : output.output
      const chunk = outputs.find(i => i.type === 'chunk')!
      expect(chunk.code).toContain('not-found')
    })
  })

  it('a required source fails with an actionable error', async () => {
    await withTemporaryDirectory(async (root) => {
      await createAiriProject(root)
      const plugin = Cubism2Core({
        sources: [
          { path: 'missing.js' },
        ],
      })
      await expect(build({ root, plugins: [plugin], build: { write: false }, logLevel: 'silent' })).rejects.toThrowError(/not found/i)
    })
  })

  it('development-only mode emits no production Core asset', async () => {
    await withTemporaryDirectory(async (root) => {
      await createAiriProject(root)
      await writeFile(join(root, 'local.js'), fixture)
      const plugin = Cubism2Core({
        distribution: 'development-only',
        sources: [{ path: 'local.js' }],
      })
      const output = await build({ root, plugins: [plugin], build: { write: false }, logLevel: 'silent' })
      const outputs = Array.isArray(output) ? output.flatMap(i => i.output) : output.output
      expect(outputs.some(i => i.type === 'asset' && i.name === 'live2d-cubism2-core.js')).toBe(false)
      const chunk = outputs.find(i => i.type === 'chunk')!
      expect(chunk.code).toContain('build-emission-disabled')
    })
  })

  it('bundle mode emits exactly one Core asset', async () => {
    await withTemporaryDirectory(async (root) => {
      await createAiriProject(root)
      await writeFile(join(root, 'local.js'), fixture)
      const plugin = Cubism2Core({
        distribution: 'bundle',
        sources: [{ path: 'local.js', sha256: digest }],
      })
      const output = await build({ root, plugins: [plugin], build: { write: false }, logLevel: 'silent' })
      const outputs = Array.isArray(output) ? output.flatMap(i => i.output) : output.output
      const assets = outputs.filter(i => i.type === 'asset' && i.name === 'live2d-cubism2-core.js')
      expect(assets).toHaveLength(1)
    })
  })

  it('relative base produces a relative or correctly base-aware URL without source path leaks', async () => {
    await withTemporaryDirectory(async (root) => {
      await createAiriProject(root)
      await writeFile(join(root, 'local.js'), fixture)
      const plugin = Cubism2Core({
        distribution: 'bundle',
        sources: [{ path: 'local.js', sha256: digest }],
      })
      const output = await build({ root, base: './', plugins: [plugin], build: { write: false }, logLevel: 'silent' })
      const outputs = Array.isArray(output) ? output.flatMap(i => i.output) : output.output
      const chunk = outputs.find(i => i.type === 'chunk')!
      expect(chunk.code).not.toContain(root)
      expect(chunk.code).not.toContain('local.js')
      expect(chunk.code).toContain('live2d-cubism2-core')
    })
  })
})
