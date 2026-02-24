# AGENT.md

This file provides guidance when working with code in this repository.

## Project Overview

Murmur is an Ollama-like Text-to-Speech (TTS) server. It pulls models, stores them locally, and serves speech synthesis via a REST API. Built with Bun, Hono, and the Kokoro TTS engine.

## Commands

```bash
bun install                        # Install dependencies
bun run dev                        # Dev server with hot reload (port 8080)
bun run start                      # Production server
bun run typecheck                  # TypeScript type checking (bunx tsc --noEmit)
bun run lint                       # Lint with Biome
bun run format                     # Format with Biome
bun run check                      # Lint + format in one pass
```

CLI entrypoint: `bun run src/main.ts <command>` where commands are `serve`, `pull`, `list`, `remove`, `run`.

## Architecture

**CLI layer** (`src/cli/`) — Commands built with `citty`. Each file exports a single subcommand registered in `src/main.ts`.

**HTTP server** (`src/server/`) — Hono app with routes under `/api/`. Key endpoints: `POST /api/generate` (synthesize speech), model CRUD under `/api/models`, health/version checks.

**Model system** (`src/models/`) — Three concerns:
- `manifest.ts` — Types and parsing for model manifest JSON (defines files, voices, defaults)
- `registry.ts` — Resolves model references (name, name:version, filepath), discovers built-in models from `manifests/` directory, handles pulling from remote URLs
- `storage.ts` — Filesystem operations at `~/.murmur/models/{name}/{version}/`

**Backend system** (`src/backends/`) — Abstract `TTSBackend` interface (`backend.ts`) with a `BackendManager` (`manager.ts`) that lazy-loads and caches backend instances. Currently one implementation: `KokoroBackend` (`kokoro.ts`) using `kokoro-js` ONNX inference.

**Audio** (`src/audio/encoder.ts`) — Encodes Float32 PCM samples to 16-bit PCM WAV format.

## Code Style

- **Biome** for formatting and linting (not ESLint/Prettier)
- Space indentation, organized imports (node → packages → aliases → relative)
- Strict lint rules: `useImportType`, explicit class member accessibility, readonly properties, mandatory block statements
- Runtime is **Bun** — use Bun APIs (not Node.js equivalents) where applicable
