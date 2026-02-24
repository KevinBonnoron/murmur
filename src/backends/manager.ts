import { join } from 'node:path';
import consola from 'consola';
import type { ModelManifest } from '../models/manifest.ts';
import { getVariant } from '../models/manifest.ts';
import { pullModel } from '../models/registry.ts';
import { getModelDir } from '../models/storage.ts';
import type { TTSBackend } from './backend.ts';
import { F5TTSBackend } from './f5tts/index.ts';
import { KokoroBackend } from './kokoro/index.ts';
import { PiperBackend } from './piper/index.ts';

const loadedBackends = new Map<string, TTSBackend>();
const inFlightLoads = new Map<string, Promise<void>>();

function createBackend(manifest: ModelManifest): TTSBackend {
  switch (manifest.backend) {
    case 'kokoro':
      return new KokoroBackend();
    case 'f5tts':
      return new F5TTSBackend();
    case 'piper':
      return new PiperBackend();
    default:
      throw new Error(`Unsupported backend: ${manifest.backend}`);
  }
}

function backendKey(name: string, variantKey: string): string {
  return `${name}:${variantKey}`;
}

export async function getBackend(manifest: ModelManifest, variantKey?: string): Promise<TTSBackend> {
  const resolvedKey = variantKey ?? manifest.defaults.variant;
  const variant = getVariant(manifest, resolvedKey);
  const key = backendKey(manifest.name, resolvedKey);

  let backend = loadedBackends.get(key);

  if (!backend) {
    backend = createBackend(manifest);
    loadedBackends.set(key, backend);
  }

  if (!backend.isLoaded()) {
    let loadPromise = inFlightLoads.get(key);
    if (!loadPromise) {
      loadPromise = (async () => {
        const modelDir = getModelDir(manifest.name);

        // Auto-pull the variant ONNX file if missing (skip if no URL — backend manages its own files)
        if (variant.url) {
          const variantPath = join(modelDir, variant.file);
          if (!(await Bun.file(variantPath).exists())) {
            consola.info(`Variant ${resolvedKey} not found locally, pulling...`);
            await pullModel(manifest.name, { variant: resolvedKey });
          }
        }

        await backend.load(modelDir, manifest, variant);
      })();
      inFlightLoads.set(key, loadPromise);
    }
    try {
      await loadPromise;
    } finally {
      inFlightLoads.delete(key);
    }
  }

  return backend;
}

export async function unloadBackend(manifest: ModelManifest, variantKey?: string): Promise<void> {
  const resolvedKey = variantKey ?? manifest.defaults.variant;
  const key = backendKey(manifest.name, resolvedKey);

  // Wait for any in-flight load to complete before unloading
  const pending = inFlightLoads.get(key);
  if (pending) {
    try {
      await pending;
    } catch {
      // Load failed — still clean up
    }
  }

  const backend = loadedBackends.get(key);
  if (backend) {
    await backend.unload();
    loadedBackends.delete(key);
  }
}

export async function unloadAll(): Promise<void> {
  await Promise.allSettled([...loadedBackends.values()].map((b) => b.unload()));
  loadedBackends.clear();
}
