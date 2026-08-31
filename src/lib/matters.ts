import { query } from './db';

export type Matter = {
  id: number;
  clientName: string;
  title: string;
};

export async function listMatters(): Promise<Matter[]> {
  const { rows } = await query<{ id: number; client_name: string; title: string }>(
    'SELECT id, client_name, title FROM matters ORDER BY id',
  );
  return rows.map((r) => ({ id: r.id, clientName: r.client_name, title: r.title }));
}

/** Does this matter exist? Checked before ingesting into it. */
export async function matterExists(matterId: number): Promise<boolean> {
  const { rows } = await query('SELECT 1 FROM matters WHERE id = $1', [matterId]);
  return rows.length === 1;
}
