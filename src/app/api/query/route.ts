import { resolveUser } from '@/lib/auth';
import { matterExists } from '@/lib/matters';
import { answerQuestion } from '@/lib/answer';

export const runtime = 'nodejs';
// Generation is not streamed (out of scope per CLAUDE.md), so one request
// covers embedding, retrieval and the full completion.
export const maxDuration = 300;

export async function POST(request: Request) {
  let body: { userId?: unknown; matterId?: unknown; question?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  // Identity first. Note what is NOT read from the body: a role. If the request
  // carries `role: "attorney"` it is ignored entirely - the role comes from the
  // users table, keyed by id. Nothing below this line runs for an unknown user,
  // so no embedding call and no retrieval happens.
  const user = await resolveUser(
    typeof body.userId === 'number' ? body.userId : Number(body.userId),
  );
  if (!user) {
    return Response.json({ error: 'Unknown user.' }, { status: 401 });
  }

  const matterId = Number(body.matterId);
  if (!Number.isInteger(matterId) || !(await matterExists(matterId))) {
    return Response.json({ error: 'Choose a matter.' }, { status: 400 });
  }

  const question = String(body.question ?? '').trim();
  if (question.length < 3) {
    return Response.json({ error: 'Ask a question.' }, { status: 400 });
  }

  try {
    const result = await answerQuestion({ question, matterId, role: user.role });

    return Response.json({
      answer: result.answer,
      citations: result.citations,
      // The evidence panel. This is exactly what the SQL returned and exactly
      // what the prompt was built from - nothing is filtered out here.
      chunks: result.chunks,
      // Echoed back from the server's own lookup, so the page can show which
      // role actually ran the query rather than which one it thinks it picked.
      user: { id: user.id, name: user.name, role: user.role },
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Cannot reach Ollama')) {
      return Response.json({ error: err.message }, { status: 503 });
    }
    console.error('query failed:', err);
    return Response.json({ error: 'Query failed. Check the server log.' }, { status: 500 });
  }
}
