import { Hono } from 'hono';
import { z } from 'zod';
import { readJson } from '../lib/http';

const recallSchema = z.object({
  query: z.string().min(1),
  session_id: z.string().min(1),
  user_id: z.string().nullish(),
  max_tokens: z.number().int().positive().optional().default(1024),
});

type Citation = {
  turn_id: string;
  score: number;
  snippet: string;
};

type RecallResponse = {
  context: string;
  citations: Citation[];
};

export const recallRoute = new Hono();

recallRoute.post('/recall', async (c) => {
  const body = await readJson(c, recallSchema);
  if (!body.ok) return body.res;

  // TODO(retrieval): query rewriting -> hybrid search (pgvector + FTS) ->
  // RRF fusion -> LLM rerank -> context assembly under max_tokens.
  // Cold sessions must return 200 with empty context, never an error.

  const response: RecallResponse = { context: '', citations: [] };
  return c.json(response);
});
