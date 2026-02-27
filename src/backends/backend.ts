import type { ManifestVariant, ModelManifest } from '../models/manifest.ts';

export interface GenerateRequest {
  text: string;
  voice?: string;
  speed?: number;
  format: 'wav';
  sampleRate?: number;
  referenceAudio?: Buffer;
  referenceText?: string;
  nfeSteps?: number;
  apiKey?: string;
}

export interface AudioResult {
  audio: Buffer;
  format: string;
  sampleRate: number;
  duration: number;
}

export interface AudioChunk {
  audio: Buffer;
  sampleRate: number;
}

export class BackendError extends Error {
  public readonly statusCode: number;

  public constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'BackendError';
    this.statusCode = statusCode;
  }
}

export interface TTSBackend {
  load(modelPath: string, manifest: ModelManifest, variant: ManifestVariant, device?: string, allowFallback?: boolean): Promise<void>;
  generate(request: GenerateRequest): Promise<AudioResult>;
  generateStream(request: GenerateRequest): AsyncGenerator<AudioChunk, void, void>;
  unload(): Promise<void>;
  isLoaded(): boolean;
}
