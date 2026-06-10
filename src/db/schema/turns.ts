import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { SessionId, TurnId, UserId } from '../../lib/ids';

export const turns = pgTable('turns', {
  id: uuid('id').primaryKey().defaultRandom().$type<TurnId>(),
  sessionId: text('session_id').notNull().$type<SessionId>(),
  userId: text('user_id').$type<UserId>(),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Turn = typeof turns.$inferSelect;
