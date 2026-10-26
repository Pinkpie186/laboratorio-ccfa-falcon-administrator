import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, ssl: config.databaseSsl ? { rejectUnauthorized: true } : false, max: Number(process.env.PG_POOL_MAX || 12) });

export async function query(text, params = []) { return pool.query(text, params); }
export async function transaction(fn, scope = {}) {
  const client = await pool.connect();
  const rawQuery = client.query.bind(client);
  let queryTail = Promise.resolve();
  client.query = (...args) => {
    const current = queryTail.then(() => rawQuery(...args));
    queryTail = current.catch(() => undefined);
    return current;
  };
  try {
    await client.query('BEGIN');
    if (scope.userId) await client.query("SELECT set_config('app.user_id',$1,true)", [scope.userId]);
    if (scope.teamId) await client.query("SELECT set_config('app.team_id',$1,true)", [scope.teamId]);
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
export async function closeDb() { await pool.end(); }
