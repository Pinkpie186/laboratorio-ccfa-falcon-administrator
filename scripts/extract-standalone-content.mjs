import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.resolve(projectRoot, '..', 'outputs', 'laboratorio-crowdstrike-administrator.html');
const targetPath = path.join(projectRoot, 'seed', 'learning-content.json');
const html = await fs.readFile(sourcePath, 'utf8');

function section(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Seção não encontrada: ${startMarker}`);
  return html.slice(start, end);
}

function evaluate(source, expression) {
  const context = Object.create(null);
  vm.runInNewContext(`${source}\nglobalThis.__result = ${expression};`, context, { timeout: 1000 });
  return JSON.parse(JSON.stringify(context.__result));
}

const labs = evaluate(section('const lab=', 'const DOCUMENTS='), 'LABS');
const glossary = evaluate(section('const GLOSSARY=', 'const tele='), 'GLOSSARY');
const telemetry = evaluate(section('const tele=', 'const QUERY_DOC='), 'TELEMETRY_TESTS');
const queryBlock = section('const QUERY_DOC=', 'DOCUMENTS.push(');
const queryGuide = evaluate(queryBlock, 'QUERY_GUIDE');
const queryExercises = evaluate(queryBlock, 'QUERY_EXERCISES');
const courses = evaluate(section('const TRAINING_SOURCE=', 'const cq='), 'TRAINING_COURSES');

const content = {
  migratedFrom: '../outputs/laboratorio-crowdstrike-administrator.html',
  generatedAt: new Date().toISOString(),
  courses,
  labs,
  telemetry,
  queryGuide,
  queryExercises,
  glossary
};
await fs.writeFile(targetPath, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ targetPath, courses: courses.length, labs: labs.length, telemetry: telemetry.length, queryGuide: queryGuide.length, queryExercises: queryExercises.length, glossary: glossary.length }));
