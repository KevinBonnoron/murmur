import { mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import consola from 'consola';
import f5ttsManifest from '../../manifests/f5tts.json';
import kokoroManifest from '../../manifests/kokoro.json';
import piperManifest from '../../manifests/piper.json';
import { getVariant, type ModelManifest, parseManifest, parseModelRef, resolveVoiceUrl } from './manifest.ts';
import { getModelDir, getVoicePath, isModelInstalled, isVoiceInstalled, listInstalledModels, loadManifest, saveManifest } from './storage.ts';

const BUILTIN_MODELS: Record<string, object> = {
  kokoro: kokoroManifest,
  f5tts: f5ttsManifest,
  piper: piperManifest,
};

export interface PullProgress {
  file: string;
  downloaded: number;
  total: number;
  done: boolean;
}

export interface PullOptions {
  variant?: string;
  voice?: string;
}

export async function downloadFile(url: string, destPath: string, expectedSize: number | undefined, label: string, onProgress?: (progress: PullProgress) => void): Promise<void> {
  const existing = Bun.file(destPath);
  if (await existing.exists()) {
    const stat = existing.size;
    if (expectedSize && stat === expectedSize) {
      onProgress?.({ file: label, downloaded: expectedSize, total: expectedSize, done: true });
      return;
    }
  }

  const fileDir = dirname(destPath);
  await mkdir(fileDir, { recursive: true });

  consola.start(`Downloading ${label}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const total = expectedSize ?? Number(response.headers.get('content-length') ?? 0);
  let downloaded = 0;

  if (!response.body) {
    throw new Error(`No response body for ${url}`);
  }

  const tmpPath = `${destPath}.tmp`;
  const writer = Bun.file(tmpPath).writer();
  const reader = response.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      writer.write(value);
      downloaded += value.byteLength;
      onProgress?.({ file: label, downloaded, total, done: false });
    }
    await writer.end();
  } catch (err) {
    await writer.end();
    await unlink(tmpPath).catch(() => {});
    throw err;
  }

  await rename(tmpPath, destPath);
  onProgress?.({ file: label, downloaded, total, done: true });
  consola.success(`Downloaded ${label}`);
}

export async function resolveManifest(nameOrPath: string): Promise<ModelManifest> {
  // local file path
  if (nameOrPath.startsWith('./') || nameOrPath.startsWith('/') || nameOrPath.endsWith('.json')) {
    const file = Bun.file(resolve(nameOrPath));
    if (!(await file.exists())) {
      throw new Error(`Manifest file not found: ${nameOrPath}`);
    }
    return parseManifest(await file.json());
  }

  const ref = parseModelRef(nameOrPath);

  // built-in model
  const builtinData = BUILTIN_MODELS[ref.name];
  if (!builtinData) {
    throw new Error(`Unknown model: ${ref.name}. Available: ${Object.keys(BUILTIN_MODELS).join(', ')}`);
  }

  return parseManifest(builtinData);
}

export async function pullModel(nameOrPath: string, options?: PullOptions, onProgress?: (progress: PullProgress) => void): Promise<ModelManifest> {
  const builtinManifest = await resolveManifest(nameOrPath);
  const ref = parseModelRef(nameOrPath);

  const variantKey = options?.variant ?? ref.variant ?? builtinManifest.defaults.variant;
  const variant = getVariant(builtinManifest, variantKey);

  const modelDir = getModelDir(builtinManifest.name);
  const alreadyInstalled = await isModelInstalled(builtinManifest.name);

  let manifest: ModelManifest = alreadyInstalled ? await loadManifest(builtinManifest.name) : builtinManifest;

  if (!alreadyInstalled) {
    await mkdir(modelDir, { recursive: true });

    // Download base files (config, tokenizer, etc.)
    for (const file of builtinManifest.files) {
      const destPath = join(modelDir, file.name);
      await downloadFile(file.url, destPath, file.size, file.name, onProgress);
    }

    // Download the requested variant's ONNX file (skip if no URL — backend manages its own files)
    if (variant.url) {
      const variantDest = join(modelDir, variant.file);
      await downloadFile(variant.url, variantDest, variant.size, variant.file, onProgress);
    }

    // Download the default voice (if the model uses pre-built voices)
    const defaultVoice = builtinManifest.defaults.voice;
    let installedVoices: string[] = [];
    if (defaultVoice && builtinManifest.voice_url) {
      const voiceUrl = resolveVoiceUrl(builtinManifest, defaultVoice);
      const voiceDest = getVoicePath(builtinManifest.name, defaultVoice);
      await downloadFile(voiceUrl, voiceDest, undefined, `voices/${defaultVoice}.bin`, onProgress);
      installedVoices = [defaultVoice];
    }

    manifest = { ...builtinManifest, installed_voices: installedVoices };
    consola.success(`Model ${builtinManifest.name} pulled successfully`);
  } else {
    // Model already installed — check if this variant's ONNX is present
    if (variant.url) {
      const variantDest = join(modelDir, variant.file);
      const variantExists = await Bun.file(variantDest).exists();
      if (!variantExists) {
        await downloadFile(variant.url, variantDest, variant.size, variant.file, onProgress);
        consola.success(`Variant ${variantKey} pulled for ${builtinManifest.name}`);
      } else {
        consola.info(`Model ${builtinManifest.name} (${variantKey}) is already installed`);
      }
    } else {
      consola.info(`Model ${builtinManifest.name} (${variantKey}) is already installed`);
    }
  }

  // Pull a specific voice if requested
  if (options?.voice) {
    const voiceId = options.voice;
    if (await isVoiceInstalled(builtinManifest.name, voiceId)) {
      consola.info(`Voice ${voiceId} is already installed`);
    } else {
      const voiceUrl = resolveVoiceUrl(builtinManifest, voiceId);
      const voiceDest = getVoicePath(builtinManifest.name, voiceId);
      await downloadFile(voiceUrl, voiceDest, undefined, `voices/${voiceId}.bin`, onProgress);
      consola.success(`Voice ${voiceId} pulled`);
    }

    if (!manifest.installed_voices.includes(voiceId)) {
      manifest = { ...manifest, installed_voices: [...manifest.installed_voices, voiceId] };
    }
  }

  await saveManifest(manifest);
  return manifest;
}

export async function ensureVoice(manifest: ModelManifest, voiceId: string): Promise<void> {
  if (!manifest.voice_url || (await isVoiceInstalled(manifest.name, voiceId))) {
    return;
  }

  consola.info(`Voice ${voiceId} not installed, pulling automatically...`);
  const voiceUrl = resolveVoiceUrl(manifest, voiceId);
  const voiceDest = getVoicePath(manifest.name, voiceId);
  await downloadFile(voiceUrl, voiceDest, undefined, `voices/${voiceId}.bin`);

  const existing = manifest.installed_voices ?? [];
  const updated = { ...manifest, installed_voices: [...existing, voiceId] };
  await saveManifest(updated);
}

export async function findModel(nameOrPath: string): Promise<ModelManifest> {
  const ref = parseModelRef(nameOrPath);
  const models = await listInstalledModels();

  const match = models.find((m) => m.name === ref.name);

  if (!match) {
    // Auto-pull if this is a known built-in model
    if (BUILTIN_MODELS[ref.name]) {
      consola.info(`Model ${ref.name} not installed, pulling automatically...`);
      return pullModel(ref.name, { variant: ref.variant });
    }
    throw new Error(`Model ${ref.name} is not installed. Run: murmur pull ${ref.name}`);
  }

  return match;
}
