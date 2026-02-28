# CLI Reference

Murmur provides a set of CLI commands modeled after [Ollama](https://ollama.com).

```bash
murmur <command> [options]
```

## `serve`

Start the Murmur TTS HTTP server.

```bash
murmur serve [options]
```

| Option | Alias | Default | Description |
|--------|-------|---------|-------------|
| `--port` | `-p` | `8080` | Port to listen on |
| `--host` | `-H` | `0.0.0.0` | Host to bind to |
| `--device` | `-d` | `auto` | Inference device (`auto`, `cpu`, `cuda`, `tensorrt`) |

**Examples:**

```bash
murmur serve                          # default (port 8080)
murmur serve -p 3000                  # custom port
murmur serve -d cuda                  # force CUDA inference
```

## `pull`

Download a TTS model from HuggingFace.

```bash
murmur pull <name> [options]
```

| Argument / Option | Alias | Description |
|-------------------|-------|-------------|
| `name` (positional) | | Model reference (`kokoro`, `kokoro:fp16`, `./manifest.json`) |
| `--voice` | `-V` | Additional voice to pull (e.g. `jf_alpha`) |

**Examples:**

```bash
murmur pull kokoro              # default variant (q8)
murmur pull kokoro:fp16         # specific variant
murmur pull kokoro -V am_adam   # pull model + extra voice
```

## `run`

Generate speech from text in one shot (no server needed).

```bash
murmur run <model> <text> [options]
```

| Argument / Option | Alias | Default | Description |
|-------------------|-------|---------|-------------|
| `model` (positional) | | | Model name (e.g. `kokoro`, `kokoro:fp16`) |
| `text` (positional) | | | Text to synthesize |
| `--output` | `-o` | `output.wav` | Output file path |
| `--voice` | `-v` | model default | Voice ID (e.g. `af_heart`, `am_adam`) |
| `--speed` | `-s` | `1.0` | Speech speed multiplier |
| `--reference-audio` | `-r` | | Reference audio WAV (for voice cloning) |
| `--reference-text` | `-t` | | Transcript of the reference audio |
| `--nfe-steps` | `-n` | `16` | Flow matching steps (higher = better quality, slower) |
| `--device` | `-d` | `auto` | Inference device (`auto`, `cpu`, `cuda`, `tensorrt`) |

**Examples:**

```bash
murmur run kokoro "Hello, world!" -o hello.wav
murmur run kokoro "Fast speech" -s 1.5 -v am_adam -o fast.wav
murmur run f5tts "Clone this" -r ref.wav -t "Reference text" -o clone.wav
```

## `list`

List all installed models.

```bash
murmur list
```

Output includes model name, backend, size, and number of installed voices.

## `remove`

Remove an installed model.

```bash
murmur remove <name>
```

| Argument | Description |
|----------|-------------|
| `name` (positional) | Model name (e.g. `kokoro`) |

**Example:**

```bash
murmur remove kokoro
```

## `setup`

Run setup utilities (e.g. GPU support).

```bash
murmur setup <subcommand>
```
