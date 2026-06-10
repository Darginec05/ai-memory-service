import type { Fragment } from 'postgres';
import type { SqlClient } from '../../db/client';
import type { RetrievalScope } from './types';

// user_id present -> user-scoped (cross-session by design, documented in README);
// session_id only -> session-scoped; neither -> nothing to search.
export function scopeFromRequest(
  userId: string | null | undefined,
  sessionId: string | null | undefined,
): RetrievalScope | null {
  if (userId) return { kind: 'user', userId };
  if (sessionId) return { kind: 'session', sessionId };
  return null;
}

// Scoping is the cross-session-bleed defense (task §5) — keep it in one place
// so the vector and FTS branches can never drift apart.

export function memoryScopeSql(sql: SqlClient, scope: RetrievalScope): Fragment {
  return scope.kind === 'user'
    ? sql`user_id = ${scope.userId}`
    : sql`user_id IS NULL AND session_id = ${scope.sessionId}`;
}

export function messageScopeSql(sql: SqlClient, scope: RetrievalScope): Fragment {
  return scope.kind === 'user'
    ? sql`t.user_id = ${scope.userId}`
    : sql`t.session_id = ${scope.sessionId}`;
}
