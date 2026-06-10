// JSON happily carries U+0000, but Postgres rejects it in TEXT and JSONB alike —
// a single poisoned character would 500 an otherwise valid request. Stripped
// once at the HTTP boundary (readJson) so no route or query has to care.
export function stripNullChars<T>(value: T): T {
  if (typeof value === 'string') return value.replaceAll('\u0000', '') as T;
  if (Array.isArray(value)) return value.map((entry) => stripNullChars(entry)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [stripNullChars(key), stripNullChars(entry)]),
    ) as T;
  }
  return value;
}
