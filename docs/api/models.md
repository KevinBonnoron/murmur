# Models API

## List Models

### `GET /api/models`

Returns all installed models.

**Response:**

```json
[
  {
    "name": "kokoro:default",
    "backend": "kokoro",
    "description": "Kokoro TTS — high quality, fast, multilingual (82M params, ONNX)",
    "voices": ["af_heart", "am_adam"],
    "defaults": {
      "variant": "default",
      "voice": "af_heart",
      "sample_rate": 24000,
      "response_format": "wav"
    }
  }
]
```

**Example:**

```bash
curl http://localhost:8080/api/models
```

## Pull a Model

### `POST /api/models/pull`

Download a model. Returns a streaming response with download progress.

**Request Body:**

```json
{
  "name": "kokoro",
  "variant": "fp16",
  "voice": "am_adam"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Model name |
| `variant` | `string` | No | Specific variant to pull |
| `voice` | `string` | No | Additional voice to pull |

**Response (streaming NDJSON):**

```
{"status":"downloading","file":"model_quantized.onnx","completed":45000000,"total":92000000,"percent":49}
{"status":"done","file":"model_quantized.onnx","completed":92000000,"total":92000000,"percent":100}
{"status":"success","model":"kokoro:default"}
```

**Example:**

```bash
curl -X POST http://localhost:8080/api/models/pull \
  -H "Content-Type: application/json" \
  -d '{"name": "kokoro"}'
```

## Model Info

### `GET /api/models/:name`

Get detailed information about an installed model.

**Response:**

```json
{
  "name": "kokoro:default",
  "backend": "kokoro",
  "description": "Kokoro TTS — high quality, fast, multilingual (82M params, ONNX)",
  "license": "Apache-2.0",
  "installed_voices": ["af_heart"],
  "variants": ["default", "fp32", "fp16", "q4", "q4f16"],
  "defaults": {
    "variant": "default",
    "voice": "af_heart",
    "sample_rate": 24000,
    "response_format": "wav"
  },
  "files": [
    { "name": "config.json", "size": 44 },
    { "name": "tokenizer.json", "size": 3497 }
  ]
}
```

**Example:**

```bash
curl http://localhost:8080/api/models/kokoro
```

## Delete a Model

### `DELETE /api/models/:name`

Remove an installed model and its files.

**Response:** `204 No Content`

**Example:**

```bash
curl -X DELETE http://localhost:8080/api/models/kokoro
```

## List Voices

### `GET /api/models/:name/voices`

List installed voices for a model.

**Response:**

```json
{
  "voices": ["af_heart", "am_adam", "bf_emma"]
}
```

**Example:**

```bash
curl http://localhost:8080/api/models/kokoro/voices
```
