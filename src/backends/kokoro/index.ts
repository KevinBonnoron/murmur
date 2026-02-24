import fs from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ManifestVariant, ModelManifest } from '../../models/manifest.ts';
import type { AudioResult, GenerateRequest } from '../backend.ts';
import { BaseTTSBackend } from '../base.ts';
import { isEnglishVoice, phonemize } from './phonemizer.ts';

// kokoro-js types (dynamic import to avoid top-level dependency issues)
type KokoroRawAudio = { audio: Float32Array; sampling_rate: number; toWav(): ArrayBuffer };
type KokoroGenerateOptions = { voice?: string; speed?: number };
type KokoroTokenizer = (text: string, options: { truncation: boolean }) => { input_ids: unknown };
type KokoroTTSInstance = {
  generate(text: string, options?: KokoroGenerateOptions): Promise<KokoroRawAudio>;
  generate_from_ids(inputIds: unknown, options?: KokoroGenerateOptions): Promise<KokoroRawAudio>;
  tokenizer: KokoroTokenizer;
  list_voices(): void;
  _validate_voice(voice: string): string;
};

/**
 * Patch fs.readFile so that kokoro-js voice reads (*.bin under a voices/ dir)
 * are redirected to the murmur model storage path. This is needed because
 * kokoro-js resolves voices relative to its own __dirname, which is wrong
 * inside a compiled Bun binary.
 */
function patchVoiceReadFile(modelPath: string): () => void {
  const original = fs.readFile;
  const voicesDir = join(modelPath, 'voices');

  // biome-ignore lint/suspicious/noExplicitAny: patching a polymorphic Node API
  (fs as any).readFile = async function patchedReadFile(path: any, ...args: any[]) {
    if (typeof path === 'string' && path.endsWith('.bin') && path.includes('/voices/')) {
      const filename = basename(path);
      const redirected = join(voicesDir, filename);
      return original.call(fs, redirected, ...args);
    }
    return original.call(fs, path, ...args);
  };

  return () => {
    // biome-ignore lint/suspicious/noExplicitAny: restoring original
    (fs as any).readFile = original;
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

  protected async doLoad(modelPath: string, manifest: ModelManifest, variant: ManifestVariant): Promise<void> {
    this.restoreFs = patchVoiceReadFile(modelPath);

    try {
      const { KokoroTTS } = await import('kokoro-js');
      const instance = await KokoroTTS.from_pretrained(modelPath, {
        dtype: variant.dtype as 'q8' | 'fp32' | 'fp16' | 'q4' | 'q4f16',
        device: 'cpu',
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

  protected async doUnload(): Promise<void> {
    this.restoreFs?.();
    this.restoreFs = null;
    this.tts = null;
    this.manifest = null;
  }
}
