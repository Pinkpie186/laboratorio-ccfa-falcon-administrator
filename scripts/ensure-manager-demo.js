import {pool} from '../src/db.js';
import {hashPassword} from '../src/security.js';

const client=await pool.connect();
try{
  await client.query('BEGIN');
  const team=(await client.query("SELECT id FROM teams WHERE slug='demo-team' ORDER BY created_at LIMIT 1")).rows[0]||
    (await client.query('SELECT id FROM teams ORDER BY created_at LIMIT 1')).rows[0];
  if(team){
    const email='gerente.demo@example.invalid';
    let user=(await client.query('SELECT id FROM users WHERE email=$1',[email])).rows[0];
    if(!user&&process.env.DEMO_MANAGER_PASSWORD){const password=process.env.DEMO_MANAGER_PASSWORD;if(password.length<12)throw new Error('DEMO_MANAGER_PASSWORD deve ter pelo menos 12 caracteres.');user=(await client.query('INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id',[email,'Gerente Demo',await hashPassword(password)])).rows[0];}
    if(user)await client.query(`INSERT INTO memberships(team_id,user_id,role_id)
      SELECT $1,$2,id FROM roles WHERE code='manager'
      ON CONFLICT(team_id,user_id) DO UPDATE SET role_id=EXCLUDED.role_id`,[team.id,user.id]);
  }
  await client.query('COMMIT');
}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await pool.end();}
