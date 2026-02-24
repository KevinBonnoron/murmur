import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { generateRoutes, healthRoutes, modelRoutes, versionRoutes } from './routes';

export function createApp(): Hono {
  const app = new Hono()
    .basePath('/api')
    .use('*', logger())
    .onError((err, c) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Server error:', message);
      return c.json({ error: message }, 500);
    })
    .route('/generate', generateRoutes)
    .route('/models', modelRoutes)
    .route('/health', healthRoutes)
    .route('/version', versionRoutes);

  // root
  app.get('/', (c) => {
    return c.json({
      name: 'murmur',
      version: '0.1.0',
      endpoints: ['/api/generate', '/api/models', '/api/version', '/api/health'],
    });
  });

  return app;
}
