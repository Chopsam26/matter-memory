-- Matter Memory schema.
--
-- Applied automatically by docker-entrypoint-initdb.d on the first start of a
-- fresh volume. If you change this file, run `npm run db:reset` - Postgres will
-- NOT re-run init scripts against an existing data directory.

CREATE EXTENSION IF NOT EXISTS vector;

-- A client engagement.
CREATE TABLE matters (
  id          SERIAL PRIMARY KEY,
  client_name TEXT NOT NULL,
  title       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No real auth by design. The role dropdown in the UI sends a user id, and the
-- server reads the role from here - the client never sends a role string.
CREATE TABLE users (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('attorney', 'paralegal'))
);

-- sensitivity lives HERE and nowhere else. It is the access-control decision,
-- so it gets exactly one home; see the note above chunks.
CREATE TABLE documents (
  id              SERIAL PRIMARY KEY,
  matter_id       INT  NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  doc_type        TEXT NOT NULL,
  sensitivity     TEXT NOT NULL DEFAULT 'standard'
                    CHECK (sensitivity IN ('standard', 'restricted')),
  source_filename TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deliberately does NOT carry matter_id or sensitivity.
--
-- Copying them here would let the retrieval query skip a join, but it would put
-- the access-control value in two places that can disagree. Flip a document to
-- 'restricted' and stale chunk rows would keep saying 'standard', and the
-- filter would keep serving them - silently. One row, one source of truth,
-- joined at query time.
CREATE TABLE chunks (
  id          SERIAL PRIMARY KEY,
  document_id INT  NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section     TEXT,                     -- e.g. 'ARTICLE III - Distribution'
  ordinal     INT  NOT NULL,            -- position within its document
  content     TEXT NOT NULL,
  embedding   vector(768) NOT NULL,     -- nomic-embed-text
  UNIQUE (document_id, ordinal)
);

CREATE INDEX idx_documents_matter ON documents (matter_id, sensitivity);
CREATE INDEX idx_chunks_document  ON chunks (document_id);

-- No approximate-nearest-neighbour index, on purpose.
--
-- HNSW searches approximately: it walks a graph to pick roughly the k nearest
-- vectors, and only THEN does Postgres apply the WHERE clause to what came
-- back. With a selective filter (one matter, one sensitivity tier) most of
-- those candidates get discarded after the fact, so you can receive far fewer
-- rows than you asked for - sometimes none - while plenty of matching chunks
-- exist.
--
-- That is a recall problem, never a security one. The filter still runs; a
-- restricted chunk cannot come back through this path. The worst case is a thin
-- answer, not a leak.
--
-- At demo scale (8 documents, a few hundred chunks) an exact sequential scan is
-- sub-10ms and has perfect recall, and the planner picks it unprompted. Enable
-- the index once the corpus outgrows that - and enable iterative scan with it,
-- which makes the index keep searching until it has filled the LIMIT after
-- filtering:
--
--   CREATE INDEX idx_chunks_embedding ON chunks
--     USING hnsw (embedding vector_cosine_ops);
--   SET hnsw.iterative_scan = relaxed_order;   -- pgvector 0.8+
