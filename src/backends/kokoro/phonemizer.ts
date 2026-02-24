import { dirname, join } from 'node:path';

/** Voice name prefix → eSpeak language code */
const VOICE_LANG_MAP: Record<string, string> = {
  a: 'en-us',
  b: 'en-gb',
  e: 'es',
  f: 'fr',
  h: 'hi',
  i: 'it',
  j: 'ja',
  p: 'pt',
  z: 'cmn',
};

/** Punctuation regex for splitting text (matches kokoro-js) */
const PUNCTUATION_RE = new RegExp(`(\\s*[${';:,.!?¡¿—…"«»""(){}[]'.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]+\\s*)+`, 'g');

/** Get the eSpeak language code for a given voice name. */
export function getVoiceLanguage(voice: string): string {
  return VOICE_LANG_MAP[voice.charAt(0)] ?? 'en-us';
}

/** Whether a voice prefix maps to English. */
export function isEnglishVoice(voice: string): boolean {
  const c = voice.charAt(0);
  return c === 'a' || c === 'b';
}

/**
 * Phonemize text to IPA using eSpeak-NG WASM.
 *
 * Splits input by punctuation so punctuation characters are preserved
 * verbatim in the output (the Kokoro model expects them inline with phonemes).
 */
export async function phonemize(text: string, voice: string): Promise<string> {
  const lang = getVoiceLanguage(voice);

  // Basic text cleanup (universal, not English-specific)
  text = text
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/、/g, ', ')
    .replace(/。/g, '. ')
    .replace(/！/g, '! ')
    .replace(/，/g, ', ')
    .replace(/：/g, ': ')
    .replace(/；/g, '; ')
    .replace(/？/g, '? ')
    .replace(/[^\S \n]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();

  // Split by punctuation — phonemize text segments, keep punctuation as-is
  const segments = splitByPunctuation(text);
  const parts = await Promise.all(segments.map(async ({ isPunct, text: seg }) => (isPunct ? seg : await espeakIPA(seg, lang))));

  return parts.join('');
}

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

/** Run eSpeak-NG WASM to convert text → IPA. */
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

  // eSpeak uses newlines as pause markers — join into a single line
  return espeak.FS.readFile('output.txt', { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}

/** Split text into alternating segments of text and punctuation. */
function splitByPunctuation(text: string): Array<{ isPunct: boolean; text: string }> {
  const result: Array<{ isPunct: boolean; text: string }> = [];
  let cursor = 0;

  for (const match of text.matchAll(PUNCTUATION_RE)) {
    const matchIndex = match.index ?? 0;
    if (cursor < matchIndex) {
      result.push({ isPunct: false, text: text.slice(cursor, matchIndex) });
    }
    if (match[0].length > 0) {
      result.push({ isPunct: true, text: match[0] });
    }
    cursor = matchIndex + match[0].length;
  }

  if (cursor < text.length) {
    result.push({ isPunct: false, text: text.slice(cursor) });
  }

  return result;
}
