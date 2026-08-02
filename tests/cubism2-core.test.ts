import type { ResolvedConfig } from 'vite'

import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'

import { build, createServer } from 'vite'
import { describe, expect, it } from 'vitest'

import { Cubism2Core, Live2DSDKError } from '../src/vite/cubism2-core'
import { withTemporaryDirectory } from './helpers/temporary-directory'

const fixture = 'globalThis.Live2D = { testFixture: true }'
const digest = createHash('sha256').update(fixture).digest('hex')

async function createFixture(root: string): Promise<string> {
  const path = join(root, 'live2d.min.js')
  await writeFile(path, fixture)
  return path
}

async function resolved(plugin: ReturnType<typeof Cubism2Core>, root: string, command: 'serve' | 'build' = 'serve', base = '/'): Promise<void> {
  await plugin.configResolved?.({ root, command, base } as ResolvedConfig)
}

describe('cubism2Core source selection', () => {
  it('is optional with no sources', async () => withTemporaryDirectory(async (root) => {
    const plugin = Cubism2Core()
    await resolved(plugin, root)
    expect(await plugin.load?.call({} as never, '\0virtual:live2d-sdk/cores')).toContain('not-configured')
  }))

  it('fails when required with no sources', async () => withTemporaryDirectory(async (root) => {
    await expect(resolved(Cubism2Core({ required: true }), root)).rejects.toMatchObject({ code: 'CORE_NOT_CONFIGURED' })
  }))

  it('falls through an optional missing source and resolves relative to Vite root', async () => withTemporaryDirectory(async (root) => {
    await createFixture(root)
    const plugin = Cubism2Core({ sources: [{ path: 'missing.js', optional: true }, { path: 'live2d.min.js', sha256: digest }] })
    await resolved(plugin, root)
    expect(await plugin.load?.call({} as never, '\0virtual:live2d-sdk/cores')).toContain(digest)
  }))

  it('fails for a non-optional missing source', async () => withTemporaryDirectory(async (root) => {
    await expect(resolved(Cubism2Core({ sources: [{ path: 'missing.js' }] }), root)).rejects.toBeInstanceOf(Live2DSDKError)
  }))

  it('accepts an absolute source and development use without a configured digest', async () => withTemporaryDirectory(async (root) => {
    const path = await createFixture(root)
    const plugin = Cubism2Core({ sources: [{ path }] })
    await resolved(plugin, join(root, 'different-root'))
    expect(await plugin.load?.call({} as never, '\0virtual:live2d-sdk/cores')).toContain(digest)
  }))

  it('rejects a mismatched digest', async () => withTemporaryDirectory(async (root) => {
    await createFixture(root)
    await expect(resolved(Cubism2Core({ sources: [{ path: 'live2d.min.js', sha256: '0'.repeat(64) }] }), root)).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
  }))

  it('requires integrity for production bundle emission', async () => withTemporaryDirectory(async (root) => {
    await createFixture(root)
    const plugin = Cubism2Core({ sources: [{ path: 'live2d.min.js' }], distribution: 'bundle' })
    await resolved(plugin, root, 'build')
    expect(() => plugin.buildStart?.call({} as never)).toThrowError(/requires a configured SHA-256/)
  }))
})

describe('cubism2Core Vite integration', () => {
  it.each(['/', '/airi/', './'])('serves GET and HEAD under base %s and rejects the wrong digest', async base => withTemporaryDirectory(async (root) => {
    await createFixture(root)
    const server = await createServer({ root, base, publicDir: false, logLevel: 'silent', plugins: [Cubism2Core({ sources: [{ path: 'live2d.min.js' }] })] })
    try {
      await server.listen()
      const origin = server.resolvedUrls?.local[0]
      expect(origin).toBeTruthy()
      const route = `${base === '/' ? '' : base.slice(0, -1)}/@live2d-sdk/core/cubism2/${digest}.js`
      const get = await fetch(new URL(route, origin))
      expect(await get.text()).toBe(fixture)
      expect(get.headers.get('x-content-type-options')).toBe('nosniff')
      const head = await fetch(new URL(route, origin), { method: 'HEAD' })
      expect(head.status).toBe(200)
      expect(await head.text()).toBe('')
      const wrong = await fetch(new URL(route.replace(digest, '0'.repeat(64)), origin))
      expect(wrong.status).toBe(404)
    }
    finally {
      await server.close()
    }
  }))

  it.each([
    { base: '/', assetsDir: 'assets' },
    { base: '/airi/', assetsDir: 'custom-assets' },
    { base: './', assetsDir: 'assets' },
  ])('emits one referenced asset for $base with $assetsDir', async ({ base, assetsDir }) => withTemporaryDirectory(async (root) => {
    await createFixture(root)
    await writeFile(join(root, 'index.html'), '<script type="module" src="/src.ts"></script>')
    await writeFile(join(root, 'src.ts'), 'import { cubism2Core } from \'virtual:live2d-sdk/cores\'; console.log(cubism2Core)')
    const output = await build({
      root,
      base,
      publicDir: false,
      logLevel: 'silent',
      plugins: [Cubism2Core({ sources: [{ path: 'live2d.min.js', sha256: digest }], distribution: 'bundle' })],
      build: { write: false, assetsDir },
    })
    const outputs = Array.isArray(output) ? output.flatMap(item => item.output) : output.output
    const coreAssets = outputs.filter(item => item.type === 'asset' && item.name === 'live2d-cubism2-core.js')
    expect(coreAssets).toHaveLength(1)
    const client = outputs.filter(item => item.type === 'chunk').map(item => item.code).join('\n')
    expect(client).not.toContain(root)
    expect(client).toContain(basename(coreAssets[0]!.fileName))
    const entry = outputs.find(item => item.type === 'chunk' && item.isEntry)
    expect(entry).toBeTruthy()
    expect(posix.normalize(posix.join(dirname(entry!.fileName), basename(coreAssets[0]!.fileName)))).toBe(coreAssets[0]!.fileName)
  }))

  it('does not emit in development-only build mode', async () => withTemporaryDirectory(async (root) => {
    await createFixture(root)
    await writeFile(join(root, 'index.html'), '<script type="module" src="/src.ts"></script>')
    await writeFile(join(root, 'src.ts'), 'import { cubism2Core } from \'virtual:live2d-sdk/cores\'; console.log(cubism2Core)')
    const output = await build({ root, publicDir: false, logLevel: 'silent', plugins: [Cubism2Core({ sources: [{ path: 'live2d.min.js' }] })], build: { write: false } })
    const outputs = Array.isArray(output) ? output.flatMap(item => item.output) : output.output
    expect(outputs.some(item => item.type === 'asset' && item.name === 'live2d-cubism2-core.js')).toBe(false)
  }))
})
