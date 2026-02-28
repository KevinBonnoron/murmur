# Docker & Deployment

## Docker

Murmur provides pre-built Docker images on GitHub Container Registry.

### Quick Start

```bash
docker run -p 8080:8080 ghcr.io/kevinbonnoron/murmur
```

### Persistent Model Storage

To avoid re-downloading models between container restarts:

```bash
docker run -p 8080:8080 \
  -v murmur-models:/home/murmur/.murmur \
  ghcr.io/kevinbonnoron/murmur
```

### Docker Compose

```yaml
services:
  murmur:
    image: ghcr.io/kevinbonnoron/murmur
    ports:
      - "8080:8080"
    volumes:
      - murmur-models:/home/murmur/.murmur

volumes:
  murmur-models:
```

### Pull a Model in Docker

Once the container is running, pull a model via the API:

```bash
curl -X POST http://localhost:8080/api/models/pull \
  -H "Content-Type: application/json" \
  -d '{"name": "kokoro"}'
```

## Building from Source

### Standalone Binary

Murmur can be compiled to a standalone binary:

```bash
bun run build
```

This produces a `dist/murmur` binary with bundled ONNX runtime and WASM files. Supported platforms:

| Platform | Architecture |
|----------|-------------|
| Linux | x64 |
| macOS | ARM64 (Apple Silicon) |

### Custom Docker Build

```bash
docker build -t murmur .
docker run -p 8080:8080 murmur
```

## Configuration

The server listens on `0.0.0.0:8080` by default. Customize with CLI flags:

```bash
murmur serve --port 3000 --host 127.0.0.1
```

Models are stored at `~/.murmur/models/` on the host filesystem.
