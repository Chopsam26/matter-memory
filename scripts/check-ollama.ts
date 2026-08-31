/**
 * Step 2 verification: is Ollama reachable, do both models load, and does
 * embedding produce a 768-dim vector?
 *
 * Run with: npm run check:ollama
 */
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });

import {
  embed,
  embedQuery,
  generate,
  listModels,
  config,
  EMBEDDING_DIMENSIONS,
} from '@/lib/ollama';

let failures = 0;

function report(ok: boolean, label: string, detail: string) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label.padEnd(26)} ${detail}`);
  if (!ok) failures++;
}

/** Cosine similarity, so we can show the embeddings carry real meaning. */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function main() {
  console.log(`\nChecking Ollama at ${config.BASE_URL}\n`);

  const models = await listModels();
  report(true, 'reachable', `${models.length} models installed`);
  report(
    models.some((m) => m.startsWith(config.EMBED_MODEL)),
    'embed model present',
    config.EMBED_MODEL,
  );
  report(
    models.some((m) => m.startsWith(config.CHAT_MODEL)),
    'chat model present',
    config.CHAT_MODEL,
  );

  // The headline check: embed a string, print the vector.
  const [vector] = await embed(['The residuary estate passes to the surviving spouse.']);
  report(
    vector.length === EMBEDDING_DIMENSIONS,
    'embedding dimensions',
    String(vector.length),
  );
  console.log(
    `\n  first 8 of ${vector.length}: [${vector.slice(0, 8).map((n) => n.toFixed(5)).join(', ')}, ...]\n`,
  );

  // Batching matters: ingestion embeds many chunks per document.
  const batch = await embed(['first passage', 'second passage', 'third passage']);
  report(batch.length === 3, 'batch embedding', `${batch.length} vectors from 1 request`);

  // Prove the vectors carry meaning, rather than merely being the right shape.
  // A related question should sit closer to the passage than an unrelated one.
  const passage = 'The residuary estate passes to the surviving spouse.';
  const [passageVec] = await embed([passage]);
  const relatedVec = await embedQuery('Who inherits the remainder of the estate?');
  const unrelatedVec = await embedQuery('How do I replace a bicycle tyre?');
  const related = cosine(passageVec, relatedVec);
  const unrelated = cosine(passageVec, unrelatedVec);
  report(
    related > unrelated,
    'semantic sanity',
    `related=${related.toFixed(3)} > unrelated=${unrelated.toFixed(3)}`,
  );

  // Generation, non-streaming.
  const answer = await generate(
    'Reply with exactly the word READY and nothing else.',
  );
  report(answer.toUpperCase().includes('READY'), 'generation', JSON.stringify(answer));

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
}

main()
  .catch((err) => {
    console.error('\nCheck failed:', err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.cause) console.error('Cause:', String(err.cause));
    failures++;
  })
  .finally(() => process.exit(failures === 0 ? 0 : 1));
