import pg from 'pg';

const connectionString = process.env.PG_CONNECTION_STRING;
if (!connectionString) throw new Error('PG_CONNECTION_STRING es obligatoria.');

export const pool = new pg.Pool({ connectionString });

// Siempre con parámetros ($1, $2...), nunca texto armado a mano.
export async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(sql, params)).rows;
}
