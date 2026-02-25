import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const esmRequire = createRequire(import.meta.url);

/** Resolve the directory containing the espeak-ng WASM file. */
export function espeakWasmDir(): string {
  const libDir = process.env.MURMUR_LIB_DIR;
  if (libDir) {
    return libDir;
  }
  try {
    return dirname(esmRequire.resolve('espeak-ng/dist/espeak-ng.wasm'));
  } catch {
    return dirname(fileURLToPath(import.meta.url));
  }
}

/** Run eSpeak-NG WASM to convert text to IPA phonemes. */
export async function espeakIPA(text: string, lang: string): Promise<string> {
  const { default: createEspeak } = await import('espeak-ng');
  const wasmDir = espeakWasmDir();

  const espeak = await new Promise<import('espeak-ng').ESpeakModule>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('espeak-ng WASM initialization timed out'));
    }, 10_000);
    createEspeak({
      arguments: ['--ipa=3', '-v', lang, '-q', '--phonout', 'output.txt', text],
      locateFile: (path: string) => join(wasmDir, path),
      onRuntimeInitialized() {
        clearTimeout(timeout);
        resolve(this);
      },
      onAbort(reason: unknown) {
        clearTimeout(timeout);
        reject(new Error(`espeak-ng WASM aborted: ${reason}`));
      },
    });
  });

  // eSpeak uses newlines as pause markers — join into a single line
  return espeak.FS.readFile('output.txt', { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}
