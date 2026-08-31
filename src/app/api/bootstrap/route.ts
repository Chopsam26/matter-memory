import { listUsers } from '@/lib/auth';
import { listMatters } from '@/lib/matters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Everything the dropdowns need: who you can be, and which matters exist. */
export async function GET() {
  try {
    const [users, matters] = await Promise.all([listUsers(), listMatters()]);
    return Response.json({ users, matters });
  } catch (err) {
    console.error('bootstrap failed:', err);
    return Response.json(
      {
        error:
          'Could not reach the database. Is the container running? Try `npm run db:up`.',
      },
      { status: 500 },
    );
  }
}
