import { pool } from '../src/db.js';
import { syncLibrary } from '../src/library-sync.js';

const scope=process.argv.find(value=>value.startsWith('--scope='))?.split('=')[1]||'all';
if(!['all','local','public'].includes(scope))throw new Error('Use --scope=all, --scope=local ou --scope=public.');
try{console.log(JSON.stringify(await syncLibrary({scope}),null,2));}
finally{await pool.end();}
