const LEVEL_RANK = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export type LogLevel = keyof typeof LEVEL_RANK;

type LogFn = (message: string, ...data: unknown[]) => void;

export type Logger = Readonly<Record<LogLevel, LogFn>>;

// Console method is looked up at call time (console[...]), never captured into a
// variable — test spies installed on console.warn/error after module load must
// still intercept logger output.
const CONSOLE_METHOD = { debug: 'log', info: 'log', warn: 'warn', error: 'error' } as const;

const ANSI = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  cyan: '\u001b[36m',
  gray: '\u001b[90m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
} as const;

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: ANSI.gray,
  info: ANSI.green,
  warn: ANSI.yellow,
  error: ANSI.red,
};

function isLogLevel(value: string): value is LogLevel {
  return value in LEVEL_RANK;
}

function resolveLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? '').toLowerCase();
  return isLogLevel(raw) ? raw : 'info';
}

// Precedence per https://no-color.org: NO_COLOR wins, then FORCE_COLOR (docker
// logs are not a TTY but render ANSI fine), then TTY detection.
function resolveColor(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return true;
  return process.stdout.isTTY === true;
}

const activeRank = LEVEL_RANK[resolveLevel()];
const colorize = resolveColor();

const noop: LogFn = () => {};

export function createLogger(namespace: string): Logger {
  const make = (level: LogLevel): LogFn => {
    if (LEVEL_RANK[level] < activeRank) return noop;
    const label = level.toUpperCase().padEnd(5);
    const prefix = colorize
      ? `${LEVEL_COLOR[level]}${label}${ANSI.reset} ${ANSI.cyan}[${namespace}]${ANSI.reset}`
      : `${label} [${namespace}]`;
    return (message, ...data) => {
      const time = new Date().toISOString().slice(11, 19);
      const stamp = colorize ? `${ANSI.dim}${time}${ANSI.reset}` : time;
      console[CONSOLE_METHOD[level]](`${stamp} ${prefix} ${message}`, ...data);
    };
  };
  return { debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error') };
}
