/**
 * Recall-quality self-eval: ingests fixture scenarios via POST /turns,
 * runs probes against POST /recall, reports "X of Y expected facts found".
 *
 * Usage: npm run eval (service must be running; see README).
 * Env: MEMORY_EVAL_URL (default http://localhost:8080), MEMORY_AUTH_TOKEN.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const BASE_URL = process.env.MEMORY_EVAL_URL ?? 'http://localhost:8080';
const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/scenarios', import.meta.url));

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool', 'system']),
  name: z.string().nullish(),
  content: z.string(),
});

const turnSchema = z.object({
  session_id: z.string().min(1),
  user_id: z.string().nullable(),
  timestamp: z.string(),
  messages: z.array(messageSchema).min(1),
});

const probeSchema = z.object({
  query: z.string().min(1),
  session_id: z.string().min(1),
  user_id: z.string().nullable(),
  max_tokens: z.number().int().positive().default(512),
  expected: z.array(z.array(z.string().min(1))),
  forbidden: z.array(z.string().min(1)).optional(),
  expect_empty: z.boolean().optional(),
});

const scenarioSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  turns: z.array(turnSchema).min(1),
  probes: z.array(probeSchema).min(1),
});

type Scenario = z.infer<typeof scenarioSchema>;
type Probe = z.infer<typeof probeSchema>;

type RecallResponse = {
  context: string;
  citations: ReadonlyArray<{ turn_id: string; score: number; snippet: string }>;
};

type ProbeResult = {
  query: string;
  matchedGroups: number;
  totalGroups: number;
  emptyCheckPassed: boolean | null;
  violations: string[];
};

type ScenarioResult = {
  name: string;
  probes: ProbeResult[];
};

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = process.env.MEMORY_AUTH_TOKEN;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function api(method: string, route: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${BASE_URL}${route}`, {
    method,
    headers: authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res;
}

async function loadScenarios(): Promise<Scenario[]> {
  const files = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith('.json')).sort();
  const scenarios: Scenario[] = [];
  for (const file of files) {
    const raw = await readFile(path.join(FIXTURES_DIR, file), 'utf8');
    scenarios.push(scenarioSchema.parse(JSON.parse(raw)));
  }
  return scenarios;
}

async function cleanupScenario(scenario: Scenario): Promise<void> {
  const userIds = new Set<string>();
  const sessionIds = new Set<string>();
  for (const turn of scenario.turns) {
    if (turn.user_id) userIds.add(turn.user_id);
    sessionIds.add(turn.session_id);
  }
  for (const userId of userIds) {
    const res = await api('DELETE', `/users/${encodeURIComponent(userId)}`);
    if (res.status !== 204) throw new Error(`cleanup DELETE /users/${userId} -> ${res.status}`);
  }
  for (const sessionId of sessionIds) {
    const res = await api('DELETE', `/sessions/${encodeURIComponent(sessionId)}`);
    if (res.status !== 204) throw new Error(`cleanup DELETE /sessions/${sessionId} -> ${res.status}`);
  }
}

async function ingestScenario(scenario: Scenario): Promise<void> {
  for (const turn of scenario.turns) {
    const res = await api('POST', '/turns', { ...turn, metadata: { eval: scenario.name } });
    if (res.status !== 201) {
      throw new Error(`[${scenario.name}] POST /turns -> ${res.status}: ${await res.text()}`);
    }
  }
}

async function runProbe(probe: Probe): Promise<ProbeResult> {
  const res = await api('POST', '/recall', {
    query: probe.query,
    session_id: probe.session_id,
    user_id: probe.user_id,
    max_tokens: probe.max_tokens,
  });
  if (res.status !== 200) {
    throw new Error(`POST /recall -> ${res.status}: ${await res.text()}`);
  }
  const recall = (await res.json()) as RecallResponse;
  const context = recall.context.toLowerCase();

  const matchedGroups = probe.expected.filter((group) =>
    group.some((alt) => context.includes(alt.toLowerCase())),
  ).length;

  const violations = (probe.forbidden ?? []).filter((term) =>
    context.includes(term.toLowerCase()),
  );

  const emptyCheckPassed = probe.expect_empty
    ? recall.context.trim() === '' && recall.citations.length === 0
    : null;

  return {
    query: probe.query,
    matchedGroups,
    totalGroups: probe.expected.length,
    emptyCheckPassed,
    violations,
  };
}

function reportScenario(result: ScenarioResult): void {
  console.log(`\n=== ${result.name} ===`);
  for (const probe of result.probes) {
    const parts: string[] = [];
    if (probe.totalGroups > 0) parts.push(`facts ${probe.matchedGroups}/${probe.totalGroups}`);
    if (probe.emptyCheckPassed !== null) parts.push(`empty ${probe.emptyCheckPassed ? 'PASS' : 'FAIL'}`);
    if (probe.violations.length > 0) parts.push(`VIOLATIONS: ${probe.violations.join(', ')}`);
    const ok =
      probe.matchedGroups === probe.totalGroups &&
      probe.emptyCheckPassed !== false &&
      probe.violations.length === 0;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  "${probe.query}" — ${parts.join('; ')}`);
  }
}

type Totals = {
  matchedGroups: number;
  totalGroups: number;
  emptyPassed: number;
  emptyTotal: number;
  violations: number;
};

function aggregate(results: ScenarioResult[]): Totals {
  const totals: Totals = { matchedGroups: 0, totalGroups: 0, emptyPassed: 0, emptyTotal: 0, violations: 0 };
  for (const scenario of results) {
    for (const probe of scenario.probes) {
      totals.matchedGroups += probe.matchedGroups;
      totals.totalGroups += probe.totalGroups;
      if (probe.emptyCheckPassed !== null) {
        totals.emptyTotal += 1;
        if (probe.emptyCheckPassed) totals.emptyPassed += 1;
      }
      totals.violations += probe.violations.length;
    }
  }
  return totals;
}

async function main(): Promise<void> {
  const health = await api('GET', '/health');
  if (!health.ok) throw new Error(`service not healthy at ${BASE_URL}`);

  const scenarios = await loadScenarios();
  console.log(`Running ${scenarios.length} scenarios against ${BASE_URL}`);

  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    process.stdout.write(`\n[${scenario.name}] cleanup + ingest ${scenario.turns.length} turns...`);
    await cleanupScenario(scenario);
    const startedAt = Date.now();
    await ingestScenario(scenario);
    process.stdout.write(` done in ${Date.now() - startedAt}ms\n`);

    const probeResults: ProbeResult[] = [];
    for (const probe of scenario.probes) probeResults.push(await runProbe(probe));
    results.push({ name: scenario.name, probes: probeResults });
  }

  for (const result of results) reportScenario(result);

  const totals = aggregate(results);
  const recallPct =
    totals.totalGroups === 0 ? 0 : Math.round((totals.matchedGroups / totals.totalGroups) * 100);
  console.log('\n=== TOTALS ===');
  console.log(`  expected facts found: ${totals.matchedGroups}/${totals.totalGroups} (${recallPct}%)`);
  console.log(`  empty-context probes passed: ${totals.emptyPassed}/${totals.emptyTotal}`);
  console.log(`  forbidden-term violations: ${totals.violations}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
