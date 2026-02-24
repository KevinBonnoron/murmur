import { Hono } from 'hono';
import pkg from '../../../package.json';

export const versionRoutes = new Hono().get('', (c) => c.json({ version: pkg.version }));
