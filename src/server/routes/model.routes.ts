import { Hono } from 'hono';
import { stream as honoStream } from 'hono/streaming';
import { getFullName, parseModelRef } from '../../models/manifest.ts';
import { pullModel } from '../../models/registry.ts';
import { listInstalledModels, removeModel } from '../../models/storage.ts';

async function findInstalledModel(nameOrRef: string): Promise<import('../../models/manifest.ts').ModelManifest | undefined> {
  const ref = parseModelRef(nameOrRef);
  const models = await listInstalledModels();
  return models.find((m) => m.name === ref.name);
}

export const modelRoutes = new Hono()
  // GET /api/models — list installed models
  .get('/', async (c) => {
    const installed = await listInstalledModels();
    return c.json(
      installed.map((m) => ({
        name: getFullName(m),
        backend: m.backend,
        description: m.description,
        voices: m.installed_voices,
        defaults: m.defaults,
      })),
    );
  })

  // POST /api/models/pull — pull a model (streaming progress)
  .post('/pull', (c) => {
    return honoStream(c, async (stream) => {
      const body = await c.req.json();
      const { name, variant, voice } = body as { name?: string; variant?: string; voice?: string };

      if (!name) {
        stream.write(`${JSON.stringify({ error: 'Missing required field: name' })}\n`);
        return;
      }

      try {
        const manifest = await pullModel(name, { variant, voice }, (progress) => {
          const pct = progress.total > 0 ? Math.round((progress.downloaded / progress.total) * 100) : 0;
          stream.write(`${JSON.stringify({ status: progress.done ? 'done' : 'downloading', file: progress.file, completed: progress.downloaded, total: progress.total, percent: pct })}\n`);
        });

        stream.write(`${JSON.stringify({ status: 'success', model: getFullName(manifest) })}\n`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        stream.write(`${JSON.stringify({ error: message })}\n`);
      }
    });
  })

  // GET /api/models/:name — model info
  .get('/:name', async (c) => {
    const name = c.req.param('name');
    const manifest = await findInstalledModel(name);
    if (!manifest) {
      return c.json({ error: `Model ${name} not found` }, 404);
    }
    return c.json({
      name: getFullName(manifest),
      backend: manifest.backend,
      description: manifest.description,
      license: manifest.license,
      installed_voices: manifest.installed_voices,
      variants: Object.keys(manifest.variants),
      defaults: manifest.defaults,
      files: manifest.files.map((f) => ({ name: f.name, size: f.size })),
    });
  })

  // DELETE /api/models/:name — remove a model
  .delete('/:name', async (c) => {
    const name = c.req.param('name');
    const manifest = await findInstalledModel(name);
    if (!manifest) {
      return c.json({ error: `Model ${name} not found` }, 404);
    }
    await removeModel(manifest.name);
    return new Response(null, { status: 204 });
  })

  // GET /api/models/:name/voices — list installed voices for a model
  .get('/:name/voices', async (c) => {
    const name = c.req.param('name');
    const manifest = await findInstalledModel(name);
    if (!manifest) {
      return c.json({ error: `Model ${name} not found` }, 404);
    }
    return c.json({
      voices: manifest.installed_voices,
    });
  });
