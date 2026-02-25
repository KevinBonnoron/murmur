import { join } from 'node:path';
import { mkdir, unlink } from 'node:fs/promises';
import { defineCommand } from 'citty';
import consola from 'consola';

const ONNXRUNTIME_VERSION = '1.24.2';

/** NuGet package URLs for GPU providers, keyed by `${os}-${arch}`. */
const GPU_PACKAGES: Record<string, { nugetPkg: string; runtimeDir: string }> = {
  'linux-x64': {
    nugetPkg: `microsoft.ml.onnxruntime.gpu.linux`,
    runtimeDir: 'runtimes/linux-x64/native',
  },
  'linux-arm64': {
    nugetPkg: `microsoft.ml.onnxruntime.gpu.linux`,
    runtimeDir: 'runtimes/linux-aarch64/native',
  },
};

const PROVIDER_FILES = ['libonnxruntime_providers_cuda.so', 'libonnxruntime_providers_tensorrt.so'];

function resolveLibDir(): string {
  // Set by the wrapper script when running as compiled binary
  const envDir = process.env['MURMUR_LIB_DIR'];
  if (envDir) {
    return envDir;
  }
  // Fallback for development: use onnxruntime-node's bin directory
  const os = process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return join(import.meta.dir, '..', '..', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', os, arch);
}

function getPlatformKey(): string {
  const os = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${os}-${arch}`;
}

export default defineCommand({
  meta: { name: 'setup', description: 'Setup optional components' },
  subCommands: {
    gpu: defineCommand({
      meta: { name: 'gpu', description: 'Download CUDA providers for GPU acceleration' },
      async run() {
        const platform = getPlatformKey();
        const gpuPkg = GPU_PACKAGES[platform];
        if (!gpuPkg) {
          consola.error(`GPU setup is not supported on ${platform}. Only Linux x64/arm64 is supported.`);
          process.exit(1);
        }

        const libDir = resolveLibDir();
        await mkdir(libDir, { recursive: true });

        // Check if already installed
        const existingCuda = Bun.file(join(libDir, 'libonnxruntime_providers_cuda.so'));
        if (await existingCuda.exists() && existingCuda.size > 1_000_000) {
          consola.success('CUDA providers already installed.');
          return;
        }

        const url = `https://api.nuget.org/v3-flatcontainer/${gpuPkg.nugetPkg}/${ONNXRUNTIME_VERSION}/${gpuPkg.nugetPkg}.${ONNXRUNTIME_VERSION}.nupkg`;

        consola.start(`Downloading ONNX Runtime CUDA providers (v${ONNXRUNTIME_VERSION})...`);
        consola.info(`This is a ~200 MB download.`);

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
        }

        // .nupkg is a ZIP file — write to temp then extract with unzip
        const tmpPath = join(libDir, '.cuda-providers.nupkg');
        const data = await response.arrayBuffer();
        await Bun.write(tmpPath, data);

        consola.start('Extracting CUDA providers...');

        for (const file of PROVIDER_FILES) {
          const zipEntry = `${gpuPkg.runtimeDir}/${file}`;
          const result = Bun.spawnSync(['unzip', '-o', '-j', tmpPath, zipEntry, '-d', libDir], {
            stdout: 'ignore',
            stderr: 'pipe',
          });
          if (result.exitCode !== 0) {
            const stderr = result.stderr.toString();
            // unzip returns 11 when a file is not found in archive (e.g. tensorrt on some builds)
            if (result.exitCode === 11 || stderr.includes('caution: filename not matched')) {
              consola.warn(`${file} not found in package (optional, skipping)`);
            } else {
              await unlink(tmpPath).catch(() => {});
              throw new Error(`Failed to extract ${file}: ${stderr}`);
            }
          } else {
            consola.success(`Extracted ${file}`);
          }
        }

        await unlink(tmpPath).catch(() => {});
        consola.success('GPU setup complete. CUDA acceleration is now available.');
      },
    }),
  },
});
