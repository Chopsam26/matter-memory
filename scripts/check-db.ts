/**
 * Step 1 verification: is Postgres up, is pgvector actually working, and is the
 * schema what we think it is?
 *
 * Run with: npm run check:db
 */
import { config } from 'dotenv';

// dotenv's default is `.env`; we keep ours in `.env.local` to match Next.
// This runs before any query because getPool() builds the pool lazily.
config({ path: '.env.local' });

import { query, closePool } from '@/lib/db';

const EXPECTED_TABLES = ['chunks', 'documents', 'matters', 'users'];

let failures = 0;

function report(ok: boolean, label: string, detail: string) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label.padEnd(28)} ${detail}`);
  if (!ok) failures++;
}

async function main() {
  console.log('\nChecking database at', process.env.DATABASE_URL ?? '(unset)', '\n');

  // 1. Can we connect at all, and to what?
  const { rows: version } = await query<{ v: string }>('SELECT version() AS v');
  report(true, 'connected', version[0].v.split(',')[0]);

  // 2. Is the pgvector extension installed?
  const { rows: ext } = await query<{ extversion: string }>(
    `SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
  );
  report(ext.length === 1, 'pgvector extension', ext[0]?.extversion ?? 'NOT INSTALLED');

  // 3. Do all four tables exist? Listing what we found beats a bare boolean when
  //    the answer is "the init script never ran".
  const { rows: tables } = await query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  const found = tables.map((t) => t.tablename);
  const missing = EXPECTED_TABLES.filter((t) => !found.includes(t));
  report(
    missing.length === 0,
    'tables',
    missing.length === 0 ? found.join(', ') : `missing: ${missing.join(', ')}`,
  );

  // 4. Is the embedding column the right type AND the right dimension? A
  //    vector(1536) would fail only much later, at the first insert.
  const { rows: col } = await query<{ type: string }>(
    `SELECT format_type(a.atttypid, a.atttypmod) AS type
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'chunks' AND a.attname = 'embedding' AND a.attnum > 0`,
  );
  report(col[0]?.type === 'vector(768)', 'chunks.embedding', col[0]?.type ?? 'NOT FOUND');

  // 5. Prove the extension actually computes, rather than merely being listed.
  //    Cosine distance: 0 for identical vectors, 1 for orthogonal ones.
  const { rows: math } = await query<{ same: number; orthogonal: number }>(
    `SELECT '[1,0,0]'::vector <=> '[1,0,0]'::vector AS same,
            '[1,0,0]'::vector <=> '[0,1,0]'::vector AS orthogonal`,
  );
  const { same, orthogonal } = math[0];
  report(
    Number(same) === 0 && Number(orthogonal) === 1,
    'cosine distance <=>',
    `identical=${same}, orthogonal=${orthogonal}`,
  );

  console.log(
    failures === 0
      ? '\nAll checks passed.\n'
      : `\n${failures} check(s) failed. If the schema is missing, the volume predates ` +
          'db/schema.sql - run `npm run db:reset`.\n',
  );
}

/**
 * A refused connection arrives as an AggregateError (one failure per resolved
 * address) whose own `message` is empty, so unwrap it rather than printing
 * a blank line.
 */
function describe(err: unknown): string {
  if (err instanceof AggregateError) {
    return err.errors.map(describe).join('; ');
  }
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return err.message || (code ? `${code} (no message)` : err.name);
  }
  return String(err);
}

main()
  .catch((err) => {
    console.error('\nCheck failed:', describe(err));
    console.error(
      '\nIs the container up? Try `npm run db:up`. Note the port is 5433, not 5432.\n',
    );
    failures++;
  })
  .finally(async () => {
    await closePool();
    process.exit(failures === 0 ? 0 : 1);
  });
