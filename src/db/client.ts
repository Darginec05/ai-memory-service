import { readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config';
import * as schema from './schema';

export const pg = postgres(config.databaseUrl, {
  max: 10,
  onnotice: () => {},
});

export const db = drizzle(pg, { schema });

export async function applySchema(): Promise<void> {
  const ddl = await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8');
  await pg.unsafe(ddl);
}

export async function closeDb(): Promise<void> {
  await pg.end({ timeout: 5 });
}
