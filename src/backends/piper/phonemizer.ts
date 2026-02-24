import { dirname, join } from 'node:path';
import type { PiperModelConfig } from './config.ts';

/** Resolve the directory containing the espeak-ng WASM file. */
function espeakWasmDir(): string {
  const libDir = process.env.MURMUR_LIB_DIR;
  if (libDir) {
    return libDir;
  }
  try {
    return dirname(require.resolve('espeak-ng/dist/espeak-ng.wasm'));
  } catch {
    return dirname(new URL(import.meta.url).pathname);
  }
}

/** Run eSpeak-NG WASM to convert text to IPA phonemes. */
async function espeakIPA(text: string, lang: string): Promise<string> {
  const { default: createEspeak } = await import('espeak-ng');
  const wasmDir = espeakWasmDir();

  const espeak = await new Promise<import('espeak-ng').ESpeakModule>((resolve) => {
    createEspeak({
      arguments: ['--ipa=3', '-v', lang, '-q', '--phonout', 'output.txt', text],
      locateFile: (path: string) => join(wasmDir, path),
      onRuntimeInitialized() {
        resolve(this);
      },
    });
  });

  return espeak.FS.readFile('output.txt', { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Convert text to Piper phoneme IDs.
 *
 * Pipeline:
 * 1. Use eSpeak-NG to convert text to IPA
 * 2. Map each IPA character to integer IDs using the phoneme_id_map
 * 3. Add padding between phonemes and BOS/EOS tokens
 */
export async function textToPhonemeIds(text: string, config: PiperModelConfig): Promise<BigInt64Array> {
  const ipa = await espeakIPA(text, config.espeak.voice);

  const phonemeIdMap = config.phoneme_id_map;
  const padId = BigInt(phonemeIdMap._?.[0] ?? 0);
  const bosId = BigInt(phonemeIdMap['^']?.[0] ?? padId);
  const eosId = BigInt(phonemeIdMap.$?.[0] ?? padId);

  // Sort map keys by descending length for greedy longest-key matching.
  // This avoids splitting multi-character IPA symbols (e.g. affricates).
  const sortedKeys = Object.keys(phonemeIdMap).sort((a, b) => b.length - a.length);

  const ids: bigint[] = [bosId];

  let cursor = 0;
  while (cursor < ipa.length) {
    let matched = false;
    for (const key of sortedKeys) {
      if (ipa.startsWith(key, cursor) && key.length > 0) {
        const mapped = phonemeIdMap[key];
        if (mapped && mapped.length > 0) {
          for (const id of mapped) {
            ids.push(BigInt(id));
          }
          ids.push(padId);
        }
        cursor += key.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Skip unrecognized character
      cursor++;
    }
  }

  ids.push(eosId);
  return BigInt64Array.from(ids);
}

/** Split text into sentences on sentence-ending punctuation. */
export function splitSentences(text: string): string[] {
  const re = /[.!?;:]+\s*/g;
  const sentences: string[] = [];
  let cursor = 0;

  for (const match of text.matchAll(re)) {
    const matchIndex = match.index ?? 0;
    if (cursor < matchIndex) {
      const sentence = text.slice(cursor, matchIndex).trim();
      if (sentence) {
        sentences.push(sentence);
      }
    }
    cursor = matchIndex + match[0].length;
  }

  const tail = text.slice(cursor).trim();
  if (tail) {
    sentences.push(tail);
  }

  return sentences.length > 0 ? sentences : [text.trim()];
}
