import { Hono } from 'hono';
import { logger } from 'hono/logger';
import pkg from '../../package.json';
import { generateRoutes, healthRoutes, modelRoutes, versionRoutes } from './routes';

export function createApp(): Hono {
  const app = new Hono()
    .basePath('/api')
    .use('*', logger())
    .onError((err, c) => {
      console.error('Server error:', err);
      return c.json({ error: 'Internal server error' }, 500);
    })
    .route('/generate', generateRoutes)
    .route('/models', modelRoutes)
    .route('/health', healthRoutes)
    .route('/version', versionRoutes);

  // root
  app.get('/', (c) => {
    return c.json({
      name: 'murmur',
      version: pkg.version,
      endpoints: ['/api/generate', '/api/models', '/api/version', '/api/health'],
    });
  });

  return app;
}
