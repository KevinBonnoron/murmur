import fs from 'node:fs/promises';
import { basename, join } from 'node:path';
import consola from 'consola';
import type { ManifestVariant, ModelManifest } from '../../models/manifest.ts';
import { encodePcmFromFloat32 } from '../../utils/audio.ts';
import type { AudioChunk, AudioResult, GenerateRequest } from '../backend.ts';
import { BaseTTSBackend } from '../base.ts';
import { isEnglishVoice, phonemize } from './phonemizer.ts';

// kokoro-js types (dynamic import to avoid top-level dependency issues)
type KokoroRawAudio = { audio: Float32Array; sampling_rate: number; toWav(): ArrayBuffer };
type KokoroGenerateOptions = { voice?: string; speed?: number };
type KokoroTokenizer = (text: string, options: { truncation: boolean }) => { input_ids: unknown };
type KokoroStreamGenerateOptions = KokoroGenerateOptions & { split_pattern?: RegExp };
type KokoroTTSInstance = {
  generate(text: string, options?: KokoroGenerateOptions): Promise<KokoroRawAudio>;
  generate_from_ids(inputIds: unknown, options?: KokoroGenerateOptions): Promise<KokoroRawAudio>;
  stream(text: string, options?: KokoroStreamGenerateOptions): AsyncGenerator<{ text: string; phonemes: string; audio: KokoroRawAudio }, void, void>;
  tokenizer: KokoroTokenizer;
  list_voices(): void;
  _validate_voice(voice: string): string;
};

/**
 * Patch fs.readFile so that kokoro-js voice reads (*.bin under a voices/ dir)
 * are redirected to the murmur model storage path. This is needed because
 * kokoro-js resolves voices relative to its own __dirname, which is wrong
 * inside a compiled Bun binary.
 *
 * Uses ref-counting so multiple KokoroBackend instances share a single patch
 * and only restore the original when the last instance unloads.
 */
let patchRefCount = 0;
let originalReadFile: typeof fs.readFile | null = null;
const patchedVoicesDirs = new Set<string>();

function patchVoiceReadFile(modelPath: string): () => void {
  const voicesDir = join(modelPath, 'voices');
  patchedVoicesDirs.add(voicesDir);

  if (patchRefCount === 0) {
    originalReadFile = fs.readFile;
    const saved = originalReadFile;

    // biome-ignore lint/suspicious/noExplicitAny: patching a polymorphic Node API
    (fs as any).readFile = async function patchedReadFile(path: any, ...args: any[]) {
      if (typeof path === 'string' && path.endsWith('.bin') && path.includes('/voices/')) {
        const filename = basename(path);
        // Try each registered voices dir
        for (const dir of patchedVoicesDirs) {
          const redirected = join(dir, filename);
          try {
            return await saved.call(fs, redirected, ...args);
          } catch {
            // Try next dir
          }
        }
      }
      return saved.call(fs, path, ...args);
    };
  }

  patchRefCount++;

  return () => {
    patchedVoicesDirs.delete(voicesDir);
    patchRefCount--;
    if (patchRefCount === 0 && originalReadFile) {
      // biome-ignore lint/suspicious/noExplicitAny: restoring original
      (fs as any).readFile = originalReadFile;
      originalReadFile = null;
    }
  };
}

export class KokoroBackend extends BaseTTSBackend {
  protected readonly backendName = 'Kokoro';

  private tts: KokoroTTSInstance | null = null;
  private manifest: ModelManifest | null = null;
  private restoreFs: (() => void) | null = null;

  public isLoaded(): boolean {
    return this.tts !== null;
  }

  protected async doLoad(modelPath: string, manifest: ModelManifest, variant: ManifestVariant, device: string): Promise<void> {
    this.restoreFs = patchVoiceReadFile(modelPath);

    try {
      const { KokoroTTS } = await import('kokoro-js');
      const instance = await KokoroTTS.from_pretrained(modelPath, {
        dtype: variant.dtype as 'q8' | 'fp32' | 'fp16' | 'q4' | 'q4f16',
        // biome-ignore lint/suspicious/noExplicitAny: device support varies by runtime (cpu, cuda, webgpu, wasm)
        device: device as any,
      });

      // Bypass voice validation entirely — kokoro-js only recognises 28 English
      // voices and prints a noisy table to the console for every unknown voice.
      // The original method just returns voice.charAt(0), so we do the same.
      (instance as KokoroTTSInstance)._validate_voice = (voice: string): string => voice.charAt(0);

      this.tts = instance;
      this.manifest = manifest;
    } catch (err) {
      this.restoreFs?.();
      this.restoreFs = null;
      throw err;
    }
  }

  protected async doGenerate(request: GenerateRequest): Promise<AudioResult> {
    const tts = this.tts as KokoroTTSInstance;
    const manifest = this.manifest as ModelManifest;
    const voice = request.voice ?? manifest.defaults.voice;
    const speed = request.speed ?? 1.0;

    let result: KokoroRawAudio;

    if (isEnglishVoice(voice)) {
      // English: use kokoro-js's built-in pipeline (includes text normalization)
      result = await tts.generate(request.text, { voice, speed });
    } else {
      // Non-English: phonemize with the correct language, then call generate_from_ids
      const phonemes = await phonemize(request.text, voice);
      const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
      result = await tts.generate_from_ids(input_ids, { voice, speed });
    }

    const wavBuffer = Buffer.from(result.toWav());
    const sampleRate = result.sampling_rate;
    const duration = result.audio.length / sampleRate;

    return {
      audio: wavBuffer,
      format: 'wav',
      sampleRate,
      duration,
    };
  }

  public override async *generateStream(request: GenerateRequest): AsyncGenerator<AudioChunk, void, void> {
    if (!this.isLoaded()) {
      throw new Error('Kokoro model not loaded. Call load() first.');
    }

    const tts = this.tts as KokoroTTSInstance;
    const manifest = this.manifest as ModelManifest;
    const voice = request.voice ?? manifest.defaults.voice;
    const speed = request.speed ?? 1.0;

    if (!isEnglishVoice(voice)) {
      yield* super.generateStream(request);
      return;
    }

    consola.start(`Streaming speech with Kokoro: ${request.text.length} chars`);

    for await (const chunk of tts.stream(request.text, { voice, speed })) {
      yield { audio: encodePcmFromFloat32(chunk.audio.audio), sampleRate: chunk.audio.sampling_rate };
    }

    consola.success('Streaming complete');
  }

  protected async doUnload(): Promise<void> {
    this.restoreFs?.();
    this.restoreFs = null;
    this.tts = null;
    this.manifest = null;
  }
}
