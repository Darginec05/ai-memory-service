import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { memories, type MemoryType } from '../db/schema';
import { asUserId } from '../lib/ids';

type MemoryDto = {
  id: string;
  type: MemoryType;
  key: string;
  value: string;
  confidence: number;
  source_session: string;
  source_turn: string | null;
  created_at: string;
  updated_at: string;
  supersedes: string | null;
  active: boolean;
};

type MemoriesResponse = {
  memories: MemoryDto[];
};

export const memoriesRoute = new Hono();

memoriesRoute.get('/users/:user_id/memories', async (c) => {
  const userId = asUserId(c.req.param('user_id'));

  const rows = await db
    .select()
    .from(memories)
    .where(eq(memories.userId, userId))
    .orderBy(desc(memories.createdAt));

  const response: MemoriesResponse = {
    memories: rows.map((m) => ({
      id: m.id,
      type: m.type,
      key: m.key,
      value: m.value,
      confidence: m.confidence,
      source_session: m.sessionId,
      source_turn: m.sourceTurn,
      created_at: m.createdAt.toISOString(),
      updated_at: m.updatedAt.toISOString(),
      supersedes: m.supersedesId,
      active: m.active,
    })),
  };
  return c.json(response);
});
