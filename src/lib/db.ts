import { Pool, type QueryResult, type QueryResultRow } from 'pg';

/**
 * A single shared Postgres connection pool.
 *
 * Two details worth knowing:
 *
 * 1. The pool is created lazily, on first use, rather than at import time.
 *    Scripts load .env.local via dotenv, and creating the pool at import time
 *    would read DATABASE_URL before that had a chance to happen.
 *
 * 2. It is stashed on globalThis. Next's dev server re-evaluates modules on
 *    every hot reload, and a module-scoped pool would leak a new set of
 *    connections each time until Postgres refused them.
 */
const globalForDb = globalThis as unknown as { matterMemoryPool?: Pool };

export function getPool(): Pool {
  if (!globalForDb.matterMemoryPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not set. Copy .env.example to .env.local.\n' +
          'Note the port is 5433, not 5432 - see the comment in that file.',
      );
    }
    globalForDb.matterMemoryPool = new Pool({ connectionString });
  }
  return globalForDb.matterMemoryPool;
}

/** Run a parameterised query. Values ALWAYS go in `params`, never in `text`. */
export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/** Scripts call this so the process can exit instead of hanging on open sockets. */
export async function closePool(): Promise<void> {
  if (globalForDb.matterMemoryPool) {
    await globalForDb.matterMemoryPool.end();
    globalForDb.matterMemoryPool = undefined;
  }
}
