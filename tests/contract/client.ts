// Black-box HTTP client for contract tests: the eval harness sees the service
// only through this surface, so the tests do too — no internal imports.

export const BASE_URL = process.env.MEMORY_API_URL ?? 'http://localhost:8080';

export type ApiResponse = {
  status: number;
  body: unknown;
};

export async function api(method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await parseBody(res) };
}

// For deliberately broken payloads that JSON.stringify would refuse to produce.
export async function rawPost(path: string, rawBody: string): Promise<ApiResponse> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody,
  });
  return { status: res.status, body: await parseBody(res) };
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function ensureServiceUp(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) throw new Error(`/health responded ${res.status}`);
  } catch (err) {
    throw new Error(
      `memory-service is not reachable at ${BASE_URL} — start it (docker compose up -d) before running contract tests. Cause: ${String(err)}`,
    );
  }
}

let seq = 0;

export function uniqueId(prefix: string): string {
  seq += 1;
  return `test-${prefix}-${Date.now()}-${seq}`;
}

type TurnMessage = {
  role: 'user' | 'assistant' | 'tool';
  name?: string | null;
  content: string;
};

type TurnRequest = {
  session_id: string;
  user_id: string | null;
  messages: TurnMessage[];
  timestamp: string;
  metadata: Record<string, unknown>;
};

export function turnBody(
  sessionId: string,
  userId: string | null,
  messages: TurnMessage[],
): TurnRequest {
  return {
    session_id: sessionId,
    user_id: userId,
    messages,
    timestamp: new Date().toISOString(),
    metadata: {},
  };
}

export async function cleanup(userIds: string[], sessionIds: string[]): Promise<void> {
  await Promise.all([
    ...userIds.map((id) => api('DELETE', `/users/${id}`)),
    ...sessionIds.map((id) => api('DELETE', `/sessions/${id}`)),
  ]);
}
