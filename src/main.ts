#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty';
import consola from 'consola';

// Polyfill DecompressionStream for Bun (needed by phonemizer/kokoro-js)
if (typeof globalThis.DecompressionStream === 'undefined') {
  const { createInflateRaw, createInflate, createGunzip } = await import('node:zlib');

  globalThis.DecompressionStream = class DecompressionStream {
    public readable: ReadableStream;
    public writable: WritableStream;

    public constructor(format: string) {
      let decompressor: import('node:zlib').Gunzip | import('node:zlib').InflateRaw | import('node:zlib').Inflate;
      switch (format) {
        case 'gzip':
          decompressor = createGunzip();
          break;
        case 'deflate':
          decompressor = createInflate();
          break;
        case 'deflate-raw':
          decompressor = createInflateRaw();
          break;
        default:
          throw new TypeError(`Unsupported compression format: ${format}`);
      }

      this.readable = new ReadableStream({
        start(controller) {
          decompressor.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          decompressor.on('end', () => controller.close());
          decompressor.on('error', (err: Error) => controller.error(err));
        },
      });

      this.writable = new WritableStream({
        write(chunk) {
          decompressor.write(chunk);
        },
        close() {
          decompressor.end();
        },
      });
    }
  } as unknown as typeof DecompressionStream;
}

consola.options.formatOptions = { ...consola.options.formatOptions, date: false };

const main = defineCommand({
  meta: {
    name: 'murmur',
    version: '0.1.0',
    description: 'An Ollama-like TTS server — pull models, run locally, serve via API',
  },
  subCommands: {
    serve: () => import('./cli/serve.ts').then((m) => m.default),
    pull: () => import('./cli/pull.ts').then((m) => m.default),
    list: () => import('./cli/list.ts').then((m) => m.default),
    remove: () => import('./cli/remove.ts').then((m) => m.default),
    run: () => import('./cli/run.ts').then((m) => m.default),
  },
});

runMain(main);
