import consola from 'consola';
import type { ManifestVariant, ModelManifest } from '../../models/manifest.ts';
import { encodeWav } from '../../utils/audio.ts';
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

interface ResolvedRequest {
  apiKey: string;
  voiceId: string;
  sampleRate: number;
  outputFormat: string;
  body: string;
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

    this.envApiKey = Bun.env.ELEVENLABS_API_KEY ?? null;
    this.modelId = variant.dtype;
    this.manifest = manifest;
    this.loaded = true;

    consola.success(`ElevenLabs backend ready (model: ${this.modelId})`);
  }

  private resolveRequest(request: GenerateRequest): ResolvedRequest {
    if (!this.loaded || !this.modelId || !this.manifest) {
      throw new BackendError('ElevenLabs backend not loaded. Call load() first.', 503);
    }

    const apiKey = request.apiKey ?? this.envApiKey;
    if (!apiKey) {
      throw new BackendError('ElevenLabs API key required. Set ELEVENLABS_API_KEY environment variable or pass it via the Authorization header (Bearer token).', 401);
    }

    const voiceId = request.voice ?? this.manifest.defaults.voice;
    const sampleRate = resolveActualSampleRate(request.sampleRate ?? this.manifest.defaults.sample_rate);
    const outputFormat = resolveOutputFormat(sampleRate);

    const body = JSON.stringify({
      text: request.text,
      model_id: this.modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    });

    return { apiKey, voiceId, sampleRate, outputFormat, body };
  }

  private async fetchElevenLabs(url: string, apiKey: string, body: string, signal: AbortSignal): Promise<Response> {
    const response = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body,
    });

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

    return response;
  }

  public async generate(request: GenerateRequest): Promise<AudioResult> {
    const { apiKey, voiceId, sampleRate, outputFormat, body } = this.resolveRequest(request);

    consola.start(`Generating speech with ElevenLabs (${this.modelId}): ${request.text.length} chars`);

    const encodedVoiceId = encodeURIComponent(voiceId);
    const url = `${ELEVENLABS_API_URL}/${encodedVoiceId}?output_format=${outputFormat}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await this.fetchElevenLabs(url, apiKey, body, controller.signal);

      const pcmBuffer = Buffer.from(await response.arrayBuffer());
      const alignedBuffer = pcmBuffer.buffer.slice(pcmBuffer.byteOffset, pcmBuffer.byteOffset + pcmBuffer.byteLength);
      const int16Samples = new Int16Array(alignedBuffer);
      const wavBuffer = encodeWav(int16Samples, sampleRate);
      const duration = int16Samples.length / sampleRate;

      consola.success(`Generated ${duration.toFixed(2)}s of audio`);

      return {
        audio: wavBuffer,
        format: 'wav',
        sampleRate,
        duration,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new BackendError('ElevenLabs request timed out', 504);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  public async *generateStream(request: GenerateRequest): AsyncGenerator<AudioChunk, void, void> {
    const { apiKey, voiceId, sampleRate, outputFormat, body } = this.resolveRequest(request);

    consola.start(`Streaming speech with ElevenLabs (${this.modelId}): ${request.text.length} chars`);

    const encodedVoiceId = encodeURIComponent(voiceId);
    const url = `${ELEVENLABS_API_URL}/${encodedVoiceId}/stream?output_format=${outputFormat}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    try {
      const response = await this.fetchElevenLabs(url, apiKey, body, controller.signal);

      if (!response.body) {
        throw new BackendError('ElevenLabs streaming response has no body', 502);
      }

      for await (const chunk of response.body) {
        yield { audio: Buffer.from(chunk), sampleRate };
      }

      consola.success('Streaming complete');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new BackendError('ElevenLabs request timed out', 504);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  public async unload(): Promise<void> {
    this.envApiKey = null;
    this.modelId = null;
    this.manifest = null;
    this.loaded = false;
    consola.info('ElevenLabs backend unloaded');
  }
}
