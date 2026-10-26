import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('trilha CCFA possui resumos e programa oficial confirmado',async()=>{
  const root=process.cwd();
  const [content,migration,ui,server]=await Promise.all([
    fs.readFile(path.resolve(root,'seed/learning-content.json'),'utf8').then(JSON.parse),
    fs.readFile(path.resolve(root,'migrations/014_ccfa_course_summaries.sql'),'utf8'),
    fs.readFile(path.resolve(root,'public/app.js'),'utf8'),
    fs.readFile(path.resolve(root,'src/server.js'),'utf8')
  ]);
  assert.equal(content.courses.length,12);
  assert.ok(content.courses.every(course=>course.summary&&course.topics.length&&course.modules.length));
  assert.equal(content.courses.find(course=>course.code==='ITSEC 121').modules.length,9);
  assert.equal(content.courses.find(course=>course.code==='ILT').modules.length,1);
  assert.match(migration,/INSERT INTO submodules/);
  assert.match(migration,/05\/10\/2026/);
  assert.match(ui,/Índice autenticado: 165 títulos de aulas confirmados/);
  assert.match(server,/confirmed_submodules/);
});
