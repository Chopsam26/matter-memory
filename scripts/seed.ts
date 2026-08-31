/**
 * Load the baseline demo corpus: 2 matters, 2 users, 8 documents.
 *
 * Run with: npm run seed
 *
 * This is the fallback if upload ever breaks, so it must keep working after the
 * upload page exists. It calls the same ingestDocument() the upload route does -
 * there is no second ingestion path here.
 *
 * DESTRUCTIVE: truncates every table first so it can be re-run freely. Anything
 * uploaded through the UI is deleted too.
 */
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { query, closePool } from '@/lib/db';
import { ingestDocument, type Sensitivity } from '@/lib/ingest';

const SEED_DIR = 'seed';

type MatterSeed = { key: string; clientName: string; title: string };

const MATTERS: MatterSeed[] = [
  {
    key: 'hollis',
    clientName: 'Margaret Anne Hollis',
    title: 'Estate of Margaret Hollis',
  },
  {
    key: 'reyes',
    clientName: 'Thomas Andres Reyes',
    title: 'Estate of Thomas Reyes',
  },
];

const USERS = [
  { name: 'Eleanor Vance', role: 'attorney' },
  { name: 'Marcus Webb', role: 'paralegal' },
] as const;

type DocumentSeed = {
  file: string;
  matter: string;
  title: string;
  docType: string;
  sensitivity: Sensitivity;
};

/** Mirrors the table in seed/README.md. */
const DOCUMENTS: DocumentSeed[] = [
  {
    file: '01-hollis-will.txt',
    matter: 'hollis',
    title: 'Last Will and Testament of Margaret Hollis',
    docType: 'will',
    sensitivity: 'standard',
  },
  {
    file: '02-hollis-revocable-trust.txt',
    matter: 'hollis',
    title: 'The Margaret A. Hollis Revocable Trust',
    docType: 'trust',
    sensitivity: 'standard',
  },
  {
    file: '03-hollis-poa.txt',
    matter: 'hollis',
    title: 'Durable Power of Attorney - Margaret Hollis',
    docType: 'poa',
    sensitivity: 'standard',
  },
  {
    file: '04-hollis-deed.txt',
    matter: 'hollis',
    title: 'Quitclaim Deed - 14 Willow Lane',
    docType: 'deed',
    sensitivity: 'standard',
  },
  {
    file: '05-hollis-account-statement.txt',
    matter: 'hollis',
    title: 'Merchant & Coastal Bank Statement - Q4 2024',
    docType: 'statement',
    sensitivity: 'standard',
  },
  {
    file: '06-hollis-confidential-memo.txt',
    matter: 'hollis',
    title: 'Confidential Memorandum - Omission of Daniel Hollis',
    docType: 'memo',
    sensitivity: 'restricted',
  },
  {
    file: '07-reyes-will.txt',
    matter: 'reyes',
    title: 'Last Will and Testament of Thomas Reyes',
    docType: 'will',
    sensitivity: 'standard',
  },
  {
    file: '08-reyes-account-statement.txt',
    matter: 'reyes',
    title: 'Harbor Trust Savings Bank Statement - Q4 2024',
    docType: 'statement',
    sensitivity: 'standard',
  },
];

async function main() {
  console.log('\nSeeding Matter Memory\n');
  console.log(
    '  This DELETES all existing data, including anything uploaded through',
  );
  console.log('  the UI, and reloads the baseline corpus from seed/.\n');

  // RESTART IDENTITY so ids are stable across runs - eval/questions.json and
  // the verification commands in PLAN.md refer to matter 1 and matter 2.
  await query('TRUNCATE matters, users, documents, chunks RESTART IDENTITY CASCADE');
  console.log('  truncated all tables\n');

  const matterIds = new Map<string, number>();
  for (const matter of MATTERS) {
    const { rows } = await query<{ id: number }>(
      'INSERT INTO matters (client_name, title) VALUES ($1, $2) RETURNING id',
      [matter.clientName, matter.title],
    );
    matterIds.set(matter.key, rows[0].id);
    console.log(`  matter ${rows[0].id}  ${matter.title}`);
  }

  for (const user of USERS) {
    const { rows } = await query<{ id: number }>(
      'INSERT INTO users (name, role) VALUES ($1, $2) RETURNING id',
      [user.name, user.role],
    );
    console.log(`  user   ${rows[0].id}  ${user.name} (${user.role})`);
  }

  console.log('\n  ingesting documents (embedding runs here, so this is slow)\n');

  let totalChunks = 0;
  for (const doc of DOCUMENTS) {
    const matterId = matterIds.get(doc.matter);
    if (matterId === undefined) {
      throw new Error(`Unknown matter key "${doc.matter}" for ${doc.file}`);
    }

    const started = Date.now();
    const result = await ingestDocument({
      matterId,
      title: doc.title,
      docType: doc.docType,
      sensitivity: doc.sensitivity,
      sourceFilename: doc.file,
      data: readFileSync(join(SEED_DIR, doc.file)),
    });
    totalChunks += result.chunkCount;

    const flag = doc.sensitivity === 'restricted' ? ' [RESTRICTED]' : '';
    console.log(
      `  ${String(result.chunkCount).padStart(2)} chunks  ${((Date.now() - started) / 1000).toFixed(1)}s  ${doc.title}${flag}`,
    );
  }

  // Report from the database rather than from the loop counters, so the numbers
  // reflect what actually landed.
  const { rows: counts } = await query<{
    matters: string;
    users: string;
    documents: string;
    chunks: string;
  }>(
    `SELECT (SELECT count(*) FROM matters)   AS matters,
            (SELECT count(*) FROM users)     AS users,
            (SELECT count(*) FROM documents) AS documents,
            (SELECT count(*) FROM chunks)    AS chunks`,
  );
  const c = counts[0];

  console.log(
    `\n  ${c.matters} matters, ${c.users} users, ${c.documents} documents, ${c.chunks} chunks\n`,
  );

  const { rows: breakdown } = await query<{
    title: string;
    sensitivity: string;
    documents: string;
    chunks: string;
  }>(
    `SELECT m.title, d.sensitivity,
            count(DISTINCT d.id) AS documents,
            count(c.id)          AS chunks
       FROM matters m
       JOIN documents d ON d.matter_id = m.id
       LEFT JOIN chunks c ON c.document_id = d.id
      GROUP BY m.title, d.sensitivity
      ORDER BY m.title, d.sensitivity`,
  );
  for (const row of breakdown) {
    console.log(
      `  ${row.title.padEnd(28)} ${row.sensitivity.padEnd(11)} ${row.documents} docs, ${row.chunks} chunks`,
    );
  }

  if (Number(c.documents) !== DOCUMENTS.length) {
    throw new Error(
      `Expected ${DOCUMENTS.length} documents but found ${c.documents}.`,
    );
  }
  if (totalChunks !== Number(c.chunks)) {
    throw new Error(
      `Ingested ${totalChunks} chunks but the database holds ${c.chunks}.`,
    );
  }

  console.log('\nSeed complete.\n');
}

main()
  .catch((err) => {
    console.error('\nSeed failed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(closePool);
