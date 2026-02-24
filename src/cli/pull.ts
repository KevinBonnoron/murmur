import { defineCommand } from 'citty';
import consola from 'consola';
import { parseModelRef } from '../models/manifest.ts';
import { pullModel } from '../models/registry.ts';

export default defineCommand({
  meta: { name: 'pull', description: 'Pull a TTS model' },
  args: {
    name: {
      type: 'positional',
      description: 'Model name (e.g. kokoro, kokoro:fp16, ./manifest.json)',
      required: true,
    },
    voice: {
      type: 'string',
      alias: 'V',
      description: 'Additional voice to pull (e.g. jf_alpha)',
    },
  },
  async run({ args }) {
    const ref = parseModelRef(args.name);
    consola.start(`Pulling model ${args.name}...`);

    await pullModel(args.name, { variant: ref.variant, voice: args.voice }, (progress) => {
      if (progress.done) {
        consola.success(`  ${progress.file}`);
      } else if (progress.total > 0) {
        const pct = Math.round((progress.downloaded / progress.total) * 100);
        const mb = (progress.downloaded / 1024 / 1024).toFixed(1);
        const totalMb = (progress.total / 1024 / 1024).toFixed(1);
        process.stdout.write(`\r  ${progress.file}: ${mb}MB / ${totalMb}MB (${pct}%)`);
      }
    });
  },
});
