/**
 * The full RAG loop from the command line - retrieve, generate, cite. No UI.
 *
 *   npm run ask -- <userId> <matterId> "<question>"
 *
 * Takes a userId rather than a role, exactly as the API will: the role is read
 * from the database, never supplied by the caller.
 *
 *   npm run ask -- 1 1 "Why was Daniel excluded from the estate?"   # attorney
 *   npm run ask -- 2 1 "Why was Daniel excluded from the estate?"   # paralegal
 *
 * Pass --prompt to print the exact text sent to the model.
 */
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });

import { closePool } from '@/lib/db';
import { resolveUser } from '@/lib/auth';
import { answerQuestion } from '@/lib/answer';

async function main() {
  const args = process.argv.slice(2);
  const showPrompt = args.includes('--prompt');
  const [userArg, matterArg, question] = args.filter((a) => a !== '--prompt');

  if (!userArg || !matterArg || !question) {
    console.error('\nUsage: npm run ask -- <userId> <matterId> "<question>" [--prompt]\n');
    process.exitCode = 1;
    return;
  }

  const user = await resolveUser(Number(userArg));
  if (!user) {
    // Same behaviour the API route will have: refuse before retrieving.
    console.error(`\nUnknown user ${userArg}. Nothing retrieved.\n`);
    process.exitCode = 1;
    return;
  }

  const matterId = Number(matterArg);
  console.log(`\n${user.name} (${user.role})  matter ${matterId}`);
  console.log(`"${question}"\n`);

  const started = Date.now();
  const result = await answerQuestion({ question, matterId, role: user.role });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (showPrompt) {
    console.log('--- PROMPT SENT TO MODEL ---');
    console.log(result.prompt || '(no prompt - nothing was retrieved)');
    console.log('--- END PROMPT ---\n');
  }

  console.log(result.answer);
  console.log();

  if (result.citations.length > 0) {
    console.log('  Sources');
    for (const c of result.citations) {
      console.log(`    [${c.n}] ${c.documentTitle} — ${c.section}`);
    }
    console.log();
  }

  const restricted = result.chunks.filter((c) => c.sensitivity === 'restricted');
  console.log(
    `  ${result.chunks.length} chunks retrieved (${restricted.length} restricted), ${seconds}s\n`,
  );
}

main()
  .catch((err) => {
    console.error('\nFailed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(closePool);
