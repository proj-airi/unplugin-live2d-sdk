import type { Plugin, ResolvedConfig } from 'vite'

import { Buffer } from 'node:buffer'
import { createHash, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

export interface Cubism2CoreOptions {
  sources?: readonly Cubism2FileSource[]
  required?: boolean
  distribution?: 'development-only' | 'bundle'
}

export interface Cubism2FileSource {
  path: string
  sha256?: string
  optional?: boolean
}

export type Cubism2CoreCapability
  = | {
    available: true
    url: string
    sha256: string
    sri: string
    expectedGlobal: 'Live2D'
    distribution: 'development' | 'bundle'
  }
  | {
    available: false
    reason: 'not-configured' | 'not-found' | 'build-emission-disabled' | 'provisioning-failed'
  }

export type Live2DSDKErrorCode
  = | 'CORE_NOT_CONFIGURED'
    | 'SOURCE_NOT_FOUND'
    | 'SOURCE_UNREADABLE'
    | 'INTEGRITY_REQUIRED'
    | 'INTEGRITY_MISMATCH'
    | 'BUILD_EMISSION_DISABLED'

export class Live2DSDKError extends Error {
  readonly code: Live2DSDKErrorCode

  constructor(code: Live2DSDKErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'Live2DSDKError'
    this.code = code
  }
}

const PUBLIC_ID = 'virtual:live2d-sdk/cores'
const RESOLVED_ID = '\0virtual:live2d-sdk/cores'
const DEVELOPMENT_ROUTE_PREFIX = '/@live2d-sdk/core/cubism2/'

interface SelectedCore {
  bytes: Uint8Array
  path: string
  configuredSha256?: string
  sha256: string
  sri: string
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function sha256Sri(bytes: Uint8Array): string {
  return `sha256-${createHash('sha256').update(bytes).digest('base64')}`
}

export function normalizeSha256Hex(value: string): string {
  if (!/^[\da-f]{64}$/i.test(value)) {
    throw new Live2DSDKError('INTEGRITY_MISMATCH', 'SHA-256 must contain exactly 64 hexadecimal characters.')
  }
  return value.toLowerCase()
}

export function verifySha256(bytes: Uint8Array, expectedHex: string): void {
  const expected = Buffer.from(normalizeSha256Hex(expectedHex), 'hex')
  const actual = createHash('sha256').update(bytes).digest()
  if (!timingSafeEqual(actual, expected)) {
    throw new Live2DSDKError('INTEGRITY_MISMATCH', 'Cubism 2 Core SHA-256 verification failed.')
  }
}

function unavailable(reason: Extract<Cubism2CoreCapability, { available: false }>['reason']): Cubism2CoreCapability {
  return { available: false, reason }
}

function capabilityCode(capability: Cubism2CoreCapability, assetReference?: string): string {
  if (capability.available && assetReference) {
    return `export const cubism2Core = ${JSON.stringify({ ...capability, url: '' })};\ncubism2Core.url = import.meta.ROLLUP_FILE_URL_${assetReference};`
  }
  return `export const cubism2Core = ${JSON.stringify(capability)};`
}

function withBase(base: string, route: string): string {
  if (base === './' || base === '')
    return route
  return `${base.endsWith('/') ? base.slice(0, -1) : base}${route}`
}

async function selectCore(config: ResolvedConfig, options: Cubism2CoreOptions): Promise<SelectedCore | undefined> {
  const sources = options.sources ?? []
  if (sources.length === 0) {
    if (options.required)
      throw new Live2DSDKError('CORE_NOT_CONFIGURED', 'Cubism 2 Core is required but no local source is configured.')
    return
  }

  for (const source of sources) {
    const sourcePath = isAbsolute(source.path) ? source.path : resolve(config.root, source.path)
    let bytes: Uint8Array
    try {
      bytes = await readFile(sourcePath)
    }
    catch (cause) {
      const error = cause as NodeJS.ErrnoException
      if (error.code === 'ENOENT' && source.optional)
        continue
      if (error.code === 'ENOENT')
        throw new Live2DSDKError('SOURCE_NOT_FOUND', 'Configured Cubism 2 Core source was not found.', { cause })
      throw new Live2DSDKError('SOURCE_UNREADABLE', 'Configured Cubism 2 Core source could not be read.', { cause })
    }

    if (source.sha256)
      verifySha256(bytes, source.sha256)

    return {
      bytes,
      path: sourcePath,
      configuredSha256: source.sha256 ? normalizeSha256Hex(source.sha256) : undefined,
      sha256: sha256Hex(bytes),
      sri: sha256Sri(bytes),
    }
  }
}

export function Cubism2Core(options: Cubism2CoreOptions = {}): Plugin {
  const normalized = {
    ...options,
    required: options.required ?? false,
    distribution: options.distribution ?? 'development-only',
  } as const
  let config: ResolvedConfig
  let selected: SelectedCore | undefined
  let capability: Cubism2CoreCapability = unavailable('not-configured')
  let assetReference: string | undefined

  return {
    name: 'proj-airi:cubism2-core',
    async configResolved(resolvedConfig) {
      config = resolvedConfig
      selected = await selectCore(config, normalized)
      if (!selected) {
        capability = unavailable((normalized.sources?.length ?? 0) > 0 ? 'not-found' : 'not-configured')
        return
      }

      if (config.command === 'build' && normalized.distribution === 'development-only') {
        capability = unavailable('build-emission-disabled')
        return
      }

      capability = {
        available: true,
        url: withBase(config.base, `${DEVELOPMENT_ROUTE_PREFIX}${selected.sha256}.js`),
        sha256: selected.sha256,
        sri: selected.sri,
        expectedGlobal: 'Live2D',
        distribution: config.command === 'build' ? 'bundle' : 'development',
      }
    },
    buildStart() {
      if (!selected || normalized.distribution !== 'bundle')
        return
      if (!selected.configuredSha256)
        throw new Live2DSDKError('INTEGRITY_REQUIRED', 'Production Cubism 2 Core emission requires a configured SHA-256 digest.')
      this.addWatchFile(selected.path)
      assetReference = this.emitFile({
        type: 'asset',
        name: 'live2d-cubism2-core.js',
        source: selected.bytes,
      })
    },
    resolveId(id) {
      if (id === PUBLIC_ID)
        return RESOLVED_ID
    },
    load(id) {
      if (id === RESOLVED_ID)
        return capabilityCode(capability, assetReference)
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!selected || !request.url || !['GET', 'HEAD'].includes(request.method ?? '')) {
          next()
          return
        }
        const pathname = new URL(request.url, 'http://localhost').pathname
        const expectedPath = withBase(config.base, `${DEVELOPMENT_ROUTE_PREFIX}${selected.sha256}.js`)
        if (pathname !== expectedPath) {
          if (pathname.includes(DEVELOPMENT_ROUTE_PREFIX)) {
            response.statusCode = 404
            response.end()
            return
          }
          next()
          return
        }
        response.statusCode = 200
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        response.setHeader('Content-Length', selected.bytes.byteLength)
        response.end(request.method === 'HEAD' ? undefined : selected.bytes)
      })
    },
  }
}
