import {
  boolean,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { EMBEDDING_DIMENSIONS } from './messages';
import { turns } from './turns';

export const MEMORY_TYPES = ['fact', 'preference', 'opinion', 'event'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const memories = pgTable('memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  // null userId = session-scoped memory (deleted with its session)
  userId: text('user_id'),
  sessionId: text('session_id').notNull(),
  type: text('type').notNull().$type<MemoryType>(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  confidence: real('confidence').notNull().default(1.0),
  sourceTurn: uuid('source_turn').references(() => turns.id, { onDelete: 'set null' }),
  supersedesId: uuid('supersedes_id'),
  active: boolean('active').notNull().default(true),
  embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
  // tsv is a generated column managed by bootstrap.sql; queried via raw SQL only
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Memory = typeof memories.$inferSelect;
