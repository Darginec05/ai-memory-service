import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';

export const health = new Hono();

health.get('/health', async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({ status: 'ok' });
  } catch {
    return c.json({ status: 'unavailable' }, 503);
  }
});
