# Architecture

Murmur is built with [Bun](https://bun.sh), [Hono](https://hono.dev), and ONNX inference. The codebase is organized into four main layers.

## Overview

```
┌─────────────────────────────────────────────┐
│                  CLI (citty)                │
│         serve · pull · list · run           │
├─────────────────────────────────────────────┤
│              HTTP Server (Hono)             │
│    /api/generate · /api/models · /api/…     │
├──────────────────────┬──────────────────────┤
│    Model System      │   Backend System     │
│  manifest · registry │  Kokoro · F5-TTS     │
│  storage             │  Piper · ElevenLabs  │
├──────────────────────┴──────────────────────┤
│             Audio Encoding                  │
│           PCM → WAV conversion              │
└─────────────────────────────────────────────┘
```

## CLI Layer

**Directory:** `src/cli/`

Commands are built with [citty](https://github.com/unjs/citty). Each file exports a single `defineCommand()` registered as a subcommand in `src/main.ts`.

| Command | File | Description |
|---------|------|-------------|
| `serve` | `src/cli/serve.ts` | Start the HTTP server |
| `pull` | `src/cli/pull.ts` | Download a model |
| `list` | `src/cli/list.ts` | List installed models |
| `remove` | `src/cli/remove.ts` | Remove a model |
| `run` | `src/cli/run.ts` | One-shot speech generation |
| `setup` | `src/cli/setup.ts` | Setup utilities |

## HTTP Server

**Directory:** `src/server/`

A [Hono](https://hono.dev) application with routes under `/api/`. Request validation uses Zod schemas via `@hono/zod-validator`.

| Route | Handler |
|-------|---------|
| `POST /api/generate` | `src/server/routes/generate.routes.ts` |
| `/api/models/*` | `src/server/routes/model.routes.ts` |
| `GET /api/health` | `src/server/routes/health.routes.ts` |
| `GET /api/version` | `src/server/routes/version.routes.ts` |

## Model System

**Directory:** `src/models/`

Three concerns split across files:

- **`manifest.ts`** — Types and parsing for model manifest JSON. A manifest defines the model's files, variants (quantization levels), voices, and defaults.
- **`registry.ts`** — Resolves model references (e.g. `kokoro`, `kokoro:fp16`, `./manifest.json`), discovers built-in models from the `manifests/` directory, and handles pulling from remote URLs.
- **`storage.ts`** — Filesystem operations at `~/.murmur/models/{name}/`.

### Manifest Format

Model manifests are JSON files in the `manifests/` directory:

```json
{
  "name": "kokoro",
  "description": "Kokoro TTS — high quality, fast, multilingual",
  "backend": "kokoro",
  "license": "Apache-2.0",
  "files": [
    { "name": "config.json", "url": "https://...", "size": 44 }
  ],
  "variants": {
    "default": { "file": "model_quantized.onnx", "dtype": "q8", "url": "https://...", "size": 92000000 }
  },
  "voice_url": "https://.../voices/${voice_id}.bin",
  "defaults": {
    "variant": "default",
    "voice": "af_heart",
    "sample_rate": 24000,
    "response_format": "wav"
  }
}
```

## Backend System

**Directory:** `src/backends/`

An abstract `TTSBackend` interface with a `BackendManager` that lazy-loads and caches backend instances by model+variant+device key.

### TTSBackend Interface

```typescript
interface TTSBackend {
  load(modelPath, manifest, variant, device?): Promise<void>;
  generate(request: GenerateRequest): Promise<AudioResult>;
  generateStream(request: GenerateRequest): AsyncGenerator<AudioChunk>;
  unload(): Promise<void>;
  isLoaded(): boolean;
}
```

### Implementations

| Backend | Directory | Description |
|---------|-----------|-------------|
| Kokoro | `src/backends/kokoro/` | ONNX inference via `kokoro-js`, with custom phonemizer |
| F5-TTS | `src/backends/f5tts/` | ONNX inference with encoder/decoder/transformer |
| Piper | `src/backends/piper/` | Lightweight ONNX TTS |
| ElevenLabs | `src/backends/elevenlabs/` | Cloud API integration |
| FishAudio | `src/backends/fishaudio/` | Cloud API integration |

### Device Detection

The `BackendManager` supports automatic device detection:
- **`auto`** — Probes for CUDA availability (checks `nvidia-smi`, CUDA libraries, ONNX Runtime providers)
- **`cpu`** — CPU-only inference
- **`cuda`** — NVIDIA GPU inference
- **`tensorrt`** — NVIDIA TensorRT optimized inference

## Audio

**File:** `src/audio/encoder.ts`

Encodes Float32 PCM samples to 16-bit PCM WAV format for output.
