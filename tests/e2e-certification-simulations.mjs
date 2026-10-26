import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const base=process.env.APP_URL||'http://127.0.0.1:8080';
const reviewerPassword=process.env.DEMO_REVIEWER_PASSWORD;
if(!reviewerPassword)throw new Error('Defina DEMO_REVIEWER_PASSWORD no ambiente privado para executar o teste E2E.');
const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'revisor.demo@example.invalid',password:reviewerPassword})});
assert.equal(login.status,200,'login de teste');
const auth=await login.json(),cookie=login.headers.get('set-cookie')?.split(';')[0];
const headers={cookie,'x-csrf-token':auth.csrf,'content-type':'application/json'};
const list=await (await fetch(`${base}/api/certifications`,{headers:{cookie}})).json();
const original=list.find(x=>x.is_active),expected=['CCCS','CCFA','CCFH','CCFP','CCFR','CCIS','CCSA','CCSE'];
const screenshots=path.resolve('test-artifacts','screenshots');await fs.mkdir(screenshots,{recursive:true});
let browser;
async function choose(row){
  const response=await fetch(`${base}/api/certifications/${row.code}/progress`,{method:'PUT',headers,body:JSON.stringify({status:row.status,percent:Number(row.percent),isActive:true})});
  assert.equal(response.status,200,`ativar ${row.code}`);
}
try{
  for(const code of expected){
    const row=list.find(x=>x.code===code);assert.ok(row,`trilha ${code}`);
    await choose(row);
    const eligibility=await (await fetch(`${base}/api/v2/simulations/eligibility`,{headers:{cookie}})).json();
    assert.equal(eligibility.certification.code,code);
    assert.equal(eligibility.available.published,60,`${code}: questões disponíveis`);
  }
  await choose(list.find(x=>x.code==='CCFP'));
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  for(const width of [1440,360]){
    const context=await browser.newContext({viewport:{width,height:800}}),page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${base}/#simulations`,{waitUntil:'networkidle'});
    await page.locator('#loginForm').getByLabel('E-mail').fill('revisor.demo@example.invalid');
    await page.locator('#loginForm').getByLabel('Senha').fill(reviewerPassword);
    await page.locator('#loginForm button[type="submit"]').click();
    await page.waitForSelector('#simModeDescription:not(:empty)');
    assert.equal(await page.locator('#simForm select').count(),1,'apenas o modo é selecionável');
    assert.equal(await page.locator('#simulationPlayer').count(),1);
    assert.equal(await page.locator('#simulationPlayer').isVisible(),false,'questões não ficam no rodapé');
    await page.locator('#simMode').selectOption('full');
    assert.match(await page.locator('#simModeDescription').innerText(),/60 questões.*90 minutos/);
    await page.locator('#simMode').selectOption('domain');
    await page.locator('#simForm button[type="submit"]').click();
    await page.waitForURL('**/#simulation-confirm');
    assert.match(await page.locator('#simulationConfirmation').innerText(),/10 questões|Questões\s+10/);
    assert.match(await page.locator('#simulationConfirmation').innerText(),/cronômetro começa apenas/i);
    assert.equal(await page.locator('#simulationPlayer').isVisible(),false);
    await page.screenshot({path:path.join(screenshots,`simulation-confirm-${width}.png`),fullPage:true});
    await page.locator('#cancelSimulationStart').click();
    await page.waitForURL('**/#simulations');
    const sample={id:'00000000-0000-4000-8000-000000000001',status:'active',mode:'quick',question_count:10,duration_minutes:20,current_position:1,deadline_at:new Date(Date.now()+20*60_000).toISOString(),questions:Array.from({length:10},(_,index)=>({id:`00000000-0000-4000-8000-${String(index+2).padStart(12,'0')}`,category:'Operações',difficulty:'intermediária',format:'administrative_scenario',correct_count:1,prompt:'Um analista encontra uma detecção em uma VM de teste. Qual é o próximo passo?',options:['Verificar o contexto da detecção.','Ignorar o evento.','Excluir todos os arquivos.','Desligar o tenant.'],answer:null,confidence:null,marked_for_review:false}))};
    await page.route('**/api/v2/simulations/active',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(sample)}));
    await page.goto(`${base}/#simulation-session`,{waitUntil:'networkidle'});
    await page.waitForSelector('#simulationPlayer .simulation-shell');
    assert.equal(await page.locator('#simulationPlayer .answer').count(),4);
    assert.equal(await page.locator('#simulationPlayer .question-nav button').count(),10);
    assert.equal(await page.locator('.sidebar').isVisible(),false,'menu lateral oculto durante a prova');
    assert.equal(await page.locator('.topbar').isVisible(),false,'cabeçalho oculto durante a prova');
    await page.locator('#answerForm input[name="answer"]').first().check();
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#answerForm input[name="answer"]').first().isChecked(),true,'alternativa permanece selecionada');
    await page.screenshot({path:path.join(screenshots,`simulation-session-${width}.png`),fullPage:true});
    await page.route('**/api/v2/simulations/00000000-0000-4000-8000-000000000001/autosave',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({saved:true})}));
    await page.locator('#answerForm button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelector('.simulation-shell .eyebrow')?.textContent?.includes('QUESTÃO 2/10'));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`${width}: rolagem horizontal`);
    assert.deepEqual(errors,[],`${width}: erro de interface`);
    await context.close();
  }
  console.log(JSON.stringify({ok:true,certifications:expected,publishedPerCertification:60,viewports:[1440,360]}));
}catch(error){console.error('Falha no teste de simulados:',error);throw error;
}finally{
  if(browser)await browser.close();
  if(original)await choose(original);
}
