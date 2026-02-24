import consola from 'consola';
import type { ManifestVariant, ModelManifest } from '../models/manifest.ts';
import type { AudioResult, GenerateRequest, TTSBackend } from './backend.ts';

export abstract class BaseTTSBackend implements TTSBackend {
  protected abstract readonly backendName: string;

  public abstract isLoaded(): boolean;

  protected abstract doLoad(modelPath: string, manifest: ModelManifest, variant: ManifestVariant): Promise<void>;
  protected abstract doGenerate(request: GenerateRequest): Promise<AudioResult>;
  protected abstract doUnload(): Promise<void>;

  public async load(modelPath: string, manifest: ModelManifest, variant: ManifestVariant): Promise<void> {
    if (this.isLoaded()) {
      return;
    }

    consola.start(`Loading ${this.backendName} model from ${modelPath}...`);
    await this.doLoad(modelPath, manifest, variant);
    consola.success(`${this.backendName} model loaded`);
  }

  public async generate(request: GenerateRequest): Promise<AudioResult> {
    if (!this.isLoaded()) {
      throw new Error(`${this.backendName} model not loaded. Call load() first.`);
    }

    consola.start(`Generating speech with ${this.backendName}: ${request.text.length} chars`);
    const result = await this.doGenerate(request);
    consola.success(`Generated ${result.duration.toFixed(2)}s of audio`);

    return result;
  }

  public async unload(): Promise<void> {
    await this.doUnload();
    consola.info(`${this.backendName} model unloaded`);
  }
}
