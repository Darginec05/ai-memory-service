#!/usr/bin/env bash
# Smoke test from §8 of the task — verifies contract shapes against a running service.
set -euo pipefail

BASE="${BASE:-http://localhost:8080}"

echo "== GET /health"
curl -sf "$BASE/health"
echo

echo "== POST /turns"
curl -sf -X POST "$BASE/turns" \
  -H 'Content-Type: application/json' \
  -d '{
    "session_id": "smoke-1",
    "user_id": "user-1",
    "messages": [
      {"role": "user", "content": "I just moved to Berlin from NYC last month. Loving it so far."},
      {"role": "assistant", "content": "That sounds exciting! Berlin is a great city. How are you settling in?"}
    ],
    "timestamp": "2025-03-15T10:30:00Z",
    "metadata": {}
  }'
echo

echo "== POST /recall"
curl -sf -X POST "$BASE/recall" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "Where does this user live?",
    "session_id": "smoke-2",
    "user_id": "user-1",
    "max_tokens": 512
  }'
echo

echo "== POST /search"
curl -sf -X POST "$BASE/search" \
  -H 'Content-Type: application/json' \
  -d '{"query": "Berlin", "user_id": "user-1", "limit": 5}'
echo

echo "== GET /users/user-1/memories"
curl -sf "$BASE/users/user-1/memories"
echo

echo "== malformed JSON -> expect 400"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/turns" \
  -H 'Content-Type: application/json' -d '{not json')
echo "status: $code"
[ "$code" = "400" ]

echo "== DELETE /sessions/smoke-1 -> expect 204"
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/sessions/smoke-1")
echo "status: $code"
[ "$code" = "204" ]

echo "== DELETE /users/user-1 -> expect 204"
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/users/user-1")
echo "status: $code"
[ "$code" = "204" ]

echo
echo "smoke OK"
