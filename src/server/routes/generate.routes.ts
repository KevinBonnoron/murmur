import { Hono } from 'hono';
import { getBackend } from '../../backends/manager.ts';
import { ensureVoice, findModel } from '../../models/registry.ts';

export const generateRoutes = new Hono().post('/', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { model, input, voice, speed, variant, reference_audio, reference_text, nfe_steps, device } = body as {
    model?: string;
    input?: string;
    voice?: string;
    speed?: number;
    variant?: string;
    reference_audio?: string;
    reference_text?: string;
    nfe_steps?: number;
    device?: string;
  };

  if (!model) {
    return c.json({ error: 'Missing required field: model' }, 400);
  }
  if (!input) {
    return c.json({ error: 'Missing required field: input' }, 400);
  }
  if (device && !['auto', 'cpu', 'cuda', 'tensorrt'].includes(device)) {
    return c.json({ error: `Invalid device: ${device}` }, 400);
  }

  try {
    const manifest = await findModel(model);
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
