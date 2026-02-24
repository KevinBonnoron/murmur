import { mkdir, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type ModelManifest, parseManifest } from './manifest.ts';

function getMurmurHome(): string {
  return process.env.MURMUR_HOME ?? join(homedir(), '.murmur');
}

export function getModelsDir(): string {
  return join(getMurmurHome(), 'models');
}

export function getModelDir(name: string): string {
  return join(getModelsDir(), name);
}

export function getManifestPath(name: string): string {
  return join(getModelDir(name), 'manifest.json');
}

export function getVoicePath(name: string, voiceId: string): string {
  return join(getModelDir(name), 'voices', `${voiceId}.bin`);
}

export async function isVoiceInstalled(name: string, voiceId: string): Promise<boolean> {
  return Bun.file(getVoicePath(name, voiceId)).exists();
}

export async function saveManifest(manifest: ModelManifest): Promise<void> {
  const dir = getModelDir(manifest.name);
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'manifest.json');
  await Bun.write(path, JSON.stringify(manifest, null, 2));
}

export async function loadManifest(name: string): Promise<ModelManifest> {
  const path = getManifestPath(name);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Model ${name} not found`);
  }
  const json = await file.json();
  return parseManifest(json);
}

export async function listInstalledModels(): Promise<ModelManifest[]> {
  const modelsDir = getModelsDir();
  const manifests: ModelManifest[] = [];

  try {
    const names = await readdir(modelsDir);
    for (const name of names) {
      try {
        const manifest = await loadManifest(name);
        manifests.push(manifest);
      } catch {
        // skip invalid or non-model directories
      }
    }
  } catch {
    // models dir doesn't exist yet
  }

  return manifests;
}

export async function removeModel(name: string): Promise<void> {
  const dir = getModelDir(name);
  await rm(dir, { recursive: true, force: true });
}

export async function isModelInstalled(name: string): Promise<boolean> {
  return Bun.file(getManifestPath(name)).exists();
}
