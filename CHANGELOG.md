# Changelog

One entry per significant design iteration: what changed, why, what was observed, what's next.

## v3 — Hybrid retrieval core (pgvector + FTS + RRF) behind /search and interim /recall

**What changed:** New `src/services/retrieval/` (same class-service pattern): `VectorSearcher` (cosine over memories + messages, distance cutoff 0.6), `FtsSearcher` (`websearch_to_tsquery` over generated `tsv` columns), `rrfFuse` (reciprocal rank fusion, k=60, pure function), `RetrievalService` orchestrating 4 parallel branches (2 corpora × 2 methods, top-30 each). `/search` returns fused structured results (memories carry type/key/confidence in metadata, messages carry role/turn). `/recall` got an interim assembly: facts section first, then conversation snippets, under a `max_tokens × 4` char budget. Also: `tsv` columns migrated from the `'english'` FTS config to `'simple'` (language-neutral tokenization; queries arrive in Russian/Japanese too) with an idempotent in-bootstrap migration for existing volumes.

**Why:** Rank-based fusion (RRF) avoids calibrating cosine distance against `ts_rank` — incomparable scales are the reason weighted-sum hybrids are fragile. The vector distance cutoff exists because "nearest of nothing relevant" is exactly how hallucinated recall happens on noise queries. Two corpora because a fact may fail extraction yet live in raw messages. Found en route: drizzle's postgres-js adapter disables the client's native timestamp parsers, so raw-SQL rows return timestamptz as strings — centralized row mapping with date normalization in `row-mappers.ts`.

**Result:** Self-eval: **0% → 88% (14/16 fact groups)**, empty-context probes 3/3, 1 forbidden-term violation. Failure analysis: (1) `websearch_to_tsquery` ANDs every token and `'simple'` keeps stopwords, so the FTS branch returns nothing for natural-language questions — it only fires on keyword-style queries (its actual job: names like "Жужа", "Maren"); (2) cross-lingual gap — Russian query vs English-valued memory lands above the 0.6 distance cutoff ("Какие хобби?" → empty context despite `hobby.calligraphy` existing); (3) the correction violation: memories store only the corrected date, but a raw message snippet quoted in context carries both the wrong and corrected date.

**Next:** Real `/recall` pipeline: LLM query rewriting (declarative, English-normalized, decomposed for multi-hop) feeding the same hybrid core, LLM rerank that also drops raw snippets already covered by facts, supersession-aware rendering ("previously …"). All three observed failures should fall out of rewriting + rerank without touching the noise-guarding distance cutoff.

## v2.1 — Extraction split into injectable class services

**What changed:** `src/services/extraction/index.ts` (~340 lines, five responsibilities) split into class services with constructor-injected dependencies: `CandidateExtractor` (session context + LLM extraction), `RelatedMemoryFinder` (key ∪ cosine lookup), `Reconciler` (add/reinforce/supersede/merge decisions), `MemoryWriter` (transactional apply), orchestrated by `ExtractionService`; shared types and the `LlmGateway` interface live in `types.ts`. No DI framework — dependencies are wired explicitly in a composition root at the bottom of `index.ts`.

**Why:** The monolith violated single-responsibility and made the upcoming unit tests awkward — reconciliation edge cases (invalid target degrades to add, undecided candidates still added) need a fake `LlmGateway`, which requires injection seams. Manual constructor injection gives the seams without framework machinery.

**Result:** Behavior unchanged (typecheck clean; live turn produced the same structured memory as before the refactor). Retrieval services will follow the same pattern.

**Next:** Hybrid retrieval core.

## v2 — Recall-quality fixture and self-eval baseline

**What changed:** Added `fixtures/scenarios/` (5 scripted scenarios: multi-hop joins, fact evolution across sessions, gradual opinion arc, Russian/Japanese/emoji with a mid-message correction, noise + session-scoping) and `scripts/eval.ts` (`npm run eval`): cleans up, ingests via `/turns`, probes `/recall`, scores "expected fact groups found" (substring alternatives), empty-context checks for noise probes, and forbidden-term violations (hallucination/leak detection).

**Why:** The fixture is the iteration loop — every retrieval change from here on gets a before/after number instead of vibes. Scenarios deliberately avoid the task doc's example domains (Berlin/Stripe/Biscuit) to keep us honest about generalization; probes are graded on alternatives ("bakery"/"baker") so phrasing variance doesn't masquerade as recall failure.

**Result:** Baseline with stub `/recall`: **0/16 fact groups (0%)**, empty-context probes 3/3 (trivially — stub always returns empty), 0 violations. Ingestion side validated on all 5 scenarios (~3.9–13.7s per scenario): supersession chains formed correctly on the fixture (Oslo→Bergen, line chef→quit), unicode and tool messages ingested cleanly. Observed extraction gaps to revisit: facts *adjacent* to a superseded one stay active ("5 years as a line chef", "Oslo rent is burdensome" survive the job change and the move) — reconciliation only considers memories related to a new candidate, so stale neighbors are untouched.

**Next:** Hybrid retrieval core (pgvector cosine + Postgres FTS + RRF) wired into `/search`, then `/recall` with query decomposition for multi-hop, rerank, and budgeted context assembly. Re-run eval after each step.

## v1 — LLM extraction with two-phase reconciliation

**What changed:** `/turns` now runs a synchronous extraction pipeline: (1) gpt-4o-mini extracts typed memory candidates (strict JSON schema, temp 0) using the last 12 session messages as coreference context; (2) candidates and messages are embedded in one batch (text-embedding-3-small); (3) for each candidate, related active memories are fetched by `key match ∪ cosine distance < 0.55`; (4) a second LLM call reconciles conflicts into explicit operations: `add` / `reinforce` / `supersede` / `merge` (merge synthesizes opinion arcs); (5) everything is applied in one transaction before 201 is returned.

**Why:** Extraction and conflict resolution are separate concerns — a single mega-prompt did both tasks worse and required shipping the whole memory store into every call. The reconciliation step is skipped entirely when a candidate has no related memories, which is the common case for fresh users. Keys are an open vocabulary (LLM mints dot-notation keys freely) to avoid overfitting to anticipated domains; the embedding-similarity fallback makes supersession robust to key instability.

**Result:** Live test (fitness domain, two sessions): implicit fact captured ("coach Dina says…" → "User's coach is named Dina"), cross-session contradiction detected and superseded with history preserved, unrelated new fact added cleanly. Notably, the LLM produced *different keys* for the same topics across sessions (`health.knee_issue` vs `health.knee`) — supersession still worked via the embedding fallback, validating the hybrid design. Latency: 3.2–5.1s per turn against a 60s budget. Failure modes verified: no API key → turn persisted, extraction skipped with a warning, 201 returned.

**Next:** Recall is still a stub. Build the self-eval fixture first (diverse domains, multi-hop, noise probes, corrections, unicode), then the hybrid retrieval core (pgvector + FTS + RRF) behind `/search` and `/recall`.

## v0 — Project skeleton

**What changed:** Initialized the service skeleton: Hono (Node/TypeScript) HTTP layer with all 7 contract endpoints, Postgres 17 + pgvector via docker compose with a named volume, Drizzle ORM entities (`turns`, `messages`, `memories`), idempotent SQL schema applied at boot, zod validation on all inputs, optional Bearer auth, a smoke-test script mirroring §8 of the assignment.

**Why:** Lock contract compliance first — endpoint shapes, status codes, persistence, and resilience to malformed input are pass/fail gates before any memory quality work. The schema already encodes the core design decisions: memories carry `type/key/value/confidence/source_turn` for provenance, `supersedes_id + active` for fact evolution, and nullable `user_id` to distinguish session-scoped from user-scoped memories (session deletion removes only session-scoped ones).

**Result:** `docker compose up` boots the stack; smoke test passes shape checks. `/turns` persists turns and messages transactionally; `/recall` and `/search` are stubs returning empty results.

**Next:** Extraction pipeline — LLM-based (gpt-4o-mini, structured outputs) fact extraction with a fixed key vocabulary, embeddings via text-embedding-3-small, then the supersession check at ingestion time.
