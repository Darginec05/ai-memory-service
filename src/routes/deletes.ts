import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { memories, turns } from '../db/schema';
import { createLogger } from '../lib/logger';

const log = createLogger('deletes');

type DeletedCounts = {
  memories: number;
  turns: number;
};

export const deletesRoute = new Hono();

deletesRoute.delete('/sessions/:session_id', async (c) => {
  const sessionId = c.req.param('session_id');

  const deleted: DeletedCounts = await db.transaction(async (tx) => {
    // Only session-scoped memories (user_id IS NULL) die with the session;
    // user-scoped facts extracted here remain valid user knowledge.
    const deletedMemories = await tx
      .delete(memories)
      .where(and(eq(memories.sessionId, sessionId), isNull(memories.userId)))
      .returning({ id: memories.id });
    const deletedTurns = await tx
      .delete(turns)
      .where(eq(turns.sessionId, sessionId))
      .returning({ id: turns.id });
    return { memories: deletedMemories.length, turns: deletedTurns.length };
  });

  log.info(
    `session=${sessionId} deleted: turns=${deleted.turns} session-scoped memories=${deleted.memories}`,
  );
  return c.body(null, 204);
});

deletesRoute.delete('/users/:user_id', async (c) => {
  const userId = c.req.param('user_id');

  const deleted: DeletedCounts = await db.transaction(async (tx) => {
    const deletedMemories = await tx
      .delete(memories)
      .where(eq(memories.userId, userId))
      .returning({ id: memories.id });
    const deletedTurns = await tx
      .delete(turns)
      .where(eq(turns.userId, userId))
      .returning({ id: turns.id });
    return { memories: deletedMemories.length, turns: deletedTurns.length };
  });

  log.info(`user=${userId} deleted: turns=${deleted.turns} memories=${deleted.memories}`);
  return c.body(null, 204);
});
