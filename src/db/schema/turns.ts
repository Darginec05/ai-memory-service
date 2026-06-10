import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const turns = pgTable('turns', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: text('session_id').notNull(),
  userId: text('user_id'),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Turn = typeof turns.$inferSelect;
