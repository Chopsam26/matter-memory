import { getPool } from './db';
import { parseFile } from './parse';
import { chunkText } from './chunk';
import { embed } from './ollama';

/**
 * THE ingestion path: parse -> chunk -> embed -> insert.
 *
 * Both scripts/seed.ts and the upload route call this. Per CLAUDE.md there is
 * exactly one of these, and it is not duplicated anywhere.
 */

export type Sensitivity = 'standard' | 'restricted';

export type IngestInput = {
  matterId: number;
  title: string;
  docType: string;
  sensitivity: Sensitivity;
  sourceFilename: string;
  data: Buffer;
};

export type IngestResult = {
  documentId: number;
  chunkCount: number;
  /** Distinct section labels, for reporting what the chunker actually found. */
  sections: string[];
};

/** Pgvector accepts a bracketed list as a text literal, cast on the way in. */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export async function ingestDocument(input: IngestInput): Promise<IngestResult> {
  // Reject an unknown sensitivity rather than guessing. Refusing to ingest is
  // itself the fail-closed outcome: nothing lands, so nothing can leak.
  if (input.sensitivity !== 'standard' && input.sensitivity !== 'restricted') {
    throw new Error(
      `ingestDocument: invalid sensitivity ${JSON.stringify(input.sensitivity)}`,
    );
  }

  const { text } = await parseFile(input.data, input.sourceFilename);
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new Error(`No chunks produced from "${input.sourceFilename}".`);
  }

  // Embed BEFORE opening the transaction. Embedding is by far the slowest part,
  // and holding a write transaction open across it would be wasteful; more
  // usefully, if Ollama fails we have written nothing at all rather than having
  // to roll back.
  const embeddings = await embed(chunks.map((c) => c.content));
  if (embeddings.length !== chunks.length) {
    throw new Error(
      `Embedding count mismatch: ${embeddings.length} vectors for ${chunks.length} chunks.`,
    );
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO documents (matter_id, title, doc_type, sensitivity, source_filename)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        input.matterId,
        input.title,
        input.docType,
        input.sensitivity,
        input.sourceFilename,
      ],
    );
    const documentId = rows[0].id;

    for (let i = 0; i < chunks.length; i++) {
      await client.query(
        `INSERT INTO chunks (document_id, section, ordinal, content, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)`,
        [
          documentId,
          chunks[i].section,
          chunks[i].ordinal,
          chunks[i].content,
          toVectorLiteral(embeddings[i]),
        ],
      );
    }

    await client.query('COMMIT');
    return {
      documentId,
      chunkCount: chunks.length,
      sections: [...new Set(chunks.map((c) => c.section))],
    };
  } catch (err) {
    // A half-ingested document would be worse than none: it would answer
    // questions from the chunks that made it in and silently omit the rest.
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
