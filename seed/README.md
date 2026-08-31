# Seed documents

**Every document in this directory is synthetic.** The people, addresses,
account numbers, registry book and page references, and firm names are all
invented for the demo. Nothing here is, or is derived from, a real client file.

Marked here rather than in the documents themselves so the marker does not end
up inside a chunk and pollute the embeddings.

## The corpus

8 documents, 2 matters. `scripts/seed.ts` maps filenames to matters and
sensitivity; this table is the reference.

| File | Matter | Type | Sensitivity |
|---|---|---|---|
| `01-hollis-will.txt` | Estate of Margaret Hollis | will | standard |
| `02-hollis-revocable-trust.txt` | Estate of Margaret Hollis | trust | standard |
| `03-hollis-poa.txt` | Estate of Margaret Hollis | poa | standard |
| `04-hollis-deed.txt` | Estate of Margaret Hollis | deed | standard |
| `05-hollis-account-statement.txt` | Estate of Margaret Hollis | statement | standard |
| `06-hollis-confidential-memo.txt` | Estate of Margaret Hollis | memo | **restricted** |
| `07-reyes-will.txt` | Estate of Thomas Reyes | will | standard |
| `08-reyes-account-statement.txt` | Estate of Thomas Reyes | statement | standard |

## Why the fact pattern is shaped this way

**The will states *that* Daniel is disinherited; only the memo says *why*.**
Article V of the will records the omission as intentional but explicitly
withholds the reasons — which is what a real will does, since reasons stated on
the face of an instrument become public on allowance. The reasoning lives in the
restricted memo.

That split is the demo. Ask *"Was Daniel provided for?"* and both roles get a
clean answer from the will. Ask *"Why was Daniel excluded from the estate?"* and
the attorney gets the unrepaid advances and the 2021 account incident, cited to
the memo, while the paralegal gets nothing — because nothing was retrieved, not
because the model chose to be discreet.

An all-or-nothing document would have made a blunter point. Here the boundary
falls in a place a lawyer would actually recognize.

**Cross-document questions have real answers.** The Willow Lane property is
conveyed by the deed, held under Section 2.1 of the trust, distributed under
Section 4.2 of the trust, and referenced in Section 3.2 of the POA. Answering
"what happens to the house" properly needs more than one document, which is what
the `spanning` questions in `eval/questions.json` measure.

**Matter 2 mirrors matter 1's document types on purpose.** Both matters have a
will and an account statement, with different families, different banks and
different beneficiaries. If the `matter_id` filter ever breaks, "who are the
beneficiaries?" starts blending the Hollis and Reyes families — a visibly wrong
answer rather than a plausible one. A second matter with unrelated document
types would have hidden that failure.

**There are deliberate gaps**, for the `unanswerable` eval questions — so
retrieval gets measured on what it does when the corpus simply has no answer.
Verified absent from all eight documents: health care proxy, prenuptial
agreement, long-term care planning, burial instructions, digital assets.

Note that *life insurance* is **not** a usable gap, despite there being no
policy in the corpus: POA §4.3 bars the Agent from changing life insurance
beneficiary designations, so the phrase is present and will retrieve something.
Checking this properly needs whitespace normalization — these documents are
hard-wrapped, so a phrase like "life insurance" can straddle a line break and
escape a naive `grep`.

## Facts that span documents

Useful when writing `spanning` eval questions. Verified by search:

| Fact | Appears in |
|---|---|
| 14 Willow Lane | will, trust, POA, deed, statement |
| Daniel's exclusion (the *fact*) | will, trust, POA, statement |
| Daniel's exclusion (the *reasons*) | **memo only** |
| Ruth Hollis Alden as successor fiduciary | will, trust, POA |
| Claire Hollis Bennett | will, trust, POA, statement, memo |

## Headings

Each document uses explicit `ARTICLE` / `SECTION` headings. The chunker in
`src/lib/chunk.ts` detects these and carries the last one seen onto each chunk,
which is what makes a citation say `ARTICLE IV - Residuary Estate` rather than
`Part 3`. Uploaded PDFs without such structure fall back to a part number.
