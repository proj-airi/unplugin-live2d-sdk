import type { Plugin, ResolvedConfig } from 'vite'

import type {
  Cubism2FileSource,
  Cubism2Source,
  Cubism2UrlSource,
  Live2DSDKErrorCode,
  SelectedCore,
} from './core-source'

import {
  Live2DSDKError,
  normalizeSha256Hex,
  resolveCoreSource,
  sha256Hex,
  sha256Sri,
  verifySha256,
} from './core-source'

export {
  type Cubism2FileSource,
  type Cubism2Source,
  type Cubism2UrlSource,
  Live2DSDKError,
  type Live2DSDKErrorCode,
  normalizeSha256Hex,
  sha256Hex,
  sha256Sri,
  verifySha256,
}

export interface Cubism2CoreOptions {
  sources?: readonly Cubism2Source[]
  required?: boolean
  distribution?: 'development-only' | 'bundle'
  cacheDir?: string
  timeout?: number
  expectedGlobal?: string
}

export type Cubism2CoreCapability
  = | {
    available: true
    url: string
    sha256: string
    sri: string
    expectedGlobal: string
    distribution: 'development' | 'bundle'
  }
  | {
    available: false
    reason: 'not-configured' | 'not-found' | 'build-emission-disabled'
  }

const PUBLIC_ID = 'virtual:live2d-sdk/cores'
const RESOLVED_ID = '\0virtual:live2d-sdk/cores'
const DEVELOPMENT_ROUTE_PREFIX = '/@live2d-sdk/core/cubism2/'
const configuredViteInstances = new WeakSet<ResolvedConfig>()

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

export function Cubism2Core(options: Cubism2CoreOptions = {}): Plugin {
  const normalized = {
    ...options,
    required: options.required ?? false,
    distribution: options.distribution ?? 'development-only',
    expectedGlobal: options.expectedGlobal ?? 'Live2D',
  } as const

  let config: ResolvedConfig
  let selected: SelectedCore | undefined
  let capability: Cubism2CoreCapability = unavailable('not-configured')
  let assetReference: string | undefined

  return {
    name: 'proj-airi:cubism2-core',
    async configResolved(resolvedConfig) {
      if (configuredViteInstances.has(resolvedConfig)) {
        throw new Live2DSDKError(
          'DUPLICATE_PLUGIN',
          'Cubism2Core() may only be registered once in a Vite configuration.',
        )
      }
      configuredViteInstances.add(resolvedConfig)
      config = resolvedConfig

      const hasSources = (normalized.sources?.length ?? 0) > 0
      if (!hasSources && !normalized.required) {
        capability = unavailable('not-configured')
        return
      }

      selected = await resolveCoreSource({
        sources: normalized.sources ?? [],
        required: normalized.required,
        cacheDir: normalized.cacheDir,
        timeout: normalized.timeout,
        viteRoot: config.root,
      })

      if (!selected) {
        capability = unavailable(hasSources ? 'not-found' : 'not-configured')
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
        expectedGlobal: normalized.expectedGlobal,
        distribution: config.command === 'build' ? 'bundle' : 'development',
      }
    },
    buildStart() {
      if (!selected || normalized.distribution !== 'bundle')
        return
      if (!selected.configuredSha256)
        throw new Live2DSDKError('INTEGRITY_REQUIRED', 'Production Cubism 2 Core emission requires a configured SHA-256 digest.')
      if (selected.path)
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
