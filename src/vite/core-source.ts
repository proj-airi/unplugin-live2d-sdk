import { Buffer } from 'node:buffer'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'

export interface Cubism2FileSource {
  path: string
  sha256?: string
  optional?: boolean
}

export interface Cubism2UrlSource {
  url: string
  sha256: string
  optional?: boolean
}

export type Cubism2Source = Cubism2FileSource | Cubism2UrlSource

export interface CoreSourceOptions {
  sources: readonly Cubism2Source[]
  required?: boolean
  cacheDir?: string
  timeout?: number
  viteRoot: string
}

export interface SelectedCore {
  bytes: Uint8Array
  path?: string
  configuredSha256?: string
  sha256: string
  sri: string
}

export type Live2DSDKErrorCode
  = | 'CORE_NOT_CONFIGURED'
    | 'SOURCE_NOT_FOUND'
    | 'SOURCE_UNREADABLE'
    | 'SOURCE_UNREACHABLE'
    | 'SOURCE_TIMEOUT'
    | 'INTEGRITY_REQUIRED'
    | 'INTEGRITY_MISMATCH'
    | 'BUILD_EMISSION_DISABLED'
    | 'DUPLICATE_PLUGIN'

export class Live2DSDKError extends Error {
  readonly code: Live2DSDKErrorCode

  constructor(code: Live2DSDKErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'Live2DSDKError'
    this.code = code
  }
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

async function safeWriteCache(cachePath: string, bytes: Uint8Array): Promise<void> {
  let tempPath: string | undefined
  try {
    await mkdir(dirname(cachePath), { recursive: true })
    tempPath = `${cachePath}.${randomBytes(16).toString('hex')}.tmp`
    await writeFile(tempPath, bytes)
    await rename(tempPath, cachePath)
    tempPath = undefined
  }
  catch (error) {
    console.warn(`[Live2D SDK] Failed to write cache to ${cachePath}:`, error)
  }
  finally {
    if (tempPath)
      await rm(tempPath, { force: true }).catch(() => {})
  }
}

function timeoutError(): Live2DSDKError {
  return new Live2DSDKError('SOURCE_TIMEOUT', 'Cubism 2 Core download timed out.')
}

export async function resolveCoreSource(options: CoreSourceOptions): Promise<SelectedCore | undefined> {
  if (options.sources.length === 0) {
    if (options.required)
      throw new Live2DSDKError('CORE_NOT_CONFIGURED', 'Cubism 2 Core is required but no local or remote source is configured.')
    return undefined
  }

  for (const source of options.sources) {
    if ('path' in source) {
      const sourcePath = isAbsolute(source.path) ? source.path : resolve(options.viteRoot, source.path)
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

    const expectedSha256 = normalizeSha256Hex(source.sha256)
    let cachePath: string | undefined
    if (options.cacheDir) {
      cachePath = resolve(options.viteRoot, options.cacheDir, expectedSha256)
      try {
        const cachedBytes = await readFile(cachePath)
        verifySha256(cachedBytes, expectedSha256)
        return {
          bytes: cachedBytes,
          configuredSha256: expectedSha256,
          sha256: expectedSha256,
          sri: sha256Sri(cachedBytes),
        }
      }
      catch {
        // Cache miss, unreadable entry, or digest mismatch. Reacquire verified bytes.
      }
    }

    const controller = new AbortController()
    const timeoutId = options.timeout === undefined
      ? undefined
      : setTimeout(() => controller.abort(timeoutError()), options.timeout)

    try {
      const response = await fetch(source.url, { signal: controller.signal })
      if (!response.ok) {
        if (source.optional)
          continue
        throw new Live2DSDKError('SOURCE_UNREACHABLE', `HTTP ${response.status} from URL source.`)
      }

      // Keep the abort timer alive through the body read. Resolving response
      // headers does not prove that the Core bytes will finish downloading.
      const bytes = new Uint8Array(await response.arrayBuffer())
      try {
        verifySha256(bytes, expectedSha256)
      }
      catch (cause) {
        throw new Live2DSDKError('INTEGRITY_MISMATCH', 'Downloaded bytes do not match mandatory SHA-256.', { cause })
      }

      if (cachePath)
        await safeWriteCache(cachePath, bytes)

      return {
        bytes,
        configuredSha256: expectedSha256,
        sha256: expectedSha256,
        sri: sha256Sri(bytes),
      }
    }
    catch (cause) {
      if (controller.signal.aborted && controller.signal.reason instanceof Live2DSDKError) {
        if (source.optional)
          continue
        throw controller.signal.reason
      }
      if (cause instanceof Live2DSDKError)
        throw cause
      if (source.optional)
        continue
      throw new Live2DSDKError('SOURCE_UNREACHABLE', 'Configured URL source could not be downloaded.', { cause })
    }
    finally {
      if (timeoutId)
        clearTimeout(timeoutId)
    }
  }

  if (options.required) {
    throw new Live2DSDKError(
      'CORE_NOT_CONFIGURED',
      'Cubism 2 Core is required but none of the configured sources could be resolved.',
    )
  }

  return undefined
}
