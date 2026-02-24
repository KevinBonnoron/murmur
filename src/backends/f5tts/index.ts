import { join } from 'node:path';
import type { ManifestVariant, ModelManifest } from '../../models/manifest.ts';
import type { AudioResult, GenerateRequest } from '../backend.ts';
import { BaseTTSBackend } from '../base.ts';
import { encodeWav, prepareReferenceAudio } from './audio.ts';
import { F5InferenceSession } from './inference.ts';
import { F5Tokenizer } from './tokenizer.ts';

const DEFAULT_NFE_STEPS = 32;

export class F5TTSBackend extends BaseTTSBackend {
  protected readonly backendName = 'F5-TTS';

  private session: F5InferenceSession | null = null;
  private tokenizer: F5Tokenizer | null = null;

  public isLoaded(): boolean {
    return this.session?.isReady === true;
  }

  protected async doLoad(modelPath: string, _manifest: ModelManifest, variant: ManifestVariant, device: string): Promise<void> {
    // Load vocab for tokenizer
    const vocabPath = join(modelPath, 'vocab.txt');
    const vocabFile = Bun.file(vocabPath);
    if (!(await vocabFile.exists())) {
      throw new Error(`F5-TTS vocab not found: ${vocabPath}`);
    }
    this.tokenizer = new F5Tokenizer(await vocabFile.text());

    // Load ONNX sessions
    this.session = new F5InferenceSession();
    await this.session.load(modelPath, variant.file, device);
  }

  protected async doGenerate({ text, referenceAudio, referenceText, speed = 1.0, nfeSteps = DEFAULT_NFE_STEPS }: GenerateRequest): Promise<AudioResult> {
    const session = this.session as F5InferenceSession;
    const tokenizer = this.tokenizer as F5Tokenizer;

    if (!referenceAudio) {
      throw new Error('F5-TTS requires reference audio (referenceAudio)');
    }
    if (!referenceText) {
      throw new Error('F5-TTS requires reference text (referenceText)');
    }
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new Error('F5-TTS speed must be a positive number');
    }
    if (!Number.isInteger(nfeSteps) || nfeSteps < 1) {
      throw new Error('F5-TTS nfeSteps must be a positive integer');
    }

    // Prepare reference audio (decode, mono, resample, normalize)
    const { int16: refInt16, rms: refRms } = prepareReferenceAudio(referenceAudio);

    // Tokenize combined text (ref_text + space + gen_text)
    const tokens = tokenizer.tokenize(`${referenceText} ${text}`);

    // Run inference
    const result = await session.run({
      refInt16,
      refRms,
      tokens,
      speed,
      nfeSteps,
      refTextLength: referenceText.length,
      genTextLength: text.length,
    });

    // Encode to WAV
    const audio = encodeWav(result.samples, result.sampleRate);

    return {
      audio,
      format: 'wav',
      sampleRate: result.sampleRate,
      duration: result.duration,
    };
  }

  protected async doUnload(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
    this.tokenizer = null;
  }
}
