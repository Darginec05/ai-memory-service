import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { config } from './config';
import { createLogger } from './lib/logger';
import { bearerAuth } from './middleware/auth';
import { deletesRoute } from './routes/deletes';
import { health } from './routes/health';
import { memoriesRoute } from './routes/memories';
import { recallRoute } from './routes/recall';
import { searchRoute } from './routes/search';
import { turnsRoute } from './routes/turns';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

const log = createLogger('http');

export function createApp(): Hono {
  const app = new Hono();

  app.use('*', logger());
  app.use('*', bodyLimit({ maxSize: MAX_BODY_BYTES }));
  app.use('*', bearerAuth(config.authToken));

  app.route('/', health);
  app.route('/', turnsRoute);
  app.route('/', recallRoute);
  app.route('/', searchRoute);
  app.route('/', memoriesRoute);
  app.route('/', deletesRoute);

  app.notFound((c) => c.json({ error: 'not found' }, 404));

  app.onError((err, c) => {
    // Framework-raised HTTP errors (e.g. bodyLimit's 413) keep their status —
    // collapsing them to 500 would misreport client errors as server faults.
    if (err instanceof HTTPException) return err.getResponse();
    log.error(`${c.req.method} ${c.req.path}:`, err);
    return c.json({ error: 'internal error' }, 500);
  });

  return app;
}
