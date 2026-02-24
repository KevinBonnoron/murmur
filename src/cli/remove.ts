import { defineCommand } from 'citty';
import consola from 'consola';
import { findModel } from '../models/registry.ts';
import { removeModel } from '../models/storage.ts';

export default defineCommand({
  meta: { name: 'remove', description: 'Remove an installed TTS model' },
  args: {
    name: {
      type: 'positional',
      description: 'Model name (e.g. kokoro, kokoro:v1.0)',
      required: true,
    },
  },
  async run({ args }) {
    const manifest = await findModel(args.name);
    await removeModel(manifest.name);
    consola.success(`Removed ${manifest.name}`);
  },
});
