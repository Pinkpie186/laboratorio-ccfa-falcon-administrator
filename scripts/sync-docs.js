import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, transaction } from '../src/db.js';
import { config } from '../src/config.js';
import { sha256 } from '../src/security.js';

const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const catalog=JSON.parse(await fs.readFile(path.join(base,'data/official-catalog.json'),'utf8'));
const savedReport=JSON.parse(await fs.readFile(path.join(base,'data/import-report.json'),'utf8'));
const pause=process.argv.includes('--pause'),teamSlug=process.env.IMPORT_TEAM_SLUG||'equipe-demo';
const stats={reportedTotal:catalog.reportedTotal,found:catalog.documents.length,importedWithFullText:0,catalogedMetadataOnly:0,updated:0,duplicates:0,failures:0,questionsGenerated:0,questionsAwaitingReview:0,byCategory:{}};

async function sync(){
  const team=(await pool.query('SELECT id FROM teams WHERE slug=$1',[teamSlug])).rows[0];
  if(!team)throw new Error(`Equipe '${teamSlug}' não encontrada. Execute as migrações e o seed.`);
  const previous=(await transaction(c=>c.query("SELECT * FROM import_runs WHERE team_id=$1 AND source=$2 AND status IN ('running','paused','checkpoint_saved') ORDER BY started_at DESC LIMIT 1",[team.id,catalog.source]),{teamId:team.id})).rows[0];
  const start=Math.min(Number(previous?.checkpoint?.offset||0),catalog.documents.length);
  const run=previous||await transaction(async c=>(await c.query("INSERT INTO import_runs(team_id,source,status,checkpoint,stats) VALUES($1,$2,'running',$3,$4) RETURNING *",[team.id,catalog.source,JSON.stringify({offset:0,page:1,complete:false}),JSON.stringify(stats)])).rows[0],{teamId:team.id});
  if(pause){await transaction(c=>c.query("UPDATE import_runs SET status='paused' WHERE id=$1",[run.id]),{teamId:team.id});return{...stats,status:'paused',checkpoint:run.checkpoint};}
  for(let offset=start;offset<catalog.documents.length;offset+=config.docBatchSize){
    const batch=catalog.documents.slice(offset,offset+config.docBatchSize);
    for(const item of batch){
      let lastError;
      for(let attempt=1;attempt<=config.docRetryLimit;attempt++){
        try{
          const outcome=await transaction(async c=>{
            const digest=sha256(JSON.stringify(item));
            let document=(await c.query('SELECT * FROM documents WHERE team_id=$1 AND (source_url=$2 OR external_id=$3) LIMIT 1',[team.id,item.url,item.externalId])).rows[0];
            if(!document)document=(await c.query(`INSERT INTO documents(team_id,external_id,title,category,product,language,source_url,source_kind,access_mode,publication_date,synchronized_at) VALUES($1,$2,$3,$4,$5,'pt-BR',$6,'official_catalog','portal_only',$7,$8) RETURNING *`,[team.id,item.externalId,item.title,item.category,item.product,item.url,item.published||null,catalog.capturedAt])).rows[0];
            else await c.query('UPDATE documents SET title=$1,category=$2,product=$3,publication_date=$4,synchronized_at=$5 WHERE id=$6',[item.title,item.category,item.product,item.published||null,catalog.capturedAt,document.id]);
            const existing=(await c.query('SELECT id FROM document_versions WHERE document_id=$1 AND sha256=$2',[document.id,digest])).rows[0];
            if(existing){await c.query('UPDATE documents SET current_version_id=$1 WHERE id=$2',[existing.id,document.id]);return'duplicate';}
            const version=(await c.query(`INSERT INTO document_versions(document_id,version_label,sha256,mime_type,byte_size,extraction_status,metadata) VALUES($1,$2,$3,'text/html',0,'metadata_only',$4) RETURNING id`,[document.id,item.version||null,digest,JSON.stringify({portalOnly:true,reason:'Consulta no portal CrowdStrike; texto não exportado.'})])).rows[0];
            await c.query('UPDATE documents SET current_version_id=$1 WHERE id=$2',[version.id,document.id]);return document.current_version_id?'updated':'cataloged';
          },{teamId:team.id});
          if(outcome==='duplicate')stats.duplicates++;else if(outcome==='updated')stats.updated++;else stats.catalogedMetadataOnly++;
          stats.byCategory[item.category]=(stats.byCategory[item.category]||0)+1;lastError=null;break;
        }catch(error){lastError=error;if(attempt<config.docRetryLimit)await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**attempt,5000)));}
      }
      if(lastError){stats.failures++;console.error(`${item.externalId}: ${lastError.message}`);}
    }
    const next=Math.min(offset+batch.length,catalog.documents.length),complete=next>=catalog.documents.length;
    await transaction(c=>c.query("UPDATE import_runs SET status=$1,checkpoint=$2,stats=$3,finished_at=CASE WHEN $1='complete' THEN now() END WHERE id=$4",[complete?'complete':'checkpoint_saved',JSON.stringify({page:1,offset:next,complete}),JSON.stringify(stats),run.id]),{teamId:team.id});
  }
  return{...stats,status:'complete',checkpoint:{page:1,offset:catalog.documents.length,complete:true},lastSynchronization:new Date().toISOString()};
}

try{console.log(JSON.stringify(await sync(),null,2));}
catch(error){
  if(['ECONNREFUSED','ENOTFOUND'].includes(error.code))console.log(JSON.stringify({...savedReport,databaseImport:'pending',databaseReason:'PostgreSQL indisponível; checkpoint em arquivo preservado.'},null,2));
  else{console.error(error);process.exitCode=1;}
}finally{await pool.end().catch(()=>{});}
