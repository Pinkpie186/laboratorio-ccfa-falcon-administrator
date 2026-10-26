import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const server=await fs.readFile(new URL('../src/server.js',import.meta.url),'utf8');
const platform=await fs.readFile(new URL('../src/platform-routes.js',import.meta.url),'utf8');
const app=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
const html=await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8');

test('decisão de prova é permitida ao gestor e ao Revisor Demo, com motivo na reprovação',()=>{
  assert.ok(server.includes('/api/v2/admin/simulation-approvals/:id/decision'));
  assert.match(server,/allow\('manager','admin_reviewer'\)/);
  assert.match(server,/Informe o motivo da reprovação/);
  assert.match(server,/simulation_approval_events/);
});

test('publicação e gestão seguem os perfis da equipe',()=>{
  assert.match(server,/Novas contas são criadas somente por gestores ou pelo Revisor Demo/);
  assert.match(server,/app\.post\('\/api\/v2\/admin\/users'.*allow\('manager','admin_reviewer'\)/);
  assert.match(server,/Somente o Revisor Demo pode conceder acesso total/);
  assert.match(server,/app\.patch\('\/api\/v2\/question-suggestions\/:id'.*allow\('admin_reviewer'\)/);
  assert.match(html,/id="questionSuggestionForm"/);
  assert.match(html,/Todos aparecem no ranking/);
});

test('precisão usa todos os domínios oficiais e escala percentual fixa',()=>{
  assert.match(server,/FROM certification_domains cd LEFT JOIN results r/);
  assert.match(app,/maximum=100/);
  assert.match(app,/class="bar-progress"/);
});

test('envio da prova fica pendente e não entra como concluído antes da decisão',()=>{
  assert.match(platform,/status='pending_approval',approval_status='pending'/);
  assert.match(platform,/status IN \('pending_approval','finished','rejected'\)/);
  assert.match(app,/ainda não entra nos gráficos de desempenho/);
});

test('desempenho é filtrado por usuário e certificação',()=>{
  assert.match(server,/s\.user_id=\$2 AND s\.certification_id=\$3/);
  assert.match(server,/g\.certification_id=\$3/);
  assert.match(html,/id="adminUser"/);
  assert.match(html,/id="adminCertification"/);
});

test('perfil, gráficos e calendário mensal estão presentes',()=>{
  assert.match(html,/data-page="profile"/);
  assert.match(html,/id="performanceTrend"/);
  assert.match(html,/id="domainChart"/);
  assert.doesNotMatch(html,/data-calendar-view="week"/);
  assert.doesNotMatch(html,/Resumo de arquivos/);
  assert.doesNotMatch(html,/Validar resumo/);
});

test('trilha oficial usa leitor separado por módulo e progresso editável',()=>{
  assert.match(html,/data-page="module-detail"/);
  assert.match(app,/class="module-launch-card"/);
  assert.match(app,/id="previousModule"/);
  assert.match(app,/id="nextModule"/);
  assert.match(app,/id="courseProgressEditor"/);
  assert.match(app,/saveCourseProgress/);
  assert.doesNotMatch(app,/Novo percentual \(0–100\)/);
});

test('conclusões da trilha concedem XP único por submódulo e módulo completo',()=>{
  assert.match(server,/\['submodule_completed','Submódulo concluído',5\]/);
  assert.match(server,/\['course_completed','Módulo completo',20\]/);
  assert.match(server,/submodule:\$\{req\.auth\.user_id\}:\$\{req\.params\.id\}:completed/);
  assert.match(server,/course:\$\{req\.auth\.user_id\}:\$\{courseId\}:completed/);
  assert.match(server,/ON CONFLICT\(team_id,idempotency_key\) DO NOTHING RETURNING points/);
  assert.match(app,/Marcar como concluído · \+5 XP/);
  assert.match(app,/concluir todos libera mais 20 XP/);
});

test('gráficos usam largura percentual absoluta',()=>{
  assert.match(app,/class="bar-progress"/);
  assert.match(app,/max="\$\{maximum\}" value="\$\{number\}"/);
});
