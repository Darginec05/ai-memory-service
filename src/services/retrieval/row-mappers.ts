import type { Row } from 'postgres';
import type { MemoryType, MessageRole } from '../../db/schema';
import type { RetrievedMemory, RetrievedMessage } from './types';

export function mapMemoryRow(row: Row): RetrievedMemory {
  return {
    source: 'memory',
    id: row.id as string,
    type: row.type as MemoryType,
    key: row.key as string,
    value: row.value as string,
    confidence: row.confidence as number,
    sessionId: row.session_id as string,
    turnId: (row.source_turn as string | null) ?? null,
    supersedesId: (row.supersedes_id as string | null) ?? null,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export function mapMessageRow(row: Row): RetrievedMessage {
  return {
    source: 'message',
    id: row.id as string,
    role: row.role as MessageRole,
    content: row.content as string,
    sessionId: row.session_id as string,
    turnId: row.turn_id as string,
    ts: toDate(row.ts),
  };
}

// drizzle's postgres-js adapter disables the client's native timestamp parsers
// (it maps dates itself), so raw-SQL rows carry timestamptz as strings.
function toDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`unparseable timestamp from db: ${String(value)}`);
  }
  return date;
}
