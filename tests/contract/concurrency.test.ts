import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, cleanup, ensureServiceUp, turnBody, uniqueId } from './client';

const INGEST_TIMEOUT = 120_000;
const RECALL_TIMEOUT = 30_000;

const userA = uniqueId('user-a');
const userB = uniqueId('user-b');
const sessionA = uniqueId('session-a');
const sessionB = uniqueId('session-b');
// Anonymous sessions: no user_id, so extracted memories are session-scoped.
const anonSession1 = uniqueId('anon-1');
const anonSession2 = uniqueId('anon-2');

beforeAll(async () => {
  await ensureServiceUp();
  const results = await Promise.all([
    api(
      'POST',
      '/turns',
      turnBody(sessionA, userA, [
        { role: 'user', content: 'I am a violinist and I live in Porto.' },
        { role: 'assistant', content: 'Porto is lovely! How long have you played?' },
      ]),
    ),
    api(
      'POST',
      '/turns',
      turnBody(sessionB, userB, [
        { role: 'user', content: 'I work as a carpenter and I live in Tallinn.' },
        { role: 'assistant', content: 'Woodworking in Tallinn sounds great!' },
      ]),
    ),
    api(
      'POST',
      '/turns',
      turnBody(anonSession1, null, [
        { role: 'user', content: 'My cat is named Zhuzha and she hates rain.' },
        { role: 'assistant', content: 'Zhuzha sounds like a character!' },
      ]),
    ),
  ]);
  for (const res of results) expect(res.status).toBe(201);
}, INGEST_TIMEOUT);

afterAll(() =>
  cleanup([userA, userB], [sessionA, sessionB, anonSession1, anonSession2]),
);

describe('concurrent sessions do not bleed', () => {
  it(
    'user A recall never contains user B facts (and vice versa)',
    async () => {
      const recallA = await api('POST', '/recall', {
        query: 'What does the user do and where do they live?',
        session_id: sessionA,
        user_id: userA,
        max_tokens: 512,
      });
      expect(recallA.status).toBe(200);
      const contextA = (recallA.body as { context: string }).context;
      expect(contextA).not.toMatch(/carpenter|tallinn/i);

      const recallB = await api('POST', '/recall', {
        query: 'What does the user do and where do they live?',
        session_id: sessionB,
        user_id: userB,
        max_tokens: 512,
      });
      expect(recallB.status).toBe(200);
      const contextB = (recallB.body as { context: string }).context;
      expect(contextB).not.toMatch(/violinist|porto/i);

      // Both users' own facts are present — isolation is not just emptiness.
      expect(contextA).toMatch(/violinist|porto/i);
      expect(contextB).toMatch(/carpenter|tallinn/i);
    },
    RECALL_TIMEOUT,
  );

  it(
    'an anonymous session never sees another anonymous session',
    async () => {
      const res = await api('POST', '/recall', {
        query: 'What pets does the user have?',
        session_id: anonSession2,
        user_id: null,
        max_tokens: 512,
      });
      expect(res.status).toBe(200);
      expect((res.body as { context: string }).context).not.toMatch(/zhuzha/i);
    },
    RECALL_TIMEOUT,
  );

  it(
    'search is scoped the same way as recall',
    async () => {
      const res = await api('POST', '/search', {
        query: 'Tallinn carpenter',
        session_id: null,
        user_id: userA,
        limit: 10,
      });
      expect(res.status).toBe(200);
      const results = (res.body as { results: Array<{ content: string }> }).results;
      for (const result of results) {
        expect(result.content).not.toMatch(/carpenter|tallinn/i);
      }
    },
    RECALL_TIMEOUT,
  );

  it('deleting one user leaves the other intact', async () => {
    const del = await api('DELETE', `/users/${userB}`);
    expect(del.status).toBe(204);

    const gone = await api('GET', `/users/${userB}/memories`);
    expect(gone.body).toEqual({ memories: [] });

    const kept = await api('GET', `/users/${userA}/memories`);
    expect((kept.body as { memories: unknown[] }).memories.length).toBeGreaterThan(0);
  });
});
