<p align="center">
  <h1 align="center">murmur</h1>
  <p align="center">An Ollama-like Text-to-Speech server — pull models, run locally, serve via API.</p>
</p>

<p align="center">
  <a href="https://github.com/KevinBonnoron/murmur/actions/workflows/docker.yml"><img src="https://github.com/KevinBonnoron/murmur/actions/workflows/docker.yml/badge.svg" alt="Docker Build"></a>
  <a href="https://github.com/KevinBonnoron/murmur/actions/workflows/release.yml"><img src="https://github.com/KevinBonnoron/murmur/actions/workflows/release.yml/badge.svg" alt="Release"></a>
  <a href="https://github.com/KevinBonnoron/murmur/pkgs/container/murmur"><img src="https://img.shields.io/badge/ghcr.io-murmur-blue?logo=docker" alt="Docker Image"></a>
  <img src="https://img.shields.io/github/license/KevinBonnoron/murmur" alt="License">
</p>

---

Murmur pulls TTS models from HuggingFace, stores them locally, and serves speech synthesis through a REST API or CLI. Think [Ollama](https://ollama.com), but for text-to-speech.

Built with [Bun](https://bun.sh), [Hono](https://hono.dev), and ONNX inference.

## Features

- **Ollama-style workflow** — `pull`, `list`, `remove`, `run` commands
- **REST API** — generate speech over HTTP, manage models programmatically
- **Multiple backends** — Kokoro (fast, multilingual) and F5-TTS (zero-shot voice cloning)
- **Model variants** — choose between fp32, fp16, q8, q4 quantizations
- **Docker-ready** — pre-built images on GitHub Container Registry
- **Single binary** — compile to a standalone executable for Linux and macOS

## Quickstart

### Install

```bash
# Clone and install
git clone https://github.com/KevinBonnoron/murmur.git
cd murmur
bun install
```

### Pull a model

```bash
murmur pull kokoro          # default quantized (q8, ~92MB)
murmur pull kokoro:fp16     # half-precision (~165MB)
murmur pull kokoro:q4       # smallest (~46MB)
murmur pull f5tts           # voice cloning model
```

### Generate speech

```bash
# One-shot (no server needed)
murmur run kokoro "Hello, world!" -o hello.wav

# With a specific voice and speed
murmur run kokoro "Good morning!" -v am_adam -s 1.2 -o morning.wav

# Voice cloning with F5-TTS
murmur run f5tts "Text to synthesize" -r reference.wav -t "Reference transcript" -o cloned.wav
```

### Start the server

```bash
murmur serve                  # http://0.0.0.0:8080
murmur serve --port 3000      # custom port
```

## API

### Generate speech

```bash
curl -X POST http://localhost:8080/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model": "kokoro", "input": "Hello from murmur!", "voice": "af_heart"}' \
  -o output.wav
```

### List models

```bash
curl http://localhost:8080/api/models
```

### Pull a model

```bash
curl -X POST http://localhost:8080/api/models/pull \
  -H "Content-Type: application/json" \
  -d '{"name": "kokoro"}'
```

### Model info

```bash
curl http://localhost:8080/api/models/kokoro
```

### Delete a model

```bash
curl -X DELETE http://localhost:8080/api/models/kokoro
```

## Docker

```bash
# Pull and run
docker run -p 8080:8080 ghcr.io/kevinbonnoron/murmur

# With persistent model storage
docker run -p 8080:8080 -v murmur-models:/home/murmur/.murmur ghcr.io/kevinbonnoron/murmur
```

## Available Models

| Model | Backend | Params | Description | License |
|-------|---------|--------|-------------|---------|
| `kokoro` | Kokoro | 82M | Fast, high-quality, multilingual | Apache-2.0 |
| `f5tts` | F5-TTS | 300M | Zero-shot voice cloning via flow matching | CC-BY-NC-4.0 |

### Kokoro variants

| Variant | Dtype | Size |
|---------|-------|------|
| `kokoro` (default) | q8 | ~92 MB |
| `kokoro:q4` | q4 | ~46 MB |
| `kokoro:q4f16` | q4f16 | ~58 MB |
| `kokoro:fp16` | fp16 | ~165 MB |
| `kokoro:fp32` | fp32 | ~330 MB |

## Development

```bash
bun install          # install dependencies
bun run dev          # dev server with hot reload
bun run typecheck    # type checking
bun run lint         # lint with Biome
bun run format       # format with Biome
bun run check        # lint + format
```

## License

See [LICENSE](LICENSE) for details.