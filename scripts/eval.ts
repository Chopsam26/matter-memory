/**
 * Retrieval evaluation over a fixed question set.
 *
 * Run with: npm run eval
 *
 * Step 5 proves the permission filter is CORRECT. It says nothing about whether
 * retrieval is any GOOD. This measures that against a fixed corpus, so a change
 * to chunk size or overlap can be judged rather than guessed at.
 *
 * Every question runs as the attorney, so the restricted memo is in scope. This
 * loop measures retrieval quality only - permissions are check-permissions.ts's
 * job, and mixing the two would make both harder to read. No LLM anywhere here.
 */
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });

import { readFileSync } from 'node:fs';
import { closePool } from '@/lib/db';
import { retrieve, type RetrievedChunk } from '@/lib/retrieve';

type Kind = 'single' | 'spanning' | 'restricted' | 'unanswerable';

type Question = {
  id: string;
  question: string;
  matterId: number;
  kind: Kind;
  expectedDocuments: string[];
  expectedOrdinals?: number[];
  note?: string;
};

const KS = [1, 3, 6] as const;
const MAX_K = Math.max(...KS);

type Outcome = {
  q: Question;
  chunks: RetrievedChunk[];
  /** Document-level hit at each k. null = not scoreable at that k. */
  docHit: Record<number, boolean | null>;
  /** Exact-chunk hit at each k, only where expectedOrdinals was supplied. */
  chunkHit: Record<number, boolean | null> | null;
  topSimilarity: number;
};

function evaluate(q: Question, chunks: RetrievedChunk[]): Outcome {
  const docHit: Record<number, boolean | null> = {};
  const chunkHit: Record<number, boolean | null> | null = q.expectedOrdinals
    ? {}
    : null;

  for (const k of KS) {
    const top = chunks.slice(0, k);

    // A spanning question needs N distinct documents, so k < N cannot be
    // satisfied no matter how good retrieval is. Mark it unscoreable rather
    // than scoring a structural impossibility as a failure.
    if (q.kind === 'spanning' && k < q.expectedDocuments.length) {
      docHit[k] = null;
      if (chunkHit) chunkHit[k] = null;
      continue;
    }

    if (q.kind === 'spanning') {
      // Stricter bar: EVERY expected document must be present, not just one.
      docHit[k] = q.expectedDocuments.every((d) =>
        top.some((c) => c.documentTitle === d),
      );
    } else {
      docHit[k] = top.some((c) => q.expectedDocuments.includes(c.documentTitle));
    }

    if (chunkHit) {
      chunkHit[k] = top.some(
        (c) =>
          q.expectedDocuments.includes(c.documentTitle) &&
          q.expectedOrdinals!.includes(c.ordinal),
      );
    }
  }

  return {
    q,
    chunks,
    docHit,
    chunkHit,
    topSimilarity: chunks[0]?.similarity ?? 0,
  };
}

function rate(outcomes: Outcome[], k: number, exact = false): string {
  // Drop questions that are not scoreable at this k, rather than counting them
  // as either hits or misses.
  const pool = (exact ? outcomes.filter((o) => o.chunkHit) : outcomes).filter(
    (o) => (exact ? o.chunkHit![k] : o.docHit[k]) !== null,
  );
  if (pool.length === 0) return '   n/a';
  const hits = pool.filter((o) => (exact ? o.chunkHit![k] : o.docHit[k])).length;
  return `${hits}/${pool.length}   (${(hits / pool.length).toFixed(2)})`;
}

function stats(values: number[]) {
  if (values.length === 0) return { min: 0, mean: 0, max: 0 };
  return {
    min: Math.min(...values),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    max: Math.max(...values),
  };
}

async function main() {
  const questions: Question[] = JSON.parse(
    readFileSync('eval/questions.json', 'utf8'),
  );

  const outcomes: Outcome[] = [];
  for (const q of questions) {
    const chunks = await retrieve({
      question: q.question,
      matterId: q.matterId,
      role: 'attorney',
      limit: MAX_K,
    });
    outcomes.push(evaluate(q, chunks));
  }

  const answerable = outcomes.filter((o) => o.q.kind !== 'unanswerable');
  const unanswerable = outcomes.filter((o) => o.q.kind === 'unanswerable');
  const spanning = answerable.filter((o) => o.q.kind === 'spanning');
  // Spanning is scored separately - a much harder bar that would drag the
  // headline number down for reasons unrelated to a chunking change.
  const headline = answerable.filter((o) => o.q.kind !== 'spanning');

  console.log(
    `\nRetrieval evaluation - ${questions.length} questions, ${headline.length} scored in the headline\n`,
  );

  for (const k of KS) {
    console.log(
      `  hit@${k}  ${rate(headline, k)}     exact-chunk hit@${k}  ${rate(headline, k, true)}`,
    );
  }
  console.log(
    `\n  spanning (ALL expected documents present)  ${rate(spanning, MAX_K)} @${MAX_K}`,
  );

  const ans = stats(answerable.map((o) => o.topSimilarity));
  const un = stats(unanswerable.map((o) => o.topSimilarity));
  console.log('\n  top-1 similarity');
  console.log(
    `    answerable    min ${ans.min.toFixed(3)}  mean ${ans.mean.toFixed(3)}  max ${ans.max.toFixed(3)}`,
  );
  console.log(
    `    unanswerable  min ${un.min.toFixed(3)}  mean ${un.mean.toFixed(3)}  max ${un.max.toFixed(3)}`,
  );
  // No threshold is enforced anywhere. This is here so that if the two bands
  // ever overlap, you can see that retrieval is returning confident-looking
  // noise for questions the corpus cannot answer.
  const separated = un.max < ans.min;
  console.log(
    `    ${separated ? 'separated' : 'OVERLAPPING'} - unanswerable max ${un.max.toFixed(3)} vs answerable min ${ans.min.toFixed(3)}`,
  );

  const misses = headline
    .concat(spanning)
    .filter(
      (o) =>
        o.docHit[1] === false ||
        o.docHit[MAX_K] === false ||
        (o.chunkHit && o.chunkHit[1] === false),
    );

  if (misses.length > 0) {
    console.log('\nMISSES');
    for (const o of misses) {
      const what: string[] = [];
      if (o.docHit[MAX_K] === false) what.push(`hit@${MAX_K} MISS`);
      else if (o.docHit[1] === false) what.push('hit@1 miss');
      if (o.chunkHit && o.chunkHit[1] === false) what.push('exact-chunk@1 miss');

      console.log(`\n  [${o.q.id}] ${what.join(', ')}`);
      console.log(
        `    expected: ${o.q.expectedDocuments.join(' + ')}${
          o.q.expectedOrdinals ? ` (ordinal ${o.q.expectedOrdinals.join('/')})` : ''
        }`,
      );
      // What came back instead is what makes a miss actionable - it usually
      // shows a chunk boundary landing mid-clause.
      o.chunks.slice(0, 3).forEach((c, i) => {
        console.log(
          `    ${i === 0 ? 'got:     ' : '         '} #${i + 1} ${c.similarity.toFixed(3)}  ${c.documentTitle} [${c.ordinal}] — ${c.section}`,
        );
      });
    }
  }

  console.log('\nPer question');
  for (const o of outcomes) {
    const firstHit = KS.find((k) => o.docHit[k] === true);
    const mark =
      o.q.kind === 'unanswerable' ? '   -' : firstHit ? `  @${firstHit}` : 'MISS';
    console.log(
      `  ${mark}  ${o.q.kind.padEnd(12)} ${o.topSimilarity.toFixed(3)}  ${o.q.id}`,
    );
  }
  console.log();
}

main()
  .catch((err) => {
    console.error('\nEval failed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(closePool);
