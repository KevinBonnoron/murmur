import { zValidator as zv } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { ZodSchema } from 'zod';

export const zValidator = <Target extends keyof ValidationTargets, T extends ZodSchema>(target: Target, schema: T) =>
  zv(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'Validation failed', details: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) }, 400);
    }
  });
