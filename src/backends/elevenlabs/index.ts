import consola from 'consola';
import type { ManifestVariant, ModelManifest } from '../../models/manifest.ts';
import { decodeWav, encodePcmFromFloat32, encodeWav, toMono } from '../../utils/audio.ts';
import type { AudioChunk, AudioResult, GenerateRequest, TTSBackend } from '../backend.ts';
import { BackendError } from '../backend.ts';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

function resolveOutputFormat(sampleRate: number): string {
  switch (sampleRate) {
    case 16000:
      return 'pcm_16000';
    case 22050:
      return 'pcm_22050';
    case 44100:
      return 'pcm_44100';
    default:
      return 'pcm_24000';
  }
}

function resolveActualSampleRate(sampleRate: number): number {
  switch (sampleRate) {
    case 16000:
    case 22050:
    case 24000:
    case 44100:
      return sampleRate;
    default:
      return 24000;
  }
}

export class ElevenLabsBackend implements TTSBackend {
  private envApiKey: string | null = null;
  private modelId: string | null = null;
  private manifest: ModelManifest | null = null;
  private loaded = false;

  public isLoaded(): boolean {
    return this.loaded;
  }

  public async load(_modelPath: string, manifest: ModelManifest, variant: ManifestVariant, _device?: string, _allowFallback?: boolean): Promise<void> {
    if (this.loaded) {
      return;
    }

    this.envApiKey = process.env.ELEVENLABS_API_KEY ?? null;
    this.modelId = variant.dtype;
    this.manifest = manifest;
    this.loaded = true;

    consola.success(`ElevenLabs backend ready (model: ${this.modelId})`);
  }

  public async generate(request: GenerateRequest): Promise<AudioResult> {
    if (!this.loaded || !this.modelId || !this.manifest) {
      throw new Error('ElevenLabs backend not loaded. Call load() first.');
    }

    const apiKey = request.apiKey ?? this.envApiKey;
    if (!apiKey) {
      throw new BackendError('ElevenLabs API key required. Set ELEVENLABS_API_KEY environment variable or pass it via the Authorization header (Bearer token).', 401);
    }

    const voiceId = request.voice ?? this.manifest.defaults.voice;
    const sampleRate = resolveActualSampleRate(request.sampleRate ?? this.manifest.defaults.sample_rate);
    const outputFormat = resolveOutputFormat(sampleRate);

    consola.start(`Generating speech with ElevenLabs (${this.modelId}): ${request.text.length} chars`);

    const encodedVoiceId = encodeURIComponent(voiceId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch(`${ELEVENLABS_API_URL}/${encodedVoiceId}?output_format=${outputFormat}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: request.text,
          model_id: this.modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new BackendError('ElevenLabs request timed out', 504);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      let message = errorBody || 'Unknown error';
      try {
        const json = JSON.parse(errorBody);
        if (json.detail?.message) {
          message = json.detail.message;
        }
      } catch {
        // Not JSON, use raw text
      }
      throw new BackendError(`ElevenLabs API error (${response.status}): ${message}`, response.status);
    }

    const pcmBuffer = Buffer.from(await response.arrayBuffer());
    const int16Samples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 2);
    const wavBuffer = encodeWav(int16Samples, sampleRate);
    const duration = int16Samples.length / sampleRate;

    consola.success(`Generated ${duration.toFixed(2)}s of audio`);

    return {
      audio: wavBuffer,
      format: 'wav',
      sampleRate,
      duration,
    };
  }

  public async *generateStream(request: GenerateRequest): AsyncGenerator<AudioChunk, void, void> {
    if (!this.loaded) {
      throw new Error('ElevenLabs backend not loaded. Call load() first.');
    }

    consola.start(`Streaming speech with ElevenLabs: ${request.text.length} chars`);
    const result = await this.generate(request);
    const { samples, sampleRate, channels } = decodeWav(result.audio);
    const monoSamples = channels > 1 ? toMono(samples, channels) : samples;
    yield { audio: encodePcmFromFloat32(monoSamples), sampleRate };
    consola.success(`Streamed ${result.duration.toFixed(2)}s of audio`);
  }

  public async unload(): Promise<void> {
    this.envApiKey = null;
    this.modelId = null;
    this.manifest = null;
    this.loaded = false;
    consola.info('ElevenLabs backend unloaded');
  }
}
