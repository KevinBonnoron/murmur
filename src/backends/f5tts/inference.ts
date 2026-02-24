import { join } from 'node:path';
import type { InferenceSession, Tensor } from 'onnxruntime-node';
import { TARGET_RMS, TARGET_SAMPLE_RATE } from './audio.ts';

const HOP_LENGTH = 256;

interface F5InferenceOptions {
  readonly refInt16: Int16Array;
  readonly refRms: number;
  readonly tokens: Int32Array;
  readonly speed: number;
  readonly nfeSteps: number;
  readonly refTextLength: number;
  readonly genTextLength: number;
}

interface F5InferenceResult {
  readonly samples: Int16Array;
  readonly sampleRate: number;
  readonly duration: number;
}

function nameAt(names: readonly string[], index: number): string {
  const name = names[index];
  if (name === undefined) {
    throw new Error(`Expected ONNX name at index ${index}, got ${names.length} names`);
  }
  return name;
}

function tensorAt(outputs: InferenceSession.ReturnType, names: readonly string[], index: number): Tensor {
  const name = nameAt(names, index);
  const tensor = outputs[name];
  if (!tensor) {
    throw new Error(`Missing ONNX output tensor: ${name}`);
  }
  return tensor as Tensor;
}

function buildFeeds(names: readonly string[], tensors: readonly Tensor[]): Record<string, Tensor> {
  const feeds: Record<string, Tensor> = {};
  for (let i = 0; i < tensors.length; i++) {
    feeds[nameAt(names, i)] = tensors[i] as Tensor;
  }
  return feeds;
}

export class F5InferenceSession {
  private encoder: InferenceSession | null = null;
  private transformer: InferenceSession | null = null;
  private decoder: InferenceSession | null = null;

  public get isReady(): boolean {
    return this.encoder !== null && this.transformer !== null && this.decoder !== null;
  }

  public async load(modelPath: string, variantFile: string): Promise<void> {
    const ort = await import('onnxruntime-node');

    const sessionOptions: InferenceSession.SessionOptions = {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    };

    const [encoder, transformer, decoder] = await Promise.all([
      ort.InferenceSession.create(join(modelPath, 'onnx', 'encoder_fp32.onnx'), sessionOptions),
      ort.InferenceSession.create(join(modelPath, variantFile), sessionOptions),
      ort.InferenceSession.create(join(modelPath, 'onnx', 'decoder_fp32.onnx'), sessionOptions),
    ]);

    this.encoder = encoder;
    this.transformer = transformer;
    this.decoder = decoder;
  }

  public async run(options: F5InferenceOptions): Promise<F5InferenceResult> {
    if (!this.encoder || !this.transformer || !this.decoder) {
      throw new Error('F5 inference sessions not loaded');
    }

    const { Tensor: OrtTensor } = await import('onnxruntime-node');

    // 1. Calculate duration
    if (options.speed <= 0) {
      throw new Error('F5 inference speed must be > 0');
    }

    const refAudioLen = Math.floor(options.refInt16.length / HOP_LENGTH);
    const duration = refAudioLen + Math.floor(((refAudioLen / (options.refTextLength + 1)) * options.genTextLength) / options.speed);

    // 2. Create input tensors
    const audioTensor = new OrtTensor('int16', options.refInt16, [1, 1, options.refInt16.length]);
    const textTensor = new OrtTensor('int32', options.tokens, [1, options.tokens.length]);
    const durationTensor = new OrtTensor('int64', BigInt64Array.from([BigInt(duration)]), [1]);

    // 3. Encoder pass
    const encOut = await this.encoder.run(buildFeeds(this.encoder.inputNames, [audioTensor, textTensor, durationTensor]));

    const encNames = this.encoder.outputNames;
    let noise = tensorAt(encOut, encNames, 0);
    const ropeCosQ = tensorAt(encOut, encNames, 1);
    const ropeSinQ = tensorAt(encOut, encNames, 2);
    const ropeCosK = tensorAt(encOut, encNames, 3);
    const ropeSinK = tensorAt(encOut, encNames, 4);
    const catMelText = tensorAt(encOut, encNames, 5);
    const catMelTextDrop = tensorAt(encOut, encNames, 6);
    const refSignalLen = tensorAt(encOut, encNames, 7);

    // 4. Transformer loop (nfe_steps - 1 iterations)
    const tInputNames = this.transformer.inputNames;
    const tOutputNames = this.transformer.outputNames;
    let timeStep: Tensor = new OrtTensor('int32', Int32Array.from([0]), [1]);

    for (let step = 0; step < options.nfeSteps - 1; step++) {
      const tOut = await this.transformer.run(buildFeeds(tInputNames, [noise, ropeCosQ, ropeSinQ, ropeCosK, ropeSinK, catMelText, catMelTextDrop, timeStep]));
      noise = tensorAt(tOut, tOutputNames, 0);
      timeStep = tensorAt(tOut, tOutputNames, 1);
    }

    // 5. Decoder pass
    const decOut = await this.decoder.run(buildFeeds(this.decoder.inputNames, [noise, refSignalLen]));
    const generated = tensorAt(decOut, this.decoder.outputNames, 0);

    // 6. Post-process — normalize to [-1, 1] in audioFloat
    const rawData = generated.data as Float32Array | Int16Array | Int32Array;
    let audioFloat: Float32Array;
    if (rawData instanceof Float32Array) {
      audioFloat = new Float32Array(rawData);
    } else if (rawData instanceof Int32Array) {
      audioFloat = new Float32Array(rawData.length);
      for (let i = 0; i < rawData.length; i++) {
        // biome-ignore lint/style/noNonNullAssertion: bounded loop
        audioFloat[i] = Number(rawData[i]!) / 2147483647.0;
      }
    } else {
      audioFloat = new Float32Array(rawData.length);
      for (let i = 0; i < rawData.length; i++) {
        // biome-ignore lint/style/noNonNullAssertion: bounded loop
        audioFloat[i] = Number(rawData[i]!) / 32767.0;
      }
    }

    // Undo RMS normalization — only needed when refRms < TARGET_RMS because
    // prepareReferenceAudio only scales up (never down), so no compensation
    // is required when refRms >= TARGET_RMS.
    if (options.refRms < TARGET_RMS) {
      const scale = options.refRms / TARGET_RMS;
      for (let i = 0; i < audioFloat.length; i++) {
        // biome-ignore lint/style/noNonNullAssertion: bounded loop
        audioFloat[i] = audioFloat[i]! * scale;
      }
    }

    // Convert to Int16
    const audioInt16 = new Int16Array(audioFloat.length);
    for (let i = 0; i < audioFloat.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded loop
      const val = Math.round(audioFloat[i]! * 32767.0);
      audioInt16[i] = Math.max(-32768, Math.min(32767, val));
    }

    const durationSec = audioInt16.length / TARGET_SAMPLE_RATE;

    return {
      samples: audioInt16,
      sampleRate: TARGET_SAMPLE_RATE,
      duration: durationSec,
    };
  }

  public async release(): Promise<void> {
    await Promise.allSettled([this.encoder, this.transformer, this.decoder].filter((s): s is InferenceSession => s !== null).map((s) => s.release()));
    this.encoder = null;
    this.transformer = null;
    this.decoder = null;
  }
}
