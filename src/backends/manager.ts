import { join } from 'node:path';
import consola from 'consola';
import type { ModelManifest } from '../models/manifest.ts';
import { getVariant } from '../models/manifest.ts';
import { pullModel } from '../models/registry.ts';
import { getModelDir } from '../models/storage.ts';
import type { TTSBackend } from './backend.ts';
import { F5TTSBackend } from './f5tts/index.ts';
import { KokoroBackend } from './kokoro/index.ts';

const loadedBackends = new Map<string, TTSBackend>();

function createBackend(manifest: ModelManifest): TTSBackend {
  switch (manifest.backend) {
    case 'kokoro':
      return new KokoroBackend();
    case 'f5tts':
      return new F5TTSBackend();
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
    const modelDir = getModelDir(manifest.name);

    // Auto-pull the variant ONNX file if missing
    const variantPath = join(modelDir, variant.file);
    if (!(await Bun.file(variantPath).exists())) {
      consola.info(`Variant ${resolvedKey} not found locally, pulling...`);
      await pullModel(manifest.name, { variant: resolvedKey });
    }

    await backend.load(modelDir, manifest, variant);
  }

  return backend;
}

export async function unloadBackend(manifest: ModelManifest, variantKey?: string): Promise<void> {
  const resolvedKey = variantKey ?? manifest.defaults.variant;
  const key = backendKey(manifest.name, resolvedKey);
  const backend = loadedBackends.get(key);
  if (backend) {
    await backend.unload();
    loadedBackends.delete(key);
  }
}

export async function unloadAll(): Promise<void> {
  for (const backend of loadedBackends.values()) {
    await backend.unload();
  }

  loadedBackends.clear();
}
