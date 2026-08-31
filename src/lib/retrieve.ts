import { query } from './db';
import { embedQuery } from './ollama';

export type Role = 'attorney' | 'paralegal';

export type RetrievedChunk = {
  chunkId: number;
  content: string;
  section: string;
  ordinal: number;
  documentId: number;
  documentTitle: string;
  docType: string;
  sensitivity: 'standard' | 'restricted';
  similarity: number;
};

/**
 * THE retrieval query. There is exactly one copy of it in the codebase.
 *
 * Access control happens HERE, in the WHERE clause, and nowhere else. Postgres
 * evaluates this query in the order:
 *
 *     FROM / JOIN     assemble candidate rows
 *     WHERE           matter scope + role/sensitivity  <- rows discarded here
 *     ORDER BY <=>    rank only the survivors by cosine distance
 *     LIMIT           take the top k of the survivors
 *
 * A restricted chunk is eliminated before it is ever scored, so it cannot place
 * in the top k - it is not in the set being ranked. Nothing downstream, not the
 * prompt builder and not the model, ever observes that it exists.
 *
 * The filter expression fails closed. An unrecognised role makes the first
 * branch false, leaving standard rows only. A NULL role makes it NULL, which
 * WHERE treats as not-true, so restricted rows are excluded again. Both cases
 * are asserted in scripts/check-permissions.ts rather than left to inspection.
 *
 * Exported so that the permission checks can run this exact text against roles
 * the TypeScript signature forbids, without a second copy of the query drifting
 * out of step with this one.
 */
export const RETRIEVAL_SQL = `
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
    AND ($3::text = 'attorney' OR d.sensitivity = 'standard')
  ORDER BY c.embedding <=> $1::vector
  LIMIT $4
`;

export const DEFAULT_LIMIT = 6;

type RawRow = {
  chunk_id: number;
  content: string;
  section: string;
  ordinal: number;
  document_id: number;
  document_title: string;
  doc_type: string;
  sensitivity: 'standard' | 'restricted';
  similarity: string;
};

function toChunk(row: RawRow): RetrievedChunk {
  return {
    chunkId: row.chunk_id,
    content: row.content,
    section: row.section,
    ordinal: row.ordinal,
    documentId: row.document_id,
    documentTitle: row.document_title,
    docType: row.doc_type,
    sensitivity: row.sensitivity,
    // pg returns float8 as a string to avoid precision loss.
    similarity: Number(row.similarity),
  };
}

/** Pgvector accepts a bracketed list as a text literal, cast on the way in. */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export type RetrieveOptions = {
  question: string;
  matterId: number;
  role: Role;
  limit?: number;
};

export async function retrieve(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
  // Redundant against the SQL, which would already return standard-only for a
  // bad value - and that redundancy is the point. The database keeps the data
  // safe; this makes sure a bug in the caller is noticed instead of silently
  // degrading into plausible-looking results.
  if (opts.role !== 'attorney' && opts.role !== 'paralegal') {
    throw new Error(`retrieve(): invalid role ${JSON.stringify(opts.role)}`);
  }

  const embedding = await embedQuery(opts.question);
  const { rows } = await query<RawRow>(RETRIEVAL_SQL, [
    toVectorLiteral(embedding),
    opts.matterId,
    opts.role,
    opts.limit ?? DEFAULT_LIMIT,
  ]);
  return rows.map(toChunk);
}
