import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pool} from '../src/db.js';

const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const data=JSON.parse(await fs.readFile(path.join(base,'seed/ccfa-module-summaries.json'),'utf8'));
const lessonData=JSON.parse(await fs.readFile(path.join(base,'seed/ccfa-academy-lessons.json'),'utf8'));
const client=await pool.connect();

try{
  await client.query('BEGIN');
  let updated=0;
  let lessonsUpdated=0;
  for(const [code,modules] of Object.entries(data.courses)){
    const course=(await client.query('SELECT id FROM courses WHERE code=$1',[code])).rows[0];
    if(!course)continue;
    for(const [index,module] of modules.entries()){
      await client.query(`
        INSERT INTO submodules(
          course_id,title,position,source_type,notes,source_url,verified_at,
          summary,key_points,summary_source_url,summary_consulted_at
        ) VALUES($1,$2,$3,'authorized_import',$4,$5,$6,$7,$8,$5,$6)
        ON CONFLICT(course_id,title) DO UPDATE SET
          position=EXCLUDED.position,
          source_type='authorized_import',
          source_url=EXCLUDED.source_url,
          verified_at=COALESCE(submodules.verified_at,EXCLUDED.verified_at),
          summary=EXCLUDED.summary,
          key_points=EXCLUDED.key_points,
          summary_source_url=EXCLUDED.summary_source_url,
          summary_consulted_at=EXCLUDED.summary_consulted_at
      `,[course.id,module.title,index+1,'Título confirmado no índice autenticado; resumo autoral sem reprodução de conteúdo fechado.',data.source,data.consultedAt,module.summary,JSON.stringify(module.keyPoints||[])]);
      updated++;
    }
  }
  for(const [code,modules] of Object.entries(lessonData.courses)){
    const course=(await client.query('SELECT id FROM courses WHERE code=$1',[code])).rows[0];
    if(!course)continue;
    for(const module of modules){
      const submodule=(await client.query('SELECT id FROM submodules WHERE course_id=$1 AND title=$2',[course.id,module.module])).rows[0];
      if(!submodule)throw new Error(`Módulo não encontrado no catálogo: ${code} / ${module.module}`);
      for(const [index,item] of module.lessons.entries()){
        const title=typeof item==='string'?item:item[0];
        const summary=typeof item==='string'?null:item[1];
        await client.query(`INSERT INTO course_units(submodule_id,position,title,summary,source_status,source_url,consulted_at)
          VALUES($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT(submodule_id,title) DO UPDATE SET
            position=EXCLUDED.position,
            summary=CASE WHEN course_units.source_status='index_only' AND EXCLUDED.source_status='content_reviewed'
              THEN EXCLUDED.summary ELSE course_units.summary END,
            source_status=CASE WHEN course_units.source_status='index_only' AND EXCLUDED.source_status='content_reviewed'
              THEN 'content_reviewed' ELSE course_units.source_status END,
            consulted_at=CASE WHEN course_units.consulted_at=TIMESTAMPTZ '2026-10-06T12:00:00-03:00'
              THEN EXCLUDED.consulted_at ELSE COALESCE(course_units.consulted_at,EXCLUDED.consulted_at) END,
            updated_at=now()`,[submodule.id,index+1,title,summary,summary?'content_reviewed':'index_only',lessonData.source,summary?lessonData.consultedAt:null]);
        lessonsUpdated++;
      }
    }
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({updated,lessonsUpdated,source:data.source,consultedAt:data.consultedAt},null,2));
}catch(error){
  await client.query('ROLLBACK');
  throw error;
}finally{
  client.release();
  await pool.end();
}
