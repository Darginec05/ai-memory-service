import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { bearerAuth } from '../../src/middleware/auth';

function appWithAuth(token: string): Hono {
  const app = new Hono();
  app.use('*', bearerAuth(token));
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.get('/protected', (c) => c.json({ data: true }));
  return app;
}

describe('bearerAuth', () => {
  it('lets everything through when no token is configured', async () => {
    const app = appWithAuth('');
    const res = await app.request('/protected');
    expect(res.status).toBe(200);
  });

  it('rejects a missing Authorization header with 401, not a crash', async () => {
    const app = appWithAuth('secret');
    const res = await app.request('/protected');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects a wrong token with 401', async () => {
    const app = appWithAuth('secret');
    const res = await app.request('/protected', {
      headers: { authorization: 'Bearer wrong' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts the correct bearer token', async () => {
    const app = appWithAuth('secret');
    const res = await app.request('/protected', {
      headers: { authorization: 'Bearer secret' },
    });
    expect(res.status).toBe(200);
  });

  it('keeps /health public even when a token is required', async () => {
    const app = appWithAuth('secret');
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });
});
