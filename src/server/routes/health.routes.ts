import { Hono } from 'hono';

export const healthRoutes = new Hono().get('/', (c) => {
  return c.text('OK', 200);
});
