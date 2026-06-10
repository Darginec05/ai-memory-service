import type { Context } from 'hono';
import type { z } from 'zod';
import { stripNullChars } from './sanitize';

type ParseResult<T> = { ok: true; data: T } | { ok: false; res: Response };

export async function readJson<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
): Promise<ParseResult<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, res: c.json({ error: 'invalid JSON body' }, 400) };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      res: c.json(
        {
          error: 'validation failed',
          details: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        400,
      ),
    };
  }

  return { ok: true, data: stripNullChars(parsed.data) };
}
