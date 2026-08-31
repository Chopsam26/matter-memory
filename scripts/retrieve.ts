/**
 * Retrieval only - no LLM in the loop, so retrieval quality is judged on its
 * own rather than through whatever the model made of it.
 *
 *   npm run retrieve -- <matterId> <role> "<question>" [limit]
 *
 * e.g.
 *   npm run retrieve -- 1 attorney  "Why was Daniel excluded from the estate?"
 *   npm run retrieve -- 1 paralegal "Why was Daniel excluded from the estate?"
 */
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });

import { closePool } from '@/lib/db';
import { retrieve, DEFAULT_LIMIT, type Role } from '@/lib/retrieve';

async function main() {
  const [matterArg, roleArg, question, limitArg] = process.argv.slice(2);

  if (!matterArg || !roleArg || !question) {
    console.error(
      '\nUsage: npm run retrieve -- <matterId> <role> "<question>" [limit]\n',
    );
    process.exitCode = 1;
    return;
  }

  const matterId = Number(matterArg);
  const limit = limitArg ? Number(limitArg) : DEFAULT_LIMIT;
  const role = roleArg as Role;

  console.log(`\nmatter ${matterId}  as ${role}  top ${limit}`);
  console.log(`"${question}"\n`);

  const chunks = await retrieve({ question, matterId, role, limit });

  if (chunks.length === 0) {
    console.log('  no chunks retrieved\n');
    return;
  }

  for (const [i, c] of chunks.entries()) {
    const flag = c.sensitivity === 'restricted' ? '  [RESTRICTED]' : '';
    console.log(
      `  #${i + 1}  ${c.similarity.toFixed(3)}  ${c.documentTitle}${flag}`,
    );
    console.log(`      ${c.section}`);
    console.log(
      `      ${c.content.replace(/\s+/g, ' ').slice(0, 150).trim()}...\n`,
    );
  }

  const restricted = chunks.filter((c) => c.sensitivity === 'restricted').length;
  console.log(
    `  ${chunks.length} chunks, ${restricted} restricted, ${chunks.length - restricted} standard\n`,
  );
}

main()
  .catch((err) => {
    console.error('\nFailed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(closePool);
