CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  user_id text,
  ts timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS turns_session_idx ON turns (session_id);
CREATE INDEX IF NOT EXISTS turns_user_idx ON turns (user_id);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id uuid NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  idx int NOT NULL,
  role text NOT NULL,
  name text,
  content text NOT NULL,
  embedding vector(1536),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

CREATE INDEX IF NOT EXISTS messages_turn_idx ON messages (turn_id);
CREATE INDEX IF NOT EXISTS messages_tsv_idx ON messages USING gin (tsv);
CREATE INDEX IF NOT EXISTS messages_embedding_idx ON messages USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  session_id text NOT NULL,
  type text NOT NULL,
  key text NOT NULL,
  value text NOT NULL,
  confidence real NOT NULL DEFAULT 1.0,
  source_turn uuid REFERENCES turns(id) ON DELETE SET NULL,
  supersedes_id uuid REFERENCES memories(id),
  active boolean NOT NULL DEFAULT true,
  embedding vector(1536),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', key || ' ' || value)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memories_user_active_idx ON memories (user_id, active);
CREATE INDEX IF NOT EXISTS memories_session_idx ON memories (session_id);
CREATE INDEX IF NOT EXISTS memories_tsv_idx ON memories USING gin (tsv);
CREATE INDEX IF NOT EXISTS memories_embedding_idx ON memories USING hnsw (embedding vector_cosine_ops);
