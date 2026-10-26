import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const catalog=JSON.parse(readFileSync(new URL('seed/ccfa-academy-lessons.json',root),'utf8'));
const modules=JSON.parse(readFileSync(new URL('seed/ccfa-module-summaries.json',root),'utf8'));
const app=readFileSync(new URL('public/app.js',root),'utf8');
const server=readFileSync(new URL('src/server.js',root),'utf8');
const migration=readFileSync(new URL('migrations/021_academy_course_units.sql',root),'utf8');

test('índice autenticado é separado dos resumos efetivamente conferidos',()=>{
  let count=0;
  let reviewed=0;
  for(const [code,groups] of Object.entries(catalog.courses)){
    assert.ok(modules.courses[code]);
    for(const group of groups){
      assert.ok(modules.courses[code].some(module=>module.title===group.module),`${code} / ${group.module}`);
      for(const lesson of group.lessons){
        count++;
        if(Array.isArray(lesson)){
          reviewed++;
          assert.ok(lesson[1].length>100,`${code} / ${lesson[0]}`);
        }else assert.equal(typeof lesson,'string');
      }
    }
  }
  assert.equal(count,165);
  assert.equal(reviewed,25);
});

test('a navegação tem página individual por aula, sem concluir progresso automaticamente',()=>{
  assert.match(app,/function loadLessonDetail\(/);
  assert.match(app,/data-lesson-index/);
  assert.match(app,/id="previousLesson"/);
  assert.match(app,/id="nextLesson"/);
  assert.match(app,/Resumo pendente/);
  assert.match(server,/FROM course_units u WHERE u\.submodule_id=s\.id/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS course_units/);
  assert.doesNotMatch(migration,/UPDATE progress|DELETE FROM progress/);
});
