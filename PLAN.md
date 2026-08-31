# Matter Memory — Build Plan

## Context

Matter Memory is a demo of permission-aware RAG over a small estate planning firm's
client documents. A user picks their identity, selects a client matter, asks a plain
English question, and gets an answer with citations back to the source document and
section.

The property being demonstrated is narrow and specific: **access control is enforced in
the SQL vector search, not in the prompt.** Restricted chunks are excluded by a `WHERE`
clause that runs before similarity ranking, so they are never retrieved, never
serialized into the generation prompt, and never reach the model at all. This is
different in kind from telling a model "do not reveal X" — the model cannot reveal what
it was never given.

Everything else in the project exists to make that one property visible and credible.

The repo is currently empty apart from `CLAUDE.md` and `.gitignore`.

> **Status: all steps complete.** Verify with `npm run db:up && npm run seed`, then
> `npm run check:permissions` (16/16), `npm run eval`, and `npm run dev`.
> Deviations from this plan, and the reasons for them, are recorded in the commit
> for each step.

---

## Environment findings

Verified on this machine before planning:

| Tool | Status |
|---|---|
| Node | v20.17.0 |
| npm | 10.8.2 |
| Docker / Compose | 27.3.1 / v2.30.3 |
| Ollama | 0.11.4, running natively on the host |
| `qwen2.5:7b` | pulled |
| `nomic-embed-text` | pulled |
| Homebrew Postgres 14 | installed locally |

Two consequences:

1. **Port 5432 is likely taken** by the Homebrew Postgres. The container maps host
   **5433** → container 5432 to avoid the collision.
2. **Ollama runs on the host, not in Compose.** Nothing in the Compose file needs to
   reach it; Node talks to `http://127.0.0.1:11434` directly. Only Postgres is
   containerized.

### Decisions confirmed

- Sensitivity stays **document-level**, as specified. The seed set is designed so the
  restricted material is its own plausible document. See *Future work* for the
  chunk-level version and why it is deferred.
- The query API **looks the role up server-side** from `users` by `user_id`. The client
  never sends a role string.
- Approved dependencies: `pg`, `@types/pg`, `pdf-parse`, `tsx` (dev), `dotenv` (dev).

### Corpus size, fixed

**8 documents across 2 matters, 2 users.** Every count in this plan and in the
verification steps refers to those numbers.

- Matter 1 — *Estate of Margaret Hollis*: **6 documents**, 5 standard + 1 restricted.
- Matter 2 — *Estate of Thomas Reyes*: **2 documents**, both standard.

---

## 1. Directory structure

```
matter_memory/
├── PLAN.md
├── CLAUDE.md
├── docker-compose.yml
├── .env.local                     # gitignored
├── .env.example                   # committed
├── db/
│   └── schema.sql                 # mounted into docker-entrypoint-initdb.d
├── seed/
│   ├── 01-hollis-will.txt                   # matter 1, standard
│   ├── 02-hollis-revocable-trust.txt        # matter 1, standard
│   ├── 03-hollis-poa.txt                    # matter 1, standard
│   ├── 04-hollis-deed.txt                   # matter 1, standard
│   ├── 05-hollis-account-statement.txt      # matter 1, standard
│   ├── 06-hollis-confidential-memo.txt      # matter 1, RESTRICTED
│   ├── 07-reyes-will.txt                    # matter 2, standard
│   └── 08-reyes-account-statement.txt       # matter 2, standard
├── eval/
│   └── questions.json             # fixed retrieval eval set
├── scripts/
│   ├── check-db.ts                # step 1 — connect, confirm pgvector, list tables
│   ├── check-ollama.ts            # step 2 — embed a string, print dims + head
│   ├── seed.ts                    # step 3/4 — reset + ingest seed/
│   ├── retrieve.ts                # step 5 — retrieval only, prints chunks, no LLM
│   ├── ask.ts                     # step 5 — full RAG from CLI, no UI
│   └── eval.ts                    # step 5b — retrieval hit rate over eval/questions.json
└── src/
    ├── lib/
    │   ├── db.ts                  # pg Pool, single export
    │   ├── ollama.ts              # embed() / embedQuery() / generate()
    │   ├── parse.ts               # File|Buffer + filename → plain text
    │   ├── chunk.ts               # text → [{ section, ordinal, content }]
    │   ├── ingest.ts              # THE shared path: parse → chunk → embed → insert
    │   ├── retrieve.ts            # THE retrieval SQL (permission filter lives here)
    │   ├── auth.ts                # resolveUser(userId) → role, or null
    │   └── answer.ts              # retrieve → build prompt → generate → citations
    ├── app/
    │   ├── layout.tsx             # header holds the identity selector
    │   ├── page.tsx               # redirect('/query')
    │   ├── query/page.tsx
    │   ├── upload/page.tsx
    │   └── api/
    │       ├── query/route.ts
    │       ├── upload/route.ts
    │       └── bootstrap/route.ts # matters + users lists for the dropdowns
    └── components/
        └── ui/                    # shadcn output
```

The three things worth noting about this layout:

- `src/lib/ingest.ts` and `src/lib/retrieve.ts` are the only places that write chunks
  and the only place that reads them. Scripts and route handlers both import from
  `src/lib/`. There is exactly one ingestion path and exactly one retrieval query, per
  CLAUDE.md.
- `src/lib/auth.ts` is the single place a `userId` becomes a `role`. Both API routes go
  through it; neither trusts a role from the request body.
- Scripts live outside `src/app/` so they never get bundled by Next.

---

## 2. Postgres schema

`db/schema.sql`, mounted read-only into `/docker-entrypoint-initdb.d/`. Compose uses the
`pgvector/pgvector:pg16` image, which ships the extension prebuilt.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE matters (
  id          SERIAL PRIMARY KEY,
  client_name TEXT NOT NULL,
  title       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('attorney', 'paralegal'))
);

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

CREATE TABLE chunks (
  id          SERIAL PRIMARY KEY,
  document_id INT  NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section     TEXT,                      -- e.g. 'ARTICLE III — Distribution'
  ordinal     INT  NOT NULL,             -- position within the document
  content     TEXT NOT NULL,
  embedding   vector(768) NOT NULL,
  UNIQUE (document_id, ordinal)
);

CREATE INDEX idx_documents_matter ON documents (matter_id, sensitivity);
CREATE INDEX idx_chunks_document  ON chunks (document_id);
```

### Why `chunks` does not carry `matter_id` or `sensitivity`

The obvious optimization is to denormalize both onto `chunks` so the retrieval query
needs no join. I am deliberately not doing that.

`sensitivity` is the access control decision. If it exists in two places, the two places
can drift — change a document to `restricted` and its previously-copied chunk rows still
say `standard`, and the filter silently keeps serving them. That failure is invisible
and it is exactly the failure this project exists to rule out. One row, one source of
truth, joined at query time. The join is on an indexed primary key over a few hundred
rows; it costs nothing at this scale.

If the table ever grew to where the join hurt, the correct fix is a trigger or a
generated column maintained by the database — not a value the application copies in by
hand.

### Why there is no HNSW index (yet)

This is the subtlety most worth understanding, and it is the one thing about pgvector
that surprises people.

An HNSW index performs **approximate** nearest-neighbor search. It walks a graph to find
roughly the k closest vectors, then Postgres applies your `WHERE` clause to whatever
came back. If most of those k rows belong to a different matter or are restricted, they
get filtered out *after* the index already chose them — and you can get back far fewer
results than you asked for, sometimes zero, even though plenty of matching chunks exist.

Two things follow:

- **This is a recall problem, never a security problem.** The filter still runs. A
  restricted chunk cannot come back through this path. The worst case is a thin or empty
  answer, not a leak.
- **At demo scale it is entirely avoidable.** Eight documents is a few hundred chunks. A
  sequential scan computing exact cosine distance over a few hundred 768-dim vectors is
  sub-10ms and gives perfect recall. The planner will pick it on its own.

So `schema.sql` ships with the HNSW block present but commented out, with a note
explaining the tradeoff:

```sql
-- Not enabled at demo scale. Exact scan over a few hundred chunks is fast and
-- has perfect recall; an approximate index would filter AFTER ranking and can
-- under-return when the WHERE clause is selective.
--
-- At scale, enable this AND set hnsw.iterative_scan (pgvector 0.8+), which makes
-- the index keep searching until it has filled the LIMIT post-filter:
--
--   CREATE INDEX idx_chunks_embedding ON chunks
--     USING hnsw (embedding vector_cosine_ops);
--   SET hnsw.iterative_scan = relaxed_order;
```

Cosine distance (`<=>` / `vector_cosine_ops`) is the right operator for
`nomic-embed-text`.

---

## 3. The retrieval SQL

Lives in `src/lib/retrieve.ts` and exists in exactly one place in the codebase.

```sql
SELECT
  c.id           AS chunk_id,
  c.content,
  c.section,
  c.ordinal,
  d.id           AS document_id,
  d.title        AS document_title,
  d.doc_type,
  d.sensitivity,
  1 - (c.embedding <=> $1::vector) AS similarity
FROM chunks c
JOIN documents d ON d.id = c.document_id
WHERE d.matter_id = $2
  AND ($3 = 'attorney' OR d.sensitivity = 'standard')
ORDER BY c.embedding <=> $1::vector
LIMIT $4;
```

Parameters, all bound — no string interpolation anywhere:

| | |
|---|---|
| `$1` | query embedding, 768 floats, passed as a `vector` literal |
| `$2` | `matter_id` |
| `$3` | role, read server-side from `users.role` |
| `$4` | top-k (default 6) |

### Where the filter sits relative to the ranking

This is the whole point of the project, so it is worth being precise about the order of
operations Postgres actually performs:

```
FROM / JOIN     ── assemble candidate rows
     ↓
WHERE           ── matter scope + role/sensitivity filter
     ↓             ROWS ARE DISCARDED HERE
ORDER BY <=>    ── rank only the survivors by cosine distance
     ↓
LIMIT           ── take top-k of the survivors
```

`WHERE` is evaluated before `ORDER BY`, and `ORDER BY` before `LIMIT`. A restricted chunk
is eliminated before it is ever scored. It cannot place in the top-k, because it is not
in the set being ranked. Nothing downstream — not the prompt builder, not the model —
ever observes that it exists.

Contrast the wrong version, which I will not write:

```sql
-- WRONG: ranks everything, then hopes the app filters afterward
ORDER BY c.embedding <=> $1::vector LIMIT 6;
-- restricted content is now in application memory, one bug away from the prompt
```

And the also-wrong version, which CLAUDE.md explicitly forbids:

```
"You may see confidential material below. Do not mention it." ← never
```

### Two properties of the filter expression worth verifying

`($3 = 'attorney' OR d.sensitivity = 'standard')` **fails closed**, which is the
direction you want an access rule to fail in:

- An unrecognized role (`'admin'`, `'intern'`) — the first branch is false, so only
  `standard` rows survive. Restricted content is not exposed.
- A `NULL` role — the first branch is `NULL`, and for a restricted row the second is
  false, so the whole expression is `NULL`, which `WHERE` treats as not-true. The row is
  excluded.

Both cases are covered by the step 5 test script rather than left to inspection.

### Fail-closed at the API boundary

The SQL failing closed is the last line of defence, not the first. It should never be
reached with a role that the database did not produce. Two layers sit above it.

**Layer 1 — resolve before doing anything.** Every route that touches matter data begins
by turning a `userId` into a role, and returns immediately if it cannot:

```ts
// src/lib/auth.ts
export async function resolveUser(userId: unknown) {
  if (typeof userId !== 'number' || !Number.isInteger(userId)) return null;
  const { rows } = await db.query(
    'SELECT id, name, role FROM users WHERE id = $1', [userId]
  );
  return rows.length === 1 ? rows[0] : null;
}
```

```ts
// src/app/api/query/route.ts
const user = await resolveUser(body.userId);
if (!user) {
  return Response.json({ error: 'Unknown user' }, { status: 401 });
}
// only past this line may embedding, retrieval, or generation run
```

The ordering is deliberate: no embedding call, no retrieval, no generation happens before
the identity resolves. An unknown `userId` costs one indexed lookup and returns 401 with
nothing retrieved. `/api/upload` does the same thing, first, before parsing the file.

**Layer 2 — an unresolved role is a crash, not a downgrade.** `retrieve()` takes
`role: 'attorney' | 'paralegal'` and asserts at runtime that the value is one of those
two literals, throwing if not:

```ts
if (role !== 'attorney' && role !== 'paralegal') {
  throw new Error(`retrieve(): invalid role ${JSON.stringify(role)}`);
}
```

This looks redundant against the SQL, and for safety it is — the query would have
returned standard-only anyway. It is there for visibility rather than safety. If
`undefined` ever reaches `retrieve()`, that is a bug in the calling code, and silently
degrading to standard-only would hide it behind results that look plausible. Failing
closed keeps the data safe; throwing makes sure someone finds out. Both, in that order.

**One structural consequence.** CLAUDE.md specifies the upload form as exactly three
fields — file picker, matter select, sensitivity select — but `/api/upload` now needs a
`userId`. Rather than adding a fourth field, the identity selector lives in the shared
header in `layout.tsx`, where both pages read it. The upload *form* stays exactly the
three fields specified.

**Policy, decided:** a paralegal may upload a document marked restricted, and then
cannot read it back. Classifying is not reading, and this matches how a firm actually
works — the person who files a sensitive memo is often not the person cleared to read
it. Upload is open to any resolved user; only retrieval is role-gated.

### The generation prompt

`src/lib/answer.ts` receives only the rows the SQL returned. It numbers them, labels each
with its document title and section, and asks for `[n]` citations. The instruction is a
**grounding** instruction, not a withholding one:

> Answer using only the numbered excerpts below. Cite the excerpts you used as [1], [2].
> If the excerpts do not contain the answer, say that this matter's documents do not
> cover it.

The distinction matters and is easy to blur. "Only use what I gave you" is a quality
instruction about staying grounded in retrieved context. "You have secret material, keep
it quiet" is a permission instruction, and it is the thing this architecture exists to
replace. If a prompt draft ever starts drifting toward the second, that is the signal to
stop and fix the SQL instead.

### Embedding detail: task prefixes

`nomic-embed-text` is trained with task prefixes and gets measurably worse retrieval
without them. `src/lib/ollama.ts` applies them so no caller has to remember:

- indexing a chunk → `search_document: <text>`
- embedding a question → `search_query: <text>`

Both live behind `embed()` and `embedQuery()`.

---

## 4. Build order

Each step is one commit and leaves the repo in a working state. Steps 1–5b are the
project; 6–7 are the demo surface.

**Step 0 — Scaffold** *(done — `d951695`, upgraded to Next 16 immediately after)*
`create-next-app` (TypeScript, Tailwind, App Router, `src/`), `shadcn init`, install the
four approved deps, commit `.env.example`.
*Done when:* `npm run dev` serves the default page.

Scaffolded on Next 15.5.24, then upgraded to **Next 16.3.3 / React 19.2.8** because
Next 15 pulls a `postcss` with four published advisories (one high) and the only fix is
the major upgrade. `npm audit` now reports 0 vulnerabilities. CLAUDE.md's stack line was
updated to match, so the instructions file does not contradict the lockfile.

Node 20.17.0 satisfies Next 16 (`>=20.9.0`), but three transitive tooling packages
(`shadcn`, `undici`, `eslint-visitor-keys`) want `>=20.18.1` and emit `EBADENGINE`
warnings on install. Harmless — build, typecheck and dev server all pass — but a bump to
Node 20.19+ or 22 LTS would silence them.

**Step 1 — Postgres + pgvector**
`docker-compose.yml` (host port **5433**), `db/schema.sql`, `src/lib/db.ts`,
`scripts/check-db.ts`.
*Done when:* `npx tsx scripts/check-db.ts` prints the pgvector version and all four
tables. Verify with `docker compose down -v && docker compose up -d` that the schema
applies to a fresh volume.

**Step 2 — Ollama**
`src/lib/ollama.ts` with `embed()`, `embedQuery()`, `generate()`.
`scripts/check-ollama.ts` embeds a sentence and prints the vector.
*Done when:* it prints `768` and the first few floats, and `generate()` returns a
sentence from `qwen2.5:7b`.

**Step 3 — Seed documents**
Eight synthetic `.txt` files, written with explicit `ARTICLE` / `SECTION` headings so
section citations have something real to point at.

*Matter 1 — Estate of Margaret Hollis (6 documents).* Five standard: will, revocable
trust, durable POA, deed, account statement. One restricted: a confidential attorney
memo on the decision to exclude a child, which references the will's residuary article.

This shape is what makes the demo land. "Who are the beneficiaries?" answers for both
roles. "Why was Daniel excluded from the estate?" answers with a citation for the
attorney and returns nothing for the paralegal — because nothing was retrieved, not
because the model declined.

*Matter 2 — Estate of Thomas Reyes (2 documents).* A will and an account statement,
both standard. The doc types deliberately overlap with matter 1, so a broken matter
filter produces a visibly wrong answer rather than a plausible one — "who are the
beneficiaries?" would start mixing two families.

*Users (2).* One attorney, one paralegal.

*Done when:* eight files exist and read like plausible documents.

**Step 4 — The ingestion path**
`parse.ts`, `chunk.ts`, `ingest.ts`, then `scripts/seed.ts` on top of it.

- Chunking: ~1000 characters with ~150 overlap, split on paragraph boundaries, never
  mid-sentence.
- Sections: regex for `ARTICLE <roman>`, `Section N.N`, and standalone ALL-CAPS lines.
  The last heading seen carries forward onto subsequent chunks. Falls back to
  `Part <n>` when a document has no headings — which is what arbitrary uploaded PDFs
  will hit.
- One transaction per document: insert `documents`, embed every chunk, insert `chunks`,
  commit. A failure part-way rolls back rather than leaving a half-indexed document.
- `seed.ts` is idempotent — `TRUNCATE matters, users, documents, chunks RESTART IDENTITY
  CASCADE` first, so it can be re-run freely. It also seeds the two users.

*Done when:* `npx tsx scripts/seed.ts` reports **2 matters, 2 users, 8 documents** and a
chunk count, and a `psql` count confirms them.

**Step 5 — Retrieval, tested without any UI**
`src/lib/retrieve.ts` with the query above, plus `src/lib/answer.ts` and
`src/lib/auth.ts`.

- `scripts/retrieve.ts <matterId> <role> "<question>"` prints ranked chunks with scores,
  document titles, and sections — no LLM in the loop, so retrieval is judged on its own.
- `scripts/ask.ts` does the full loop and prints the cited answer.
- An assertion block covering the properties that matter: the paralegal never receives a
  `restricted` row for the disinheritance question; the attorney does; an unknown role
  and a `NULL` role both return standard-only; a matter-1 query never returns a matter-2
  chunk.

*Done when:* those assertions pass. **This is the step where the security property is
established** — everything after it is measurement and presentation.

**Step 5b — Retrieval evaluation**

Step 5 proves the filter is correct. It says nothing about whether retrieval is any
*good*. This step measures that, against a fixed corpus, so that later changes to chunk
size or overlap can be judged rather than guessed at.

`eval/questions.json` — ~12 questions, each shaped:

```json
{
  "id": "residuary-beneficiaries",
  "question": "Who receives the residuary estate?",
  "matterId": 1,
  "kind": "single",
  "expectedDocuments": ["Last Will and Testament of Margaret Hollis"],
  "expectedOrdinals": [4]
}
```

Four kinds, deliberately mixed:

| kind | count | what it tests |
|---|---|---|
| `single` | ~5 | answer sits in one document |
| `spanning` | ~2 | answer needs two documents (e.g. will + trust on the same asset) |
| `restricted` | ~2 | answer exists only in the confidential memo |
| `unanswerable` | ~3 | nothing in the corpus answers it; `expectedDocuments` is `[]` |

`scripts/eval.ts` runs every question **as the attorney**, so the restricted memo is in
scope. This loop measures retrieval quality only — permissions are step 5's job, and
mixing the two would make both harder to read. No LLM anywhere in it.

Scoring:

- `single` / `restricted` — hit at k if any of the top-k chunks comes from the expected
  document. If `expectedOrdinals` is present, also report the stricter exact-chunk hit
  rate as a second number.
- `spanning` — hit at k only if *every* expected document appears in the top-k. Reported
  separately, since it is a harder bar and will drag the headline number down
  misleadingly if pooled.
- `unanswerable` — no hit to measure. Instead record the top-1 similarity score, and
  report the spread against the answerable questions. If unanswerable questions score as
  highly as answerable ones, retrieval is returning confident-looking noise, and that is
  worth seeing even though no threshold is being enforced yet.

Output:

```
hit@1  8/9   (0.89)     exact-chunk hit@1  6/9
hit@3  9/9   (1.00)     exact-chunk hit@3  8/9
hit@6  9/9   (1.00)
spanning (all docs present):  1/2 @6

top-1 similarity   answerable   min 0.62  mean 0.74
                   unanswerable min 0.31  mean 0.38

MISSES
  [poa-successor] hit@1 miss
    expected: Durable Power of Attorney — Margaret Hollis
    got:      #1 Revocable Trust §2.1 (0.68)
              #2 Last Will ARTICLE II (0.64)
```

Listing what came back instead is the part that makes a miss actionable — usually it
shows a chunk boundary landing mid-clause.

*A note on `expectedOrdinals`:* they are brittle by nature. Change the chunk size and
every recorded ordinal is meaningless, while the expected *document* stays valid. So
document match is the primary signal and the headline number; exact-chunk match is a
secondary one, and re-recording ordinals after a chunking change is expected, not a
failure.

*Done when:* `npx tsx scripts/eval.ts` prints a baseline. Record that baseline in the
commit message — it is the number every later chunking change gets compared against.

**Step 6 — Upload page**
`/upload` and `POST /api/upload`. File picker, matter select, sensitivity select; the
identity selector is in the shared header. Resolves the user first (401 if unknown),
then calls the same `ingest()` from step 4 — no ingestion logic is written here.
Synchronous with a spinner. Rejects anything that is not PDF or `.txt`, and shows an
explicit error when extraction yields empty text, which is what a scanned PDF does.

**Step 7 — Query page**
`/query` and `POST /api/query`. Identity dropdown (name + role, from `users`), matter
dropdown, question box, answer with citations to document and section.

Below the answer, a collapsible **"chunks retrieved"** panel listing what the SQL
actually returned, with similarity scores. Switch from attorney to paralegal, ask the
same question, and the panel visibly shrinks. That panel is the demo — it is the
difference between claiming restricted content never reached the model and showing it.

---

## 5. Things I think are wrong or underspecified

Ordered by how likely each is to bite.

**a. `pdf-parse` under Next.js — corrected at step 0.** The planned workaround was for
`pdf-parse` v1, whose entry point ran a debug block that read a bundled test PDF from
disk and threw once bundled. npm now installs **v2.4.5, a full rewrite**, and the
workaround no longer applies:

```ts
// v1 (what the plan assumed)          // v2 (what we actually have)
const pdf = require('pdf-parse')       import { PDFParse } from 'pdf-parse';
pdf(buffer).then(r => r.text)          const r = await new PDFParse({ data: buf }).getText();
```

Three consequences:

- No deep import needed — v2 has a proper `exports` map for both ESM and CJS.
- **No `@types/pdf-parse`** — v2 ships its own types, so that is one dependency we do
  not have to add.
- v2 wraps `pdfjs-dist`, which is heavy and may need listing in
  `serverExternalPackages` in `next.config.ts` so Next does not try to bundle it into
  the server build. Handle at step 6 if it complains.

The upload route still needs `export const runtime = 'nodejs'` — this will not work on
the Edge runtime.

A bonus: v2 returns per-page text, so page numbers become available as a citation
fallback for uploaded PDFs that have no detectable headings (item **c** below).

**b. The port collision.** Homebrew Postgres 14 is installed and almost certainly holds
5432. Handled by mapping to 5433, but it means `DATABASE_URL` must say 5433 and any
`psql` you run by hand needs `-p 5433`, or you will connect to the wrong server and
wonder why the tables are missing.

**c. "Citations back to section" assumed sections exist.** Plain text has no structure
unless something imposes it. Step 4's heading detection plus deliberately well-formed
seed documents handles this, but arbitrary uploaded PDFs will often produce `Part 3`
rather than `ARTICLE IV`. Worth knowing before the demo rather than during it.

**d. There is no stated way to *show* the security property.** The claim "restricted
chunks never reached the model" is invisible in a chat UI — an absent answer looks
identical to a model that chose to decline. The retrieved-chunks panel in step 7 and the
side-by-side assertions in step 5 are what turn the claim into evidence. I would treat
these as core, not polish.

**e. The `users` table was orphaned by the spec.** Resolved: the client posts a `userId`
and the server reads the role. Worth restating because it is the one place where "no
real auth" could have quietly become "the access control is client-controlled," which
would undercut the whole demo. The knock-on effect is that the identity selector has to
live in the shared header, since the upload form is specified as exactly three fields.

**f. The 768 dimension is baked into the schema.** That is correct for
`nomic-embed-text` and fine here, but swapping embedding models later means an
`ALTER TABLE` and a full re-embed. Mentioning it so it is a known constraint rather than
a surprise. Not worth storing a model name per chunk at this scale.

**g. Chunk size was unspecified.** Starting at ~1000 chars / ~150 overlap. The model's
8192-token context is not the binding constraint — retrieval quality is. Legal documents
have long clauses, and chunks that split mid-clause retrieve badly. Step 5b is what turns
this from a guess into a measured choice.

**h. Re-running the seed after uploads will delete uploaded documents.** `TRUNCATE` is
the right call for a demo (it keeps the seed a reliable fallback, as CLAUDE.md asks) but
it is destructive. The script will print a clear warning about what it is about to
delete.

---

## 6. Verification

Per step, in order:

```bash
docker compose up -d
npx tsx scripts/check-db.ts        # pgvector present, 4 tables
npx tsx scripts/check-ollama.ts    # 768 dims, generation responds
npx tsx scripts/seed.ts            # 2 matters, 2 users, 8 documents
```

Confirm the corpus is exactly what the plan says:

```bash
psql -p 5433 -U matter -d matter_memory -c "
  SELECT m.title, d.sensitivity, count(*)
  FROM documents d JOIN matters m ON m.id = d.matter_id
  GROUP BY 1, 2 ORDER BY 1, 2;"
# Estate of Margaret Hollis | restricted | 1
# Estate of Margaret Hollis | standard   | 5
# Estate of Thomas Reyes    | standard   | 2
```

The one that matters — same matter, same question, different roles:

```bash
npx tsx scripts/retrieve.ts 1 attorney  "Why was Daniel excluded from the estate?"
#  → includes the confidential memo, sensitivity=restricted

npx tsx scripts/retrieve.ts 1 paralegal "Why was Daniel excluded from the estate?"
#  → no restricted rows, at any rank, at any similarity score
```

Then confirm the filter is genuinely in the database and not in the JavaScript, by
running it by hand:

```bash
psql -p 5433 -U matter -d matter_memory -c "
  SELECT d.title, d.sensitivity FROM chunks c
  JOIN documents d ON d.id = c.document_id
  WHERE d.matter_id = 1 AND ('paralegal' = 'attorney' OR d.sensitivity = 'standard');"
```

Retrieval quality baseline:

```bash
npx tsx scripts/eval.ts             # hit rates @1/@3/@6, misses listed
```

Fail-closed at the API, once step 7 exists — a forged role must not work:

```bash
curl -s localhost:3000/api/query -H 'content-type: application/json' \
  -d '{"role":"attorney","matterId":1,"question":"Why was Daniel excluded?"}'
# → 401, no userId present; role in the body is ignored entirely

curl -s localhost:3000/api/query -H 'content-type: application/json' \
  -d '{"userId":9999,"matterId":1,"question":"Why was Daniel excluded?"}'
# → 401, unknown user, nothing retrieved
```

End to end at step 7: `npm run dev`, upload a `.txt` to matter 1 as restricted, confirm
it appears for the attorney and not the paralegal. Then upload a scanned PDF and confirm
you get the empty-extraction error rather than a silently empty document.

---

## 7. Future work

**Chunk-level sensitivity.** The natural next step. Document-level sensitivity means a
document is entirely visible or entirely invisible, which does not match how legal
documents actually work — a single will contains routine boilerplate alongside one
genuinely sensitive clause, and today the only way to protect the clause is to restrict
the whole will.

Deferred because it moves cost from the schema into the ingestion path, which is the
part that has to stay simple. The schema change is small: a `sensitivity` column on
`chunks`, defaulted from its document, and the filter moves from `d.sensitivity` to
`c.sensitivity`. The hard part is *deciding* each chunk's sensitivity — marker lines in
the seed documents, plus some answer for uploaded PDFs where no such markers exist, plus
a UI for correcting it. That is a meaningful chunk of work for a demo whose point is
already made by the document-level version, given a well-chosen corpus.

Worth doing when a real document needs mixed sensitivity. Not before.

**HNSW with iterative scan.** Covered in section 2. Needed once the corpus outgrows exact
scan; the commented block in `schema.sql` is the starting point.

**A `role_sensitivity` lookup table.** The inline `($3 = 'attorney' OR ...)` is the most
legible form for two roles and one restricted tier — a reviewer reads one line and sees
the whole rule. With a third role or a second tier it stops scaling, and the rule should
move into a table joined into the filter:

```sql
AND EXISTS (SELECT 1 FROM role_sensitivity r
            WHERE r.role = $3 AND r.sensitivity = d.sensitivity)
```

Same position in the query, same fail-closed behaviour, data instead of a literal.

**Answer-quality evaluation.** Step 5b measures retrieval only. Measuring whether the
generated answer is faithful to the retrieved chunks, and whether its citations point at
the right places, is a separate and harder problem — and is where an LLM judge would
earn its place. Out of scope here.

**Real authentication.** Explicitly out of scope per CLAUDE.md. The shape of the code
anticipates it: `resolveUser()` is the only place identity is established, so swapping a
dropdown for a session is a change in one file.
