import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const packageRoot=path.resolve(projectRoot,'..','output','pdf','crowdstrike_certifications_en');
const fixtures=path.join(packageRoot,'lab_data');
const json=name=>JSON.parse(fs.readFileSync(path.join(packageRoot,name),'utf8'));
const fixtureJson=name=>JSON.parse(fs.readFileSync(path.join(fixtures,name),'utf8'));
const csv=name=>{const [header,...lines]=fs.readFileSync(path.join(fixtures,name),'utf8').trim().split(/\r?\n/);const keys=header.split(',');return lines.map(line=>Object.fromEntries(line.split(',').map((value,index)=>[keys[index],value])));};

test('pacote inglês contém 480 questões equilibradas e 32 labs mapeados',()=>{
  const bank=json('Question_Bank_480_EN.json'),labs=json('Lab_to_Question_Map.json');
  assert.equal(Object.keys(bank).length,8);assert.equal(labs.length,32);
  for(const [code,volume] of Object.entries(bank)){
    assert.equal(volume.questions.length,60,code);
    const answers=Object.fromEntries(['A','B','C','D'].map(letter=>[letter,volume.questions.filter(q=>q.answer===letter).length]));
    assert.deepEqual(answers,{A:15,B:15,C:15,D:15},code);
    assert.equal(labs.filter(lab=>lab.code===code).length,4,code);
    for(const question of volume.questions){assert.equal(question.choices.length,4);assert.equal(question.choices['ABCD'.indexOf(question.answer)],question.correct);}
  }
});

test('fixtures sintéticas reproduzem as correlações esperadas sem rede ou impacto',()=>{
  const events=csv('events.csv'),processes=events.filter(row=>row.event_type==='process');
  assert.equal(events.length,12);assert.equal(processes.length,8);
  assert.equal(processes.filter(row=>row.image==='powershell.exe').length,4);
  assert.equal(new Set(processes.filter(row=>row.image==='powershell.exe').map(row=>row.host_id)).size,4);
  const network=events.filter(row=>row.event_type==='network'&&row.destination_ip==='192.0.2.10');
  assert.deepEqual(new Set(network.map(row=>row.host_id)),new Set(['h1','h2']));
  assert.equal(network.flatMap(n=>processes.filter(p=>n.process_key===p.process_key)).length,6);
  assert.equal(network.flatMap(n=>processes.filter(p=>n.host_id===p.host_id&&n.process_key===p.process_key)).length,2);
  const owners=csv('owners.csv');assert.equal(processes.flatMap(p=>owners.filter(o=>p.host_id.toUpperCase()===o.host_id)).length,11);
  const auth=csv('authentication.csv'),start=Date.parse('2026-09-01T10:00:00Z'),end=Date.parse('2026-09-01T10:05:00Z');
  const failures=auth.filter(row=>row.outcome==='failure'&&Date.parse(row.event_time)>=start&&Date.parse(row.event_time)<end).reduce((out,row)=>(out[row.user_id]=(out[row.user_id]||0)+1,out),{});
  assert.deepEqual(failures,{'alice@lab.example':3,'bob@lab.example':1});
  assert.equal(auth.length,8);assert.equal(new Set(auth.map(row=>row.user_id)).size,3);assert.equal(auth.filter(row=>row.outcome==='failure').length,6);
  assert.equal((Date.parse(auth[5].ingest_time)-Date.parse(auth[5].event_time))/1000,420);
  const pages=fixtureJson('api_pages.json').pages,ids=pages.flatMap(page=>page.resources);
  assert.equal(new Set(ids).size,5);assert.equal(pages[0].pageInfo.hasNextPage,true);assert.equal(pages.at(-1).pageInfo.hasNextPage,false);
  const assets=fixtureJson('cloud_assets.json');assert.equal(assets.filter(x=>x.discovered).length,4);assert.equal(assets.filter(x=>x.posture_assessed).length,3);assert.equal(assets.filter(x=>x.runtime_healthy).length,2);
  assert.deepEqual(csv('case_metrics.csv').map(x=>Number(x.triage_minute)-Number(x.alert_minute)),[5,15,20]);
});
