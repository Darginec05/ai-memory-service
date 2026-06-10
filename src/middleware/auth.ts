import type { MiddlewareHandler } from 'hono';

const PUBLIC_PATHS = ['/health'] as const;

export function bearerAuth(token: string): MiddlewareHandler {
  return async (c, next) => {
    if (!token || PUBLIC_PATHS.includes(c.req.path as (typeof PUBLIC_PATHS)[number])) {
      return next();
    }
    if (c.req.header('authorization') !== `Bearer ${token}`) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    return next();
  };
}
