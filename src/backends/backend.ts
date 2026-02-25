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
}

export interface AudioResult {
  audio: Buffer;
  format: string;
  sampleRate: number;
  duration: number;
}

export interface TTSBackend {
  load(modelPath: string, manifest: ModelManifest, variant: ManifestVariant, device?: string, allowFallback?: boolean): Promise<void>;
  generate(request: GenerateRequest): Promise<AudioResult>;
  unload(): Promise<void>;
  isLoaded(): boolean;
}
