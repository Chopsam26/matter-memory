Matter Memory

Permission-aware RAG over an estate planning firm's client files. Demo project — synthetic documents only, never real client data.

Stack
Next.js 15 (App Router), React 19, TypeScript, Tailwind, shadcn/ui
PostgreSQL 16 + pgvector, running in Docker
Ollama: qwen2.5:7b (generation), nomic-embed-text (embeddings, 768 dims)
No ORM. Raw SQL via pg.
The core rule

Access control happens in SQL, in the vector search WHERE clause. Restricted chunks are never retrieved, so they never enter the model's context. Never implement permissions by instructing the model to withhold information. If you find yourself writing that in a prompt, stop and tell me.
 All SQL uses parameterized queries ($1, $2). Never interpolate values
into query strings.

Data model
matters — a client engagement
documents — belongs to a matter, has sensitivity ('standard' | 'restricted')
chunks — belongs to a document, has embedding vector(768)
users — has role ('attorney' | 'paralegal')

Every retrieval query filters by matter_id AND the user's role before ranking by similarity.

Ingestion

One shared ingestion path: parse → chunk → embed → insert. Both the seed script and the upload page call into it. Do not duplicate this logic.

Keep the seed script working even after upload exists. It loads the baseline demo documents and is the fallback if upload breaks.

Upload

Single-file upload page: file picker, matter select, sensitivity select. That's the entire form.

PDF and .txt only, parsed with pdf-parse
Processes synchronously with a spinner — no job queue, no progress bar
One file at a time, no drag-and-drop, no multi-select
Show a clear error if text extraction returns nothing (scanned PDFs will)
Pages

Exactly two:

Upload — the form above
Query — role switcher, matter selector, question box, answer with citations back to document and section
Scope — do not build these
Real authentication (a role dropdown is fine)
Streaming responses
Multi-file upload or background job processing
Any page beyond upload and query
Conventions
Explain what you're doing as you go. I'm learning this stack.
Small commits. Commit after each working piece.
Ask before adding a dependency that isn't already in the stack above.
Build order
Docker Compose: Postgres + pgvector, schema applied, connection verified
Ollama wired up — a script that embeds a string and prints the vector
Synthetic seed documents (will, trust, POA, deed, account statement; mark one restricted)
Ingestion path: parse, chunk, embed, insert
Retrieval SQL with the permission filter — tested from a script, no UI
Upload page
Query page

Steps 1–5 are the project. Steps 6–7 are how it gets demoed.