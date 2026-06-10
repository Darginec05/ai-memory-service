import type { SqlClient } from '../../src/db/client';
import type { LlmGateway, StructuredCallArgs } from '../../src/lib/openai';
import type { RetrievedMemory, RetrievedMessage } from '../../src/services/retrieval/types';

export type FakeLlm = {
  gateway: LlmGateway;
  calls: StructuredCallArgs[];
};

// Injectable LlmGateway double: records every structured call and answers via
// the provided responder (throw inside it to simulate an LLM outage).
export function fakeLlm(respond: (args: StructuredCallArgs) => unknown): FakeLlm {
  const calls: StructuredCallArgs[] = [];
  const gateway: LlmGateway = {
    completeStructured: async (args: StructuredCallArgs): Promise<unknown> => {
      calls.push(args);
      return respond(args);
    },
    embedTexts: async (texts: string[]): Promise<number[][]> => texts.map(() => [0.1, 0.2, 0.3]),
  };
  return { gateway, calls };
}

type SqlRow = Record<string, unknown>;

// Minimal postgres.js double for ContextAssembler: a tagged-template call
// (first arg has `.raw`) resolves to `rows`; a helper call like sql(ids)
// returns its argument as an inert fragment.
export function fakeSql(rows: SqlRow[] = []): SqlClient {
  const sql = (first: unknown): unknown =>
    Array.isArray(first) && Object.hasOwn(first as object, 'raw') ? Promise.resolve(rows) : first;
  return sql as unknown as SqlClient;
}

let seq = 0;

export function memoryItem(overrides: Partial<RetrievedMemory> = {}): RetrievedMemory {
  seq += 1;
  return {
    source: 'memory',
    id: `mem-${seq}`,
    type: 'fact',
    key: 'location.city',
    value: 'User lives in Bergen.',
    confidence: 0.9,
    sessionId: 's1',
    turnId: `turn-${seq}`,
    supersedesId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

export function messageItem(overrides: Partial<RetrievedMessage> = {}): RetrievedMessage {
  seq += 1;
  return {
    source: 'message',
    id: `msg-${seq}`,
    role: 'user',
    content: 'I moved to Bergen last month.',
    sessionId: 's1',
    turnId: `turn-${seq}`,
    ts: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}
