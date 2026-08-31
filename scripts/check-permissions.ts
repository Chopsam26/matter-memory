/**
 * Step 5 verification: prove the permission filter does what the project claims.
 *
 * Run with: npm run check:permissions
 *
 * These are the assertions the whole design rests on, so they are checked
 * rather than inspected. Nothing here calls the LLM - the claim is about what
 * reaches the model, so it is tested at the boundary before the model is
 * involved.
 */
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });

import { query, closePool } from '@/lib/db';
import { embedQuery } from '@/lib/ollama';
import { retrieve, RETRIEVAL_SQL } from '@/lib/retrieve';
import { buildPrompt } from '@/lib/answer';

/** Larger than the whole corpus, so "absent" means absent, not "outside top 6". */
const ALL = 1000;

const DISINHERITANCE = 'Why was Daniel excluded from the estate?';

/** Strings that appear only in the restricted memo. Verified in step 3. */
const RESTRICTED_MARKERS = ['180,000', '41,500', 'Osei', 'work product'];

let passed = 0;
let failed = 0;

function assert(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  —  ${detail}` : ''}`);
  ok ? passed++ : failed++;
}

/** Run the exact production SQL with a role the TypeScript signature forbids. */
async function rawRetrieve(embedding: number[], matterId: number, role: unknown) {
  const { rows } = await query<{ sensitivity: string; document_id: number }>(
    RETRIEVAL_SQL,
    [`[${embedding.join(',')}]`, matterId, role, ALL],
  );
  return rows;
}

async function main() {
  console.log('\nPermission filter checks\n');

  const embedding = await embedQuery(DISINHERITANCE);

  // ---------------------------------------------------------------- roles
  console.log('Role filtering, question: "' + DISINHERITANCE + '"');

  const attorney = await retrieve({
    question: DISINHERITANCE,
    matterId: 1,
    role: 'attorney',
    limit: ALL,
  });
  const paralegal = await retrieve({
    question: DISINHERITANCE,
    matterId: 1,
    role: 'paralegal',
    limit: ALL,
  });

  const attorneyRestricted = attorney.filter((c) => c.sensitivity === 'restricted');
  const paralegalRestricted = paralegal.filter((c) => c.sensitivity === 'restricted');

  assert(
    attorneyRestricted.length > 0,
    'attorney receives restricted chunks',
    `${attorneyRestricted.length} of ${attorney.length}`,
  );
  assert(
    paralegalRestricted.length === 0,
    'paralegal receives none, at any rank',
    `${paralegal.length} chunks, 0 restricted`,
  );
  assert(
    attorney.length > paralegal.length,
    'attorney sees strictly more of the corpus',
    `${attorney.length} vs ${paralegal.length}`,
  );

  // The top-ranked restricted chunk is what a naive post-filter would have
  // leaked. Worth naming so the demo can point at it.
  if (attorneyRestricted.length > 0) {
    const top = attorneyRestricted[0];
    console.log(
      `        (highest-ranked restricted chunk: ${top.documentTitle} — ${top.section}, ${top.similarity.toFixed(3)})`,
    );
  }

  // ------------------------------------------------------- fail-closed SQL
  console.log('\nSQL fails closed for roles the type system would reject');

  for (const role of ['admin', 'intern', '', 'ATTORNEY'] as const) {
    const rows = await rawRetrieve(embedding, 1, role);
    const restricted = rows.filter((r) => r.sensitivity === 'restricted');
    assert(
      restricted.length === 0,
      `role ${JSON.stringify(role)} gets standard only`,
      `${rows.length} rows, 0 restricted`,
    );
  }

  const nullRows = await rawRetrieve(embedding, 1, null);
  assert(
    nullRows.filter((r) => r.sensitivity === 'restricted').length === 0,
    'role NULL gets standard only',
    `${nullRows.length} rows, 0 restricted`,
  );

  // 'ATTORNEY' in capitals must NOT be treated as the attorney role - the
  // comparison is case-sensitive, and that is the safe direction to fail.
  const upper = await rawRetrieve(embedding, 1, 'ATTORNEY');
  assert(
    upper.filter((r) => r.sensitivity === 'restricted').length === 0,
    'role is matched case-sensitively',
    'ATTORNEY !== attorney',
  );

  // ----------------------------------------------------- TypeScript layer
  console.log('\nApplication layer surfaces the bug rather than degrading');

  let threw = false;
  try {
    // @ts-expect-error - deliberately passing a role the signature forbids
    await retrieve({ question: DISINHERITANCE, matterId: 1, role: 'admin' });
  } catch {
    threw = true;
  }
  assert(threw, 'retrieve() throws on an invalid role');

  let threwUndefined = false;
  try {
    // @ts-expect-error - deliberately omitting the role
    await retrieve({ question: DISINHERITANCE, matterId: 1, role: undefined });
  } catch {
    threwUndefined = true;
  }
  assert(threwUndefined, 'retrieve() throws on an undefined role');

  // --------------------------------------------------------- matter scope
  console.log('\nMatter isolation');

  const { rows: docs } = await query<{ id: number; matter_id: number }>(
    'SELECT id, matter_id FROM documents',
  );
  const docsByMatter = new Map<number, Set<number>>();
  for (const d of docs) {
    if (!docsByMatter.has(d.matter_id)) docsByMatter.set(d.matter_id, new Set());
    docsByMatter.get(d.matter_id)!.add(d.id);
  }

  for (const matterId of [1, 2]) {
    const own = docsByMatter.get(matterId)!;
    const rows = await retrieve({
      question: 'Who are the beneficiaries and who serves as fiduciary?',
      matterId,
      role: 'attorney',
      limit: ALL,
    });
    const strays = rows.filter((r) => !own.has(r.documentId));
    assert(
      strays.length === 0 && rows.length > 0,
      `matter ${matterId} returns only its own documents`,
      `${rows.length} chunks, ${strays.length} from other matters`,
    );
  }

  // -------------------------------------------------- what reaches the model
  console.log('\nWhat actually reaches the model');

  const attorneyTop = await retrieve({
    question: DISINHERITANCE,
    matterId: 1,
    role: 'attorney',
  });
  const paralegalTop = await retrieve({
    question: DISINHERITANCE,
    matterId: 1,
    role: 'paralegal',
  });

  const attorneyPrompt = buildPrompt(DISINHERITANCE, attorneyTop);
  const paralegalPrompt = buildPrompt(DISINHERITANCE, paralegalTop);

  const inAttorney = RESTRICTED_MARKERS.filter((m) => attorneyPrompt.includes(m));
  const inParalegal = RESTRICTED_MARKERS.filter((m) => paralegalPrompt.includes(m));

  assert(
    inAttorney.length > 0,
    "attorney's prompt contains the restricted detail",
    inAttorney.join(', '),
  );
  assert(
    inParalegal.length === 0,
    "paralegal's prompt contains none of it",
    inParalegal.length === 0 ? 'no markers present' : `LEAKED: ${inParalegal.join(', ')}`,
  );

  // The prompt must not be doing the work the SQL is supposed to do.
  const withholdingLanguage =
    /do not (reveal|mention|disclose)|confidential|withhold|not authoris|not authoriz/i;
  assert(
    !withholdingLanguage.test(paralegalPrompt),
    'prompt contains no withholding instruction',
    'permissions are enforced in SQL, not by asking the model nicely',
  );

  console.log(
    `\n${passed} passed, ${failed} failed\n`,
  );
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('\nChecks failed to run:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(closePool);
