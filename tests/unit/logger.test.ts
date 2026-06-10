import { afterEach, describe, expect, it, vi } from 'vitest';

type LoggerModule = typeof import('../../src/lib/logger');

// Level and color resolve once at module load, so each case re-imports a fresh
// copy of the module with its own env (the one place dynamic import is justified).
async function loadLogger(env: Record<string, string> = {}): Promise<LoggerModule> {
  vi.resetModules();
  vi.stubEnv('NO_COLOR', '1');
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import('../../src/lib/logger');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('createLogger', () => {
  it('emits info and silences debug at the default level', async () => {
    const { createLogger } = await loadLogger();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createLogger('test');

    log.debug('hidden');
    log.info('hello');

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.[0]).toMatch(/^\d{2}:\d{2}:\d{2} INFO {2}\[test\] hello$/);
  });

  it('emits debug when LOG_LEVEL=debug', async () => {
    const { createLogger } = await loadLogger({ LOG_LEVEL: 'debug' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    createLogger('test').debug('visible');

    expect(logSpy.mock.calls[0]?.[0]).toMatch(/DEBUG \[test\] visible$/);
  });

  it('silences warn but keeps error at LOG_LEVEL=error', async () => {
    const { createLogger } = await loadLogger({ LOG_LEVEL: 'error' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createLogger('test');

    log.warn('hidden');
    log.error('boom');

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to info on an unknown LOG_LEVEL', async () => {
    const { createLogger } = await loadLogger({ LOG_LEVEL: 'verbose' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createLogger('test');

    log.debug('hidden');
    log.info('shown');

    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('routes warn through console.warn spied after logger creation', async () => {
    const { createLogger } = await loadLogger();
    const log = createLogger('test');
    // Spy installed AFTER createLogger: the logger must look console.warn up at
    // call time, or test mocks (and vitest's console interception) get bypassed.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const cause = new Error('llm down');
    log.warn('rerank failed:', cause);

    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/WARN {2}\[test\] rerank failed:$/);
    expect(warnSpy.mock.calls[0]?.[1]).toBe(cause);
  });
});
