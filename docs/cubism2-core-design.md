# Cubism 2 Core provisioning design

Status: proposed for maintainer approval. Implementation must not begin until this design and first-PR scope are approved.

## Public API and scope

The first PR adds one additive Vite plugin export and no changes to the external behavior of `DownloadLive2DSDK()`:

```ts
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

export function Cubism2Core(options?: Cubism2CoreOptions): import('vite').Plugin
```

This PR supports local files only. It does not include remote downloads, archives, retries, shared caches, source-provider abstractions, or a configurable development route. Those remain explicitly deferred unless separately approved.

The defaults are `required: false` and `distribution: 'development-only'`. With no sources, the optional plugin silently reports `not-configured`; the required plugin fails configuration. Sources are tried in declaration order. Relative paths resolve from the final Vite `config.root`, while absolute paths remain absolute. Missing optional sources may fall through; missing non-optional sources, unreadable files, and integrity mismatches fail rather than silently degrading.

## Integrity and distribution

Configured SHA-256 values are exactly 64 hexadecimal characters, accepted in either case and normalized to lowercase. The plugin computes both lowercase hexadecimal SHA-256 and `sha256-<base64>` SRI for selected bytes. Digest comparison is timing-safe. SHA-256 proves byte identity and integrity; it does not grant a license.

Development may use a local file without a configured digest because the plugin calculates the digest before serving it. Production `bundle` mode requires a configured matching digest. Production `development-only` mode never emits Core bytes and reports `build-emission-disabled` through the capability module.

Production emission is always explicit. Cubism Core is proprietary: users must provide bytes they are permitted to use, and maintainers must separately decide whether a release may redistribute them. Selecting `bundle` places those bytes in generated application artifacts.

## Browser capability

The plugin exposes `virtual:live2d-sdk/cores` with this browser-safe union:

```ts
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

After `configResolved`, the plugin reads the selected local file into memory, verifies any configured digest, computes SHA-256 and SRI, and uses `config.logger`. It serves only those verified bytes at a content-addressed path:

```text
/@live2d-sdk/core/cubism2/<sha256>.js
```

The route accounts for Vite's resolved base, matches the complete path, supports `GET` and `HEAD`, and returns 404 for any other digest. Responses use JavaScript content type, `Cache-Control: public, max-age=31536000, immutable`, and `X-Content-Type-Options: nosniff`. No source path is disclosed. Changing the source requires restarting the development server in this first PR.

## Production emission and Vite assumptions

In `buildStart`, `bundle` mode registers the selected source as a watched file and emits exactly one asset named `live2d-cubism2-core.js`. The virtual module refers to the emitted asset through Vite/Rolldown's plugin asset-reference mechanism, not a fixed `/assets/` URL. No file is emitted from `configResolved`.

Implementation is conditional on integration tests proving the installed Vite 8/Rolldown version transforms the emitted reference correctly for `base: '/'`, a non-root base, `base: './'`, and a custom `build.assetsDir`. If it does not, the plan's stop condition applies and the API is not improvised.

For Electron, `base: './'` must produce a relative renderer URL that resolves under `file://`; an absolute `/assets/...` URL is unacceptable. The runtime may omit browser SRI enforcement for `file://` only if tests show it is necessary, while build-time SHA-256 verification remains mandatory. That runtime choice belongs to AIRI, not this SDK PR.

## Types and packaging

An ambient declaration for `virtual:live2d-sdk/cores` will ship with the package. The preferred result is automatic consumer visibility from the main declarations. If unbuild cannot preserve that reliably without redesigning the build, a narrow documented types subpath is acceptable temporarily. A packed-package consumer test will verify both the plugin export and virtual-module types before release.

The packed artifact must contain compiled plugin code, public declarations, the ambient declaration or documented types subpath, README, and package metadata. It must contain no fixture Core, Core bytes, absolute source path, or temporary output.

## Approval requested

Please approve or request reductions to:

1. the exact API above;
2. local-file-only first-PR scope;
3. optional and development-only defaults;
4. explicit digest-gated production emission;
5. the browser capability union and fixed development route;
6. the Vite 8/Rolldown emitted-reference test requirement;
7. relative `base: './'` and Electron `file://` requirements;
8. the ambient declaration packaging strategy; and
9. deferring all remote-source and shared-cache work.
