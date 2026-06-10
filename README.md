# Memory Service

A memory service for an AI agent: ingests conversation turns, extracts structured
knowledge with an LLM, and answers recall queries that decide what context the agent
sees on its next turn.

## Quick start

```bash
cp .env.example .env        # set OPENAI_API_KEY
docker compose up -d
until curl -sf http://localhost:8080/health; do sleep 1; done
./scripts/smoke.sh          # optional: the smoke test from the task spec
```

The service listens on **:8080**. Auth is optional: if `MEMORY_AUTH_TOKEN` is set,
every endpoint except `/health` requires `Authorization: Bearer <token>`; if unset,
the header is ignored.

## 1. Architecture

```
                 ┌─────────────────────────────────────────────────┐
                 │               api — Hono on Node 22             │
                 │                                                 │
 POST /turns ───▶│  ExtractionService (synchronous, before 201)    │
                 │    1. candidate extraction      (gpt-4o-mini)   │
                 │    2. related-memory lookup     (pgvector)      │
                 │    3. reconciliation            (gpt-4o-mini)   │
                 │       add / reinforce / supersede / merge       │
                 │    4. transactional write                       │
                 │                                                 │
 POST /recall ──▶│  RecallService                                  │
                 │    query rewrite (LLM) ─▶ hybrid retrieval per  │
                 │    variant ─▶ RRF fuse ─▶ LLM rerank ─▶         │
                 │    budgeted context assembly                    │
                 │                                                 │
 POST /search ──▶│  RetrievalService (LLM-free)                    │
                 │    vector + FTS over memories and messages,     │
                 │    fused with reciprocal rank fusion            │
                 └─────────────────────┬───────────────────────────┘
                                       │
                 ┌─────────────────────▼───────────────────────────┐
                 │       Postgres 16 + pgvector (named volume)     │
                 │  turns ── messages (raw log, embedded + FTS)    │
                 │        └─ memories (structured, supersession    │
                 │           chain, embedded + FTS)                │
                 │  HNSW cosine indexes · GIN tsvector indexes     │
                 └─────────────────────────────────────────────────┘
```

A single API container in front of a single Postgres. Internally the code is small
class services with manual constructor injection (`src/services/*`): each service
declares its dependencies (the LLM gateway, the SQL client) as constructor
parameters and a composition root at the bottom of its `index.ts` wires the
production instances. That seam is exactly what the unit tests script against — no
mocking framework, just a scripted `LlmGateway`.

Two storage planes, deliberately separate:

- **`turns` + `messages`** — the verbatim conversation log. Never mutated; the
  ground truth that extraction can be re-run against, and the source of
  conversational snippets in recall.
- **`memories`** — structured knowledge distilled from turns: `type`
  (fact / preference / opinion / event), normalized `key` (`pet.dog.name`),
  human-readable `value`, `confidence`, provenance (`source_turn`, `session_id`),
  and the evolution chain (`supersedes_id`, `active`).

`POST /turns` is fully synchronous: persist → extract → reconcile → write, all
before the 201. The eval harness allows 60 s per turn; a typical turn takes a few
seconds of LLM time, and in exchange there is no queue, no eventual consistency,
and no race between `/turns` returning and `/recall` seeing the data.

## 2. Backing store: Postgres 16 + pgvector

One store covers every access pattern the service needs:

- **Vector search** — pgvector with HNSW cosine indexes on both `memories` and
  `messages`.
- **Keyword search** — native full-text search via generated `tsvector` columns
  with GIN indexes. The `simple` configuration is used (no language stemming)
  because content arrives in any language — Russian fixture data tokenizes just as
  well as English.
- **Relational integrity** — the supersession chain is a self-referencing foreign
  key; deleting a session or user is plain SQL; turn writes are transactions.
- **Persistence** — one named Docker volume (`memory_data`), nothing else to back
  up or replay.

The alternative — a dedicated vector DB (Qdrant, etc.) next to a relational store —
buys nothing at this scale and costs a second system, cross-store consistency, and
a harder restart story. Hybrid retrieval needs exact keyword matching anyway, and
Postgres FTS + pgvector in one engine means one query path, one transaction
boundary, one volume.

## 3. Extraction pipeline

Extraction runs on every `POST /turns`, in three stages
(`src/services/extraction/`):

**Stage 1 — candidate extraction** (`candidate-extractor.ts`). The turn's messages
plus up to 12 recent messages from the same session (for coreference: "she", "the
new job") go to `gpt-4o-mini` (temperature 0, structured outputs). It returns typed
candidates: `{type, key, value, confidence}`. The prompt targets personal facts,
preferences, opinions, events, **implicit facts** ("walking Biscuit this morning" →
the user has a pet named Biscuit) and **corrections** ("actually, not the 3rd — the
8th" yields only the corrected value). Keys are normalized to dotted lowercase
(`location.city`); candidates below 0.5 confidence are dropped.

**Stage 2 — related-memory lookup** (`related-finder.ts`). Each candidate is
embedded (`text-embedding-3-small`, one batched call shared with message
embeddings) and searched against the user's existing active memories by vector
similarity and key match. This is deterministic SQL — the LLM never sees the whole
memory store, only plausible neighbors.

**Stage 3 — reconciliation** (`reconciler.ts`). If a candidate has no neighbors it
is inserted directly — no LLM call, no possible conflict. Otherwise a second
`gpt-4o-mini` call sees candidates + neighbors and decides per candidate:

| decision    | effect                                                                 |
|-------------|------------------------------------------------------------------------|
| `add`       | new row                                                                |
| `reinforce` | same fact restated — bump `confidence`/`updated_at`, no new row        |
| `supersede` | contradicts an existing fact — old row `active=false`, new row points at it via `supersedes_id` |
| `merge`     | refines an existing fact — like supersede, but the value is an LLM-composed synthesis of old + new |

Every degradation in this stage falls toward **add**: invalid target id, missing
decision, duplicate index — knowledge is never silently dropped (see
`reconciler.ts` for the exact rules; they're unit-tested one by one).

All writes — message embeddings and memory ops — happen in a single transaction
(`memory-writer.ts`), so a crash mid-write leaves no partial state.

**What it misses, knowingly:** facts stated only by the assistant and never
confirmed by the user (low trust), and knowledge spread across more turns than the
12-message coreference window. Both are prompt/window tuning levers, not
architecture changes.

## 4. Recall strategy

`POST /recall` is a five-stage pipeline (`src/services/recall/`), built around one
asymmetry: the retrieval stage trades precision for recall, and the rerank stage
buys precision back.

1. **Query rewriting** (`query-rewriter.ts`). `gpt-4o-mini` turns the question into
   up to 3 declarative third-person English variants ("Where does this user live?" →
   "The user lives in a city"). Memories are stored as declarative statements, so
   declarative queries embed closer to them than interrogatives do. The original
   query is always searched too — rewriting widens the net, never replaces it.

2. **Hybrid retrieval per variant** (`src/services/retrieval/`). Four branches —
   FTS over memories, FTS over messages, vector over memories, vector over
   messages — each top-30, fused with reciprocal rank fusion. RRF is fused by
   rank, not score, because FTS rank and cosine distance are incomparable scales.
   The vector cutoff is 0.73, looser than `/search`'s 0.6, and calibrated on the
   fixture corpus: obliquely relevant facts ("opening their own bakery" vs the
   query "what's their job") measure 0.63–0.71 cosine distance, while the nearest
   fully irrelevant memory across noise probes starts at ~0.746 — 0.73 sits inside
   that gap.

3. **RRF across variants.** Each query variant produced its own ranking; they are
   fused again by rank. A memory that several differently-phrased queries agree on
   outranks one that a single phrasing happened to hit.

4. **LLM rerank** (`reranker.ts`). `gpt-4o-mini` sees the original question and the
   fused candidates and returns the indexes worth keeping, in order. This is the
   precision stage: it drops the noise the loose cutoff admitted and drops raw
   snippets whose content is already covered by a structured fact. Returning an
   empty `keep` is valid — that is exactly how noise queries produce
   `{"context": "", "citations": []}` instead of hallucinated relevance.

5. **Budgeted assembly** (`context-assembler.ts`) — see below.

`/search` deliberately skips stages 1 and 4: it is an agent *tool call*, so it
should be fast, deterministic, and LLM-free — just hybrid retrieval at the stricter
0.6 cutoff, returning structured results with scores.

### Context assembly and priority under budget

When the token budget is tight, triage order is:

1. **Stable user facts** (`## Known facts about this user`) — a fact distilled from
   N turns is denser per token than any single turn, and stays true across
   sessions. Superseded history rides along inline: `works at Notion (fact,
   updated 2026-01-02; previously: works at Stripe)`.
2. **Query-relevant conversation snippets** (`## Relevant from recent
   conversations`) — dated, role-tagged, capped at 200 chars each, in rerank
   order, only with whatever budget the facts left.

Two guards in the assembler:

- **Same-turn suppression.** If a kept fact came from turn T, raw snippets from T
  are skipped — they add no information and can leak pre-correction values the
  user explicitly retracted. Computed over *all* kept facts, not just
  budget-admitted ones, so a tight budget can never swap a clean fact out for its
  rawer source message.
- **Script-aware token estimation.** ASCII ≈ 4 chars/token, non-ASCII ≈ 2 — a flat
  divisor of 4 would overshoot the budget ~2× on Russian or CJK text. Lines that
  don't fit are skipped, never truncated mid-sentence.

Cold sessions and unknown topics return `200 {"context": "", "citations": []}` —
never an error, never invented memories.

## 5. Fact evolution

"I work at Stripe" (session 1) → "I just started at Notion" (session 3):

1. Extraction in session 3 yields candidate `employment.employer = Notion`.
2. The related-finder surfaces the active Stripe memory as a neighbor.
3. The reconciler returns `supersede`.
4. The writer flips Stripe to `active = false` and inserts Notion with
   `supersedes_id` → the Stripe row. Nothing is deleted.

`/recall` searches only active memories, so the current fact wins; the assembler
renders the predecessor inline ("…; previously: works at Stripe"). The full chain —
both rows, the link, timestamps — is inspectable via `GET /users/{id}/memories`.

**Opinion arcs** ("I love TypeScript" → "TS generics are getting annoying" → "fine
for big projects, Python for scripts") are not flat contradictions, and that is
what `merge` exists for: the reconciler composes a synthesized value capturing the
trajectory ("likes TypeScript for large projects but finds generics frustrating;
prefers Python for scripts") that supersedes the previous opinion row. The chain of
superseded rows *is* the arc, walkable through `supersedes_id`. Handling is
partial by design: each merge keeps only its immediate predecessor's text in the
new value, so a long arc compresses — the full nuance lives in the chain, not the
head row. Scenario `03-opinion-arc.json` in the fixture exercises exactly this.

## 6. Tradeoffs

**Optimized for:** recall quality and synchronous correctness. Costs accepted:
LLM latency on the write path (a few seconds per turn, well inside the 60 s
budget) and two LLM calls on the read path (~1–2 s per `/recall`).

**Quality over latency on /recall.** Rewrite + rerank are the difference between
vanilla cosine-top-k and a pipeline that survives interrogative/declarative
mismatch and noise queries (self-eval went 88% → 100% when they landed — see
CHANGELOG v4). If p99 mattered more, both stages degrade independently and could
be feature-flagged off.

**A deliberately rejected idea: the entity-mismatch rerank rule.** A test showed
that asking about "Java" for a user who only discussed TypeScript returned
related-but-not-matching context instead of nothing. The obvious fix — make the
reranker drop everything when the question names an entity absent from all
candidates — was rejected:

1. *Risk asymmetry.* Earlier eval runs taught that an extra candidate is cheap
   (the consuming LLM ignores it), but a wrongly dropped one is unrecoverable.
   The rule pushes the reranker toward aggressive drops on its worst-calibrated
   judgment, entity identity.
2. *Entity ≠ string.* "Жужа" and "Zhuzha" are one cat; "the employer" and
   "Notion" are one entity. A string-level rule misfires on transliteration and
   coreference exactly where this service must not.
3. *Multi-hop adjacency.* Multi-hop questions legitimately retrieve memories that
   don't name the question's entity ("what city does the user with the dog named
   Biscuit live in?" needs a location fact with no dog in it).
4. The current behavior is honest related context with citations — not
   hallucination. The agent's LLM can see the context doesn't answer the question.

**Cross-session sharing is intentional.** When `user_id` is present, scope is the
user across all sessions — that is what makes memory useful on session 2. When
`user_id` is null, everything is scoped to the single `session_id` and dies with
it. The two scopes never mix: scoping lives in one module (`retrieval/scope.ts`)
shared by the vector and FTS branches so they cannot drift apart, and the
concurrency contract tests assert no bleed in both directions.

**Known limitations:** superseded neighbors may briefly survive if extraction
phrasing jitters (same fact, different key — the related-finder may miss it);
within-conversation recency uses ingestion order, not message timestamps; opinion
arcs compress as described above.

## 7. Failure modes

| failure | behavior |
|---|---|
| Cold session / unknown topic | `200 {"context": "", "citations": []}` |
| `OPENAI_API_KEY` missing or OpenAI down during `/turns` | turn and messages are persisted, extraction is skipped with a warning, still `201` — raw log is never lost, memories for that turn are simply absent |
| Query embedding fails during `/recall` or `/search` | FTS-only retrieval (exact-token match still answers many queries) |
| Query rewrite fails | raw query only |
| Rerank fails | fused RRF order passes through unranked |
| Reconciler returns an invalid target | degrades to `add` — knowledge is never dropped |
| Oversized payload (> 2 MB) | `413` |
| Malformed JSON / schema violation | `400` with field-level details |
| `U+0000` in strings (legal JSON, fatal to Postgres TEXT/JSONB) | stripped once at the HTTP boundary |
| Restart mid-write | each turn's writes are one transaction — either fully visible or absent; `restart: unless-stopped` brings the container back |
| Slow/unavailable DB at boot | compose healthcheck gates the API on Postgres readiness; schema bootstrap is idempotent |

## 8. Running the tests

```bash
npm install                  # once, for the test runner

npm run test:unit            # 50 tests, no service or API key needed
docker compose up -d         # the next three need the running stack
npm run test:contract        # 19 black-box HTTP tests (needs OPENAI_API_KEY in .env)
npm test                     # unit + contract
npm run test:persistence     # ingests, then full `compose down`/`up`, then recalls
npm run eval                 # recall-quality fixture (see below)
```

- **Unit tests** (`tests/unit/`) cover the pure logic — RRF math, token
  estimation, budget admission, supersession rendering, reconciler degradation
  rules — with a scripted `LlmGateway`, no network.
- **Contract tests** (`tests/contract/`) import nothing from `src/` — they speak
  to the service over HTTP only, the same surface the eval harness sees: contract
  roundtrip, structured-memories inspection, malformed input, unicode abuse,
  oversized payloads, cross-session/cross-user isolation with positive controls.
- **Persistence test** (`tests/persistence/`) requires the service to be running
  *via docker compose* (it shells out to `docker compose down && up` — a full
  restart against the named volume, not a soft `restart`).
- **Recall-quality fixture** (`fixtures/scenarios/` + `npm run eval`): five
  scripted multi-session conversations — multi-hop, fact evolution, opinion arc,
  corrections + unicode, noise + scoping — with probe queries asserting expected
  facts, forbidden strings, and expect-empty checks. It reports "X of Y expected
  fact groups found". It lives in `scripts/`, not `tests/`, on purpose: it calls
  live LLMs, so it is the iteration loop (run after every pipeline change — see
  CHANGELOG metrics), while CI-style tests stay deterministic. Current result:
  16/16 probes, 3/3 expect-empty, 0 forbidden-string violations.

## Models used

- `gpt-4o-mini` (temperature 0, structured outputs) — extraction, reconciliation,
  query rewriting, reranking. Chosen for the latency/cost/quality balance: every
  call is a narrow classification or rewriting task over short prompts, where it
  performs indistinguishably from larger models at a fraction of the latency.
- `text-embedding-3-small` (1536 dims) — memory, message, and query embeddings.

Swapping providers means implementing the one-interface `LlmGateway`
(`completeStructured` + `embedTexts`).
