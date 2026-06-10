import { integer, pgTable, text, uuid, vector } from 'drizzle-orm/pg-core';
import type { MessageId, TurnId } from '../../lib/ids';
import { turns } from './turns';

export const EMBEDDING_DIMENSIONS = 1536;

export const MESSAGE_ROLES = ['user', 'assistant', 'tool', 'system'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom().$type<MessageId>(),
  turnId: uuid('turn_id')
    .notNull()
    .references(() => turns.id, { onDelete: 'cascade' })
    .$type<TurnId>(),
  idx: integer('idx').notNull(),
  role: text('role').notNull().$type<MessageRole>(),
  name: text('name'),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
  // tsv is a generated column managed by bootstrap.sql; queried via raw SQL only
});

export type Message = typeof messages.$inferSelect;
