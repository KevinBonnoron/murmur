import { join, resolve, sep } from 'node:path';
import consola from 'consola';
import type { InferenceSession } from 'onnxruntime-node';
import type { ManifestVariant, ModelManifest } from '../../models/manifest.ts';
import { downloadFile } from '../../models/registry.ts';
import type { AudioResult, GenerateRequest } from '../backend.ts';
import { BaseTTSBackend } from '../base.ts';
import { type PiperModelConfig, parsePiperConfig } from './config.ts';
import { splitSentences, textToPhonemeIds } from './phonemizer.ts';

/** Base URL for Piper voices on HuggingFace. */
const PIPER_VOICE_BASE_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

/** Maximum number of voice ONNX sessions cached in memory. */
const MAX_CACHED_VOICES = 3;

/** Seconds of silence inserted between sentences. */
const SENTENCE_PAUSE_SECONDS = 0.3;

interface LoadedVoice {
  readonly session: InferenceSession;
  readonly config: PiperModelConfig;
}

/**
 * Parse a Piper voice ID like "en_US-lessac-medium" into components.
 * Format: {locale}-{name}-{quality}
 * URL path: {lang}/{locale}/{name}/{quality}/{voiceId}.onnx
 * e.g. en_US-lessac-medium → en/en_US/lessac/medium/en_US-lessac-medium.onnx
 */
function parseVoiceId(voiceId: string): { lang: string; locale: string; name: string; quality: string } {
  const parts = voiceId.split('-');
  if (parts.length < 3) {
    throw new Error(`Invalid Piper voice ID: "${voiceId}". Expected format: {locale}-{name}-{quality} (e.g., en_US-lessac-medium)`);
  }
  const quality = parts[parts.length - 1] as string;
  const locale = parts[0] as string;
  const lang = locale.split('_')[0] as string;
  const name = parts.slice(1, -1).join('-');
  return { lang, locale, name, quality };
}

/** Build a HuggingFace URL for a Piper voice file. */
function buildVoiceUrl(voiceId: string, extension: string): string {
  const { lang, locale, name, quality } = parseVoiceId(voiceId);
  return `${PIPER_VOICE_BASE_URL}/${lang}/${locale}/${name}/${quality}/${voiceId}${extension}`;
}

/** Encode Float32 PCM samples to a 16-bit PCM WAV buffer. */
function encodeWavFromFloat32(samples: Float32Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = samples.length * bytesPerSample;
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: bounded loop
    const val = Math.round(samples[i]! * 32767.0);
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, val)), headerSize + i * 2);
  }

  return buffer;
}

export class PiperBackend extends BaseTTSBackend {
  protected readonly backendName = 'Piper';

  private readonly voices = new Map<string, LoadedVoice>();
  private readonly voiceLoads = new Map<string, Promise<LoadedVoice>>();
  private modelPath: string | null = null;
  private manifest: ModelManifest | null = null;
  private device = 'cpu';
  private loaded = false;

  public isLoaded(): boolean {
    return this.loaded;
  }

  protected async doLoad(modelPath: string, manifest: ModelManifest, _variant: ManifestVariant, device: string): Promise<void> {
    this.modelPath = modelPath;
    this.manifest = manifest;
    this.device = device;
    this.loaded = true;
    // Voice ONNX sessions are loaded on-demand in doGenerate since
    // each Piper voice is a separate ONNX model.
  }

  protected async doGenerate(request: GenerateRequest): Promise<AudioResult> {
    const manifest = this.manifest as ModelManifest;
    const modelPath = this.modelPath as string;
    const voiceId = request.voice ?? manifest.defaults.voice;

    const voice = await this.getOrLoadVoice(modelPath, voiceId);
    const sampleRate = voice.config.audio.sample_rate;
    const speed = request.speed ?? 1.0;
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new Error('speed must be a positive number');
    }

    // Split text into sentences and generate each one separately,
    // inserting real silence samples between them.
    const sentences = splitSentences(request.text);
    const silenceSamples = Math.round(sampleRate * SENTENCE_PAUSE_SECONDS);
    const audioChunks: Float32Array[] = [];

    for (let i = 0; i < sentences.length; i++) {
      const chunk = await this.synthesizeSentence(sentences[i] as string, voice, speed);
      audioChunks.push(chunk);

      if (i < sentences.length - 1) {
        audioChunks.push(new Float32Array(silenceSamples));
      }
    }

    // Concatenate all chunks
    const totalLength = audioChunks.reduce((sum, c) => sum + c.length, 0);
    const audioFloat = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of audioChunks) {
      audioFloat.set(chunk, offset);
      offset += chunk.length;
    }

    const wavBuffer = encodeWavFromFloat32(audioFloat, sampleRate);
    const duration = audioFloat.length / sampleRate;

    return {
      audio: wavBuffer,
      format: 'wav',
      sampleRate,
      duration,
    };
  }

  /** Run ONNX inference for a single sentence and return raw float32 audio. */
  private async synthesizeSentence(text: string, voice: LoadedVoice, speed: number): Promise<Float32Array> {
    const phonemeIds = await textToPhonemeIds(text, voice.config);
    const lengthScale = voice.config.inference.length_scale / speed;

    const ort = await import('onnxruntime-node');
    const { Tensor: OrtTensor } = ort;

    const inputTensor = new OrtTensor('int64', phonemeIds, [1, phonemeIds.length]);
    const inputLengths = new OrtTensor('int64', BigInt64Array.from([BigInt(phonemeIds.length)]), [1]);
    const scales = new OrtTensor('float32', Float32Array.from([voice.config.inference.noise_scale, lengthScale, voice.config.inference.noise_w]), [3]);

    const feeds: Record<string, InstanceType<typeof OrtTensor>> = {
      input: inputTensor,
      input_lengths: inputLengths,
      scales,
    };

    if (voice.config.num_speakers > 1) {
      feeds.sid = new OrtTensor('int64', BigInt64Array.from([BigInt(0)]), [1]);
    }

    const outputs = await voice.session.run(feeds);

    const outputName = voice.session.outputNames[0];
    if (!outputName) {
      throw new Error('Piper ONNX model has no output tensor');
    }
    const outputTensor = outputs[outputName];
    if (!outputTensor) {
      throw new Error(`Missing ONNX output tensor: ${outputName}`);
    }
    if (!(outputTensor.data instanceof Float32Array)) {
      throw new Error(`Expected float32 output, got: ${outputTensor.type}`);
    }
    return outputTensor.data;
  }

  /** Get a cached voice or load it on-demand with LRU eviction. */
  private async getOrLoadVoice(modelPath: string, voiceId: string): Promise<LoadedVoice> {
    const cached = this.voices.get(voiceId);
    if (cached) {
      // Move to end (most recently used)
      this.voices.delete(voiceId);
      this.voices.set(voiceId, cached);
      return cached;
    }

    // Deduplicate concurrent loads for the same voice
    const pending = this.voiceLoads.get(voiceId);
    if (pending) {
      return pending;
    }

    const loadPromise = this.loadVoice(modelPath, voiceId);
    this.voiceLoads.set(voiceId, loadPromise);
    try {
      return await loadPromise;
    } finally {
      this.voiceLoads.delete(voiceId);
    }
  }

  private async loadVoice(modelPath: string, voiceId: string): Promise<LoadedVoice> {
    await this.ensurePiperVoice(modelPath, voiceId);

    // Load config
    const voiceDir = join(modelPath, 'voices', voiceId);
    const configPath = join(voiceDir, `${voiceId}.onnx.json`);
    const configFile = Bun.file(configPath);
    if (!(await configFile.exists())) {
      throw new Error(`Piper voice config not found: ${configPath}`);
    }
    const config = parsePiperConfig(await configFile.json());

    // Load ONNX session
    const ort = await import('onnxruntime-node');
    const onnxPath = join(voiceDir, `${voiceId}.onnx`);
    consola.start(`Loading Piper voice: ${voiceId}`);
    const session = await ort.InferenceSession.create(onnxPath, {
      executionProviders: [this.device],
      graphOptimizationLevel: 'all',
    });
    consola.success(`Loaded Piper voice: ${voiceId}`);

    const voice: LoadedVoice = { session, config };

    // Evict oldest voice if cache is full
    if (this.voices.size >= MAX_CACHED_VOICES) {
      const oldestKey = this.voices.keys().next().value;
      if (oldestKey) {
        const oldest = this.voices.get(oldestKey);
        this.voices.delete(oldestKey);
        await oldest?.session.release();
        consola.info(`Evicted cached Piper voice: ${oldestKey}`);
      }
    }

    this.voices.set(voiceId, voice);
    return voice;
  }

  /**
   * Ensure Piper voice files (.onnx and .onnx.json) are present locally.
   * If files already exist (e.g. manually placed custom voices), they are used as-is.
   * Otherwise, attempts to download from HuggingFace rhasspy/piper-voices.
   */
  private async ensurePiperVoice(modelPath: string, voiceId: string): Promise<void> {
    const baseDir = resolve(modelPath, 'voices');
    const voiceDir = resolve(baseDir, voiceId);
    if (!voiceDir.startsWith(baseDir + sep)) {
      throw new Error(`Invalid voice ID: ${voiceId}`);
    }
    const onnxPath = join(voiceDir, `${voiceId}.onnx`);
    const configPath = join(voiceDir, `${voiceId}.onnx.json`);

    const onnxExists = await Bun.file(onnxPath).exists();
    const configExists = await Bun.file(configPath).exists();

    if (onnxExists && configExists) {
      return;
    }

    try {
      if (!configExists) {
        const configUrl = buildVoiceUrl(voiceId, '.onnx.json');
        await downloadFile(configUrl, configPath, undefined, `${voiceId}.onnx.json`);
      }

      if (!onnxExists) {
        const onnxUrl = buildVoiceUrl(voiceId, '.onnx');
        await downloadFile(onnxUrl, onnxPath, undefined, `${voiceId}.onnx`);
      }
    } catch {
      throw new Error(`Piper voice "${voiceId}" not found locally or on HuggingFace. For custom voices, place your files at:\n  ${onnxPath}\n  ${configPath}`);
    }
  }

  protected async doUnload(): Promise<void> {
    await Promise.allSettled([...this.voices.values()].map((v) => v.session.release()));
    this.voices.clear();
    this.voiceLoads.clear();
    this.modelPath = null;
    this.manifest = null;
    this.loaded = false;
  }
}
