# Cubism 2 Core provisioning design

Status: proposed for maintainer approval. Implementation must not begin until this design and first-PR scope are approved.

## Public API and scope

The PR adds one additive Vite plugin export and no changes to the external behavior of `DownloadLive2DSDK()`:

```ts
export interface Cubism2CoreOptions {
  sources?: readonly Cubism2Source[]
  required?: boolean
  distribution?: 'development-only' | 'bundle'
  cacheDir?: string
  timeout?: number
  expectedGlobal?: 'Live2D'
}

export type Cubism2Source = Cubism2FileSource | Cubism2UrlSource

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

export function Cubism2Core(options?: Cubism2CoreOptions): import('vite').Plugin
```

This PR supports both local files and remote URLs.
The defaults are `required: false`, `distribution: 'development-only'`, and `expectedGlobal: 'Live2D'`.
Sources are tried in declaration order. Relative paths resolve from the final Vite `config.root`, while absolute paths remain absolute.
URL sources require a mandatory SHA-256 digest. The SDK contains no built-in mirror.
Missing optional sources fall through; missing non-optional sources, unreadable files, timeout, and integrity mismatches fail rather than silently degrading.

## Integrity, caching, and distribution

Configured SHA-256 values are exactly 64 hexadecimal characters, accepted in either case and normalized to lowercase. The plugin computes both lowercase hexadecimal SHA-256 and `sha256-<base64>` SRI for selected bytes. Digest comparison is timing-safe. SHA-256 proves byte identity and integrity; it does not grant a license.

URL sources always require SHA-256. When `cacheDir` is configured, downloaded bytes are cached safely (via atomic rename) keyed by their normalized digest, not the URL. A cache hit prevents a network request. Unreadable or corrupt cache entries are treated as a cache miss, and a network request will be made. Cache-write failure produces a warning but must not discard already verified in-memory bytes.

Development may use a local file without a configured digest because the plugin calculates the digest before serving it. Production `bundle` mode requires a configured matching digest. Production `development-only` mode never emits Core bytes and reports `build-emission-disabled` through the capability module.

Production emission is always explicit. Cubism Core is proprietary: users must provide bytes they are permitted to use, and maintainers must separately decide whether a release may redistribute them. Selecting `bundle` places those bytes in generated application artifacts.

## Failure table

- No sources configured: Reports `not-configured` if optional, fails if required.
- Optional file missing: Falls through to the next source.
- Required file missing: Fails configuration (`SOURCE_NOT_FOUND`).
- Optional URL unreachable: Falls through to the next source.
- Required URL unreachable: Fails configuration (`SOURCE_UNREACHABLE`).
- URL timeout: Fails configuration (`SOURCE_TIMEOUT`).
- Digest mismatch: Fails configuration (`INTEGRITY_MISMATCH`). Never silently accepted.
- Valid cache hit: Uses cached bytes without network request.
- Corrupt cache entry: Treated as cache miss, proceeds to download.
- Unreadable cache entry: Treated as cache miss, proceeds to download.
- Cache-write failure after successful acquisition: Logs warning, continues with verified bytes.
- Bundle mode disabled: Capability reports `build-emission-disabled`.
- Duplicate plugin instance: Detected and safely prevented from emitting duplicate assets or installing conflicting middleware.

## Browser capability

The plugin exposes `virtual:live2d-sdk/cores` with this browser-safe union:

```ts
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
    reason:
      | 'not-configured'
      | 'not-found'
      | 'build-emission-disabled'
      | 'provisioning-failed'
  }

export const cubism2Core: Cubism2CoreCapability
```

Client output contains no source paths, environment variables, credentials, cache paths, or detailed optional-source diagnostics. Explicit source-read and integrity failures normally fail startup or build; `provisioning-failed` is reserved for a future repository policy that deliberately permits sanitized optional degradation.

## Development delivery

After `configResolved`, the plugin resolves a selected source into memory, verifies the configured digest, computes SHA-256 and SRI, and uses `config.logger`. It serves only those verified bytes at a content-addressed path:

```text
/@live2d-sdk/core/cubism2/<sha256>.js
```

The route accounts for Vite's resolved base, matches the complete path, supports `GET` and `HEAD`, and returns 404 for any other digest. Responses use JavaScript content type, `Cache-Control: public, max-age=31536000, immutable`, and `X-Content-Type-Options: nosniff`. No source path or cache path is disclosed. Changing the source requires restarting the development server.

## Production emission and Vite assumptions

In `buildStart`, `bundle` mode registers the selected source as a watched file (if it's a file) and emits exactly one asset named `live2d-cubism2-core.js`. The virtual module refers to the emitted asset through Vite/Rolldown's plugin asset-reference mechanism, not a fixed `/assets/` URL. No file is emitted from `configResolved`.

Implementation is conditional on integration tests proving the installed Vite 8/Rolldown version transforms the emitted reference correctly for `base: '/'`, a non-root base, `base: './'`, and a custom `build.assetsDir`.

For Electron, `base: './'` must produce a relative renderer URL that resolves under `file://`; an absolute `/assets/...` URL is unacceptable. The runtime may omit browser SRI enforcement for `file://` only if tests show it is necessary, while build-time SHA-256 verification remains mandatory. That runtime choice belongs to AIRI, not this SDK PR.

## Types and packaging

An ambient declaration for `virtual:live2d-sdk/cores` will ship with the package automatically. A packed-package consumer test will verify both the plugin export and virtual-module types before release.

The packed artifact must contain compiled plugin code, public declarations, the ambient declaration, README, and package metadata. It must contain no fixture Core, Core bytes, absolute source path, or temporary output.
