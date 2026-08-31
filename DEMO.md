# Running and presenting the demo

Everything below has been run end to end from a destroyed database volume.
Timings are from this machine.

---

## Pre-flight — about 5 minutes before

Run these in order. The whole sequence takes under a minute once Ollama is up.

**1. Is Ollama running?** It is started by hand, not by Docker Compose, and it
does not survive a reboot or a closed terminal.

```bash
curl -s http://127.0.0.1:11434/api/version
```

Expect `{"version":"0.33.0"}`. If it fails, run `ollama serve` in its own
terminal tab and leave it there.

**2. Start Postgres.** ~6 seconds.

```bash
npm run db:up
```

**3. Load the corpus.** ~2 seconds. Destructive — it truncates every table and
reloads the eight seed documents, so anything uploaded through the UI is gone.
Do this before the demo, not during.

```bash
npm run seed
```

Expect `2 matters, 2 users, 8 documents, 62 chunks`.

**4. Run the permission checks.** This is the evidence, so run it now and be
ready to run it again in front of the partner.

```bash
npm run check:permissions
```

Expect `16 passed, 0 failed`.

**5. Warm the model. Do not skip this.** Ollama unloads a model after five
idle minutes. The first question afterwards takes **~20 seconds**; every one
after that takes **~8**. Twenty seconds of silence in front of a partner feels
much longer than it is.

```bash
npm run ask -- 1 1 "Who receives the residuary estate?"
```

If there is a long gap between setup and demo, run it again just before you
start.

**6. Start the app** and open <http://localhost:3000>.

```bash
npm run dev
```

Set the header dropdown to **Marcus Webb · paralegal**. Starting as the
paralegal is what makes the reveal land.

---

## The demo — about five minutes

### 1. Frame it (30 seconds)

> This is retrieval over a small estate planning firm's client files. Two roles,
> attorney and paralegal. The interesting part isn't the answers — it's *where*
> the access control lives.

### 2. Ask as the paralegal (1 minute)

Matter: **Estate of Margaret Hollis**. Question:

> **Why was Daniel excluded from the estate?**

The answer says Daniel was *intentionally* excluded and cites **ARTICLE V** of
the will. No reasons.

Open **6 chunks retrieved**. Six results, none flagged. Say:

> The paralegal can see *that* he was disinherited — a will always states that,
> to defeat a claim that a child was left out by oversight. What she cannot see
> is why.

### 3. Switch to the attorney and ask the identical question (1 minute)

Change the header dropdown to **Eleanor Vance · attorney**. Ask the same
question again.

Now the answer gives the reasons: roughly **$180,000** in unrepaid advances, and
a meeting on **28 February 2022** — cited to the **Confidential Memorandum**.

Open the panel: six chunks again, but **three are amber and marked restricted**.

### 4. The point (1 minute)

This is the part worth slowing down for.

> Look at the paralegal's list again. Those three memo chunks weren't hidden from
> her, or greyed out, or filtered by the model. They were never retrieved. Her
> ranks 2 and 3 are different documents entirely — the list closes up.

The scores make it concrete:

| rank | attorney | paralegal |
|---|---|---|
| #1 | 0.740 will, Article V | 0.740 will, Article V |
| #2 | **0.737 memo** | 0.696 power of attorney |
| #3 | **0.735 memo** | 0.688 trust |

> The 0.737 chunk is the second-best match in the whole matter. It simply isn't
> in the set she's ranking against.

### 5. Show why that's true (1 minute)

Open [src/lib/retrieve.ts](src/lib/retrieve.ts) and show the query:

```sql
WHERE d.matter_id = $2
  AND ($3 = 'attorney' OR d.sensitivity = 'standard')
ORDER BY c.embedding <=> $1::vector
LIMIT $4
```

> Postgres applies `WHERE` before `ORDER BY`, and `ORDER BY` before `LIMIT`. A
> restricted chunk is discarded before it's ever scored, so it can't place in the
> top six — it isn't in the set being ranked. Nothing downstream ever sees it.
>
> There is no instruction anywhere telling the model to keep a secret. It can't
> reveal what it was never given.

### 6. Prove it rather than assert it (1 minute)

Run this in the terminal, live:

```bash
npm run check:permissions
```

Sixteen assertions. Three worth naming out loud:

- The paralegal check runs at a **limit of 1000** — larger than the entire
  62-chunk corpus. So "no restricted chunks" means *at any rank*, not "outside
  the top six."
- One assertion inspects **the prompt itself**, confirming the attorney's
  contains the restricted detail, the paralegal's contains none of it, and
  neither contains any instruction to withhold anything.
- Unknown roles, empty strings, `NULL`, and `'ATTORNEY'` in capitals all return
  standard rows only. It **fails closed**.

### 7. Optional — upload (1 minute)

Go to **Upload**. As the *paralegal*, upload any `.txt` to the Hollis matter and
mark it **Restricted**. It succeeds.

> A paralegal can file a sensitive document and then not be able to read it back.
> Classifying isn't reading — that's how a firm actually works.

Ask a question about its contents as the paralegal (nothing), then switch to the
attorney (there it is). Same ingestion path as the seed script, same filter, no
special-casing.

---

## Questions a partner will ask

**"Could the model leak it anyway if someone phrased the question cleverly?"**
No. Prompt injection works on instructions; there's no instruction here to
subvert. The restricted text is not in the model's context at all — the prompt is
built only from rows the SQL returned.

**"What if someone changes the prompt?"**
There's no permission logic in the prompt to break. The only instruction is to
stay grounded in the excerpts provided.

**"What stops the browser claiming to be an attorney?"**
The client sends a **user ID**, never a role. The server reads the role from the
database. You can show this:

```bash
curl -s localhost:3000/api/query -H 'content-type: application/json' \
  -d '{"role":"attorney","matterId":1,"question":"Why was Daniel excluded?"}'
```

Returns **401**. The forged role is ignored entirely, and nothing is retrieved.

**"Is this real client data?"**
No. All eight documents are synthetic — invented people, addresses, account
numbers and registry references. See [seed/README.md](seed/README.md).

**"How accurate is the retrieval?"**
There's a measured baseline, not a guess:

```bash
npm run eval
```

13 questions against a fixed corpus. `hit@3` and `hit@6` are 1.00; `hit@1` is
0.88. The single miss is interesting: for "why was Daniel excluded," Article V of
the will out-scores the memo by 0.003 — correct behaviour, since Article V *is*
the clause that excludes him. It just doesn't contain the reasons.

**"What isn't built?"**
Deliberately out of scope: real authentication, streaming responses, multi-file
upload, background job processing. Sensitivity is per **document**, not per
clause — a single will containing one sensitive paragraph would have to be
restricted whole. That's the natural next step and is written up under *Future
work* in [PLAN.md](PLAN.md).

---

## If something breaks

| Symptom | Fix |
|---|---|
| First answer takes ~20s | Normal — model loading. Warm it beforehand (pre-flight 5). |
| `Cannot reach Ollama` | `ollama serve` isn't running. Start it in its own tab. |
| `check:db` fails, tables missing | `npm run db:reset && npm run seed` |
| Uploaded documents disappeared | Someone re-ran `npm run seed`. It truncates by design. |
| Port 5432 error | We use **5433** — Homebrew Postgres holds 5432 on this machine. |
| Page loads but dropdowns are empty | Postgres isn't up. `npm run db:up`. |

**Fallback if the browser misbehaves.** The whole demo works from the terminal
and doesn't need the UI:

```bash
npm run retrieve -- 1 paralegal "Why was Daniel excluded from the estate?"
npm run retrieve -- 1 attorney  "Why was Daniel excluded from the estate?"
```

The attorney's output shows three `[RESTRICTED]` rows; the paralegal's shows
none. That's the same reveal, and it's arguably more legible than the UI.

---

## Command reference

| Command | What it does |
|---|---|
| `npm run db:up` | Start Postgres |
| `npm run db:reset` | Destroy the volume and reapply the schema |
| `npm run db:psql` | psql shell inside the container |
| `npm run seed` | Reload the 8 seed documents (destructive) |
| `npm run check:db` | Postgres, pgvector, schema, vector maths |
| `npm run check:ollama` | Both models, 768 dims, semantic sanity |
| `npm run check:permissions` | The 16 access-control assertions |
| `npm run eval` | Retrieval quality against the fixed question set |
| `npm run retrieve -- <matter> <role> "<q>"` | Retrieval only, no LLM |
| `npm run ask -- <userId> <matter> "<q>"` | Full answer with citations |
| `npm run dev` | The app on :3000 |

Users are **1 Eleanor Vance (attorney)** and **2 Marcus Webb (paralegal)**.
Matters are **1 Hollis** and **2 Reyes**.
