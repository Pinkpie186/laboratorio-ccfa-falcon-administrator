import test from 'node:test';
import assert from 'node:assert/strict';
import { simulationModePresets,selectSimulationDomain } from '../src/platform-routes.js';

test('modos de simulado têm quantidade e tempo fixos no servidor',()=>{
  assert.deepEqual(Object.keys(simulationModePresets).sort(),
    ['adaptive','custom','domain','error_review','full','quick']);
  assert.deepEqual(simulationModePresets.full,{count:60,durationMinutes:90});
  for(const [mode,preset] of Object.entries(simulationModePresets)){
    assert.ok(Number.isInteger(preset.count)&&preset.count>0,mode);
    assert.ok(Number.isInteger(preset.durationMinutes)&&preset.durationMinutes>=preset.count,mode);
  }
});

test('modo por domínio exige e respeita a escolha explícita do usuário',()=>{
  const candidates=[...Array(10)].map((_,index)=>({id:`a${index}`,category:'Sensor Deployment'}))
    .concat([...Array(12)].map((_,index)=>({id:`b${index}`,category:'Policy Application'})));
  assert.throws(()=>selectSimulationDomain(candidates,'',10),/Escolha um domínio/);
  assert.throws(()=>selectSimulationDomain(candidates,'User Management',10),/possui 0 questões/);
  const selected=selectSimulationDomain(candidates,'Policy Application',10);
  assert.equal(selected.domain,'Policy Application');
  assert.equal(selected.candidates.length,12);
  assert.ok(selected.candidates.every(question=>question.category==='Policy Application'));
});
