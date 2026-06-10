# Changelog

One entry per significant design iteration: what changed, why, what was observed, what's next.

## v0 — Project skeleton

**What changed:** Initialized the service skeleton: Hono (Node/TypeScript) HTTP layer with all 7 contract endpoints, Postgres 17 + pgvector via docker compose with a named volume, Drizzle ORM entities (`turns`, `messages`, `memories`), idempotent SQL schema applied at boot, zod validation on all inputs, optional Bearer auth, a smoke-test script mirroring §8 of the assignment.

**Why:** Lock contract compliance first — endpoint shapes, status codes, persistence, and resilience to malformed input are pass/fail gates before any memory quality work. The schema already encodes the core design decisions: memories carry `type/key/value/confidence/source_turn` for provenance, `supersedes_id + active` for fact evolution, and nullable `user_id` to distinguish session-scoped from user-scoped memories (session deletion removes only session-scoped ones).

**Result:** `docker compose up` boots the stack; smoke test passes shape checks. `/turns` persists turns and messages transactionally; `/recall` and `/search` are stubs returning empty results.

**Next:** Extraction pipeline — LLM-based (gpt-4o-mini, structured outputs) fact extraction with a fixed key vocabulary, embeddings via text-embedding-3-small, then the supersession check at ingestion time.
