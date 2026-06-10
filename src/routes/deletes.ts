import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { memories, turns } from '../db/schema';
import { asSessionId, asUserId } from '../lib/ids';

export const deletesRoute = new Hono();

deletesRoute.delete('/sessions/:session_id', async (c) => {
  const sessionId = asSessionId(c.req.param('session_id'));

  await db.transaction(async (tx) => {
    // Only session-scoped memories (user_id IS NULL) die with the session;
    // user-scoped facts extracted here remain valid user knowledge.
    await tx
      .delete(memories)
      .where(and(eq(memories.sessionId, sessionId), isNull(memories.userId)));
    await tx.delete(turns).where(eq(turns.sessionId, sessionId));
  });

  return c.body(null, 204);
});

deletesRoute.delete('/users/:user_id', async (c) => {
  const userId = asUserId(c.req.param('user_id'));

  await db.transaction(async (tx) => {
    await tx.delete(memories).where(eq(memories.userId, userId));
    await tx.delete(turns).where(eq(turns.userId, userId));
  });

  return c.body(null, 204);
});
