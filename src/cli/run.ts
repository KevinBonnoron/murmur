import { defineCommand } from 'citty';
import consola from 'consola';
import { getBackend } from '../backends/manager.ts';
import { parseModelRef } from '../models/manifest.ts';
import { ensureVoice, findModel } from '../models/registry.ts';

export default defineCommand({
  meta: { name: 'run', description: 'Generate speech from text (one-shot, no server needed)' },
  args: {
    model: {
      type: 'positional',
      description: 'Model name (e.g. kokoro, kokoro:fp16)',
      required: true,
    },
    text: {
      type: 'positional',
      description: 'Text to synthesize',
      required: true,
    },
    output: {
      type: 'string',
      alias: 'o',
      description: 'Output file path',
      default: 'output.wav',
    },
    voice: {
      type: 'string',
      alias: 'v',
      description: 'Voice ID (e.g. af_heart, am_adam)',
    },
    speed: {
      type: 'string',
      alias: 's',
      description: 'Speech speed (default: 1.0)',
      default: '1.0',
    },
    'reference-audio': {
      type: 'string',
      alias: 'r',
      description: 'Path to reference audio WAV file (for voice cloning)',
    },
    'reference-text': {
      type: 'string',
      alias: 't',
      description: 'Transcript of the reference audio',
    },
    'nfe-steps': {
      type: 'string',
      alias: 'n',
      description: 'Number of flow matching steps (default: 16, higher = better quality but slower)',
    },
    device: {
      type: 'enum',
      alias: 'd',
      description: 'Device to run inference on (auto, cpu, cuda, tensorrt)',
      default: 'auto',
      options: ['auto', 'cpu', 'cuda', 'tensorrt'],
    },
  },
  async run({ args }) {
    const ref = parseModelRef(args.model);
    const manifest = await findModel(args.model);

    // Backend-specific argument validation
    if (manifest.backend === 'f5tts' && (!args['reference-audio'] || !args['reference-text'])) {
      console.log(`
F5-TTS is a voice cloning model and requires a reference audio sample.

Usage:
  murmur run f5tts "Text to synthesize" -r <audio.wav> -t <transcript>

Required flags:
  -r, --reference-audio  Path to a reference audio WAV file
  -t, --reference-text   Transcript of the reference audio

Example:
  murmur run f5tts "Hello world" -r voice.wav -t "This is my voice" -o output.wav
`);
      process.exit(1);
    }

    const voice = args.voice ?? manifest.defaults.voice;
    await ensureVoice(manifest, voice);
    const backend = await getBackend(manifest, ref.variant, args.device);

    let referenceAudio: Buffer | undefined;
    const refAudioPath = args['reference-audio'];
    if (refAudioPath) {
      const file = Bun.file(refAudioPath);
      if (!(await file.exists())) {
        consola.error(`Reference audio file not found: ${refAudioPath}`);
        process.exit(1);
      }
      referenceAudio = Buffer.from(await file.arrayBuffer());
    }

    const speed = Number.parseFloat(args.speed);
    if (Number.isNaN(speed)) {
      consola.error(`Invalid --speed value: ${args.speed}`);
      process.exit(1);
    }
    const nfeSteps = args['nfe-steps'] ? Number.parseInt(args['nfe-steps'], 10) : undefined;
    if (nfeSteps !== undefined && Number.isNaN(nfeSteps)) {
      consola.error(`Invalid --nfe-steps value: ${args['nfe-steps']}`);
      process.exit(1);
    }

    const result = await backend.generate({
      text: args.text,
      voice,
      speed,
      format: 'wav',
      referenceAudio,
      referenceText: args['reference-text'],
      nfeSteps,
    });

    await Bun.write(args.output, result.audio);
    consola.success(`Saved ${args.output} (${result.duration.toFixed(2)}s, ${result.sampleRate}Hz)`);
  },
});
