import { defineCommand } from 'citty';
import consola from 'consola';
import { listInstalledModels } from '../models/storage.ts';

export default defineCommand({
  meta: { name: 'list', description: 'List installed TTS models' },
  async run() {
    const models = await listInstalledModels();

    if (models.length === 0) {
      consola.info('No models installed. Run: murmur pull kokoro');
      return;
    }

    consola.log('');
    consola.log('Installed models:');
    consola.log('');

    for (const model of models) {
      const totalSize = model.files.reduce((sum, f) => sum + (f.size ?? 0), 0);
      const sizeMb = (totalSize / 1024 / 1024).toFixed(0);
      const voiceCount = model.installed_voices.length;

      consola.log(`  ${model.name.padEnd(20)} ${model.backend.padEnd(10)} ${sizeMb.padStart(6)} MB   ${voiceCount} voices`);
    }

    consola.log('');
  },
});
