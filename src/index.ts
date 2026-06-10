import { serve } from '@hono/node-server';
import { createApp } from './app';
import { config } from './config';
import { applySchema, closeDb } from './db/client';

async function main() {
  await applySchema();
  console.log('[boot] schema applied');

  const app = createApp();
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`[boot] memory-service listening on :${info.port}`);
  });

  const shutdown = async () => {
    console.log('[shutdown] closing');
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[boot] fatal:', err);
  process.exit(1);
});
