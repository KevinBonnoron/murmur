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
const NVIDIA_SMI_PATHS = ['/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi', '/opt/cuda/bin/nvidia-smi', '/usr/local/nvidia/bin/nvidia-smi'];
const CUBLAS_SEARCH_PATHS = ['/usr/local/cuda-12/lib64', '/usr/local/cuda/lib64', '/usr/lib/x86_64-linux-gnu', '/usr/lib/aarch64-linux-gnu', '/usr/local/nvidia/lib64', '/usr/local/nvidia/lib'];

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

/** Collect extra library directories from LD_LIBRARY_PATH (set by NVIDIA Container Toolkit). */
function getExtraLibDirs(): string[] {
  const ldPath = process.env.LD_LIBRARY_PATH;
  if (!ldPath) {
    return [];
  }
  return ldPath.split(':').filter((d) => {
    return d.length > 0;
  });
}

function detectCuda(): { available: boolean; reason?: string } {
  try {
    // 1. Check for NVIDIA GPU (try known absolute paths first, then fall back to PATH lookup)
    let smiPath = findExecutable(NVIDIA_SMI_PATHS);
    if (!smiPath) {
      // Fallback: try PATH-based lookup (covers Docker NVIDIA runtime mounts)
      const which = Bun.spawnSync(['which', 'nvidia-smi'], { stdout: 'pipe', stderr: 'ignore' });
      if (which.exitCode === 0) {
        smiPath = which.stdout.toString().trim();
      }
    }
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
    const libSearchPaths = [...CUBLAS_SEARCH_PATHS, ...getExtraLibDirs()];
    const requiredLibs = ['libcublasLt.so.12', 'libcudnn.so.9'];
    for (const lib of requiredLibs) {
      let found = ldcacheOutput.includes(lib);
      if (!found) {
        for (const dir of libSearchPaths) {
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

    // 4. Check that ONNX Runtime CUDA provider is installed (bundled or via `murmur setup gpu`)
    const libDir = process.env.MURMUR_LIB_DIR;
    if (libDir) {
      try {
        if (Bun.file(`${libDir}/libonnxruntime_providers_cuda.so`).size === 0) {
          return { available: false, reason: 'ONNX Runtime CUDA provider not installed — run `murmur setup gpu`' };
        }
      } catch {
        return { available: false, reason: 'ONNX Runtime CUDA provider not installed — run `murmur setup gpu`' };
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
    case 'piper':
      return new PiperBackend();
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

        // Auto-pull the variant ONNX file if missing (skip if no URL — backend manages its own files)
        if (variant.url) {
          const variantPath = join(modelDir, variant.file);
          if (!(await Bun.file(variantPath).exists())) {
            consola.info(`Variant ${resolvedKey} not found locally, pulling...`);
            await pullModel(manifest.name, { variant: resolvedKey });
          }
        }

        const allowFallback = (device ?? defaultDevice) === 'auto';
        await backend.load(modelDir, manifest, variant, resolvedDevice, allowFallback);
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
