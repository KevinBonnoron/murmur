# Development

## Setup

```bash
git clone https://github.com/KevinBonnoron/murmur.git
cd murmur
bun install
```

## Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Dev server with hot reload (port 8080) |
| `bun run start` | Production server |
| `bun run typecheck` | TypeScript type checking (`tsc --noEmit`) |
| `bun run lint` | Lint with Biome |
| `bun run format` | Format with Biome |
| `bun run check` | Lint + format in one pass |
| `bun run build` | Compile to standalone binary |

## Project Structure

```
src/
├── main.ts                    # CLI entrypoint (citty)
├── cli/                       # CLI commands
│   ├── serve.ts               # Start HTTP server
│   ├── pull.ts                # Download models
│   ├── list.ts                # List installed models
│   ├── remove.ts              # Remove models
│   ├── run.ts                 # One-shot generation
│   └── setup.ts               # Setup utilities
├── server/                    # HTTP server (Hono)
│   ├── app.ts                 # App creation
│   ├── validation.ts          # Zod validation
│   └── routes/                # Route handlers
├── models/                    # Model management
│   ├── manifest.ts            # Manifest types/parsing
│   ├── registry.ts            # Model resolution
│   └── storage.ts             # Filesystem storage
├── backends/                  # TTS backend implementations
│   ├── backend.ts             # TTSBackend interface
│   ├── base.ts                # Base backend class
│   ├── manager.ts             # BackendManager
│   ├── kokoro/                # Kokoro (ONNX)
│   ├── f5tts/                 # F5-TTS (ONNX)
│   ├── piper/                 # Piper (ONNX)
│   ├── elevenlabs/            # ElevenLabs (API)
│   └── fishaudio/             # FishAudio (API)
└── utils/                     # Utilities
    ├── download.ts            # HTTP downloads
    ├── audio.ts               # Audio utilities
    └── espeak.ts              # eSpeak utilities
```

## Code Style

Murmur uses [Biome](https://biomejs.dev/) for linting and formatting (not ESLint/Prettier).

- Space indentation
- Organized imports: `node:` → packages → aliases → relative
- Strict lint rules: `useImportType`, explicit class member accessibility, readonly properties, mandatory block statements
- Runtime is **Bun** — use Bun APIs where applicable

Run the formatter and linter before committing:

```bash
bun run check
```

## Adding a Backend

1. Create a new directory under `src/backends/` (e.g. `src/backends/mybackend/`)
2. Implement the `TTSBackend` interface from `src/backends/backend.ts`
3. Register it in `src/backends/manager.ts` (`createBackend` function)
4. Create a manifest JSON in `manifests/`

## Adding a Model

1. Create a manifest JSON file in the `manifests/` directory
2. Follow the schema defined in `manifests/manifest.schema.json`
3. Specify the backend, files, variants, and defaults

## License

MIT — see [LICENSE](https://github.com/KevinBonnoron/murmur/blob/main/LICENSE).
