import consola from 'consola';
import type { ManifestVariant, ModelManifest } from '../models/manifest.ts';
import type { AudioResult, GenerateRequest, TTSBackend } from './backend.ts';

export abstract class BaseTTSBackend implements TTSBackend {
  protected abstract readonly backendName: string;
  private loadedDevice?: string;

  public abstract isLoaded(): boolean;

  protected abstract doLoad(modelPath: string, manifest: ModelManifest, variant: ManifestVariant, device: string): Promise<void>;
  protected abstract doGenerate(request: GenerateRequest): Promise<AudioResult>;
  protected abstract doUnload(): Promise<void>;

  public async load(modelPath: string, manifest: ModelManifest, variant: ManifestVariant, device?: string): Promise<void> {
    const resolvedDevice = device ?? 'cpu';
    if (this.isLoaded()) {
      if (this.loadedDevice && this.loadedDevice !== resolvedDevice) {
        throw new Error(`${this.backendName} already loaded on '${this.loadedDevice}'. Unload before switching to '${resolvedDevice}'.`);
      }
      return;
    }

    consola.start(`Loading ${this.backendName} model from ${modelPath} (device: ${resolvedDevice})...`);
    try {
      await this.doLoad(modelPath, manifest, variant, resolvedDevice);
    } catch (err) {
      if (resolvedDevice !== 'cpu' && err instanceof Error && /ExecutionProvider|providers.*load|shared library/i.test(err.message)) {
        throw new Error(`Failed to load ${this.backendName} with device '${resolvedDevice}': ${err.message}\nMake sure the CUDA toolkit is installed and its libraries are in LD_LIBRARY_PATH.\nHint: use --device auto to fall back automatically.`);
      }
      throw err;
    }
    this.loadedDevice = resolvedDevice;
    consola.success(`${this.backendName} model loaded (device: ${resolvedDevice})`);
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
    if (!this.isLoaded()) {
      return;
    }
    await this.doUnload();
    this.loadedDevice = undefined;
    consola.info(`${this.backendName} model unloaded`);
  }
}
