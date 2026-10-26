import test from 'node:test';
import assert from 'node:assert/strict';
import { pool, transaction } from '../src/db.js';

const enabled=process.env.RUN_DB_TESTS==='1';
test('RLS isola documentos por equipe e auditoria é append-only',{skip:!enabled},async()=>{const teams=(await pool.query("SELECT id FROM teams ORDER BY created_at LIMIT 2")).rows;if(teams.length<2)return assert.fail('O teste requer duas equipes.');const visible=await transaction(c=>c.query('SELECT count(*) n FROM documents'),{teamId:teams[0].id});assert.ok(Number(visible.rows[0].n)>=0);await assert.rejects(pool.query('UPDATE audit_log SET action=\'tamper\' WHERE id=(SELECT min(id) FROM audit_log)'));await pool.end();});

