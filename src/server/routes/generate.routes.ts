import { Hono } from 'hono';
import { stream as honoStream } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { BackendError } from '../../backends/backend.ts';
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
  stream: z.boolean().optional(),
});

export const generateRoutes = new Hono().post('/', zValidator('json', generateSchema), async (c) => {
  const { model, input, voice, speed, variant, reference_audio, reference_text, nfe_steps, device, stream: isStream } = c.req.valid('json');

  try {
    const manifest = await ensureModel(model);
    const resolvedVoice = voice ?? manifest.defaults.voice;
    await ensureVoice(manifest, resolvedVoice);
    const backend = await getBackend(manifest, variant, device);

    const referenceAudio = reference_audio ? Buffer.from(reference_audio, 'base64') : undefined;

    const authHeader = c.req.header('Authorization');
    const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

    const request = {
      text: input,
      voice: resolvedVoice,
      speed,
      format: 'wav' as const,
      referenceAudio,
      referenceText: reference_text,
      nfeSteps: nfe_steps,
      apiKey,
    };

    if (isStream) {
      // Stream raw 16-bit PCM chunks as they are generated (sentence by sentence for Kokoro)
      const sampleRate = manifest.defaults.sample_rate;

      c.header('Content-Type', 'audio/pcm');
      c.header('X-Sample-Rate', String(sampleRate));
      c.header('X-Channels', '1');
      c.header('X-Bit-Depth', '16');
      c.header('Transfer-Encoding', 'chunked');

      return honoStream(c, async (stream) => {
        try {
          for await (const chunk of backend.generateStream(request)) {
            await stream.write(chunk.audio);
          }
        } catch {
          stream.abort();
        }
      });
    }

    const result = await backend.generate(request);

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
    let status = 500;
    if (err instanceof BackendError) {
      status = err.statusCode;
    } else if (message.includes('not installed') || message.includes('not found')) {
      status = 404;
    }
    return c.json({ error: message }, status as ContentfulStatusCode);
  }
});
