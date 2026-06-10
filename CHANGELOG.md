# Changelog

One entry per significant design iteration: what changed, why, what was observed, what's next.

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
