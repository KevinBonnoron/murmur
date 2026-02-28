# Available Models

## Overview

| Model | Backend | Params | Description | License |
|-------|---------|--------|-------------|---------|
| `kokoro` | Kokoro | 82M | Fast, high-quality, multilingual | Apache-2.0 |
| `f5tts` | F5-TTS | 300M | Zero-shot voice cloning via flow matching | CC-BY-NC-4.0 |
| `piper` | Piper | — | Lightweight, offline TTS | MIT |
| `elevenlabs` | ElevenLabs | — | Cloud-based, high-quality TTS (API key required) | Proprietary |

## Kokoro

High-quality, fast, multilingual TTS with 82M parameters. Uses ONNX inference for efficient local generation.

### Variants

| Variant | Dtype | Size | Command |
|---------|-------|------|---------|
| `kokoro` (default) | q8 | ~92 MB | `murmur pull kokoro` |
| `kokoro:q4` | q4 | ~46 MB | `murmur pull kokoro:q4` |
| `kokoro:q4f16` | q4f16 | ~58 MB | `murmur pull kokoro:q4f16` |
| `kokoro:fp16` | fp16 | ~165 MB | `murmur pull kokoro:fp16` |
| `kokoro:fp32` | fp32 | ~330 MB | `murmur pull kokoro:fp32` |

### Voices

Kokoro supports multiple voices. The default voice is `af_heart`. Additional voices can be pulled with the `--voice` flag:

```bash
murmur pull kokoro -V am_adam
```

### Usage

```bash
# CLI
murmur run kokoro "Hello, world!" -o hello.wav
murmur run kokoro "Custom voice" -v am_adam -o custom.wav

# API
curl -X POST http://localhost:8080/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model": "kokoro", "input": "Hello!"}' \
  -o output.wav
```

## F5-TTS

Zero-shot voice cloning via flow matching with 300M parameters. Requires a reference audio sample and its transcript.

### Variants

| Variant | Dtype | Command |
|---------|-------|---------|
| `f5tts` (default) | fp32 | `murmur pull f5tts` |
| `f5tts:fp16` | fp16 | `murmur pull f5tts:fp16` |

### Usage

F5-TTS requires `--reference-audio` and `--reference-text` flags:

```bash
# CLI
murmur run f5tts "Text to synthesize" \
  -r reference.wav \
  -t "Transcript of the reference audio" \
  -o cloned.wav

# API
curl -X POST http://localhost:8080/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "f5tts",
    "input": "Text to synthesize",
    "reference_audio": "<base64-encoded-wav>",
    "reference_text": "Transcript of the reference audio"
  }' \
  -o cloned.wav
```

## Piper

Lightweight, offline TTS engine designed for embedded and edge devices.

```bash
murmur pull piper
murmur run piper "Hello, world!" -o hello.wav
```

## ElevenLabs

Cloud-based TTS using the ElevenLabs API. Requires an API key passed via the `Authorization` header.

```bash
murmur pull elevenlabs

# API (with Bearer token)
curl -X POST http://localhost:8080/api/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"model": "elevenlabs", "input": "Hello!"}' \
  -o output.wav
```

## Custom Models

You can use a local manifest file to define custom models:

```bash
murmur pull ./path/to/manifest.json
```

See the [Architecture](/architecture) page for details on the manifest format.
