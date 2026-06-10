import { serve } from '@hono/node-server';
import { createApp } from './app';
import { config } from './config';
import { applySchema, closeDb } from './db/client';
import { createLogger } from './lib/logger';

const log = createLogger('boot');

async function main() {
  await applySchema();
  log.info('schema applied');

  const app = createApp();
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    log.info(`memory-service listening on :${info.port}`);
  });

  const shutdown = async () => {
    log.info('shutting down');
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log.error('fatal:', err);
  process.exit(1);
});
