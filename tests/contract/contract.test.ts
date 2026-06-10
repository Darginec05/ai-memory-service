import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, cleanup, ensureServiceUp, turnBody, uniqueId } from './client';

const TURN_TIMEOUT = 60_000;
const RECALL_TIMEOUT = 30_000;

const userId = uniqueId('user');
const sessionId = uniqueId('session');

beforeAll(ensureServiceUp, 15_000);
afterAll(() => cleanup([userId], [sessionId]));

describe('contract roundtrip', () => {
  let turnId = '';

  it('GET /health returns 200', async () => {
    const res = await api('GET', '/health');
    expect(res.status).toBe(200);
  });

  it(
    'POST /turns persists a turn and returns 201 with an id',
    async () => {
      const res = await api(
        'POST',
        '/turns',
        turnBody(sessionId, userId, [
          { role: 'user', content: 'I just moved to Berlin from NYC last month. Loving it so far.' },
          { role: 'assistant', content: 'That sounds exciting! How are you settling in?' },
        ]),
      );
      expect(res.status).toBe(201);
      const body = res.body as { id?: unknown };
      expect(typeof body.id).toBe('string');
      turnId = body.id as string;
    },
    TURN_TIMEOUT,
  );

  it(
    'POST /recall surfaces the fact immediately after /turns returns (synchronous correctness)',
    async () => {
      // Different session, same user: user-scoped knowledge is cross-session by design.
      const res = await api('POST', '/recall', {
        query: 'Where does this user live?',
        session_id: uniqueId('other-session'),
        user_id: userId,
        max_tokens: 512,
      });
      expect(res.status).toBe(200);

      const body = res.body as { context: string; citations: unknown[] };
      expect(body.context).toMatch(/berlin/i);
      expect(Array.isArray(body.citations)).toBe(true);
      expect(body.citations.length).toBeGreaterThan(0);
      for (const citation of body.citations as Array<Record<string, unknown>>) {
        expect(typeof citation.turn_id).toBe('string');
        expect(typeof citation.score).toBe('number');
        expect(typeof citation.snippet).toBe('string');
      }
    },
    RECALL_TIMEOUT,
  );

  it(
    'POST /search returns structured scored results',
    async () => {
      const res = await api('POST', '/search', {
        query: 'Berlin',
        session_id: null,
        user_id: userId,
        limit: 10,
      });
      expect(res.status).toBe(200);

      const body = res.body as { results: Array<Record<string, unknown>> };
      expect(body.results.length).toBeGreaterThan(0);
      for (const result of body.results) {
        expect(typeof result.content).toBe('string');
        expect(typeof result.score).toBe('number');
        expect(typeof result.session_id).toBe('string');
        expect(Number.isNaN(Date.parse(result.timestamp as string))).toBe(false);
        expect(result.metadata).toBeTypeOf('object');
      }
    },
    RECALL_TIMEOUT,
  );

  it('GET /users/:id/memories exposes structured memories, not raw chunks', async () => {
    const res = await api('GET', `/users/${userId}/memories`);
    expect(res.status).toBe(200);

    const body = res.body as { memories: Array<Record<string, unknown>> };
    expect(body.memories.length).toBeGreaterThan(0);
    for (const memory of body.memories) {
      expect(typeof memory.id).toBe('string');
      expect(['fact', 'preference', 'opinion', 'event']).toContain(memory.type);
      expect(typeof memory.key).toBe('string');
      expect(typeof memory.value).toBe('string');
      expect(memory.confidence).toBeGreaterThanOrEqual(0);
      expect(memory.confidence).toBeLessThanOrEqual(1);
      expect(typeof memory.source_session).toBe('string');
      expect(typeof memory.active).toBe('boolean');
      expect(Number.isNaN(Date.parse(memory.created_at as string))).toBe(false);
    }
    // Provenance: at least one memory traces back to the ingested turn.
    expect(body.memories.some((m) => m.source_turn === turnId)).toBe(true);
    // Extraction actually distilled the fact (not just echoed messages).
    expect(body.memories.some((m) => /berlin/i.test(m.value as string))).toBe(true);
  });

  it(
    'POST /recall on a cold session returns empty context, never an error',
    async () => {
      const res = await api('POST', '/recall', {
        query: 'What is the favorite color of this user?',
        session_id: uniqueId('cold-session'),
        user_id: uniqueId('ghost-user'),
        max_tokens: 256,
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ context: '', citations: [] });
    },
    RECALL_TIMEOUT,
  );

  it('DELETE /users/:id returns 204 and removes the data', async () => {
    const del = await api('DELETE', `/users/${userId}`);
    expect(del.status).toBe(204);

    const memoriesRes = await api('GET', `/users/${userId}/memories`);
    expect(memoriesRes.body).toEqual({ memories: [] });
  });

  it('DELETE /sessions/:id returns 204', async () => {
    const res = await api('DELETE', `/sessions/${sessionId}`);
    expect(res.status).toBe(204);
  });
});
