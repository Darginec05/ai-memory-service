# Memory Service — project guide

The full task specification lives at @docs/memory-service-requirements.md — read it before making design decisions. The HTTP contract (§3), hard problems (§4), and hard constraints (§5) are the source of truth.

## Changelog discipline

Every significant feature, change, or addition must get an entry in `CHANGELOG.md` — it is the most important deliverable of this project. Write the entry **as part of the same change**, not retroactively. Format: what changed, why, observed result (with metrics from the fixture self-eval when available), and what's next.

## When you're stuck

1. Re-read the relevant spec section. Most architectural decisions are already there.
2. Check existing code in the relevant app — patterns are deliberate.
3. If genuinely undefined, ask a specific question. We'd rather answer than re-architect later.

---

## Code style — non-negotiable principles

When writing code, follow:

- **SOLID.** Single responsibility per class/module; depend on abstractions, not concretions; keep interfaces small and focused.
- **KISS.** Pick the boring solution. A `for` loop is not a sin. Avoid clever generics, premature abstractions, and speculative branches that aren't on a real roadmap.
- **DRY.** Extract when the same *idea* repeats in ≥2 places. Do not extract two-line snippets that merely look alike — accidental similarity is not duplication.
- **TypeScript best practices:**
  - `strict` mode and `noUncheckedIndexedAccess` are globally on. Don't disable them.
  - No `any`. If you truly need an escape, use `unknown` and narrow.
  - `type` for data shapes, `interface` for extendable contracts.
  - `as const` for literal lookup tables; never magic strings.
  - Discriminated unions over boolean-flag soup.
  - No `enum`. Use `as const` objects with `keyof typeof` (`const enum` is banned by `isolatedModules`).
  - Explicit return types on every exported function.
  - Top-level imports only — no dynamic `require`.
  - All async code returns `Promise<T>` with `T` named explicitly on exports.
  - No inline type annotations for object shapes — extract them into a named `type` declared above the usage.
