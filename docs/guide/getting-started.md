# Getting Started

## Prerequisites

- [Bun](https://bun.sh) v1.2 or later

## Installation

```bash
git clone https://github.com/KevinBonnoron/murmur.git
cd murmur
bun install
```

## Pull a Model

Before generating speech, you need to pull a TTS model:

```bash
murmur pull kokoro          # default quantized (q8, ~92 MB)
murmur pull kokoro:fp16     # half-precision (~165 MB)
murmur pull kokoro:q4       # smallest (~46 MB)
murmur pull f5tts           # voice cloning model
```

See [Available Models](/models/) for the full list.

## Generate Speech

### One-shot (no server)

```bash
murmur run kokoro "Hello, world!" -o hello.wav
```

### With a specific voice and speed

```bash
murmur run kokoro "Good morning!" -v am_adam -s 1.2 -o morning.wav
```

### Voice cloning with F5-TTS

```bash
murmur run f5tts "Text to synthesize" \
  -r reference.wav \
  -t "Reference transcript" \
  -o cloned.wav
```

## Start the Server

```bash
murmur serve                  # http://0.0.0.0:8080
murmur serve --port 3000      # custom port
```

Once the server is running, you can generate speech via the [REST API](/api/generate):

```bash
curl -X POST http://localhost:8080/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model": "kokoro", "input": "Hello from murmur!"}' \
  -o output.wav
```

## Next Steps

- [CLI Reference](/guide/cli) — all commands and options
- [API Reference](/api/) — full HTTP endpoint documentation
- [Docker & Deployment](/guide/docker) — run with Docker
