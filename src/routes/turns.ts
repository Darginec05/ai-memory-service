import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { MESSAGE_ROLES, messages, turns } from '../db/schema';
import { readJson } from '../lib/http';
import { asSessionId, asUserId, type TurnId } from '../lib/ids';

const messageSchema = z.object({
  role: z.enum(MESSAGE_ROLES),
  name: z.string().nullish(),
  content: z.string(),
});

const turnSchema = z.object({
  session_id: z.string().min(1),
  user_id: z.string().nullish(),
  messages: z.array(messageSchema).min(1),
  timestamp: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

type CreateTurnResponse = {
  id: string;
};

function parseTimestamp(value: string | undefined): Date {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export const turnsRoute = new Hono();

turnsRoute.post('/turns', async (c) => {
  const body = await readJson(c, turnSchema);
  if (!body.ok) return body.res;
  const turn = body.data;

  const turnId: TurnId = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(turns)
      .values({
        sessionId: asSessionId(turn.session_id),
        userId: turn.user_id ? asUserId(turn.user_id) : null,
        ts: parseTimestamp(turn.timestamp),
        metadata: turn.metadata ?? {},
      })
      .returning({ id: turns.id });
    if (!inserted) throw new Error('turn insert returned no row');

    await tx.insert(messages).values(
      turn.messages.map((m, idx) => ({
        turnId: inserted.id,
        idx,
        role: m.role,
        name: m.name ?? null,
        content: m.content,
      })),
    );

    return inserted.id;
  });

  // TODO(extraction): embed messages, extract structured memories via LLM,
  // run supersession check — all synchronously before responding (60s budget).

  const response: CreateTurnResponse = { id: turnId };
  return c.json(response, 201);
});
