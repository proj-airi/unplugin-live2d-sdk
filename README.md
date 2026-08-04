<a name="readme-top"></a>

# `@proj-airi/unplugin-live2d-sdk`

Helper plugin for helping installing Live2D SDK.

> [!NOTE]
>
> This project is part of (and also associate to) the [Project AIRI](https://github.com/moeru-ai/airi), we aim to build a LLM-driven VTuber like [Neuro-sama](https://www.youtube.com/@Neurosama) (subscribe if you didn't!) if you are interested in, please do give it a try on [live demo](https://airi.moeru.ai).

## Installation

Pick the package manager of your choice:

```shell
ni @proj-airi/unplugin-live2d-sdk -D # from @antfu/ni, can be installed via `npm i -g @antfu/ni`
pnpm i @proj-airi/unplugin-live2d-sdk -D
yarn i @proj-airi/unplugin-live2d-sdk -D
npm i @proj-airi/unplugin-live2d-sdk -D
```

### UnoCSS usage

```typescript
import { DownloadLive2DSDK } from '@proj-airi/unplugin-live2d-sdk/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    DownloadLive2DSDK(),
  ]
})
```

## Cubism 2 Core provisioning

`Cubism2Core()` makes an explicitly supplied local or remote Cubism 2 Core available to a Vite application. It has no default source and never downloads a Core unless explicitly configured with a URL:

```typescript
import { Cubism2Core } from '@proj-airi/unplugin-live2d-sdk/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    Cubism2Core({
      cacheDir: './node_modules/.cache/cubism2-core',
      timeout: 10000,
      sources: [
        { path: './private/live2d.min.js', optional: true },
        {
          url: 'https://example.com/permitted-cores/live2d.min.js',
          sha256: '<64 hexadecimal characters>',
          optional: true
        },
        { path: 'C:/permitted-cores/live2d.min.js' },
      ],
    }),
  ],
})
```

Relative source paths resolve from Vite's final `root`; absolute paths remain absolute. Sources are checked in order. A missing optional source falls through, while a missing required source, unreadable file, network timeout, or integrity mismatch fails configuration. With no sources, the plugin is optional and silent by default; set `required: true` to require configuration. URL sources require a mandatory SHA-256 digest.

Development serves the selected bytes from a content-addressed URL. The plugin computes SHA-256 and SRI even when no digest is configured for local files. Restart the development server after changing the local Core file.

Production emission is disabled by default. It must be enabled explicitly and requires the expected SHA-256:

```typescript
Cubism2Core({
  distribution: 'bundle',
  sources: [{
    path: './private/live2d.min.js',
    sha256: '<64 hexadecimal characters>',
  }],
})
```

Consumers can inspect the browser-safe capability:

```typescript
/// <reference types="@proj-airi/unplugin-live2d-sdk/types" />

import { cubism2Core } from 'virtual:live2d-sdk/cores'

if (cubism2Core.available)
  console.info(cubism2Core.url, cubism2Core.sri, cubism2Core.expectedGlobal)
```

The explicit types reference is temporarily required because the package's current unbuild entry does not automatically include ambient virtual-module declarations.

> [!WARNING]
>
> Cubism Core is proprietary. Supply only bytes you are permitted to use. SHA-256 verifies identity and integrity but grants no license. `distribution: 'bundle'` places the Core in generated application artifacts, so maintainers must decide whether a release is permitted to redistribute it.

## Other side projects born from Project AIRI

- [Awesome AI VTuber](https://github.com/proj-airi/awesome-ai-vtuber): A curated list of AI VTubers and related projects
- [`unspeech`](https://github.com/moeru-ai/unspeech): Universal endpoint proxy server for `/audio/transcriptions` and `/audio/speech`, like LiteLLM but for any ASR and TTS
- [`hfup`](https://github.com/moeru-ai/hfup): tools to help on deploying, bundling to HuggingFace Spaces
- [`xsai-transformers`](https://github.com/moeru-ai/xsai-transformers): Experimental [🤗 Transformers.js](https://github.com/huggingface/transformers.js) provider for [xsAI](https://github.com/moeru-ai/xsai).
- [WebAI: Realtime Voice Chat](https://github.com/proj-airi/webai-realtime-voice-chat): Full example of implementing ChatGPT's realtime voice from scratch with VAD + STT + LLM + TTS.
- [`@proj-airi/drizzle-duckdb-wasm`](https://github.com/moeru-ai/airi/tree/main/packages/drizzle-duckdb-wasm/README.md): Drizzle ORM driver for DuckDB WASM
- [`@proj-airi/duckdb-wasm`](https://github.com/moeru-ai/airi/tree/main/packages/duckdb-wasm/README.md): Easy to use wrapper for `@duckdb/duckdb-wasm`
- [Airi Factorio](https://github.com/moeru-ai/airi-factorio): Allow Airi to play Factorio
- [Factorio RCON API](https://github.com/nekomeowww/factorio-rcon-api): RESTful API wrapper for Factorio headless server console
- [`autorio`](https://github.com/moeru-ai/airi-factorio/tree/main/packages/autorio): Factorio automation library
- [`tstl-plugin-reload-factorio-mod`](https://github.com/moeru-ai/airi-factorio/tree/main/packages/tstl-plugin-reload-factorio-mod): Reload Factorio mod when developing
- [Velin](https://github.com/luoling8192/velin): Use Vue SFC and Markdown to write easy to manage stateful prompts for LLM
- [`demodel`](https://github.com/moeru-ai/demodel): Easily boost the speed of pulling your models and datasets from various of inference runtimes.
- [`inventory`](https://github.com/moeru-ai/inventory): Centralized model catalog and default provider configurations backend service
- [MCP Launcher](https://github.com/moeru-ai/mcp-launcher): Easy to use MCP builder & launcher for all possible MCP servers, just like Ollama for models!
- [🥺 SAD](https://github.com/moeru-ai/sad): Documentation and notes for self-host and browser running LLMs.
