import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { MESSAGE_ROLES, messages, turns } from '../db/schema';
import { readJson } from '../lib/http';
import { asSessionId, asUserId, type MessageId, type TurnId } from '../lib/ids';
import { LlmUnavailableError } from '../lib/openai';
import { processTurn, type ExtractTurnInput } from '../services/extraction';

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

type PersistedTurn = {
  turnId: TurnId;
  messageIds: MessageId[];
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
  const sessionId = asSessionId(turn.session_id);
  const userId = turn.user_id ? asUserId(turn.user_id) : null;

  const persisted: PersistedTurn = await db.transaction(async (tx) => {
    const [insertedTurn] = await tx
      .insert(turns)
      .values({
        sessionId,
        userId,
        ts: parseTimestamp(turn.timestamp),
        metadata: turn.metadata ?? {},
      })
      .returning({ id: turns.id });
    if (!insertedTurn) throw new Error('turn insert returned no row');

    const insertedMessages = await tx
      .insert(messages)
      .values(
        turn.messages.map((m, idx) => ({
          turnId: insertedTurn.id,
          idx,
          role: m.role,
          name: m.name ?? null,
          content: m.content,
        })),
      )
      .returning({ id: messages.id });

    return { turnId: insertedTurn.id, messageIds: insertedMessages.map((m) => m.id) };
  });

  // Synchronous by design (60s budget): memories must be queryable the moment we
  // return 201. Extraction failure degrades to "turn stored, no memories" — the
  // raw conversation is still searchable, so we log and return success.
  const extractionInput: ExtractTurnInput = {
    turnId: persisted.turnId,
    sessionId,
    userId,
    messages: turn.messages.flatMap((m, idx) => {
      const id = persisted.messageIds[idx];
      return id ? [{ id, role: m.role, content: m.content }] : [];
    }),
  };
  
  try {
    await processTurn(extractionInput);
  } catch (err) {
    if (err instanceof LlmUnavailableError) {
      console.warn(`[extraction] skipped for turn=${persisted.turnId}: ${err.message}`);
    } else {
      console.error(`[extraction] failed for turn=${persisted.turnId}:`, err);
    }
  }

  const response: CreateTurnResponse = { id: persisted.turnId };
  return c.json(response, 201);
});
