import { execSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, BASE_URL, cleanup, ensureServiceUp, turnBody, uniqueId } from '../contract/client';

// Restart-persistence test (task §7): facts written before `docker compose down`
// must be recallable after `docker compose up`. Run via `npm run test:persistence`.
//
// REQUIREMENT: the service under test must itself be running via docker compose
// (not `npm run dev`) — this test restarts the compose stack and verifies the
// named volume carries the data across.

const TEST_TIMEOUT = 240_000;
const HEALTH_POLL_TIMEOUT_MS = 120_000;

const userId = uniqueId('restart-user');
const sessionId = uniqueId('restart-session');

function compose(command: string): void {
  execSync(`docker compose ${command}`, { stdio: 'inherit' });
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`service did not become healthy within ${HEALTH_POLL_TIMEOUT_MS}ms after restart`);
}

beforeAll(ensureServiceUp, 15_000);
afterAll(() => cleanup([userId], [sessionId]));

describe('persistence across docker compose down/up', () => {
  it(
    'facts written before the restart are recallable after it',
    async () => {
      const ingest = await api(
        'POST',
        '/turns',
        turnBody(sessionId, userId, [
          { role: 'user', content: 'My daughter Ines was born in Lyon last spring.' },
          { role: 'assistant', content: 'Congratulations! Lyon is a wonderful place.' },
        ]),
      );
      expect(ingest.status).toBe(201);

      // Sanity before restart — otherwise a recall failure would masquerade
      // as a persistence failure.
      const before = await api('POST', '/recall', {
        query: 'Does the user have children?',
        session_id: sessionId,
        user_id: userId,
        max_tokens: 512,
      });
      expect((before.body as { context: string }).context).toMatch(/ines|lyon/i);

      compose('down');
      compose('up -d');
      await waitForHealth();

      const after = await api('POST', '/recall', {
        query: 'Does the user have children?',
        session_id: sessionId,
        user_id: userId,
        max_tokens: 512,
      });
      expect(after.status).toBe(200);
      expect((after.body as { context: string }).context).toMatch(/ines|lyon/i);

      // The structured memory store survived too, with provenance intact.
      const memories = await api('GET', `/users/${userId}/memories`);
      const list = (memories.body as { memories: Array<{ value: string }> }).memories;
      expect(list.some((m) => /ines|lyon/i.test(m.value))).toBe(true);
    },
    TEST_TIMEOUT,
  );
});
