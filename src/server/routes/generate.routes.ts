import { Hono } from 'hono';
import { z } from 'zod';
import { getBackend } from '../../backends/manager.ts';
import { ensureModel, ensureVoice } from '../../models/registry.ts';
import { zValidator } from '../validation.ts';

const generateSchema = z.object({
  model: z.string(),
  input: z.string(),
  voice: z.string().optional(),
  speed: z.number().optional(),
  variant: z.string().optional(),
  reference_audio: z.string().optional(),
  reference_text: z.string().optional(),
  nfe_steps: z.number().optional(),
  device: z.enum(['auto', 'cpu', 'cuda', 'tensorrt']).optional(),
});

export const generateRoutes = new Hono().post('/', zValidator('json', generateSchema), async (c) => {
  const { model, input, voice, speed, variant, reference_audio, reference_text, nfe_steps, device } = c.req.valid('json');

  try {
    const manifest = await ensureModel(model);
    const resolvedVoice = voice ?? manifest.defaults.voice;
    await ensureVoice(manifest, resolvedVoice);
    const backend = await getBackend(manifest, variant, device);

    const referenceAudio = reference_audio ? Buffer.from(reference_audio, 'base64') : undefined;

    const result = await backend.generate({
      text: input,
      voice: resolvedVoice,
      speed,
      format: 'wav',
      referenceAudio,
      referenceText: reference_text,
      nfeSteps: nfe_steps,
    });

    return new Response(result.audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(result.audio.byteLength),
        'X-Audio-Duration': String(result.duration.toFixed(3)),
        'X-Audio-Sample-Rate': String(result.sampleRate),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not installed') || message.includes('not found') ? 404 : 500;
    return c.json({ error: message }, status);
  }
});
