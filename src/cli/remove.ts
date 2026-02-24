import { defineCommand } from 'citty';
import consola from 'consola';
import { parseModelRef } from '../models/manifest.ts';
import { listInstalledModels, removeModel } from '../models/storage.ts';

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
    const ref = parseModelRef(args.name);
    const models = await listInstalledModels();
    const manifest = models.find((m) => m.name === ref.name);
    if (!manifest) {
      throw new Error(`Model ${ref.name} is not installed. Nothing to remove.`);
    }
    await removeModel(manifest.name);
    consola.success(`Removed ${manifest.name}`);
  },
});
