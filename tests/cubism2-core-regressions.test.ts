import type { ResolvedConfig } from 'vite'

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveCoreSource } from '../src/vite/core-source'
import { Cubism2Core } from '../src/vite/cubism2-core'

const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'live2d-sdk-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Cubism 2 provisioning regressions', () => {
  it('times out while a response body is stalled', async () => {
    const root = await temporaryRoot()
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => ({
      ok: true,
      arrayBuffer: () => new Promise<ArrayBuffer>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      }),
    })))

    await expect(resolveCoreSource({
      sources: [{ url: 'https://example.com/live2d.min.js', sha256: '0'.repeat(64) }],
      timeout: 10,
      viteRoot: root,
    })).rejects.toMatchObject({ code: 'SOURCE_TIMEOUT' })
  })

  it('fails required provisioning after every optional source is exhausted', async () => {
    const root = await temporaryRoot()
    await expect(resolveCoreSource({
      sources: [{ path: 'missing.js', optional: true }],
      required: true,
      viteRoot: root,
    })).rejects.toMatchObject({ code: 'CORE_NOT_CONFIGURED' })
  })

  it('rejects duplicate plugin registration for one Vite config', async () => {
    const root = await temporaryRoot()
    const config = { root, command: 'serve', base: '/' } as ResolvedConfig
    await Cubism2Core().configResolved?.(config)
    await expect(Cubism2Core().configResolved?.(config)).rejects.toMatchObject({ code: 'DUPLICATE_PLUGIN' })
  })
})
