import { generate } from './ollama';
import { retrieve, DEFAULT_LIMIT, type RetrievedChunk, type Role } from './retrieve';

export type Citation = {
  n: number;
  documentId: number;
  documentTitle: string;
  section: string;
  chunkId: number;
};

export type AnswerResult = {
  answer: string;
  /** Exactly what the SQL returned - the evidence panel on the query page. */
  chunks: RetrievedChunk[];
  /** Only the excerpts the model actually cited. */
  citations: Citation[];
  /** The full text sent to the model, so it can be inspected. */
  prompt: string;
};

export const NO_ANSWER = 'The documents available for this matter do not cover that.';

/**
 * Build the generation prompt from the retrieved chunks.
 *
 * IMPORTANT - the one rule this project exists to demonstrate:
 *
 * This prompt contains NO instruction to withhold anything. It cannot, because
 * restricted content is not here to withhold: it was excluded by the WHERE
 * clause in retrieve() and never entered this function. `chunks` holds only
 * what the caller's role was permitted to retrieve.
 *
 * What the prompt DOES instruct is grounding - "use only these excerpts" - which
 * is a quality instruction about not inventing law, not a permission control.
 * The distinction is easy to blur, and blurring it is the failure mode this
 * design replaces. If a future edit here starts to read "you may see
 * confidential material, do not mention it", that is a signal the SQL is wrong,
 * not the prompt.
 */
export function buildPrompt(question: string, chunks: RetrievedChunk[]): string {
  const excerpts = chunks
    .map(
      (c, i) =>
        `[${i + 1}] ${c.documentTitle} — ${c.section}\n${c.content.trim()}`,
    )
    .join('\n\n');

  return `You are assisting a lawyer at an estate planning firm. Answer the question using only the numbered excerpts below, which are taken from this client matter's file.

Rules:
- Use only these excerpts. Do not draw on legal knowledge from anywhere else.
- Cite every factual claim with its excerpt number in square brackets, like [2]. Cite more than one where more than one applies.
- Put each citation immediately after the claim it supports, never at the start of a sentence.
- Quote names, figures and dates exactly as they appear.
- If the excerpts do not answer the question, reply with exactly this sentence and nothing more: ${NO_ANSWER}

EXCERPTS
${excerpts}

QUESTION
${question}

ANSWER`;
}

/** Pull the [n] markers the model used, in order of first appearance. */
export function extractCitations(
  answer: string,
  chunks: RetrievedChunk[],
): Citation[] {
  const seen = new Set<number>();
  const citations: Citation[] = [];
  for (const match of answer.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1]);
    // Ignore a number the model invented that has no corresponding excerpt.
    if (n < 1 || n > chunks.length || seen.has(n)) continue;
    seen.add(n);
    const c = chunks[n - 1];
    citations.push({
      n,
      documentId: c.documentId,
      documentTitle: c.documentTitle,
      section: c.section,
      chunkId: c.chunkId,
    });
  }
  return citations;
}

export type AnswerOptions = {
  question: string;
  matterId: number;
  role: Role;
  limit?: number;
};

export async function answerQuestion(opts: AnswerOptions): Promise<AnswerResult> {
  const chunks = await retrieve({
    question: opts.question,
    matterId: opts.matterId,
    role: opts.role,
    limit: opts.limit ?? DEFAULT_LIMIT,
  });

  // Nothing survived the filter. Say so without calling the model at all -
  // there is no context for it to ground an answer in.
  if (chunks.length === 0) {
    return { answer: NO_ANSWER, chunks: [], citations: [], prompt: '' };
  }

  const prompt = buildPrompt(opts.question, chunks);
  const answer = await generate(prompt);
  return { answer, chunks, citations: extractCitations(answer, chunks), prompt };
}
