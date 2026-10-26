import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSimulationReport,simulationWeek } from '../src/simulation-report.js';

test('semana do simulado usa segunda-feira em America/Sao_Paulo',()=>{
  assert.deepEqual(simulationWeek(new Date('2026-10-05T02:59:59Z')),{weekStart:'2026-09-28',nextWeekStart:'2026-10-05',timeZone:'America/Sao_Paulo'});
  assert.deepEqual(simulationWeek(new Date('2026-10-05T03:00:00Z')),{weekStart:'2026-10-05',nextWeekStart:'2026-10-12',timeZone:'America/Sao_Paulo'});
});

test('relatório inclui todos os erros e omissões, forças e foco por domínio',()=>{
  const simulation={id:'sim-1',mode:'full',language:'pt-BR',started_at:'2026-09-28T12:00:00Z',finished_at:'2026-09-28T13:00:00Z'};
  const questions=[
    {id:'q1',position:1,category:'Sensores',difficulty:'fácil',prompt:'Cenário 1',options:['A','B'],correct_answer:0,answer:0,correct:true,elapsed_seconds:20},
    {id:'q2',position:2,category:'Sensores',difficulty:'fácil',prompt:'Cenário 2',options:['A','B'],correct_answer:0,answer:0,correct:true,elapsed_seconds:40},
    {id:'q3',position:3,category:'Políticas',difficulty:'difícil',prompt:'Cenário 3',options:['A','B'],correct_answer:1,answer:0,correct:false,elapsed_seconds:60,explanation:'Reveja a precedência.'},
    {id:'q4',position:4,category:'Políticas',difficulty:'difícil',prompt:'Cenário 4',options:['A','B'],correct_answer:1,answer:null,correct:null,elapsed_seconds:null}
  ];
  const report=buildSimulationReport(simulation,questions,{code:'CCFA',title:'Falcon Administrator'});
  assert.equal(report.score,50);
  assert.equal(report.answered,3);
  assert.equal(report.unanswered,1);
  assert.deepEqual(report.missed.map(item=>item.position),[3,4]);
  assert.deepEqual(report.strengths.map(item=>item.domain),['Sensores']);
  assert.deepEqual(report.focus.map(item=>item.domain),['Políticas']);
  assert.equal(report.avgSeconds,40);
  assert.equal(report.certification.code,'CCFA');
});
