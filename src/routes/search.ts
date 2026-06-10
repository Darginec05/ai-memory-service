import { Hono } from 'hono';
import { z } from 'zod';
import { readJson } from '../lib/http';

const searchSchema = z.object({
  query: z.string().min(1),
  session_id: z.string().nullish(),
  user_id: z.string().nullish(),
  limit: z.number().int().positive().max(100).optional().default(10),
});

type SearchResult = {
  content: string;
  score: number;
  session_id: string;
  timestamp: string;
  metadata: Record<string, unknown>;
};

type SearchResponse = {
  results: SearchResult[];
};

export const searchRoute = new Hono();

searchRoute.post('/search', async (c) => {
  const body = await readJson(c, searchSchema);
  if (!body.ok) return body.res;

  // TODO(retrieval): same hybrid pipeline as /recall but returns
  // structured results instead of formatted prose.

  const response: SearchResponse = { results: [] };
  return c.json(response);
});
