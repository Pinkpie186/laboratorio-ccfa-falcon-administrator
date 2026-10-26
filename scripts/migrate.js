import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../migrations');
await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
for(const name of (await fs.readdir(base)).filter(x=>x.endsWith('.sql')).sort()){
  if((await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name])).rowCount)continue;
  const client=await pool.connect(); try{await client.query('BEGIN');let sql=await fs.readFile(path.join(base,name),'utf8');if(process.env.PGLITE_LOCAL==='1')sql=sql.replace(/^CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/m,'');await client.query(sql);await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);await client.query('COMMIT');console.log(`aplicada ${name}`);}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
await pool.end();

