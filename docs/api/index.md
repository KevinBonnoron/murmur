# API Overview

Murmur exposes a REST API for speech synthesis and model management.

## Base URL

```
http://localhost:8080/api
```

## Content Type

All request bodies use `application/json`. Audio responses are returned as `audio/wav` (or `audio/pcm` for streaming).

## Error Handling

Errors return JSON with an `error` field:

```json
{
  "error": "Model kokoro not found"
}
```

Validation errors include details:

```json
{
  "error": "Validation failed",
  "details": [
    { "field": "input", "message": "Required" }
  ]
}
```

### HTTP Status Codes

| Code | Description |
|------|-------------|
| `200` | Success |
| `204` | Success (no content) |
| `400` | Validation error |
| `404` | Model or resource not found |
| `500` | Internal server error |

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | [`/api/generate`](/api/generate) | Generate speech from text |
| `GET` | [`/api/models`](/api/models#list-models) | List installed models |
| `POST` | [`/api/models/pull`](/api/models#pull-a-model) | Pull a model |
| `GET` | [`/api/models/:name`](/api/models#model-info) | Get model info |
| `DELETE` | [`/api/models/:name`](/api/models#delete-a-model) | Delete a model |
| `GET` | [`/api/models/:name/voices`](/api/models#list-voices) | List model voices |
| `GET` | [`/api/health`](/api/health#health-check) | Health check |
| `GET` | [`/api/version`](/api/health#version) | Get server version |
