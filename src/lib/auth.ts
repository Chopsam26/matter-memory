import { query } from './db';
import type { Role } from './retrieve';

/**
 * The single place a userId becomes a role.
 *
 * There is no real authentication here - CLAUDE.md puts that out of scope, and
 * a dropdown is fine. What is NOT fine is letting the client name its own role:
 * a request body saying `role: 'attorney'` would make the whole demo
 * client-controlled. So the client sends a userId, and the role comes from the
 * database.
 *
 * Both API routes go through this function, and neither reads a role from the
 * request body.
 */

export type User = {
  id: number;
  name: string;
  role: Role;
};

export async function resolveUser(userId: unknown): Promise<User | null> {
  // JSON bodies arrive as `unknown`. Reject anything that is not a plain
  // integer before it reaches the query.
  if (typeof userId !== 'number' || !Number.isInteger(userId)) return null;

  const { rows } = await query<{ id: number; name: string; role: string }>(
    'SELECT id, name, role FROM users WHERE id = $1',
    [userId],
  );
  if (rows.length !== 1) return null;

  const { id, name, role } = rows[0];
  // The CHECK constraint on users.role already guarantees this. Verified again
  // because everything downstream trusts this value, and an unexpected string
  // reaching retrieve() should surface as a null user rather than as a role.
  if (role !== 'attorney' && role !== 'paralegal') return null;

  return { id, name, role };
}

/** For the identity dropdown in the shared header. */
export async function listUsers(): Promise<User[]> {
  const { rows } = await query<{ id: number; name: string; role: Role }>(
    'SELECT id, name, role FROM users ORDER BY id',
  );
  return rows;
}
