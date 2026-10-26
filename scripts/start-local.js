import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try{process.loadEnvFile(path.join(root,'.env'));}catch(error){if(error?.code!=='ENOENT')throw error;}
const dataDir=path.join(root,'storage','local-postgres');
await fs.mkdir(path.dirname(dataDir),{recursive:true});
const db=await PGlite.create(dataDir);
const socket=new PGLiteSocketServer({db,host:'127.0.0.1',port:55432});
await socket.start();
const env={...process.env,PGLITE_LOCAL:'1',PG_POOL_MAX:'1',DATABASE_URL:'postgresql://postgres@127.0.0.1:55432/postgres',DATABASE_SSL:'false',HOST:'127.0.0.1',PORT:'8080',APP_ORIGIN:'http://127.0.0.1:8080',STORAGE_DRIVER:'local',LOCAL_STORAGE_PATH:path.join(root,'storage','private'),DOCS_ROOT:path.resolve(root,'..')};
let app;
let stopping=false;

async function run(relative,...args){
  const child=spawn(process.execPath,[path.join(root,relative),...args],{cwd:root,env,stdio:'inherit',windowsHide:true});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  if(code!==0)throw new Error(`${relative} terminou com código ${code}.`);
}

async function stop(){
  if(stopping)return;stopping=true;
  if(app&&!app.killed)app.kill('SIGTERM');
  await socket.stop();await db.close();
}

try{
  await run('scripts/migrate.js');
  const teams=(await db.query('SELECT count(*)::integer AS total FROM teams')).rows[0].total;
  if(teams===0)await run('scripts/seed.js');
  await run('scripts/ensure-manager-demo.js');
  await run('scripts/seed-course-module-summaries.js');
  const englishPackage=path.resolve(root,'..','output','pdf','crowdstrike_certifications_en','Question_Bank_480_EN.json');
  const englishImported=(await db.query("SELECT count(*)::integer AS total FROM question_translations WHERE language='en-US' AND translation_method='user_provided_english_edition'")).rows[0].total;
  if(englishImported<480){
    try{
      await fs.access(englishPackage);
      await run('scripts/import-english-certification-package.js','--apply');
    }catch(error){
      if(error?.code==='ENOENT')console.warn('Pacote inglês não encontrado; a plataforma continuará sem a importação opcional.');
      else throw error;
    }
  }
  app=spawn(process.execPath,[path.join(root,'src','server.js')],{cwd:root,env,stdio:'inherit',windowsHide:true});
  app.once('error',async error=>{console.error(error);await stop();process.exitCode=1;});
  app.once('exit',async code=>{await stop();process.exitCode=code||0;});
  process.on('SIGINT',()=>{stop().then(()=>process.exit(0));});
  process.on('SIGTERM',()=>{stop().then(()=>process.exit(0));});
}catch(error){console.error(error.message);await stop();process.exitCode=1;}
