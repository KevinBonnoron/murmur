# Generate Speech

## `POST /api/generate`

Synthesize speech from text using an installed model.

### Request Body

```json
{
  "model": "kokoro",
  "input": "Hello from murmur!",
  "voice": "af_heart",
  "speed": 1.0
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `model` | `string` | Yes | | Model name (e.g. `kokoro`, `f5tts`) |
| `input` | `string` | Yes | | Text to synthesize |
| `voice` | `string` | No | model default | Voice ID (e.g. `af_heart`, `am_adam`) |
| `speed` | `number` | No | `1.0` | Speech speed multiplier |
| `variant` | `string` | No | model default | Model variant (e.g. `fp16`, `q4`) |
| `stream` | `boolean` | No | `false` | Enable streaming response |
| `reference_audio` | `string` | No | | Base64-encoded reference audio (for voice cloning) |
| `reference_text` | `string` | No | | Transcript of the reference audio |
| `nfe_steps` | `number` | No | `16` | Flow matching steps (F5-TTS) |
| `device` | `string` | No | `auto` | Inference device (`auto`, `cpu`, `cuda`, `tensorrt`) |

### Response

Returns a WAV audio file.

**Headers:**

| Header | Description |
|--------|-------------|
| `Content-Type` | `audio/wav` |
| `Content-Length` | File size in bytes |
| `X-Audio-Duration` | Audio duration in seconds |
| `X-Audio-Sample-Rate` | Sample rate in Hz |

### Streaming Response

When `stream: true`, the response returns raw 16-bit PCM audio chunks.

**Headers:**

| Header | Description |
|--------|-------------|
| `Content-Type` | `audio/pcm` |
| `X-Sample-Rate` | Sample rate in Hz |
| `X-Channels` | Number of channels (`1`) |
| `X-Bit-Depth` | Bit depth (`16`) |
| `Transfer-Encoding` | `chunked` |

### Examples

**Basic generation:**

```bash
curl -X POST http://localhost:8080/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model": "kokoro", "input": "Hello from murmur!"}' \
  -o output.wav
```

**With voice and speed:**

```bash
curl -X POST http://localhost:8080/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "kokoro",
    "input": "Good morning!",
    "voice": "am_adam",
    "speed": 1.2
  }' \
  -o morning.wav
```

**Voice cloning (F5-TTS):**

```bash
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

**Streaming:**

```bash
curl -X POST http://localhost:8080/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model": "kokoro", "input": "Streaming audio!", "stream": true}' \
  -o stream.pcm
```
