import { Hono } from 'hono';
import { z } from 'zod';
import { readJson } from '../lib/http';
import { recallService, type Citation } from '../services/recall';
import { scopeFromRequest } from '../services/retrieval';

const recallSchema = z.object({
  query: z.string().min(1),
  session_id: z.string().min(1),
  user_id: z.string().nullish(),
  max_tokens: z.number().int().positive().optional().default(1024),
});

type RecallResponse = {
  context: string;
  citations: Citation[];
};

export const recallRoute = new Hono();

recallRoute.post('/recall', async (c) => {
  const body = await readJson(c, recallSchema);
  if (!body.ok) return body.res;

  const scope = scopeFromRequest(body.data.user_id, body.data.session_id);
  if (!scope) {
    const empty: RecallResponse = { context: '', citations: [] };
    return c.json(empty);
  }

  const assembled = await recallService.recall(scope, body.data.query, body.data.max_tokens);

  const response: RecallResponse = {
    context: assembled.context,
    citations: assembled.citations,
  };
  return c.json(response);
});
