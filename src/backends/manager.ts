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
const inFlightLoads = new Map<string, Promise<void>>();

let defaultDevice = 'auto';
let resolvedAutoDevice: string | null = null;

export function setDefaultDevice(device: string): void {
  defaultDevice = device;
  resolvedAutoDevice = null;
}

/**
 * Probe CUDA availability without loading a model (avoids ONNX RT state corruption).
 * Checks: 1) NVIDIA GPU present (nvidia-smi) 2) CUDA 12 runtime libs available (ldconfig).
 * A CUDA 13 driver can run CUDA 12 code — only the toolkit libs matter.
 */
const NVIDIA_SMI_PATHS = ['/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi', '/opt/cuda/bin/nvidia-smi'];
const CUBLAS_SEARCH_PATHS = ['/usr/local/cuda-12/lib64', '/usr/local/cuda/lib64', '/usr/lib/x86_64-linux-gnu', '/usr/lib/aarch64-linux-gnu'];

function findExecutable(candidates: readonly string[]): string | null {
  for (const p of candidates) {
    try {
      if (Bun.file(p).size > 0) {
        return p;
      }
    } catch {
      // not found
    }
  }
  return null;
}

function detectCuda(): { available: boolean; reason?: string } {
  try {
    // 1. Check for NVIDIA GPU (use absolute paths — compiled binary may have a minimal PATH)
    const smiPath = findExecutable(NVIDIA_SMI_PATHS);
    if (!smiPath) {
      return { available: false, reason: 'no NVIDIA GPU detected (nvidia-smi not found)' };
    }
    const smi = Bun.spawnSync([smiPath], { stdout: 'pipe', stderr: 'ignore' });
    if (smi.exitCode !== 0) {
      return { available: false, reason: 'no NVIDIA GPU detected' };
    }
    const smiOut = smi.stdout.toString();
    if (/No devices were found|Failed to initialize NVML|NVIDIA-SMI has failed/i.test(smiOut)) {
      return { available: false, reason: 'no NVIDIA GPU detected (nvidia-smi reported no devices)' };
    }

    // 2. Build ldconfig cache for library lookups
    let ldcacheOutput = '';
    const ldconfigPath = findExecutable(['/sbin/ldconfig', '/usr/sbin/ldconfig']);
    if (ldconfigPath) {
      const ldconfig = Bun.spawnSync([ldconfigPath, '-p'], { stdout: 'pipe', stderr: 'ignore' });
      ldcacheOutput = ldconfig.exitCode === 0 ? ldconfig.stdout.toString() : '';
    }

    // 3. Check required CUDA 12 libs (cuBLAS + cuDNN)
    const requiredLibs = ['libcublasLt.so.12', 'libcudnn.so.9'];
    for (const lib of requiredLibs) {
      let found = ldcacheOutput.includes(lib);
      if (!found) {
        for (const dir of CUBLAS_SEARCH_PATHS) {
          try {
            if (Bun.file(`${dir}/${lib}`).size > 0) {
              found = true;
              break;
            }
          } catch {
            // path doesn't exist
          }
        }
      }
      if (!found) {
        return { available: false, reason: `NVIDIA GPU found but ${lib} not installed — install cuda-libraries-12-x and libcudnn9-cuda-12` };
      }
    }

    return { available: true };
  } catch {
    return { available: false, reason: 'no NVIDIA GPU detected' };
  }
}

function resolveDevice(device: string): string {
  if (device !== 'auto') {
    return device;
  }
  if (resolvedAutoDevice === null) {
    const cuda = detectCuda();
    resolvedAutoDevice = cuda.available ? 'cuda' : 'cpu';
    if (cuda.available) {
      consola.info(`Auto-detected device: cuda`);
    } else {
      consola.info(`Auto-detected device: cpu (${cuda.reason})`);
    }
  }
  return resolvedAutoDevice;
}

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

function backendKey(name: string, variantKey: string, device: string): string {
  return `${name}:${variantKey}:${device}`;
}

export async function getBackend(manifest: ModelManifest, variantKey?: string, device?: string): Promise<TTSBackend> {
  const resolvedKey = variantKey ?? manifest.defaults.variant;
  const resolvedDevice = resolveDevice(device ?? defaultDevice);
  const variant = getVariant(manifest, resolvedKey);
  const key = backendKey(manifest.name, resolvedKey, resolvedDevice);

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

        // Auto-pull the variant ONNX file if missing
        const variantPath = join(modelDir, variant.file);
        if (!(await Bun.file(variantPath).exists())) {
          consola.info(`Variant ${resolvedKey} not found locally, pulling...`);
          await pullModel(manifest.name, { variant: resolvedKey });
        }

        await backend.load(modelDir, manifest, variant, resolvedDevice);
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

export async function unloadBackend(manifest: ModelManifest, variantKey?: string, device?: string): Promise<void> {
  const resolvedKey = variantKey ?? manifest.defaults.variant;
  const resolvedDevice = resolveDevice(device ?? defaultDevice);
  const key = backendKey(manifest.name, resolvedKey, resolvedDevice);

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
